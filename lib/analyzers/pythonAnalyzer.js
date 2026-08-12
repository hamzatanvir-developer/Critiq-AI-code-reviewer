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

  const practices = [
    ["snake_case naming used", namesUseSnakeCase, namesUseSnakeCase ? "Detected function and variable names use snake_case." : "Rename functions and variables to snake_case."],
    ["Type hints present", typeHintsPresent, typeHintsPresent ? "Detected functions include complete type hints." : "Add parameter and return type hints."],
    ["Docstrings present", docstringsPresent, docstringsPresent ? "Detected functions include docstrings." : "Add docstrings to functions."],
    ["No bare except", !hasBareExcept, hasBareExcept ? "Replace bare except with specific exception types." : "No bare except clauses were found."],
    ["No print statements", !hasPrint, hasPrint ? "Replace print statements with structured logging." : "No print statements were found."],
    ["No global variables", globalAssignments.length === 0, globalAssignments.length ? "Move mutable module state behind functions or classes." : "No module-level assignments were detected."],
    ["is None used instead of == None", !hasNoneEquality, hasNoneEquality ? "Use is None or is not None." : "None comparisons use identity semantics."],
    ["No mutable default arguments", !hasMutableDefaults, hasMutableDefaults ? "Use None defaults and initialize inside functions." : "No mutable default arguments were found."],
  ];

  for (const [rule, passed, description] of practices) {
    bestPractices.push({ rule, status: passed ? "pass" : "fail", description });
  }

  return { bugs, security, performance, quality, bestPractices };
}

export default analyzePython;
