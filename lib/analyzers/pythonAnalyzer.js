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

function indentationOf(line) {
  const whitespace = line.match(/^\s*/)?.[0] ?? "";
  return whitespace.replace(/\t/g, "    ").length;
}

function stripStringsAndComments(code) {
  return code.replace(
    /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*)/g,
    (value) => value.replace(/[^\n]/g, " "),
  );
}

function getFunctions(code) {
  const lines = code.split("\n");
  const functions = [];

  lines.forEach((line, index) => {
    const match = line.match(
      /^(\s*)(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/,
    );

    if (!match) return;

    const indent = indentationOf(line);
    let endLine = lines.length;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (!candidate.trim() || candidate.trimStart().startsWith("#")) continue;
      if (indentationOf(candidate) <= indent) {
        endLine = cursor;
        break;
      }
    }

    const bodyLines = lines.slice(index + 1, endLine);
    const firstBodyLine = bodyLines.find((candidate) => candidate.trim());
    const hasDocstring = Boolean(
      firstBodyLine && /^\s*(?:[rubf]*)(?:"""|''')/i.test(firstBodyLine),
    );

    functions.push({
      name: match[2],
      parameters: match[3],
      returnHint: match[4]?.trim() ?? "",
      startLine: index + 1,
      endLine,
      lineCount: endLine - index,
      body: bodyLines.join("\n"),
      hasDocstring,
    });
  });

  return functions;
}

function isSnakeCase(name) {
  return /^_?[a-z][a-z0-9_]*$/.test(name) && !/[A-Z]/.test(name);
}

function getIndentedBlock(lines, startIndex) {
  const parentIndent = indentationOf(lines[startIndex]);
  let endIndex = lines.length;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (!lines[index].trim() || lines[index].trimStart().startsWith("#")) continue;
    if (indentationOf(lines[index]) <= parentIndent) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex).join("\n");
}

export function analyzePython(code) {
  const source = typeof code === "string" ? code : "";
  const lines = source.split("\n");
  const sanitized = stripStringsAndComments(source);
  const functions = getFunctions(source);
  const bugs = [];
  const security = [];
  const performance = [];
  const quality = [];
  const bestPractices = [];

  addPatternFindings(source, /^\s*except\s*:/gm, (match, line) => {
    addBug(bugs, line, "Bare except catches every exception, including system-exit signals.", "high");
  });
  addPatternFindings(source, /^\s*(?:async\s+)?def\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\})[^)]*\)/gm, (match, line) => {
    addBug(bugs, line, "Mutable default argument is shared between function calls.", "high");
  });
  addPatternFindings(source, /(?:==|!=)\s*None\b|\bNone\s*(?:==|!=)/g, (match, line) => {
    addBug(bugs, line, "None is compared with equality instead of identity.", "medium");
  });
  addPatternFindings(source, /^\s*except\s+Exception\s+as\s+\w+\s*:\s*(?:\n\s+)?pass\s*$/gm, (match, line) => {
    addBug(bugs, line, "Exception is swallowed with pass.", "high");
  });
  for (const fn of functions) {
    const appearsToReturnValue =
      Boolean(fn.returnHint && fn.returnHint !== "None") ||
      /\b(?:get|find|calculate|compute|create|build|parse|load|fetch|read)_?/.test(
        fn.name,
      );
    const hasValueReturn = /^\s*return\s+\S+/m.test(fn.body);

    if (appearsToReturnValue && !hasValueReturn) {
      addBug(
        bugs,
        fn.startLine,
        `Function "${fn.name}" appears to produce a value but has no value-returning statement.`,
        "medium",
      );
    }
  }
  addPatternFindings(source, /^\s*while\s+True\s*:/gm, (match, line) => {
    const loopIndent = indentationOf(lines[line - 1]);
    const loopBody = [];
    for (let index = line; index < lines.length; index += 1) {
      if (lines[index].trim() && indentationOf(lines[index]) <= loopIndent) break;
      loopBody.push(lines[index]);
    }
    if (!/^\s*break\b/m.test(loopBody.join("\n"))) {
      addBug(bugs, line, "Infinite while True loop has no break statement.", "high");
    }
  });
  addPatternFindings(source, /^\s*(?:if|elif|while)\s+[^:\n]*(?<![=!<>:])=(?!=)[^:\n]*:/gm, (match, line) => {
    addBug(bugs, line, "Assignment operator is used where a comparison is expected.", "high");
  });

  const builtinNames = "list|dict|set|tuple|str|int|float|bool|bytes|id|input|open|type|sum|min|max|len|range|filter|map|zip|object|property|super";
  const shadowedBuiltins = new Set();
  addPatternFindings(sanitized, new RegExp(`(?:^|\\n)\\s*(${builtinNames})\\s*=`, "g"), (match, line) => {
    shadowedBuiltins.add(match[1]);
    addBug(bugs, line, `Do not shadow Python built-in name "${match[1]}".`, "high");
  });
  for (const fn of functions) {
    const parameters = fn.parameters.split(",").map((item) => item.trim().split(/[:=]/)[0].trim().replace(/^\*+/, ""));
    for (const parameter of parameters.filter((name) => new RegExp(`^(?:${builtinNames})$`).test(name))) {
      shadowedBuiltins.add(parameter);
      addBug(bugs, fn.startLine, `Do not shadow Python built-in name "${parameter}".`, "high");
    }
  }
  addPatternFindings(source, /\btype\s*\([^)]*\)\s*(?:==|!=|is(?:\s+not)?)\s*[A-Za-z_][\w.]*/g, (match, line) => {
    addBug(bugs, line, "Use isinstance() for type checking instead of comparing type() results.", "medium");
  });
  addPatternFindings(sanitized, /(?:\b\d+(?:\.\d+)?|\b[A-Za-z_]\w*)\s*(?:<|<=)\s*([A-Za-z_]\w*)\s*(?:>|>=)\s*(?:\d+(?:\.\d+)?|[A-Za-z_]\w*)/g, (match, line) => {
    addBug(bugs, line, `Chained comparison around "${match[1]}" points in conflicting directions.`, "medium");
  });
  addPatternFindings(source, /^\s*return\s+(?:f?["'][^"']*["']|[A-Za-z_]\w*)\s*\+\s*(?:f?["']|str\s*\(|[A-Za-z_]\w*)/gm, (match, line) => {
    addBug(bugs, line, "String concatenation in a return statement is difficult to maintain; use f-strings or join() for string building.", "medium");
  });
  for (const fn of functions) {
    const recursiveCall = new RegExp(`\\b${fn.name}\\s*\\(`).test(fn.body);
    const hasBaseCase = /^\s*(?:if|elif)\b[^:]*:\s*(?:\n\s+)?return\b/m.test(fn.body);
    if (recursiveCall && !hasBaseCase) {
      addBug(bugs, fn.startLine, `Recursive function "${fn.name}" has no detectable base case and may recurse indefinitely.`, "high");
    }
  }
  lines.forEach((lineText, index) => {
    if (!/^\s*return\b/.test(lineText)) return;
    const returnIndent = indentationOf(lineText);
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (!candidate.trim() || candidate.trimStart().startsWith("#")) continue;
      const candidateIndent = indentationOf(candidate);
      if (candidateIndent < returnIndent) break;
      if (candidateIndent === returnIndent && !/^\s*(?:else|elif|except|finally)\b/.test(candidate)) {
        addBug(bugs, index + 1, "Code after this return statement is unreachable.", "medium");
      }
      break;
    }
  });
  addPatternFindings(source, /^([ \t]*)for\s+\w+\s+in\s+([A-Za-z_]\w*)\s*:\s*$/gm, (match, line) => {
    const body = getIndentedBlock(lines, line - 1);
    if (new RegExp(`\\b${match[2]}\\.(?:append|extend|insert|remove|pop|clear)\\s*\\(`).test(body)) {
      addBug(bugs, line, `List "${match[2]}" is modified while it is being iterated.`, "high");
    }
  });
  lines.forEach((lineText, index) => {
    const classMatch = lineText.match(/^\s*class\s+([A-Za-z_]\w*)\s*\(([^)]+)\)\s*:/);
    if (!classMatch || classMatch[2].trim() === "object") return;
    const body = getIndentedBlock(lines, index);
    if (/^\s*def\s+__init__\s*\(/m.test(body) && !/\bsuper\s*\(\s*\)\s*\.\s*__init__\s*\(/.test(body)) {
      addBug(bugs, index + 1, `Subclass "${classMatch[1]}" defines __init__() without calling super().__init__().`, "medium");
    }
  });

  const securityRules = [
    [/\b(?:eval|exec)\s*\(/g, "Dynamic code execution detected.", "eval/exec is dangerous, avoid dynamic code execution."],
    [/\bpickle\.loads?\s*\(/g, "Unsafe pickle deserialization detected.", "pickle is unsafe with untrusted data, use json instead."],
    [/\bsubprocess\.(?:run|call|Popen|check_call|check_output)\s*\([\s\S]{0,300}?shell\s*=\s*True/g, "Subprocess is executed through a shell.", "shell=True is a security risk, use list arguments."],
    [/\bos\.system\s*\(/g, "Command execution through os.system detected.", "Use subprocess module instead of os.system."],
  ];
  for (const [pattern, issue, recommendation] of securityRules) {
    addPatternFindings(source, pattern, (match, line) =>
      addIssue(security, line, issue, "recommendation", recommendation),
    );
  }
  addPatternFindings(source, /\b(password|secret|api_key)\s*=\s*["'][^"']+["']/gi, (match, line) => {
    addIssue(security, line, `Hardcoded ${match[1]} detected.`, "recommendation", "Move secrets to environment variables or a secrets manager.");
  });
  addPatternFindings(source, /f["']\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{[^}]+\}[^"']*["']/gi, (match, line) => {
    addIssue(security, line, "SQL query interpolates values directly into the statement.", "recommendation", "Use parameterized queries to prevent SQL injection.");
  });
  addPatternFindings(source, /\byaml\.load\s*\(([^)]*)\)/g, (match, line) => {
    if (!/\bLoader\s*=/.test(match[1])) {
      addSeverityIssue(security, line, "yaml.load() is called without an explicit safe loader.", "recommendation", "Use yaml.safe_load() to prevent code execution.", "high");
    }
  });
  addPatternFindings(source, /\bhashlib\.(?:md5|sha1)\s*\(|\bhashlib\.new\s*\(\s*["'](?:md5|sha1)["']/gi, (match, line) => {
    addSeverityIssue(security, line, "Weak cryptographic hash algorithm detected.", "recommendation", "MD5 and SHA1 are weak, use SHA256 or better.", "medium");
  });
  addPatternFindings(source, /\btempfile\.mktemp\s*\(/g, (match, line) => {
    addSeverityIssue(security, line, "tempfile.mktemp() is vulnerable to race conditions.", "recommendation", "Use tempfile.mkstemp() instead to prevent race conditions.", "high");
  });
  let hasSecurityAssert = false;
  addPatternFindings(source, /^\s*assert\s+[^\n]*(?:auth|permission|role|user|token|password|secret|access|admin)/gim, (match, line) => {
    addSeverityIssue(security, line, "assert is used for a security-sensitive validation.", "recommendation", "assert can be disabled with -O flag, use proper validation.", "high");
    hasSecurityAssert = true;
  });
  addPatternFindings(source, /\bdebug\s*=\s*True\b/g, (match, line) => {
    addSeverityIssue(security, line, "Application debug mode is hardcoded as enabled.", "recommendation", "Never deploy with debug=True.", "high");
  });
  addPatternFindings(source, /\bopen\s*\(([^)\n]*)\)/g, (match, line) => {
    const argumentsText = match[1];
    const binaryMode = /["'][^"']*b[^"']*["']/.test(argumentsText);
    if (!binaryMode && !/\bencoding\s*=/.test(argumentsText)) {
      addSeverityIssue(security, line, "Text file is opened without an explicit encoding.", "recommendation", "Always specify encoding in open().", "low");
    }
  });

  addPatternFindings(source, /^\s*(?:for|while)\b[^:]*:\s*\n(?:\s+.*\n){0,20}?\s+\w+\s*\+=\s*(?:f?["']|str\s*\()/gm, (match, line) => {
    addIssue(performance, line, "String concatenation is repeated inside a loop.", "suggestion", "Use join() for string concatenation in loops.");
  });
  addPatternFindings(source, /\[(?!\s*\])[^\]\n]+\bfor\s+\w+\s+in\s+(?:range\s*\([^)]{4,}\)|\w+)[^\]\n]*\]/g, (match, line) => {
    addIssue(performance, line, "List comprehension eagerly allocates a list that may be large.", "suggestion", "Use generator expression for large datasets.");
  });

  const dictionaryLookups = new Map();
  addPatternFindings(sanitized, /\b([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]/g, (match, line) => {
    const key = `${match[1]}[${match[2].trim()}]`;
    const occurrences = dictionaryLookups.get(key) ?? [];
    occurrences.push(line);
    dictionaryLookups.set(key, occurrences);
  });
  for (const [lookup, occurrences] of dictionaryLookups) {
    if (occurrences.length > 2) {
      addIssue(performance, occurrences[2], `Dictionary lookup ${lookup} is repeated.`, "suggestion", "Cache dictionary values in variables.");
    }
  }

  const globalAssignments = [];
  lines.forEach((line, index) => {
    if (/^[A-Za-z_]\w*\s*=/.test(stripStringsAndComments(line))) {
      globalAssignments.push(index + 1);
      addIssue(performance, index + 1, "Module-level mutable variable detected.", "suggestion", "Minimize global variable usage.");
    }
  });
  addPatternFindings(source, /^([ \t]*)for\s+.+:\s*\n(?:\1[ \t]+.*\n)*?\1[ \t]+for\s+.+:/gm, (match, line) => {
    addIssue(performance, line, "Nested loops may have O(n²) complexity.", "suggestion", "Consider optimizing O(n²) complexity.");
  });

  addPatternFindings(source, /^([ \t]*)(?:for|while)\b[^:]*:\s*\n(?:(?:\1[ \t]+).*\n){0,30}?\1[ \t]+[A-Za-z_]\w*\s*=\s*[A-Za-z_]\w*\s*\+\s*(?:f?["']|[A-Za-z_]\w*)/gm, (match, line) => {
    addSeverityIssue(performance, line, "String is rebuilt with + inside a loop.", "suggestion", "Use list and join() for string building in loops.", "high");
  });
  addPatternFindings(source, /^([ \t]*)(?:for|while)\b[^:]*:\s*$/gm, (match, line) => {
    const body = getIndentedBlock(lines, line - 1);
    const lookups = new Map();
    for (const lookup of body.matchAll(/\b([A-Za-z_]\w*\.[A-Za-z_]\w*)\b/g)) {
      lookups.set(lookup[1], (lookups.get(lookup[1]) ?? 0) + 1);
    }
    const repeated = [...lookups.entries()].find(([, count]) => count > 1);
    if (repeated) {
      addSeverityIssue(performance, line, `Attribute lookup "${repeated[0]}" is repeated inside a loop.`, "suggestion", "Cache attribute lookups before loops.", "medium");
    }
  });
  const hasRangeLen = /\bfor\s+\w+\s+in\s+range\s*\(\s*len\s*\(/.test(source);
  addPatternFindings(source, /\bfor\s+\w+\s+in\s+range\s*\(\s*len\s*\([^)]*\)\s*\)\s*:/g, (match, line) => {
    addSeverityIssue(performance, line, "Loop uses range(len()) to access sequence indexes.", "suggestion", "Use enumerate() instead of range(len()).", "medium");
  });
  addPatternFindings(source, /^([ \t]*)for\s+([A-Za-z_]\w*)\s+in\s+([^:\n]+):\s*\n\1[ \t]+([A-Za-z_]\w*)\.append\s*\(\s*([^\n]+)\s*\)\s*$/gm, (match, line) => {
    addSeverityIssue(performance, line, `Simple loop only appends values to "${match[4]}".`, "suggestion", "Use a list comprehension for this simple transformation.", "low");
  });
  let hasOpenWithoutContextManager = false;
  addPatternFindings(source, /^(\s*)(?!with\s+)(?:[A-Za-z_]\w*\s*=\s*)?open\s*\([^\n]+\)/gm, (match, line) => {
    addSeverityIssue(performance, line, "File is opened without a context manager.", "suggestion", "Use with statement for file handling.", "medium");
    hasOpenWithoutContextManager = true;
  });
  addPatternFindings(source, /\blist\s*\(\s*[^()[\]]+\s+for\s+\w+\s+in\s+[^)]+\)/g, (match, line) => {
    addSeverityIssue(performance, line, "Generator expression is immediately wrapped in list().", "suggestion", "Use a list comprehension directly or keep the generator lazy.", "low");
  });

  addPatternFindings(source, /^\s*print\s*\(/gm, (match, line) => {
    addIssue(quality, line, "print() statement found.", "improvement", "Remove print() statements before production.");
  });
  addPatternFindings(source, /#.*\b(?:TODO|FIXME)\b/gi, (match, line) => {
    addIssue(quality, line, "Unresolved TODO or FIXME comment found.", "improvement", "Resolve before production.");
  });
  for (const fn of functions) {
    if (fn.lineCount > 50) {
      addIssue(quality, fn.startLine, `Function "${fn.name}" is ${fn.lineCount} lines long.`, "improvement", "Break into smaller functions.");
    }
    if (!fn.hasDocstring) {
      addIssue(quality, fn.startLine, `Function "${fn.name}" has no docstring.`, "improvement", "Add docstrings to all functions.");
    }

    const parameters = fn.parameters
      .split(",")
      .map((parameter) => parameter.trim())
      .filter(Boolean);
    const hasParameterHints = parameters.every(
      (parameter) => parameter.startsWith("*") || parameter.includes(":"),
    );
    if (!hasParameterHints || !fn.returnHint) {
      addIssue(quality, fn.startLine, `Function "${fn.name}" is missing complete type hints.`, "improvement", "Add type hints for better code clarity.");
    }
  }
  addPatternFindings(sanitized, /\b([a-hl-zA-HL-Z])\s*=(?!=)/g, (match, line) => {
    addIssue(quality, line, `Single-letter variable "${match[1]}" is not descriptive.`, "improvement", "Use descriptive variable names.");
  });
  lines.forEach((line, index) => {
    const indent = indentationOf(line);
    if (line.trim() && indent >= 16) {
      addIssue(quality, index + 1, "Code is nested four or more indentation levels deep.", "improvement", "Reduce nesting with early returns.");
    }
  });

  for (const fn of functions) {
    const parameters = fn.parameters.split(",").map((item) => item.trim()).filter(Boolean);
    if (parameters.length > 5) {
      addSeverityIssue(quality, fn.startLine, `Function "${fn.name}" has ${parameters.length} parameters.`, "improvement", "Reduce parameters or group related values in an object.", "medium");
    }
  }
  lines.forEach((lineText, index) => {
    if (lineText.length > 79) {
      addSeverityIssue(quality, index + 1, `Line is ${lineText.length} characters long.`, "improvement", "PEP8 recommends max 79 characters per line.", "low");
    }
    if (/[ \t]+$/.test(lineText)) {
      addSeverityIssue(quality, index + 1, "Trailing whitespace found.", "improvement", "Remove trailing whitespace.", "low");
    }
    const leadingWhitespace = lineText.match(/^[ \t]+/)?.[0] ?? "";
    if ((leadingWhitespace.includes(" ") && leadingWhitespace.includes("\t")) || (lineText.trim() && leadingWhitespace && indentationOf(lineText) % 4 !== 0)) {
      addSeverityIssue(quality, index + 1, "Inconsistent indentation detected.", "improvement", "Use four spaces consistently for indentation.", "high");
    }
  });
  if (/^\s*from\s+\.+[A-Za-z_]/m.test(source)) {
    addSeverityIssue(quality, 1, "Relative package import detected; ensure the package includes __init__.py.", "improvement", "Add and maintain __init__.py for package awareness.", "low");
  }

  const importedNames = [];
  addPatternFindings(source, /^\s*import\s+([^#\n]+)/gm, (match, line) => {
    for (const item of match[1].split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      importedNames.push({ name: parts[1] ?? parts[0].split(".")[0], line });
    }
  });
  addPatternFindings(source, /^\s*from\s+[A-Za-z_.][\w.]*\s+import\s+([^#\n]+)/gm, (match, line) => {
    if (match[1].trim() === "*") return;
    for (const item of match[1].split(",")) {
      const parts = item.trim().replace(/[()]/g, "").split(/\s+as\s+/);
      if (parts[0]) importedNames.push({ name: parts[1] ?? parts[0], line });
    }
  });
  for (const imported of importedNames) {
    const occurrences = Array.from(sanitized.matchAll(new RegExp(`\\b${imported.name}\\b`, "g"))).length;
    if (occurrences <= 1) {
      addSeverityIssue(quality, imported.line, `Imported name "${imported.name}" is not used.`, "improvement", "Remove unused imports.", "medium");
    }
  }
  const hasWildcardImports = /^\s*from\s+[A-Za-z_.][\w.]*\s+import\s+\*/m.test(source);
  addPatternFindings(source, /^\s*from\s+[A-Za-z_.][\w.]*\s+import\s+\*/gm, (match, line) => {
    addSeverityIssue(quality, line, "Wildcard import obscures which names enter the module.", "improvement", "Avoid wildcard imports.", "medium");
  });

  const functionNames = functions.map((fn) => fn.name);
  const assignmentNames = [...sanitized.matchAll(/^\s*([A-Za-z_]\w*)\s*=/gm)].map(
    (match) => match[1],
  );
  const namesUseSnakeCase = [...functionNames, ...assignmentNames].every(isSnakeCase);
  const typeHintsPresent = functions.length === 0 || functions.every((fn) => fn.returnHint && fn.parameters.split(",").filter((item) => item.trim()).every((item) => item.includes(":") || item.trim().startsWith("*")));
  const docstringsPresent = functions.length === 0 || functions.every((fn) => fn.hasDocstring);
  const hasBareExcept = /^\s*except\s*:/m.test(source);
  const hasPrint = /^\s*print\s*\(/m.test(source);
  const hasNoneEquality = /(?:==|!=)\s*None\b|\bNone\s*(?:==|!=)/.test(source);
  const hasMutableDefaults = /^\s*(?:async\s+)?def\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\})[^)]*\)/m.test(source);
  const hasTypeComparison = /\btype\s*\([^)]*\)\s*(?:==|!=|is(?:\s+not)?)\s*[A-Za-z_][\w.]*/.test(source);
  const hasIsInstance = /\bisinstance\s*\(/.test(source);
  const hasFString = /(?:^|[^A-Za-z_])f["']/.test(source);
  const hasLegacyStringFormatting = /["'][^"'\n]*["']\s*%|["'][^"'\n]*["']\.format\s*\(|^\s*return\s+(?:["'][^"']*["']|[A-Za-z_]\w*)\s*\+/m.test(source);

  const practices = [
    ["snake_case naming used", namesUseSnakeCase, namesUseSnakeCase ? "Detected function and variable names use snake_case." : "Rename functions and variables to snake_case."],
    ["Type hints present", typeHintsPresent, typeHintsPresent ? "Detected functions include complete type hints." : "Add parameter and return type hints."],
    ["Docstrings present", docstringsPresent, docstringsPresent ? "Detected functions include docstrings." : "Add docstrings to functions."],
    ["No bare except", !hasBareExcept, hasBareExcept ? "Replace bare except with specific exception types." : "No bare except clauses were found."],
    ["No print statements", !hasPrint, hasPrint ? "Replace print statements with structured logging." : "No print statements were found."],
    ["No global variables", globalAssignments.length === 0, globalAssignments.length ? "Move mutable module state behind functions or classes." : "No module-level assignments were detected."],
    ["is None used instead of == None", !hasNoneEquality, hasNoneEquality ? "Use is None or is not None." : "None comparisons use identity semantics."],
    ["No mutable default arguments", !hasMutableDefaults, hasMutableDefaults ? "Use None defaults and initialize inside functions." : "No mutable default arguments were found."],
    ["enumerate() used instead of range(len())", !hasRangeLen, hasRangeLen ? "Replace range(len(sequence)) loops with enumerate(sequence)." : "No range(len()) loops were found."],
    ["Context managers used for files", !hasOpenWithoutContextManager, hasOpenWithoutContextManager ? "Open files inside a with statement." : "File operations use context managers or no file opens were found."],
    ["No wildcard imports", !hasWildcardImports, hasWildcardImports ? "Import required names explicitly." : "No wildcard imports were found."],
    ["No shadowed builtins", shadowedBuiltins.size === 0, shadowedBuiltins.size ? "Rename variables or parameters that shadow Python built-ins." : "No Python built-ins are shadowed."],
    ["isinstance() used for type checking", !hasTypeComparison || hasIsInstance, hasTypeComparison && !hasIsInstance ? "Replace direct type comparisons with isinstance()." : "Type checks use isinstance() or no direct type comparisons were found."],
    ["f-strings used for formatting", hasFString || !hasLegacyStringFormatting, hasLegacyStringFormatting && !hasFString ? "Replace percent or .format() formatting with f-strings." : hasFString ? "F-strings are used for string formatting." : "No legacy string formatting was found."],
    ["No assert for security", !hasSecurityAssert, hasSecurityAssert ? "Replace security-sensitive assertions with explicit validation." : "No security-sensitive assert statements were found."],
  ];

  for (const [rule, passed, description] of practices) {
    bestPractices.push({ rule, status: passed ? "pass" : "fail", description });
  }

  return { bugs, security, performance, quality, bestPractices };
}

export default analyzePython;
