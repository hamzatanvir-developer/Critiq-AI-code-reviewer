const reservedWords = new Set([
  "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends",
  "false", "finally", "for", "function", "if", "import", "in",
  "instanceof", "let", "new", "null", "of", "return", "static",
  "super", "switch", "this", "throw", "true", "try", "typeof",
  "undefined", "var", "void", "while", "with", "yield", "async",
]);

const browserGlobals = new Set([
  "Array", "Boolean", "Date", "Error", "Function", "JSON", "Map",
  "Math", "Number", "Object", "Promise", "RegExp", "Set", "String",
  "Symbol", "URL", "Uint8Array", "WeakMap", "WeakSet", "atob", "btoa",
  "clearInterval", "clearTimeout", "console", "document", "fetch",
  "globalThis", "history", "localStorage", "location", "navigator",
  "performance", "requestAnimationFrame", "sessionStorage", "setInterval",
  "setTimeout", "window",
]);

function lineNumberAt(code, index) {
  return code.slice(0, index).split("\n").length;
}

function lineContentAt(code, index) {
  return code.split("\n")[lineNumberAt(code, index) - 1]?.trim() ?? "";
}

function addPatternFindings(code, pattern, callback) {
  for (const match of code.matchAll(pattern)) {
    callback(match, lineNumberAt(code, match.index), lineContentAt(code, match.index));
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
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,
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

    if (character === '"' || character === "'" || character === "`") {
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

function getFunctions(code) {
  const functions = [];
  const patterns = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g,
  ];

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const openingBrace = code.indexOf("{", match.index + match[0].length - 1);
      const end = findBlockEnd(code, openingBrace);
      functions.push({
        name: match[1] || "anonymous function",
        start: match.index,
        end,
        body: code.slice(openingBrace + 1, end),
        startLine: lineNumberAt(code, match.index),
        lineCount: lineNumberAt(code, end) - lineNumberAt(code, match.index) + 1,
        isAsync: /\basync\b/.test(match[0]),
        parameters: match[0]
          .slice(match[0].indexOf("(") + 1, match[0].lastIndexOf(")"))
          .split(",")
          .map((parameter) => parameter.trim())
          .filter(Boolean),
      });
    }
  }

  return functions;
}

function detectDuplicateObjectKeys(code, bugs) {
  let found = false;

  addPatternFindings(code, /\{[^{}]*\}/g, (match, line) => {
    const keys = new Set();
    const keyPattern = /(?:^|,)\s*(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))\s*:/g;

    for (const keyMatch of match[0].slice(1, -1).matchAll(keyPattern)) {
      const key = keyMatch[1] ?? keyMatch[2];
      if (keys.has(key)) {
        addBug(bugs, line, `Duplicate object key "${key}" overrides an earlier value.`, "high");
        found = true;
        break;
      }
      keys.add(key);
    }
  });

  return found;
}

function findUnhandledPromises(code, functions, bugs) {
  const asyncNames = functions
    .filter((fn) => fn.isAsync && fn.name !== "anonymous function")
    .map((fn) => fn.name);
  const callNames = ["fetch", ...asyncNames]
    .map((name) => name.replace(/[$]/g, "\\$"))
    .join("|");
  const promisePattern = new RegExp(
    `(?:^|[;{}]\\s*)(?!await\\b|return\\b)(?:(?:const|let|var)\\s+\\w+\\s*=\\s*)?(?:new\\s+Promise\\s*\\(|(?:${callNames})\\s*\\()`,
    "gm",
  );
  let found = false;

  addPatternFindings(code, promisePattern, (match, line) => {
    const statement = code.slice(match.index, code.indexOf(";", match.index) + 1 || code.length);
    if (!/\.(?:then|catch|finally)\s*\(/.test(statement)) {
      addBug(bugs, line, "Promise-producing call is not awaited, returned, or handled with .catch().", "high");
      found = true;
    }
  });

  return found;
}

function detectCommentedOutCode(code, quality) {
  let found = false;
  const pattern = /^\s*\/\/\s*(?:(?:const|let|var|return|throw|if|for|while|function|class|import|export)\b|[A-Za-z_$][\w$]*\s*(?:=|\())/gm;

  addPatternFindings(code, pattern, (match, line) => {
    addSeverityIssue(quality, line, "Commented-out code block found.", "improvement", "Remove commented out code.", "low");
    found = true;
  });

  return found;
}

function detectUsedBeforeDeclaration(code, bugs) {
  const sanitized = stripStringsAndComments(code);
  const declarations = new Map();
  const declarationPattern = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;

  for (const match of sanitized.matchAll(declarationPattern)) {
    if (!declarations.has(match[1])) declarations.set(match[1], match.index);
  }

  const reported = new Set();
  for (const [name, declarationIndex] of declarations) {
    const usagePattern = new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`, "g");
    for (const match of sanitized.matchAll(usagePattern)) {
      if (match.index >= declarationIndex) break;
      const previousCharacter = sanitized[match.index - 1];
      if (previousCharacter === "." || reported.has(name)) continue;
      addBug(
        bugs,
        lineNumberAt(code, match.index),
        `"${name}" is used before its declaration.`,
        "medium",
      );
      reported.add(name);
      break;
    }
  }
}

function detectDuplicateBlocks(code, quality) {
  const normalizedLines = code
    .split("\n")
    .map((line, index) => ({ text: line.trim(), line: index + 1 }))
    .filter(({ text }) => text.length > 12 && !/^[{}()[\],;]+$/.test(text));
  const seen = new Map();

  for (let index = 0; index <= normalizedLines.length - 3; index += 1) {
    const block = normalizedLines
      .slice(index, index + 3)
      .map(({ text }) => text)
      .join("\n");

    if (seen.has(block)) {
      addIssue(
        quality,
        normalizedLines[index].line,
        "Duplicate code block detected.",
        "improvement",
        "Extract duplicate code into reusable functions.",
      );
      return;
    }

    seen.set(block, normalizedLines[index].line);
  }
}

export function analyzeJavaScript(code) {
  const source = typeof code === "string" ? code : "";
  const bugs = [];
  const security = [];
  const performance = [];
  const quality = [];
  const bestPractices = [];
  const functions = getFunctions(source);
  const sanitized = stripStringsAndComments(source);

  addPatternFindings(source, /(^|[^=!])(?:==|!=)(?!=)/gm, (match, line) => {
    addBug(bugs, line, "Loose equality can cause unexpected type coercion; use strict equality.", "high");
  });
  detectUsedBeforeDeclaration(source, bugs);
  addPatternFindings(source, /catch\s*\([^)]*\)\s*\{\s*\}/g, (match, line) => {
    addBug(bugs, line, "Empty catch block silently discards errors.", "high");
  });
  addPatternFindings(source, /\breturn\b[^;\n]*;[^}\n]*(?:\n\s*)?(?!case\b|default\b)([A-Za-z_$])/g, (match, line) => {
    addBug(bugs, line, "Code after this return statement may be unreachable.", "medium");
  });
  for (const fn of functions.filter((item) => item.isAsync && !/\btry\s*\{/.test(item.body))) {
    addBug(bugs, fn.startLine, `Async function "${fn.name}" has no try/catch error handling.`, "high");
  }
  addPatternFindings(sanitized, /\b[A-Za-z_$][\w$]*\s*\/\s*([A-Za-z_$][\w$]*|\d+(?:\.\d+)?)/g, (match, line) => {
    const divisor = match[1];
    const nearby = source.split("\n").slice(Math.max(0, line - 3), line + 1).join("\n");
    if (!new RegExp(`${divisor.replace(/[$]/g, "\\$")}\\s*(?:!==?|>|<)\\s*0|0\\s*(?:!==?|<)\\s*${divisor.replace(/[$]/g, "\\$")}`).test(nearby)) {
      addBug(bugs, line, "Division is performed without an explicit zero check.", "medium");
    }
  });
  addPatternFindings(source, /while\s*\(\s*true\s*\)\s*\{/g, (match, line) => {
    const open = source.indexOf("{", match.index);
    const body = source.slice(open + 1, findBlockEnd(source, open));
    if (!/\bbreak\b/.test(body)) addBug(bugs, line, "Infinite while(true) loop has no break statement.", "high");
  });

  addPatternFindings(source, /\barguments\.(?:caller|callee)\b/g, (match, line) => {
    addBug(bugs, line, "arguments.caller/callee is deprecated.", "high");
  });
  addPatternFindings(sanitized, /\b(?:if|while)\s*\([^)]*(?<![=!<>])=(?!=|>)[^)]*\)/g, (match, line) => {
    addBug(bugs, line, "Assignment in condition is likely a bug, use == or ===.", "high");
  });
  const hasDuplicateObjectKeys = detectDuplicateObjectKeys(source, bugs);
  addPatternFindings(source, /\bthrow\b[^;\n]*;[^}\n]*(?:\n\s*)?(?!case\b|default\b)([A-Za-z_$])/g, (match, line) => {
    addBug(bugs, line, "Code after this throw statement may be unreachable.", "medium");
  });
  const validTypeofValues = new Set([
    "undefined", "object", "boolean", "number", "bigint", "string", "symbol", "function",
  ]);
  addPatternFindings(source, /\btypeof\s+[^=!<>\n]+\s*(?:===?|!==?)\s*["']([^"']+)["']/g, (match, line) => {
    if (!validTypeofValues.has(match[1])) {
      addBug(bugs, line, `typeof is compared with invalid type string "${match[1]}".`, "high");
    }
  });
  addPatternFindings(sanitized, /(?:\bNaN\s*(?:===?|!==?)\s*[^;\n)]+|[^;\n(]+\s*(?:===?|!==?)\s*NaN\b)/g, (match, line) => {
    addBug(bugs, line, "NaN comparison is always unreliable; use Number.isNaN() or isNaN().", "high");
  });

  let hasMissingAwait = false;
  for (const asyncFunction of functions.filter((fn) => fn.isAsync && fn.name !== "anonymous function")) {
    const escapedName = asyncFunction.name.replace(/[$]/g, "\\$");
    const callPattern = new RegExp(`(^|[;{}]\\s*)(?!await\\s+|return\\s+)${escapedName}\\s*\\(`, "gm");
    addPatternFindings(source, callPattern, (match, line) => {
      if (match.index === asyncFunction.start) return;
      addBug(bugs, line, `Async function "${asyncFunction.name}" is called without await.`, "high");
      hasMissingAwait = true;
    });
  }
  const hasUnhandledPromises = findUnhandledPromises(source, functions, bugs);

  const securityRules = [
    [/\beval\s*\(/g, "eval() usage can execute untrusted code.", "eval() is dangerous, use JSON.parse or Function constructor."],
    [/\bdocument\.write\s*\(/g, "document.write() usage can inject unsafe markup.", "document.write() can cause XSS attacks."],
    [/\.innerHTML\s*=/g, "Direct innerHTML assignment can introduce XSS.", "innerHTML can cause XSS, use textContent or DOMPurify."],
    [/\bdangerouslySetInnerHTML\s*=/g, "dangerouslySetInnerHTML is used without guaranteed sanitization.", "Use DOMPurify before setting HTML."],
    [/\blocalStorage\.(?:setItem|getItem)\s*\(\s*["'`](?:password|secret|token|api[_-]?key|auth)/gi, "Sensitive data appears to be stored in localStorage.", "Do not store sensitive data in localStorage."],
  ];
  for (const [pattern, issue, recommendation] of securityRules) {
    addPatternFindings(source, pattern, (match, line) => addIssue(security, line, issue, "recommendation", recommendation));
  }
  addPatternFindings(source, /\b(password|secret|apiKey|api_key)\s*[:=]\s*["'`][^"'`]+["'`]/gi, (match, line) => {
    addIssue(security, line, `Hardcoded ${match[1]} detected.`, "recommendation", "Move secrets to protected environment variables or a secrets manager.");
  });
  addPatternFindings(source, /\b(?:token|secret|password|nonce|session|otp|uuid|key)\w*\s*[:=][^;\n]*\bMath\.random\s*\(/gi, (match, line) => {
    addSeverityIssue(security, line, "Math.random() is used to generate a security-sensitive value.", "recommendation", "Math.random() is not cryptographically secure, use crypto.getRandomValues().", "medium");
  });
  addPatternFindings(source, /(?:addEventListener\s*\(\s*["']message["']|\.onmessage\s*=)[\s\S]{0,1000}/g, (match, line) => {
    if (!/\b(?:event|e|messageEvent)\.origin\b/.test(match[0])) {
      addSeverityIssue(security, line, "Message event handler does not verify the sender origin.", "recommendation", "Always verify origin in postMessage handler.", "high");
    }
  });
  addPatternFindings(source, /\bdocument\.cookie\s*=\s*([^\n]+)/g, (match, line) => {
    if (!/\bSecure\b/i.test(match[1]) || !/\bHttpOnly\b/i.test(match[1])) {
      addSeverityIssue(security, line, "Cookie is set without Secure and HttpOnly attributes.", "recommendation", "Set Secure and HttpOnly flags on sensitive cookies.", "high");
    }
  });
  addPatternFindings(source, /\/(?:\\.|[^/\n])*\((?:\\.|[^)\n])*[+*](?:\\.|[^)\n])*\)[+*](?:\?|\{\d[^}]*\})?(?:[dgimsuvy]*)/g, (match, line) => {
    addSeverityIssue(security, line, "Regular expression contains nested quantifiers and may allow catastrophic backtracking.", "recommendation", "Vulnerable regex pattern can cause ReDoS attack.", "high");
  });
  addPatternFindings(source, /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, (match, line) => {
    addSeverityIssue(security, line, `Hardcoded IP address ${match[0]} detected.`, "recommendation", "Hardcoded IPs make deployment difficult and can be a security risk.", "medium");
  });
  addPatternFindings(source, /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|\bverify\s*:\s*false)/gi, (match, line) => {
    addSeverityIssue(security, line, "SSL certificate verification is disabled.", "recommendation", "Never disable SSL certificate verification.", "high");
  });

  addPatternFindings(source, /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,500}?\bvar\s+/g, (match, line) => {
    addIssue(performance, line, "Variable declared with var inside a loop.", "suggestion", "Declare variables outside loops.");
  });
  addPatternFindings(source, /\.open\s*\([^,]+,[^,]+,\s*false\s*\)/g, (match, line) => {
    addIssue(performance, line, "Synchronous XMLHttpRequest blocks the main thread.", "suggestion", "Use fetch() or async/await instead.");
  });
  addPatternFindings(source, /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,700}?document\.getElementById\s*\(/g, (match, line) => {
    addIssue(performance, line, "DOM query is repeated inside a loop.", "suggestion", "Cache DOM queries outside loops.");
  });
  addPatternFindings(source, /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,500}?(?:for|while)\s*\(/g, (match, line) => {
    addIssue(performance, line, "Nested loops may have O(n²) complexity.", "suggestion", "Consider optimizing nested loops.");
  });
  addPatternFindings(source, /\.map\s*\([^)]*=>\s*\(?\s*</g, (match, line) => {
    const fragment = source.slice(match.index, match.index + 500);
    if (!/\bkey\s*=/.test(fragment.split(/\)\s*[,;}]/)[0])) {
      addIssue(performance, line, "React list rendering appears to omit a key prop.", "suggestion", "Add unique key prop to list items.");
    }
  });
  addPatternFindings(source, /\b(?:style|options|config|data)\s*=\s*\{[^}]{120,}\}/g, (match, line) => {
    addIssue(performance, line, "Large inline object may be recreated on every render.", "suggestion", "Move objects outside render to prevent re-creation.");
  });
  addPatternFindings(source, /\.forEach\s*\([^)]*=>\s*(?:\{[\s\S]{0,300}?\.(?:push|splice)\s*\(|[^;\n]*\.(?:push|splice)\s*\()/g, (match, line) => {
    addSeverityIssue(performance, line, ".forEach() is being used to construct or filter another collection.", "suggestion", "Use .map() or .filter() when transforming or selecting array values.", "low");
  });
  for (const fn of functions) {
    const awaits = Array.from(fn.body.matchAll(/\bawait\b/g));
    if (awaits.length > 1 && !/\bPromise\.all\s*\(/.test(fn.body)) {
      addSeverityIssue(performance, fn.startLine, `Function "${fn.name}" performs ${awaits.length} sequential awaits.`, "suggestion", "Use Promise.all() for parallel async operations.", "medium");
    }
  }
  let hasRepeatedArrayFrom = false;
  for (const fn of functions) {
    const arrayFromCalls = Array.from(fn.body.matchAll(/\bArray\.from\s*\(/g));
    if (arrayFromCalls.length > 1) {
      addSeverityIssue(performance, fn.startLine, `Function "${fn.name}" repeatedly converts values with Array.from().`, "suggestion", "Reuse a single converted array when the source has not changed.", "low");
      hasRepeatedArrayFrom = true;
    }
  }
  const allArrayFromCalls = Array.from(source.matchAll(/\bArray\.from\s*\(/g));
  if (!hasRepeatedArrayFrom && allArrayFromCalls.length > 1) {
    addSeverityIssue(performance, lineNumberAt(source, allArrayFromCalls[1].index), "Array.from() is called repeatedly.", "suggestion", "Cache and reuse the converted array when the source has not changed.", "low");
  }
  addPatternFindings(source, /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:\[\s*\.\.\.[A-Za-z_$][\w$]*\s*\]|\{\s*\.\.\.[A-Za-z_$][\w$]*\s*\})\s*;/g, (match, line) => {
    addSeverityIssue(performance, line, "A spread operation creates an unnecessary shallow copy.", "suggestion", "Reuse the original value when a copy is not required.", "low");
  });
  addPatternFindings(source, /(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,1000}?\bfs\.(?:readFileSync|writeFileSync|appendFileSync|readdirSync|statSync)\s*\(/g, (match, line) => {
    addSeverityIssue(performance, line, "Synchronous filesystem operation inside a loop blocks the event loop.", "suggestion", "Use asynchronous filesystem APIs and batch operations outside loops.", "high");
  });

  const qualityRules = [
    [/\bvar\s+/g, "var keyword is used.", "Use const or let instead of var."],
    [/\bconsole\.log\s*\(/g, "console.log statement found.", "Remove console.log before production."],
    [/\b(?:TODO|FIXME)\b/gi, "Unresolved TODO or FIXME comment found.", "Resolve TODO and FIXME comments before production."],
  ];
  for (const [pattern, issue, improvement] of qualityRules) {
    addPatternFindings(source, pattern, (match, line) => addIssue(quality, line, issue, "improvement", improvement));
  }
  for (const fn of functions.filter((item) => item.lineCount > 50)) {
    addIssue(quality, fn.startLine, `Function "${fn.name}" is ${fn.lineCount} lines long.`, "improvement", "Break large functions into smaller ones.");
  }

  let nestingDepth = 0;
  source.split("\n").forEach((line, index) => {
    const cleanLine = stripStringsAndComments(line);
    nestingDepth -= (cleanLine.match(/}/g) ?? []).length;
    if (nestingDepth > 3) {
      addIssue(quality, index + 1, "Code is nested more than three levels deep.", "improvement", "Reduce nesting depth.");
    }
    nestingDepth += (cleanLine.match(/{/g) ?? []).length;
    nestingDepth = Math.max(0, nestingDepth);
  });
  addPatternFindings(sanitized, /(^|[^\w.])(-?(?:[2-9]|[1-9]\d+)(?:\.\d+)?)\b/gm, (match, line) => {
    addIssue(quality, line, `Magic number ${match[2]} is hardcoded.`, "improvement", "Use named constants for meaningful numeric values.");
  });
  detectDuplicateBlocks(source, quality);

  for (const fn of functions.filter((item) => item.parameters.length > 5)) {
    addSeverityIssue(quality, fn.startLine, `Function "${fn.name}" has ${fn.parameters.length} parameters.`, "improvement", "Too many parameters, consider using an options object.", "medium");
  }
  addPatternFindings(sanitized, /\?[^?:\n]*\?[^:\n]*:/g, (match, line) => {
    addSeverityIssue(quality, line, "Deeply nested ternary expression found.", "improvement", "Nested ternaries are hard to read, use if/else.", "medium");
  });
  const hasCommentedOutCode = detectCommentedOutCode(source, quality);
  source.split("\n").forEach((lineText, index) => {
    if (lineText.length > 120) {
      addSeverityIssue(quality, index + 1, `Line is ${lineText.length} characters long.`, "improvement", "Keep lines at or below 120 characters.", "low");
    }
  });

  const semicolonCandidates = source.split("\n").map((lineText, index) => ({
    text: stripStringsAndComments(lineText).trim(),
    line: index + 1,
  })).filter(({ text }) =>
    text.length > 0 &&
    !/[;{},:]$/.test(text) &&
    !/^(?:if|for|while|switch|catch|else|try|finally|function|class|do)\b/.test(text) &&
    /^(?:(?:const|let|var|return|throw|break|continue|import|export)\b|(?:await\s+)?[A-Za-z_$][\w$.[\]]*\s*(?:=|\(|\+\+|--))/.test(text),
  );
  for (const candidate of semicolonCandidates) {
    addSeverityIssue(quality, candidate.line, "Statement is missing a semicolon.", "improvement", "Terminate statements consistently with semicolons.", "low");
  }

  for (const fn of functions) {
    const hasValueReturn = /\breturn\s+(?![;}])[^;\n]+/.test(fn.body);
    const hasBareReturn = /\breturn\s*;/.test(fn.body);
    if (hasValueReturn && hasBareReturn) {
      addSeverityIssue(quality, fn.startLine, `Function "${fn.name}" mixes value-returning and empty return statements.`, "improvement", "Return a consistent value on every function path.", "medium");
    }
  }

  const hasConst = /\bconst\s+/.test(sanitized);
  const hasArrow = /=>/.test(sanitized);
  const hasErrorHandling = /\btry\s*\{[\s\S]*?\bcatch\s*\(/.test(source);
  const hasVar = /\bvar\s+/.test(sanitized);
  const hasConsoleLog = /\bconsole\.log\s*\(/.test(source);
  const hasLooseEquality = /(^|[^=!])(?:==|!=)(?!=)/m.test(sanitized);
  const hasAsyncAwait = /\basync\b/.test(sanitized) && /\bawait\b/.test(sanitized);
  const hasCallbacks = /\b(?:setTimeout|setInterval|addEventListener)\s*\([^,]+,?/.test(source) || /\([^)]*\)\s*=>/.test(source);
  const functionsAreSmall = functions.every((fn) => fn.lineCount <= 50);
  const hasEval = /\beval\s*\(/.test(sanitized);
  const functionsHaveFiveOrFewerParameters = functions.every((fn) => fn.parameters.length <= 5);
  const asyncAwaitIsConsistent = !hasMissingAwait && !hasUnhandledPromises;

  const practices = [
    ["const used properly", hasConst, hasConst ? "const declarations are present." : "Prefer const for values that are not reassigned."],
    ["Arrow functions used", hasArrow, hasArrow ? "Arrow functions are used." : "Consider arrow functions where lexical this is appropriate."],
    ["Proper error handling present", hasErrorHandling, hasErrorHandling ? "try/catch error handling is present." : "Add explicit error handling for fallible operations."],
    ["No var usage", !hasVar, hasVar ? "Replace var declarations with const or let." : "No var declarations were found."],
    ["No console.log", !hasConsoleLog, hasConsoleLog ? "Remove console.log before production." : "No console.log statements were found."],
    ["Strict equality used", !hasLooseEquality, hasLooseEquality ? "Replace loose equality with === or !==." : "No loose equality operators were found."],
    ["Async/await used instead of callbacks", hasAsyncAwait || !hasCallbacks, hasAsyncAwait ? "Async/await is used for asynchronous flow." : hasCallbacks ? "Prefer async/await over callback-based asynchronous flow." : "No callback-based asynchronous flow was detected."],
    ["Functions are small and focused", functionsAreSmall, functionsAreSmall ? "All detected functions are 50 lines or fewer." : "Break functions longer than 50 lines into focused helpers."],
    ["No eval() usage", !hasEval, hasEval ? "Remove eval() and use a safe parser or explicit logic." : "No eval() calls were found."],
    ["Promises handled properly", !hasUnhandledPromises, hasUnhandledPromises ? "Await, return, or attach rejection handling to every Promise." : "No unhandled Promise-producing calls were found."],
    ["No commented out code", !hasCommentedOutCode, hasCommentedOutCode ? "Delete commented-out implementation code and rely on version control." : "No commented-out code was found."],
    ["Functions under 5 parameters", functionsHaveFiveOrFewerParameters, functionsHaveFiveOrFewerParameters ? "All detected functions have five or fewer parameters." : "Replace long parameter lists with an options object."],
    ["No duplicate object keys", !hasDuplicateObjectKeys, hasDuplicateObjectKeys ? "Remove or rename duplicate object keys." : "No duplicate object keys were found."],
    ["Async/await used consistently", asyncAwaitIsConsistent, asyncAwaitIsConsistent ? "Async calls are awaited or otherwise handled." : "Use await consistently and handle Promise rejections."],
  ];

  for (const [rule, passed, description] of practices) {
    bestPractices.push({ rule, status: passed ? "pass" : "fail", description });
  }

  return { bugs, security, performance, quality, bestPractices };
}

export default analyzeJavaScript;
