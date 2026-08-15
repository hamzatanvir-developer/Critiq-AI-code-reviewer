function lineNumberAt(code, index) {
  return code.slice(0, index).split("\n").length;
}

function addMatches(code, pattern, callback) {
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
  target.push({ line: String(line), issue, [detailName]: detail, severity });
}

function stripStringsAndComments(code) {
  return code.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,
    (value) => value.replace(/[^\n]/g, " "),
  );
}

function findBlockEnd(code, openingBrace) {
  let depth = 0;

  for (let index = openingBrace; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }

  return code.length - 1;
}

function blockDepthAt(code, index) {
  let depth = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (code[cursor] === "{") depth += 1;
    if (code[cursor] === "}") depth = Math.max(0, depth - 1);
  }
  return depth;
}

function getFunctions(code) {
  const functions = [];
  const pattern = /(?:^|\n)\s*(?:template\s*<[^>]+>\s*)?(?:inline\s+|static\s+|virtual\s+|constexpr\s+|explicit\s+)*[\w:<>,~*&\s]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)(?:\s*(?:const|noexcept|override|final))*\s*\{/g;
  const controls = new Set(["if", "for", "while", "switch", "catch"]);

  for (const match of code.matchAll(pattern)) {
    if (controls.has(match[1])) continue;
    const openingBrace = code.indexOf("{", match.index + match[0].length - 1);
    const end = findBlockEnd(code, openingBrace);
    functions.push({
      name: match[1],
      start: match.index,
      startLine: lineNumberAt(code, match.index),
      lineCount: lineNumberAt(code, end) - lineNumberAt(code, match.index) + 1,
      body: code.slice(openingBrace + 1, end),
      signature: match[0],
    });
  }

  return functions;
}

function getClasses(code) {
  const classes = [];
  const pattern = /\b(?:class|struct)\s+([A-Za-z_]\w*)(?:\s*:\s*(?:public|protected|private)?\s*([A-Za-z_]\w*))?[^;{]*\{/g;

  for (const match of code.matchAll(pattern)) {
    const openingBrace = code.indexOf("{", match.index);
    const end = findBlockEnd(code, openingBrace);
    classes.push({
      name: match[1],
      baseName: match[2] ?? "",
      start: match.index,
      startLine: lineNumberAt(code, match.index),
      body: code.slice(openingBrace + 1, end),
    });
  }

  return classes;
}

function loopBlocks(code) {
  const blocks = [];
  addMatches(code, /\b(?:for|while)\s*\([^\n{]*\)\s*\{/g, (match, line) => {
    const openingBrace = code.indexOf("{", match.index);
    blocks.push({ line, body: code.slice(openingBrace + 1, findBlockEnd(code, openingBrace)) });
  });
  return blocks;
}

export function analyzeCpp(code) {
  const source = typeof code === "string" ? code : "";
  const sanitized = stripStringsAndComments(source);
  const lines = source.split("\n");
  const functions = getFunctions(source);
  const classes = getClasses(source);
  const loops = loopBlocks(sanitized);
  const bugs = [];
  const security = [];
  const performance = [];
  const quality = [];
  const bestPractices = [];

  const allocations = new Map();
  addMatches(sanitized, /\b(?:auto|[A-Za-z_]\w*(?:::\w+)*(?:\s*[*&])?)\s+([A-Za-z_]\w*)\s*=\s*new\b/g, (match, line) => {
    allocations.set(match[1], line);
  });
  for (const [variable, line] of allocations) {
    const escaped = variable.replace(/[$]/g, "\\$");
    if (!new RegExp(`\\bdelete(?:\\s*\\[\\s*\\])?\\s+${escaped}\\b`).test(sanitized)) {
      addBug(bugs, line, `Memory allocated for '${variable}' may leak because no matching delete was found.`, "high");
    }
  }

  addMatches(sanitized, /\b([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]/g, (match, line) => {
    if (/^\d+$/.test(match[2]) || /^\s*$/.test(match[2])) return;
    const context = lines.slice(Math.max(0, line - 4), line).join("\n");
    if (!/(?:size|length|sizeof|std::size|\.at\s*\(|<|>=?)\s*\(?/.test(context)) {
      addBug(bugs, line, `Array access '${match[0]}' has no nearby bounds check.`, "high");
    }
  });

  addMatches(sanitized, /(?:^|[;{}]\s*)\b(?:int|long|short|float|double|char|bool|size_t|unsigned(?:\s+int)?|signed(?:\s+int)?)\s+([A-Za-z_]\w*)\s*;/gm, (match, line) => {
    addBug(bugs, line, `Variable '${match[1]}' may be used without initialization.`, "high");
  });

  addMatches(sanitized, /\b(?:int|long|short|unsigned|size_t)\s+[A-Za-z_]\w*\s*=\s*[^;]*(?:\+|\*|<<)[^;]*;/g, (match, line) => {
    addBug(bugs, line, "Integer arithmetic may overflow without a range check or wider type.", "medium");
  });

  addMatches(sanitized, /delete(?:\s*\[\s*\])?\s+([A-Za-z_]\w*)\s*;/g, (match, line) => {
    const remainder = sanitized.slice(match.index + match[0].length);
    if (new RegExp(`\\b${match[1]}\\s*(?:->|\\[|\\*)`).test(remainder)) {
      addBug(bugs, line, `Pointer '${match[1]}' is accessed after deletion; accessing freed memory is undefined behavior.`, "high");
    }
  });

  addMatches(sanitized, /\bclass\s+([A-Za-z_]\w*)[^;{]*\{/g, (match, line) => {
    const openingBrace = sanitized.indexOf("{", match.index);
    const body = sanitized.slice(openingBrace + 1, findBlockEnd(sanitized, openingBrace));
    if (/\bvirtual\b/.test(body) && !new RegExp(`virtual\\s+~${match[1]}\\s*\\(`).test(body)) {
      addBug(bugs, line, `Polymorphic base class '${match[1]}' is missing a virtual destructor.`, "high");
    }
  });

  const signedVariables = new Set();
  const unsignedVariables = new Set();
  addMatches(sanitized, /\b(?:int|long|short|signed(?:\s+int)?)\s+([A-Za-z_]\w*)/g, (match) => signedVariables.add(match[1]));
  addMatches(sanitized, /\b(?:unsigned(?:\s+(?:int|long|short))?|size_t|std::size_t)\s+([A-Za-z_]\w*)/g, (match) => unsignedVariables.add(match[1]));
  addMatches(sanitized, /\b([A-Za-z_]\w*)\s*(?:==|!=|<|<=|>|>=)\s*([A-Za-z_]\w*)\b/g, (match, line) => {
    if ((signedVariables.has(match[1]) && unsignedVariables.has(match[2])) || (unsignedVariables.has(match[1]) && signedVariables.has(match[2]))) {
      addBug(bugs, line, "Comparison mixes signed and unsigned integer values.", "medium");
    }
  });

  addMatches(sanitized, /\b(?:while\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\))\s*\{/g, (match, line) => {
    const openingBrace = sanitized.indexOf("{", match.index);
    const body = sanitized.slice(openingBrace + 1, findBlockEnd(sanitized, openingBrace));
    if (!/\bbreak\s*;/.test(body)) addBug(bugs, line, "Infinite loop has no break condition.", "high");
  });
  addMatches(sanitized, /\b(?:signed\s+)?(?:int|long|short)\s+[A-Za-z_]\w*\s*=\s*[^;]*(?:\+|\*|<<)[^;]*;/g, (match, line) => {
    const nearby = lines.slice(Math.max(0, line - 4), line + 1).join("\n");
    if (!/(?:numeric_limits|INT_MAX|LONG_MAX|__builtin_(?:add|mul)_overflow|checked)/.test(nearby)) {
      addBug(bugs, line, "Signed integer overflow is undefined behavior in C++.", "high");
    }
  });
  const nonTrivialVariables = new Set();
  for (const javaStyleClass of classes) {
    addMatches(sanitized, new RegExp(`\\b${javaStyleClass.name}\\s+([A-Za-z_]\\w*)\\b`, "g"), (match) => nonTrivialVariables.add(match[1]));
  }
  addMatches(source, /\b(?:std::)?mem(?:cpy|set)\s*\(\s*&?([A-Za-z_]\w*)/g, (match, line) => {
    if (nonTrivialVariables.has(match[1])) {
      addBug(bugs, line, `Raw memory operation is applied to non-trivial object '${match[1]}'; use std::copy or assignment.`, "high");
    }
  });
  addMatches(sanitized, /\b[\w:<>]+\s*&\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{/g, (match, line) => {
    const openingBrace = sanitized.indexOf("{", match.index);
    const body = sanitized.slice(openingBrace + 1, findBlockEnd(sanitized, openingBrace));
    const locals = [...body.matchAll(/\b[\w:<>]+\s+([A-Za-z_]\w*)\s*(?:[=;({])/g)].map((item) => item[1]);
    for (const local of locals) {
      if (new RegExp(`\\breturn\\s+${local}\\s*;`).test(body)) {
        addBug(bugs, line, `Function returns a reference to local variable '${local}'; never return references to local variables.`, "high");
        break;
      }
    }
  });
  for (const derivedClass of classes.filter((item) => item.baseName)) {
    const pattern = new RegExp(`\\b${derivedClass.baseName}\\s+[A-Za-z_]\\w*\\s*=\\s*(?:${derivedClass.name}\\s*[({]|[A-Za-z_]\\w*\\s*;)`, "g");
    addMatches(sanitized, pattern, (match, line) => {
      addBug(bugs, line, `Derived '${derivedClass.name}' is copied into base '${derivedClass.baseName}' by value; use pointers or references to avoid object slicing.`, "high");
    });
  }
  const pointerNames = new Set();
  addMatches(sanitized, /\b[\w:<>]+\s*\*\s*([A-Za-z_]\w*)/g, (match) => pointerNames.add(match[1]));
  addMatches(sanitized, /\bsizeof\s*\(\s*([A-Za-z_]\w*)\s*\)/g, (match, line) => {
    if (pointerNames.has(match[1])) {
      addBug(bugs, line, `sizeof(${match[1]}) returns pointer size, not array size.`, "high");
    }
  });

  addMatches(source, /\b(?:gets\s*\(|scanf\s*\(\s*"(?![^"]*%\d+s))/g, (match, line) => {
    addSeverityIssue(security, line, "Unbounded input may overflow a buffer.", "recommendation", "Buffer overflow risk, use fgets() with size limit.", "high");
  });
  addMatches(source, /\bstrcpy\s*\(/g, (match, line) => addIssue(security, line, "strcpy() does not enforce destination bounds.", "recommendation", "Use strncpy() or std::string to prevent buffer overflow"));
  addMatches(source, /\bsprintf\s*\(/g, (match, line) => addIssue(security, line, "sprintf() can write beyond the destination buffer.", "recommendation", "Use snprintf() with size limit"));

  const credentialPattern = /\b(?:password|passwd|secret|api[_-]?key|token|credential)\b\s*=\s*(?:"[^"\n]+"|'[^'\n]+')/gi;
  addMatches(source, credentialPattern, (match, line) => addIssue(security, line, "Hardcoded password, secret, or credential detected.", "recommendation", "Never hardcode credentials"));
  addMatches(source, /\b(?:std::)?system\s*\(/g, (match, line) => addIssue(security, line, "system() executes a shell command and may allow command injection.", "recommendation", "Validate input before system() calls"));
  addMatches(sanitized, /\b[A-Za-z_]\w*\s*(?:\+\+|--|\+=\s*\w+|-=\s*\w+)\s*;/g, (match, line) => {
    const declarationContext = sanitized.slice(0, match.index);
    if (new RegExp(`(?:\\w+\\s*\\*|auto\\s*\\*)\\s*${match[0].match(/[A-Za-z_]\w*/)?.[0]}\\b`).test(declarationContext)) {
      addIssue(security, line, "Raw pointer arithmetic can cause invalid memory access.", "recommendation", "Use smart pointers instead of raw pointer arithmetic");
    }
  });
  addMatches(source, /\b(?:token|secret|password|nonce|session|otp|key|salt)\w*\s*=\s*rand\s*\(/gi, (match, line) => {
    addSeverityIssue(security, line, "rand() is used for security-sensitive randomness.", "recommendation", "Use /dev/urandom or std::random_device for security.", "high");
  });
  addMatches(source, /\b(?:printf|fprintf|sprintf)\s*\(\s*([A-Za-z_]\w*)\s*(?:,|\))/g, (match, line) => {
    addSeverityIssue(security, line, `Variable '${match[1]}' is used as a printf format string.`, "recommendation", "Never use user input as printf format string.", "high");
  });
  addMatches(sanitized, /\bint\s+[A-Za-z_]\w*\s*=\s*(?:static_cast\s*<\s*int\s*>\s*\()?\s*([A-Za-z_]\w*)(\.size\s*\(\s*\))?\s*\)?\s*;/g, (match, line) => {
    if (match[2] || unsignedVariables.has(match[1])) {
      addSeverityIssue(security, line, "Potential size_t-to-int conversion may truncate the value.", "recommendation", "Integer truncation can cause security vulnerabilities.", "medium");
    }
  });
  addMatches(source, /\b(?:std::)?string\s+((?:password|secret|token|credential|apiKey)[A-Za-z_]*)\b/gi, (match, line) => {
    const remainder = source.slice(match.index, match.index + 2000);
    const escapedName = match[1].replace(/[$]/g, "\\$");
    if (!new RegExp(`(?:${escapedName}\\.(?:clear|assign)\\s*\\(|(?:memset|SecureZeroMemory|std::fill)\\s*\\([^;]*${escapedName})`).test(remainder)) {
      addSeverityIssue(security, line, `Sensitive string '${match[1]}' is not explicitly cleared.`, "recommendation", "Use SecureZeroMemory or memset before freeing sensitive data.", "medium");
    }
  });
  const sharedMutableGlobals = [];
  addMatches(sanitized, /(?:^|\n)(?!\s)(?!#|using\b|namespace\b|class\b|struct\b|enum\b|typedef\b|template\b)(?!const\b|constexpr\b|std::atomic\b)(?:int|long|short|float|double|bool|char|std::\w+(?:<[^>]+>)?)\s+([A-Za-z_]\w*)\s*(?:=|;)/g, (match, line) => {
    if (blockDepthAt(sanitized, match.index) === 0) sharedMutableGlobals.push({ name: match[1], line });
  });
  if (sharedMutableGlobals.length && !/\b(?:mutex|lock_guard|unique_lock|scoped_lock|atomic)\b/.test(sanitized)) {
    for (const global of sharedMutableGlobals) {
      addSeverityIssue(security, global.line, `Shared mutable global '${global.name}' has no detectable synchronization.`, "recommendation", "Protect shared mutable state with mutex.", "high");
    }
  }

  addMatches(sanitized, /\b(?:std::)?(?:string|vector|map|set|unordered_map|unordered_set)\s*(?:<[^;()]+>)?\s+[A-Za-z_]\w*\s*(?=[,)])/g, (match, line) => {
    if (!/[&*]/.test(match[0])) addIssue(performance, line, "Large object parameter is passed by value.", "suggestion", "Pass large objects by const reference");
  });
  if (/\busing\s+namespace\s+std\s*;/.test(sanitized)) {
    addIssue(performance, lineNumberAt(sanitized, sanitized.search(/\busing\s+namespace\s+std\s*;/)), "using namespace std can pollute header consumers' namespaces.", "suggestion", "Avoid using namespace std in headers");
  }
  addMatches(sanitized, /\b(?:std::)?string\s*\([^)]*\)\s*\.(?:substr|find|compare)\s*\(/g, (match, line) => addIssue(performance, line, "Repeated temporary string operation detected.", "suggestion", "Use string_view for read-only string operations"));
  for (const loop of loops) {
    if (/\b(?:for|while)\s*\(/.test(loop.body)) addIssue(performance, loop.line, "Nested loops may result in quadratic or worse complexity.", "suggestion", "Consider algorithm optimization");
  }
  addMatches(sanitized, /\bfor\s*\([^:;]+:\s*(?!const\s+)?(?:auto|[A-Za-z_:][\w:]*(?:<[^>]+>)?)\s+([A-Za-z_]\w*)\s*\)/g, (match, line) => addIssue(performance, line, "Range-based loop copies each element.", "suggestion", "Use references in range-based for loops"));
  for (const loop of loops) {
    if (/\b(?:new|delete)\b/.test(loop.body)) addIssue(performance, loop.line, "Dynamic memory operation occurs inside a loop.", "suggestion", "Avoid new/delete in performance-critical loops");
  }
  addMatches(source, /\bstd::endl\b/g, (match, line) => {
    addSeverityIssue(performance, line, "std::endl flushes the stream unnecessarily.", "suggestion", "Use \\n instead of std::endl to avoid unnecessary flush.", "low");
  });
  addMatches(sanitized, /\bfor\s*\([^;]*;[^;]*;\s*([A-Za-z_]\w*)\+\+\s*\)/g, (match, line) => {
    if (!/^(?:i|j|k|index|count)$/.test(match[1])) {
      addSeverityIssue(performance, line, `Loop iterator '${match[1]}' uses postfix increment.`, "suggestion", "Use prefix increment (++i) for non-primitive types.", "low");
    }
  });
  addMatches(sanitized, /\b(?:std::)?(?:string|vector|map|set|unordered_map|unordered_set)\s*(?:<[^;=]+>)?\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/g, (match, line) => {
    addSeverityIssue(performance, line, `Container '${match[2]}' is copied into '${match[1]}'.`, "suggestion", "Use std::move for transferring ownership when the source is no longer needed.", "medium");
  });
  let hasVirtualCallsInConstructors = false;
  for (const cppClass of classes) {
    const virtualMethods = [...cppClass.body.matchAll(/\bvirtual\s+[\w:<>,~*&\s]+\s+([A-Za-z_]\w*)\s*\(/g)].map((item) => item[1]);
    const constructorPattern = new RegExp(`(?:~?${cppClass.name})\\s*\\([^;{}]*\\)\\s*\\{`, "g");
    addMatches(cppClass.body, constructorPattern, (match, relativeLine) => {
      const openingBrace = cppClass.body.indexOf("{", match.index);
      const body = cppClass.body.slice(openingBrace + 1, findBlockEnd(cppClass.body, openingBrace));
      const calledVirtual = virtualMethods.find((name) => new RegExp(`(?:this->)?${name}\\s*\\(`).test(body));
      if (calledVirtual) {
        addSeverityIssue(performance, cppClass.startLine + relativeLine - 1, `Constructor or destructor calls virtual method '${calledVirtual}'.`, "suggestion", "Virtual calls in constructors/destructors do not dispatch virtually.", "high");
        hasVirtualCallsInConstructors = true;
      }
    });
  }
  addMatches(source, /\bdynamic_cast\s*</g, (match, line) => {
    addSeverityIssue(performance, line, "dynamic_cast introduces runtime type checking and may indicate tight coupling.", "suggestion", "Excessive dynamic_cast may indicate poor design.", "medium");
  });
  for (const loop of loops) {
    if (/\b[A-Za-z_]\w*\.find\s*\(/.test(loop.body)) {
      addSeverityIssue(performance, loop.line, "String find is repeatedly called inside a loop.", "suggestion", "Use std::find or std::search for repeated searches.", "low");
    }
  }

  addMatches(sanitized, /\b[A-Za-z_:][\w:<>]*\s*\*\s*[A-Za-z_]\w*/g, (match, line) => addIssue(quality, line, "Raw pointer declaration requires manual lifetime management.", "improvement", "Use unique_ptr or shared_ptr instead of raw pointers"));
  addMatches(sanitized, /(?:^|\n)(?!\s)(?!#|using\b|namespace\b|class\b|struct\b|enum\b|typedef\b|template\b)(?:const\s+)?(?:int|long|short|float|double|bool|char|std::\w+(?:<[^>]+>)?)\s+[A-Za-z_]\w*\s*(?:=|;)/g, (match, line) => addIssue(quality, line, "Global variable increases shared mutable state.", "improvement", "Minimize global variable usage"));
  addMatches(source, /\b(?:TODO|FIXME)\b/gi, (match, line) => addIssue(quality, line, `${match[0].toUpperCase()} comment remains unresolved.`, "improvement", "Resolve before production"));
  for (const fn of functions) {
    if (fn.lineCount > 50) addSeverityIssue(quality, fn.startLine, `Function '${fn.name}' is ${fn.lineCount} lines long.`, "improvement", "Break into smaller functions.", "medium");
  }
  addMatches(sanitized, /(?<![\w.])(?:[2-9]|[1-9]\d+)(?:\.\d+)?(?![\w.])/g, (match, line) => addSeverityIssue(quality, line, `Magic number '${match[0]}' reduces readability.`, "improvement", "Use constexpr for compile-time constants.", "medium"));
  lines.forEach((lineText, index) => {
    const indentation = lineText.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0;
    if (indentation >= 16 && lineText.trim() && !/^\s*[}\])]/.test(lineText)) addIssue(quality, index + 1, "Code is nested four or more indentation levels deep.", "improvement", "Reduce nesting depth");
  });
  addMatches(source, /^\s*#\s*define\s+([A-Za-z_]\w*)(?:\s*\([^\n]*\))?\s+[^\n]+/gm, (match, line) => {
    if (!/^\s*#\s*define\s+[A-Za-z_]\w*\s*$/m.test(match[0])) {
      addSeverityIssue(quality, line, `Macro '${match[1]}' could hide type or evaluation issues.`, "improvement", "Replace macros with constexpr or inline functions.", "medium");
    }
  });
  const cStyleCastPattern = /\(\s*(?:unsigned\s+|signed\s+)?(?:char|short|int|long|float|double|bool|void|[A-Z][A-Za-z_]\w*)\s*\*?\s*\)\s*[A-Za-z_(]/g;
  const hasCStyleCasts = cStyleCastPattern.test(sanitized);
  addMatches(sanitized, new RegExp(cStyleCastPattern.source, "g"), (match, line) => {
    addSeverityIssue(quality, line, "C-style cast bypasses explicit C++ cast semantics.", "improvement", "Use static_cast, dynamic_cast, or reinterpret_cast.", "medium");
  });
  addMatches(sanitized, /\b[A-Za-z_]\w*\s*<[^;\n]*<[^^;\n]*<[^;\n]*>[^;\n]*>[^;\n]*>/g, (match, line) => {
    addSeverityIssue(quality, line, "Deeply nested template type reduces readability.", "improvement", "Introduce type aliases to simplify deeply nested templates.", "low");
  });
  let hasMissingConstMethods = false;
  for (const cppClass of classes) {
    for (const method of getFunctions(cppClass.body)) {
      if (method.name === cppClass.name || method.name === `~${cppClass.name}`) continue;
      const mutatesState = /(?<![=!<>])=(?!=)|\+\+|--|\b(?:push_back|pop_back|insert|erase|clear|reset)\s*\(/.test(method.body);
      if (!/\bstatic\b/.test(method.signature) && !/\)\s*const\b/.test(method.signature) && !mutatesState) {
        addSeverityIssue(quality, cppClass.startLine + method.startLine - 1, `Non-mutating member function '${method.name}' is not const.`, "improvement", "Mark non-mutating methods as const.", "medium");
        hasMissingConstMethods = true;
      }
    }
  }
  const rawArrayPattern = /\b[A-Za-z_:][\w:<>]*\s+([A-Za-z_]\w*)\s*\[\s*[^\]]+\s*\]/g;
  const hasRawArrays = rawArrayPattern.test(sanitized);
  addMatches(sanitized, new RegExp(rawArrayPattern.source, "g"), (match, line) => {
    addSeverityIssue(quality, line, `Raw array '${match[1]}' has manual bounds and lifetime semantics.`, "improvement", "Use std::array or std::vector instead.", "medium");
  });

  const looksLikeHeader = !/\bmain\s*\(/.test(sanitized) && /\b(?:class|struct|template|#include)\b/.test(sanitized);
  const hasHeaderGuard = /#\s*pragma\s+once\b/.test(source) || /#\s*ifndef\s+\w+[\s\S]*?#\s*define\s+\w+[\s\S]*?#\s*endif\b/.test(source);
  if (looksLikeHeader && !hasHeaderGuard) addIssue(quality, 1, "Header-like code has no include guard.", "improvement", "Add header guards to all header files");

  const hasRawPointers = /\b[A-Za-z_:][\w:<>]*\s*\*\s*[A-Za-z_]\w*/.test(sanitized);
  const hasSmartPointers = /\b(?:std::)?(?:unique_ptr|shared_ptr|weak_ptr)\b/.test(sanitized);
  const hasUsingNamespaceStd = /\busing\s+namespace\s+std\s*;/.test(sanitized);
  const hasGlobals = quality.some((item) => item.issue.startsWith("Global variable"));
  const hasConstCorrectness = /\bconst\b|\bconstexpr\b/.test(sanitized);
  const hasRawMemory = /\b(?:new|delete)\b/.test(sanitized);
  const hasRaii = hasSmartPointers || /\b(?:lock_guard|unique_lock|scoped_lock|fstream|ifstream|ofstream)\b/.test(sanitized);
  const hasDeprecatedCFunctions = /\b(?:gets|strcpy|sprintf)\s*\(/.test(source);
  const hasMagicNumbers = quality.some((item) => item.issue.startsWith("Magic number"));
  const hasContainerCopies = performance.some((item) => item.issue.includes("is copied into"));
  const hasMoveSemantics = /\bstd::move\s*\(|\b(?:&&|move constructor)\b/.test(sanitized);
  const practices = [
    ["Smart pointers used", !hasRawPointers || hasSmartPointers, !hasRawPointers || hasSmartPointers ? "Pointer ownership uses smart pointers or no raw pointers were found." : "Replace owning raw pointers with smart pointers."],
    ["No using namespace std in headers", !looksLikeHeader || !hasUsingNamespaceStd, !looksLikeHeader || !hasUsingNamespaceStd ? "Header-like code does not import the entire std namespace." : "Remove using namespace std from headers."],
    ["Header guards present", !looksLikeHeader || hasHeaderGuard, !looksLikeHeader || hasHeaderGuard ? "Header guards are present or the input is not header-like." : "Add #pragma once or an include guard."],
    ["No global variables", !hasGlobals, hasGlobals ? "Move global state into scoped objects or functions." : "No global variables were detected."],
    ["Const correctness applied", hasConstCorrectness, hasConstCorrectness ? "const or constexpr is used." : "Apply const to immutable values and methods."],
    ["No raw memory management", !hasRawMemory, hasRawMemory ? "Replace new/delete with RAII containers or smart pointers." : "No explicit new/delete operations were found."],
    ["RAII pattern used", !hasRawMemory || hasRaii, !hasRawMemory || hasRaii ? "Resource ownership follows RAII or no manual resources were found." : "Use RAII wrappers for resource lifetime management."],
    ["No deprecated C functions", !hasDeprecatedCFunctions, hasDeprecatedCFunctions ? "Replace unsafe deprecated C functions with bounded alternatives." : "No deprecated unsafe C functions were found."],
    ["RAII used consistently", !hasRawMemory || hasRaii, !hasRawMemory || hasRaii ? "Resources use RAII or no manual resource ownership was found." : "Replace manual resource management with RAII wrappers."],
    ["No C-style casts", !hasCStyleCasts, hasCStyleCasts ? "Replace C-style casts with explicit C++ casts." : "No C-style casts were found."],
    ["constexpr used for constants", !hasMagicNumbers || /\bconstexpr\b/.test(sanitized), hasMagicNumbers && !/\bconstexpr\b/.test(sanitized) ? "Define meaningful compile-time values with constexpr." : "Compile-time constants use constexpr or no magic numbers were found."],
    ["Move semantics used", !hasContainerCopies || hasMoveSemantics, hasContainerCopies && !hasMoveSemantics ? "Use std::move when transferring ownership from disposable sources." : "Move semantics are used or no avoidable container copies were found."],
    ["No raw arrays", !hasRawArrays, hasRawArrays ? "Replace raw arrays with std::array or std::vector." : "No raw arrays were found."],
    ["No virtual calls in constructors", !hasVirtualCallsInConstructors, hasVirtualCallsInConstructors ? "Move virtual calls out of constructors and destructors." : "No virtual calls in constructors or destructors were found."],
    ["Smart pointers used exclusively", !hasRawPointers, hasRawPointers ? "Replace owning raw pointers with smart pointers." : "No raw pointer declarations were found."],
  ];

  for (const [rule, passed, description] of practices) {
    bestPractices.push({ rule, status: passed ? "pass" : "fail", description });
  }

  return { bugs, security, performance, quality, bestPractices };
}

export default analyzeCpp;
