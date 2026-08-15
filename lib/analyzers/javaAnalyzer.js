function lineNumberAt(code, index) {
  return code.slice(0, index).split("\n").length;
}

function addPatternFindings(code, pattern, callback) {
  for (const match of code.matchAll(pattern)) {
    callback(match, lineNumberAt(code, match.index));
  }
}

function addBug(target, line, issue, severity) {
  target.push({ line: String(line), issue, severity });
}

function addIssue(target, line, issue, detailName, detail) {
  target.push({ line: String(line), issue, [detailName]: detail });
}

function addSeverityIssue(target, line, issue, detailName, detail, severity) {
  target.push({
    line: String(line),
    issue,
    [detailName]: detail,
    severity,
  });
}

function stripStringsAndComments(code) {
  return code.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,
    (value) => value.replace(/[^\n]/g, " "),
  );
}

function findBlockEnd(code, openingBrace) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingBrace; index < code.length; index += 1) {
    const character = code[index];
    const nextCharacter = code[index + 1];

    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      index = code.indexOf("\n", index);
      if (index === -1) return code.length - 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      index = code.indexOf("*/", index + 2);
      if (index === -1) return code.length - 1;
      index += 1;
      continue;
    }

    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return index;
  }

  return code.length - 1;
}

function getMethods(code) {
  const methods = [];
  const pattern = /(?:^|\n)\s*(?:(public|protected|private)\s+)?(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s+)?([A-Za-z_$][\w$<>\[\], ?]*)\s+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^{]+)?\{/g;
  const controlWords = new Set(["if", "for", "while", "switch", "catch", "try", "do"]);

  for (const match of code.matchAll(pattern)) {
    if (controlWords.has(match[3])) continue;
    const openingBrace = code.indexOf("{", match.index + match[0].length - 1);
    const end = findBlockEnd(code, openingBrace);
    methods.push({
      access: match[1] ?? "",
      returnType: match[2].trim(),
      name: match[3],
      start: match.index,
      end,
      startLine: lineNumberAt(code, match.index),
      lineCount: lineNumberAt(code, end) - lineNumberAt(code, match.index) + 1,
      body: code.slice(openingBrace + 1, end),
      parameters: match[0]
        .slice(match[0].indexOf("(") + 1, match[0].lastIndexOf(")"))
        .split(",")
        .map((parameter) => parameter.trim())
        .filter(Boolean),
    });
  }

  return methods;
}

function getClasses(code) {
  const classes = [];
  const pattern = /\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$<>., ]*))?[^;{]*\{/g;

  for (const match of code.matchAll(pattern)) {
    const openingBrace = code.indexOf("{", match.index);
    const end = findBlockEnd(code, openingBrace);
    classes.push({
      name: match[1],
      extendsName: match[2]?.trim() ?? "",
      start: match.index,
      end,
      startLine: lineNumberAt(code, match.index),
      lineCount: lineNumberAt(code, end) - lineNumberAt(code, match.index) + 1,
      body: code.slice(openingBrace + 1, end),
    });
  }

  return classes;
}

function isCamelCase(name) {
  return /^[a-z][A-Za-z0-9]*$/.test(name) && !name.includes("_");
}

function isPascalCase(name) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !name.includes("_");
}

export function analyzeJava(code) {
  const source = typeof code === "string" ? code : "";
  const sanitized = stripStringsAndComments(source);
  const lines = source.split("\n");
  const methods = getMethods(source);
  const classes = getClasses(source);
  const bugs = [];
  const security = [];
  const performance = [];
  const quality = [];
  const bestPractices = [];

  addPatternFindings(source, /catch\s*\([^)]*\)\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g, (match, line) => {
    addBug(bugs, line, "Empty catch block silently discards an exception.", "high");
  });

  const nullableVariables = new Set();
  addPatternFindings(sanitized, /\b([A-Za-z_$][\w$]*)\s*=\s*null\s*;/g, (match) => {
    nullableVariables.add(match[1]);
  });
  for (const variable of nullableVariables) {
    const methodCall = new RegExp(`\\b${variable.replace(/[$]/g, "\\$")}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`, "g");
    addPatternFindings(sanitized, methodCall, (match, line) => {
      const nearby = lines.slice(Math.max(0, line - 4), line).join("\n");
      const nullCheck = new RegExp(`${variable.replace(/[$]/g, "\\$")}\\s*!=\\s*null|null\\s*!=\\s*${variable.replace(/[$]/g, "\\$")}`);
      if (!nullCheck.test(nearby)) {
        addBug(bugs, line, `Method is called on potentially null variable "${variable}".`, "high");
      }
    });
  }
  addPatternFindings(source, /\b([A-Za-z_$][\w$]*)\s*(==|!=)\s*("(?:\\.|[^"\\])*")|("(?:\\.|[^"\\])*")\s*(==|!=)\s*([A-Za-z_$][\w$]*)/g, (match, line) => {
    addBug(bugs, line, "String values are compared with == or != instead of equals().", "high");
  });
  const stringVariables = new Set();
  addPatternFindings(sanitized, /\bString\s+([A-Za-z_$][\w$]*)\b/g, (match) => stringVariables.add(match[1]));
  addPatternFindings(sanitized, /\b([A-Za-z_$][\w$]*)\s*(?:==|!=)\s*([A-Za-z_$][\w$]*)\b/g, (match, line) => {
    if (stringVariables.has(match[1]) || stringVariables.has(match[2])) {
      addBug(bugs, line, "String values are compared with == or !=; use .equals() for String comparison.", "high");
    }
  });
  addPatternFindings(source, /catch\s*\(\s*Exception\s+([A-Za-z_$][\w$]*)\s*\)\s*\{([\s\S]*?)\}/g, (match, line) => {
    const body = match[2];
    const exceptionName = match[1];
    if (!/(?:log|logger)\s*\.|throw\s+/.test(body) && !new RegExp(`${exceptionName.replace(/[$]/g, "\\$")}\\.printStackTrace\\s*\\(`).test(body)) {
      addBug(bugs, line, "Generic Exception is caught without logging or rethrowing.", "medium");
    }
  });
  addPatternFindings(source, /(?:while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))\s*\{/g, (match, line) => {
    const openingBrace = source.indexOf("{", match.index);
    const body = source.slice(openingBrace + 1, findBlockEnd(source, openingBrace));
    if (!/\bbreak\b|\breturn\b|\bthrow\b/.test(body)) {
      addBug(bugs, line, "Infinite loop has no break, return, or throw condition.", "high");
    }
  });
  addPatternFindings(source, /\bcase\s+[^:]+:\s*([\s\S]*?)(?=\bcase\s+|\bdefault\s*:|\})/g, (match, line) => {
    if (!/\b(?:break|return|throw|yield)\b/.test(match[1])) {
      addBug(bugs, line, "Switch case may fall through because it has no break or terminating statement.", "medium");
    }
  });
  addPatternFindings(source, /new\s+(?:FileInputStream|FileOutputStream|BufferedReader|BufferedWriter)\s*\(/g, (match, line) => {
    const nearby = source.slice(Math.max(0, match.index - 250), match.index);
    if (!/try\s*\([^)]*$/.test(nearby)) {
      addBug(bugs, line, "I/O resource is created outside try-with-resources and may leak.", "high");
    }
  });
  addPatternFindings(source, /\b(?:float|double)\s+\w+\s*=\s*[A-Za-z_$\d][\w$]*\s*\/\s*[A-Za-z_$\d][\w$]*\s*;/g, (match, line) => {
    if (!/\(\s*(?:float|double)\s*\)|\d+\.\d+/.test(match[0])) {
      addBug(bugs, line, "Integer division is assigned to a floating-point variable without a cast.", "medium");
    }
  });
  for (const method of methods.filter((item) => /(?:Collection|List|Set|Map|Queue|Deque|Iterable|Stream)(?:\s*<|\b)/.test(item.returnType))) {
    addPatternFindings(method.body, /\breturn\s+null\s*;/g, (match, relativeLine) => {
      addBug(bugs, method.startLine + relativeLine - 1, `Collection-returning method "${method.name}" returns null; return an empty collection instead.`, "high");
    });
  }
  let hasUnpairedEquals = false;
  for (const javaClass of classes) {
    const hasEquals = /\bboolean\s+equals\s*\(\s*(?:final\s+)?Object\b/.test(javaClass.body);
    const hasHashCode = /\bint\s+hashCode\s*\(\s*\)/.test(javaClass.body);
    if (hasEquals && !hasHashCode) {
      addBug(bugs, javaClass.startLine, `Class "${javaClass.name}" overrides equals() without hashCode(); always override both methods.`, "high");
      hasUnpairedEquals = true;
    }
  }
  addPatternFindings(source, /catch\s*\(\s*[A-Za-z_$][\w$<>.]*\s+([A-Za-z_$][\w$]*)\s*\)\s*\{\s*throw\s+\1\s*;\s*\}/g, (match, line) => {
    addBug(bugs, line, "Caught exception is rethrown unchanged without adding context.", "medium");
  });
  addPatternFindings(sanitized, /\b(?:int|long)\s+[A-Za-z_$][\w$]*\s*=\s*[^;]*(?:\+|\*|<<)[^;]*;/g, (match, line) => {
    const nearby = lines.slice(Math.max(0, line - 4), line + 1).join("\n");
    if (!/(?:Math\.(?:addExact|multiplyExact)|MAX_VALUE|MIN_VALUE|compareUnsigned|longValueExact)/.test(nearby)) {
      addBug(bugs, line, "Integer arithmetic may overflow without a bounds check or exact arithmetic helper.", "high");
    }
  });
  addPatternFindings(source, /\bstatic\s+(?:final\s+)?SimpleDateFormat\s+[A-Za-z_$][\w$]*\s*=/g, (match, line) => {
    addBug(bugs, line, "Static SimpleDateFormat is not thread-safe; use ThreadLocal or DateTimeFormatter.", "high");
  });
  addPatternFindings(source, /\bCollections\.EMPTY_LIST\b/g, (match, line) => {
    addBug(bugs, line, "Collections.EMPTY_LIST is raw and unsafe; use Collections.emptyList().", "low");
  });
  let hasMissingOverride = false;
  for (const javaClass of classes.filter((item) => item.extendsName)) {
    for (const method of getMethods(javaClass.body).filter((item) => item.access !== "private")) {
      const prefix = javaClass.body.slice(Math.max(0, method.start - 160), method.start);
      if (!/@Override\s*$/.test(prefix.trimEnd())) {
        addBug(bugs, javaClass.startLine + method.startLine - 1, `Possible overriding method "${method.name}" is missing @Override annotation.`, "medium");
        hasMissingOverride = true;
      }
    }
  }

  addPatternFindings(source, /\b(?:password|passwd|credential|secret|apiKey|api_key)\s*=\s*"[^"\n]+"/gi, (match, line) => {
    addIssue(security, line, "Hardcoded credential detected.", "recommendation", "Never hardcode credentials, use environment variables.");
  });
  addPatternFindings(source, /"\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*"\s*\+|(?:SELECT|INSERT|UPDATE|DELETE)[^;\n]*\+\s*\w+/gi, (match, line) => {
    addIssue(security, line, "SQL statement is built through string concatenation.", "recommendation", "Use PreparedStatement to prevent SQL injection.");
  });
  for (const method of methods.filter((item) => item.name !== "main")) {
    addPatternFindings(method.body, /\bSystem\.exit\s*\(/g, (match, relativeLine) => {
      addIssue(security, method.startLine + relativeLine - 1, `System.exit() is called inside "${method.name}".`, "recommendation", "Avoid System.exit() in library code.");
    });
  }
  addPatternFindings(source, /\bRuntime\.getRuntime\s*\(\s*\)\.exec\s*\(/g, (match, line) => {
    addIssue(security, line, "Runtime.exec() executes an external command.", "recommendation", "Validate input before passing to Runtime.exec().");
  });
  addPatternFindings(source, /\bclass\s+([A-Za-z_$][\w$]*)[^\{]*\bimplements\s+[^\{]*\bSerializable\b[^\{]*\{/g, (match, line) => {
    const openingBrace = source.indexOf("{", match.index);
    const body = source.slice(openingBrace + 1, findBlockEnd(source, openingBrace));
    if (!/\bserialVersionUID\b/.test(body)) {
      addIssue(security, line, `Serializable class "${match[1]}" has no serialVersionUID.`, "recommendation", "Add serialVersionUID to Serializable classes.");
    }
  });
  addPatternFindings(source, /\.printStackTrace\s*\(/g, (match, line) => {
    addIssue(security, line, "printStackTrace() exposes implementation details and bypasses structured logging.", "recommendation", "Use proper logging framework instead of printStackTrace.");
  });
  const hasWeakDigest = /\bMessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1)"/i.test(source);
  addPatternFindings(source, /\bMessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1)"\s*\)/gi, (match, line) => {
    addSeverityIssue(security, line, "Weak MessageDigest algorithm is used.", "recommendation", "Use SHA-256 or stronger hashing algorithm.", "high");
  });
  const hasInsecureRandom = /\b(?:token|secret|password|nonce|session|otp|key|salt)\w*\s*=\s*(?:new\s+Random\s*\(|[A-Za-z_$][\w$]*\.next(?:Int|Long|Bytes|Double)\s*\()/i.test(source);
  addPatternFindings(source, /\b(?:token|secret|password|nonce|session|otp|key|salt)\w*\s*=\s*(?:new\s+Random\s*\(|[A-Za-z_$][\w$]*\.next(?:Int|Long|Bytes|Double)\s*\()/gi, (match, line) => {
    addSeverityIssue(security, line, "java.util.Random is used for a security-sensitive value.", "recommendation", "Use SecureRandom for security-sensitive random numbers.", "high");
  });
  addPatternFindings(source, /\b(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory)\.newInstance\s*\(\s*\)/g, (match, line) => {
    const nearby = source.slice(match.index, match.index + 1500);
    if (!/(?:disallow-doctype-decl|external-general-entities|external-parameter-entities|ACCESS_EXTERNAL_DTD|SUPPORT_DTD)[\s\S]{0,200}(?:false|"")/i.test(nearby)) {
      addSeverityIssue(security, line, "XML parser is created without disabling external entity processing.", "recommendation", "Disable external entity processing to prevent XXE attacks.", "high");
    }
  });
  addPatternFindings(source, /\b([A-Za-z_$][\w$]*)\.readObject\s*\(\s*\)/g, (match, line) => {
    const nearby = source.slice(match.index, match.index + 600);
    if (!/(?:ObjectInputFilter|instanceof|validate|check|allowlist|whitelist)/i.test(nearby)) {
      addSeverityIssue(security, line, "ObjectInputStream.readObject() result is used without detectable validation.", "recommendation", "Validate deserialized objects to prevent attacks.", "high");
    }
  });
  addPatternFindings(source, /\bHttpURLConnection\s+([A-Za-z_$][\w$]*)\s*=/g, (match, line) => {
    const escapedName = match[1].replace(/[$]/g, "\\$");
    const nearby = source.slice(match.index, match.index + 1200);
    if (!new RegExp(`${escapedName}\\.setConnectTimeout\\s*\\(`).test(nearby) || !new RegExp(`${escapedName}\\.setReadTimeout\\s*\\(`).test(nearby)) {
      addSeverityIssue(security, line, `HttpURLConnection "${match[1]}" is missing connection or read timeout configuration.`, "recommendation", "Always set connection and read timeouts.", "medium");
    }
  });
  addPatternFindings(source, /\b(?:log|logger)\.(?:trace|debug|info|warn|error)\s*\([^;\n]*(?:password|passwd|token|secret|ssn|creditCard|email)/gi, (match, line) => {
    addSeverityIssue(security, line, "Sensitive data may be written to application logs.", "recommendation", "Never log passwords, tokens, or PII data.", "high");
  });
  addPatternFindings(source, /\bCipher\.getInstance\s*\(\s*"(?:DES(?:ede)?|RC4)(?:\/[^"\n]*)?"\s*\)/gi, (match, line) => {
    addSeverityIssue(security, line, "Weak cipher algorithm is configured.", "recommendation", "Use AES-256 instead of weak ciphers.", "high");
  });

  addPatternFindings(source, /(?:for|while)\s*\([^)]*\)\s*\{([\s\S]{0,1000}?)\}/g, (match, line) => {
    const body = match[1];
    if (/\bString\s+\w+\s*=|\w+\s*\+=\s*(?:"|\w+)/.test(body) && /\+/.test(body)) {
      addIssue(performance, line, "String concatenation occurs inside a loop.", "suggestion", "Use StringBuilder in loops.");
    }
    if (/\bnew\s+[A-Za-z_$][\w$<>]*\s*\(/.test(body)) {
      addIssue(performance, line, "Object is created repeatedly inside a loop.", "suggestion", "Move object creation outside loops when possible.");
    }
    if (/(?:for|while)\s*\(/.test(body)) {
      addIssue(performance, line, "Nested loops may have O(n²) complexity.", "suggestion", "Consider optimizing O(n²) complexity.");
    }
  });
  addPatternFindings(source, /\b(?:Vector|Hashtable)\s*</g, (match, line) => {
    addIssue(performance, line, `${match[0].split("<")[0].trim()} is a legacy synchronized collection.`, "suggestion", "Use ArrayList or HashMap instead.");
  });
  addPatternFindings(source, /\bSystem\.out\.println\s*\(/g, (match, line) => {
    addIssue(performance, line, "System.out.println is used in production code.", "suggestion", "Use logging framework (SLF4J/Log4j).");
  });
  addPatternFindings(source, /\bnew\s+(?:Boolean|Integer|Long)\s*\(/g, (match, line) => {
    addIssue(performance, line, "Unnecessary wrapper object is created.", "suggestion", "Use primitive types or valueOf().");
  });
  addPatternFindings(source, /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,1200}?\bString\.format\s*\(/g, (match, line) => {
    addSeverityIssue(performance, line, "String.format() is repeatedly executed inside a loop.", "suggestion", "Cache String.format() results or use StringBuilder.", "medium");
  });
  addPatternFindings(source, /\bArrayList\s*<[^>]+>\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+ArrayList\s*<[^>]*>\s*\([^)]*\)/g, (match, line) => {
    const escapedName = match[1].replace(/[$]/g, "\\$");
    const remainder = source.slice(match.index + match[0].length);
    if (new RegExp(`\\b${escapedName}\\.(?:add\\s*\\(\\s*0\\s*,|remove\\s*\\(\\s*0\\s*\\))`).test(remainder)) {
      addSeverityIssue(performance, line, `ArrayList "${match[1]}" is used for frequent front insertions or removals.`, "suggestion", "Use LinkedList when frequent insertions at the beginning are required.", "low");
    }
  });
  addPatternFindings(source, /\bnew\s+HashMap\s*<[^>]*>\s*\(\s*\)/g, (match, line) => {
    addSeverityIssue(performance, line, "HashMap is created without an initial capacity.", "suggestion", "Specify initial capacity for HashMap when size is known.", "low");
  });
  const nonFinalFields = new Set();
  addPatternFindings(sanitized, /^\s*(?:public|protected|private)\s+(?![^;\n]*\bfinal\b)(?:static\s+)?[A-Za-z_$][\w$<>, ?\[\]]*\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/gm, (match) => {
    nonFinalFields.add(match[1]);
  });
  addPatternFindings(source, /\bsynchronized\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g, (match, line) => {
    if (nonFinalFields.has(match[1])) {
      addSeverityIssue(performance, line, `Synchronization locks on non-final field "${match[1]}".`, "suggestion", "Synchronize on final fields only.", "high");
    }
  });
  addPatternFindings(source, /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,1200}?\b(?:Boolean|Integer|Long|Double|Float|Short|Byte|Character)\s+[A-Za-z_$][\w$]*\s*=\s*(?:[A-Za-z_$][\w$]*|\d+|true|false)\s*;/g, (match, line) => {
    addSeverityIssue(performance, line, "Primitive value is unnecessarily autoboxed inside a loop.", "suggestion", "Use primitive local variables inside performance-critical loops.", "medium");
  });

  addPatternFindings(source, /^\s*(?!public\b|protected\b|private\b|class\b|interface\b|enum\b|record\b|@)(?:static\s+|final\s+)*(?:[A-Za-z_$][\w$<>\[\], ?]*\s+)+[A-Za-z_$][\w$]*\s*(?:[=;]|\()/gm, (match, line) => {
    if (!/^\s*(?:if|for|while|switch|catch|return|throw)\b/.test(match[0])) {
      addIssue(quality, line, "Class member or method is missing an explicit access modifier.", "improvement", "Always specify access modifiers.");
    }
  });
  addPatternFindings(source, /\/\/.*\b(?:TODO|FIXME)\b|\/\*[\s\S]*?\b(?:TODO|FIXME)\b[\s\S]*?\*\//gi, (match, line) => {
    addIssue(quality, line, "Unresolved TODO or FIXME comment found.", "improvement", "Resolve before production.");
  });
  for (const method of methods.filter((item) => item.lineCount > 50)) {
    addIssue(quality, method.startLine, `Method "${method.name}" is ${method.lineCount} lines long.`, "improvement", "Break into smaller methods.");
  }
  addPatternFindings(sanitized, /(^|[^\w.])(-?(?:[2-9]|[1-9]\d+)(?:\.\d+)?)[fFdDlL]?\b/gm, (match, line) => {
    addIssue(quality, line, `Magic number ${match[2]} is hardcoded.`, "improvement", "Use named constants instead of magic numbers.");
  });
  let nestingDepth = 0;
  lines.forEach((line, index) => {
    const cleanLine = stripStringsAndComments(line);
    nestingDepth -= (cleanLine.match(/}/g) ?? []).length;
    if (nestingDepth >= 4 && cleanLine.trim()) {
      addIssue(quality, index + 1, "Code is nested four or more levels deep.", "improvement", "Reduce nesting with early returns.");
    }
    nestingDepth += (cleanLine.match(/{/g) ?? []).length;
    nestingDepth = Math.max(0, nestingDepth);
  });

  const classNames = [...source.matchAll(/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)].map((match) => ({ name: match[1], line: lineNumberAt(source, match.index) }));
  for (const item of classNames.filter(({ name }) => !isPascalCase(name))) {
    addIssue(quality, item.line, `Class name "${item.name}" is not PascalCase.`, "improvement", "Class names must be PascalCase.");
  }
  for (const method of methods.filter((item) => !isCamelCase(item.name))) {
    addIssue(quality, method.startLine, `Method name "${method.name}" is not camelCase.`, "improvement", "Method names must be camelCase.");
  }

  for (const javaClass of classes.filter((item) => item.lineCount > 300)) {
    addSeverityIssue(quality, javaClass.startLine, `Class "${javaClass.name}" is ${javaClass.lineCount} lines long.`, "improvement", "Break large classes into smaller focused classes.", "medium");
  }
  for (const method of methods) {
    const decisionPoints = method.body.match(/\b(?:if|for|while|case|catch)\b|&&|\|\||\?(?![?.])/g)?.length ?? 0;
    if (decisionPoints > 10) {
      addSeverityIssue(quality, method.startLine, `Method "${method.name}" has cyclomatic complexity ${decisionPoints + 1}.`, "improvement", "Reduce method complexity by extracting methods.", "high");
    }
  }
  let hasPublicFields = false;
  addPatternFindings(source, /^\s*public\s+(?!class\b|interface\b|enum\b|record\b|(?:static\s+)?final\b)(?:static\s+)?[A-Za-z_$][\w$<>, ?\[\]]*\s+([A-Za-z_$][\w$]*)\s*(?:=|;)/gm, (match, line) => {
    addSeverityIssue(quality, line, `Public field "${match[1]}" exposes mutable state.`, "improvement", "Make fields private and expose controlled accessors when needed.", "medium");
    hasPublicFields = true;
  });
  for (const javaClass of classes) {
    const constructorPattern = new RegExp(`\\b(?:public|protected|private)?\\s*${javaClass.name}\\s*\\([^)]*\\)\\s*\\{(?:\\s|//[^\\n]*|/\\*[\\s\\S]*?\\*/)*\\}`, "g");
    addPatternFindings(javaClass.body, constructorPattern, (match, relativeLine) => {
      addSeverityIssue(quality, javaClass.startLine + relativeLine - 1, `Constructor for "${javaClass.name}" is empty.`, "improvement", "Remove unnecessary empty constructors.", "low");
    });
  }
  for (const method of methods) {
    const methodBody = stripStringsAndComments(method.body);
    addPatternFindings(methodBody, /(?:^|[;{}]\s*)\b(?:boolean|byte|short|int|long|float|double|char|String|[A-Z][\w$<>]*)\s+([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/g, (match, relativeLine) => {
      const escapedName = match[1].replace(/[$]/g, "\\$");
      if ((methodBody.match(new RegExp(`\\b${escapedName}\\b`, "g")) ?? []).length === 1) {
        addSeverityIssue(quality, method.startLine + relativeLine - 1, `Local variable "${match[1]}" is declared but never used.`, "improvement", "Remove unused local variables.", "medium");
      }
    });
    if (method.parameters.length > 5) {
      addSeverityIssue(quality, method.startLine, `Method "${method.name}" has ${method.parameters.length} parameters.`, "improvement", "Reduce the parameter list or introduce a parameter object.", "medium");
    }
    if (method.access === "public") {
      const prefix = source.slice(Math.max(0, method.start - 800), method.start).trimEnd();
      if (!/\/\*\*[\s\S]*?\*\/\s*(?:@[A-Za-z_$][\w$]*(?:\([^)]*\))?\s*)*$/.test(prefix)) {
        addSeverityIssue(quality, method.startLine, `Public method "${method.name}" has no Javadoc.`, "improvement", "Add Javadoc describing the method contract.", "low");
      }
    }
  }

  const hasEmptyCatch = /catch\s*\([^)]*\)\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/.test(source);
  const hasGenericSwallow = /catch\s*\(\s*Exception\s+\w+\s*\)\s*\{\s*(?:pass\s*;?)?\s*\}/.test(source);
  const hasHardcodedCredentials = /\b(?:password|passwd|credential|secret|apiKey|api_key)\s*=\s*"[^"\n]+"/i.test(source);
  const hasPrintln = /\bSystem\.out\.println\s*\(/.test(source);
  const hasLoopConcatenation = /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,1000}?\+=\s*(?:"|\w+)/.test(source);
  const hasStringBuilder = /\bStringBuilder\b/.test(source);
  const hasResourceCreation = /new\s+(?:FileInputStream|FileOutputStream|BufferedReader|BufferedWriter)\s*\(/.test(source);
  const hasTryWithResources = /try\s*\([^)]*(?:FileInputStream|FileOutputStream|BufferedReader|BufferedWriter)/.test(source);
  const accessModifiersPresent = methods.every((method) => Boolean(method.access));
  const hasSecureRandom = /\bSecureRandom\b/.test(source);
  const hasMagicNumbers = /(^|[^\w.])(-?(?:[2-9]|[1-9]\d+)(?:\.\d+)?)[fFdDlL]?\b/m.test(sanitized);
  const hasPrintStackTrace = /\.printStackTrace\s*\(/.test(source);

  const practices = [
    ["PascalCase class names", classNames.every(({ name }) => isPascalCase(name)), classNames.every(({ name }) => isPascalCase(name)) ? "All detected class-like names use PascalCase." : "Rename class-like declarations to PascalCase."],
    ["camelCase method names", methods.every((method) => isCamelCase(method.name)), methods.every((method) => isCamelCase(method.name)) ? "All detected methods use camelCase." : "Rename methods to camelCase."],
    ["Access modifiers present", accessModifiersPresent, accessModifiersPresent ? "Detected methods specify access modifiers." : "Add explicit access modifiers to members and methods."],
    ["No System.out.println", !hasPrintln, hasPrintln ? "Replace System.out.println with structured logging." : "No System.out.println calls were found."],
    ["Proper exception handling", !hasEmptyCatch && !hasGenericSwallow, !hasEmptyCatch && !hasGenericSwallow ? "No empty or swallowed exception handlers were found." : "Log, handle, or rethrow caught exceptions."],
    ["No hardcoded credentials", !hasHardcodedCredentials, hasHardcodedCredentials ? "Move credentials to environment variables or a secrets manager." : "No hardcoded credentials were found."],
    ["StringBuilder used in loops", !hasLoopConcatenation || hasStringBuilder, !hasLoopConcatenation || hasStringBuilder ? "Loop string construction avoids repeated immutable concatenation." : "Use StringBuilder for repeated string construction in loops."],
    ["Try-with-resources used", !hasResourceCreation || hasTryWithResources, !hasResourceCreation || hasTryWithResources ? "Detected resources use try-with-resources or no tracked resources exist." : "Wrap closeable resources in try-with-resources."],
    ["SecureRandom used for security", !hasInsecureRandom, hasInsecureRandom ? "Replace security-sensitive java.util.Random usage with SecureRandom." : hasSecureRandom ? "SecureRandom is used for security-sensitive randomness." : "No insecure security-sensitive random usage was found."],
    ["No MD5/SHA1 for security", !hasWeakDigest, hasWeakDigest ? "Replace MD5 or SHA-1 with SHA-256 or stronger." : "No MD5 or SHA-1 MessageDigest usage was found."],
    ["equals() and hashCode() paired", !hasUnpairedEquals, hasUnpairedEquals ? "Override hashCode() whenever equals() is overridden." : "Detected equals() implementations are paired with hashCode()."],
    ["No public fields", !hasPublicFields, hasPublicFields ? "Make mutable public fields private." : "No mutable public fields were found."],
    ["@Override annotation present", !hasMissingOverride, hasMissingOverride ? "Add @Override to overriding methods." : "No overriding methods missing @Override were detected."],
    ["No magic numbers", !hasMagicNumbers, hasMagicNumbers ? "Replace meaningful numeric literals with named constants." : "No magic numbers were found."],
    ["Proper logging framework used", !hasPrintln && !hasPrintStackTrace, hasPrintln || hasPrintStackTrace ? "Replace console output and stack traces with SLF4J or Log4j." : "No direct console or stack-trace logging was found."],
  ];

  for (const [rule, passed, description] of practices) {
    bestPractices.push({ rule, status: passed ? "pass" : "fail", description });
  }

  return { bugs, security, performance, quality, bestPractices };
}

export default analyzeJava;
