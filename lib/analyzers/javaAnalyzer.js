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
    });
  }

  return methods;
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
  addPatternFindings(source, /\bnew\s+(?:Boolean|Integer)\s*\(/g, (match, line) => {
    addIssue(performance, line, "Unnecessary wrapper object is created.", "suggestion", "Use primitive types or valueOf().");
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

  const hasEmptyCatch = /catch\s*\([^)]*\)\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/.test(source);
  const hasGenericSwallow = /catch\s*\(\s*Exception\s+\w+\s*\)\s*\{\s*(?:pass\s*;?)?\s*\}/.test(source);
  const hasHardcodedCredentials = /\b(?:password|passwd|credential|secret|apiKey|api_key)\s*=\s*"[^"\n]+"/i.test(source);
  const hasPrintln = /\bSystem\.out\.println\s*\(/.test(source);
  const hasLoopConcatenation = /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,1000}?\+=\s*(?:"|\w+)/.test(source);
  const hasStringBuilder = /\bStringBuilder\b/.test(source);
  const hasResourceCreation = /new\s+(?:FileInputStream|FileOutputStream|BufferedReader|BufferedWriter)\s*\(/.test(source);
  const hasTryWithResources = /try\s*\([^)]*(?:FileInputStream|FileOutputStream|BufferedReader|BufferedWriter)/.test(source);
  const accessModifiersPresent = methods.every((method) => Boolean(method.access));

  const practices = [
    ["PascalCase class names", classNames.every(({ name }) => isPascalCase(name)), classNames.every(({ name }) => isPascalCase(name)) ? "All detected class-like names use PascalCase." : "Rename class-like declarations to PascalCase."],
    ["camelCase method names", methods.every((method) => isCamelCase(method.name)), methods.every((method) => isCamelCase(method.name)) ? "All detected methods use camelCase." : "Rename methods to camelCase."],
    ["Access modifiers present", accessModifiersPresent, accessModifiersPresent ? "Detected methods specify access modifiers." : "Add explicit access modifiers to members and methods."],
    ["No System.out.println", !hasPrintln, hasPrintln ? "Replace System.out.println with structured logging." : "No System.out.println calls were found."],
    ["Proper exception handling", !hasEmptyCatch && !hasGenericSwallow, !hasEmptyCatch && !hasGenericSwallow ? "No empty or swallowed exception handlers were found." : "Log, handle, or rethrow caught exceptions."],
    ["No hardcoded credentials", !hasHardcodedCredentials, hasHardcodedCredentials ? "Move credentials to environment variables or a secrets manager." : "No hardcoded credentials were found."],
    ["StringBuilder used in loops", !hasLoopConcatenation || hasStringBuilder, !hasLoopConcatenation || hasStringBuilder ? "Loop string construction avoids repeated immutable concatenation." : "Use StringBuilder for repeated string construction in loops."],
    ["Try-with-resources used", !hasResourceCreation || hasTryWithResources, !hasResourceCreation || hasTryWithResources ? "Detected resources use try-with-resources or no tracked resources exist." : "Wrap closeable resources in try-with-resources."],
  ];

  for (const [rule, passed, description] of practices) {
    bestPractices.push({ rule, status: passed ? "pass" : "fail", description });
  }

  return { bugs, security, performance, quality, bestPractices };
}

export default analyzeJava;
