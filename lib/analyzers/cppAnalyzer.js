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
    });
  }

  return functions;
}

function loopBlocks(code) {
  const blocks = [];
  addMatches(code, /\b(?:for|while)\s*\([^)]*\)\s*\{/g, (match, line) => {
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
      addBug(bugs, line, `Pointer '${match[1]}' is used after deletion and may be dangling.`, "high");
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

  addMatches(source, /\b(?:gets\s*\(|scanf\s*\(\s*"(?![^"]*%\d+s))/g, (match, line) => {
    addIssue(security, line, "Unbounded input may overflow a buffer.", "recommendation", "Use fgets() or scanf with width limit to prevent buffer overflow");
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

  addMatches(sanitized, /\b[A-Za-z_:][\w:<>]*\s*\*\s*[A-Za-z_]\w*/g, (match, line) => addIssue(quality, line, "Raw pointer declaration requires manual lifetime management.", "improvement", "Use unique_ptr or shared_ptr instead of raw pointers"));
  addMatches(sanitized, /(?:^|\n)(?!\s)(?!#|using\b|namespace\b|class\b|struct\b|enum\b|typedef\b|template\b)(?:const\s+)?(?:int|long|short|float|double|bool|char|std::\w+(?:<[^>]+>)?)\s+[A-Za-z_]\w*\s*(?:=|;)/g, (match, line) => addIssue(quality, line, "Global variable increases shared mutable state.", "improvement", "Minimize global variable usage"));
  addMatches(source, /\b(?:TODO|FIXME)\b/gi, (match, line) => addIssue(quality, line, `${match[0].toUpperCase()} comment remains unresolved.`, "improvement", "Resolve before production"));
  for (const fn of functions) {
    if (fn.lineCount > 50) addIssue(quality, fn.startLine, `Function '${fn.name}' is ${fn.lineCount} lines long.`, "improvement", "Break into smaller functions");
  }
  addMatches(sanitized, /(?<![\w.])(?:[2-9]|[1-9]\d+)(?:\.\d+)?(?![\w.])/g, (match, line) => addIssue(quality, line, `Magic number '${match[0]}' reduces readability.`, "improvement", "Use named constants or constexpr"));
  lines.forEach((lineText, index) => {
    const indentation = lineText.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0;
    if (indentation >= 16 && lineText.trim() && !/^\s*[}\])]/.test(lineText)) addIssue(quality, index + 1, "Code is nested four or more indentation levels deep.", "improvement", "Reduce nesting depth");
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
  const practices = [
    ["Smart pointers used", !hasRawPointers || hasSmartPointers, !hasRawPointers || hasSmartPointers ? "Pointer ownership uses smart pointers or no raw pointers were found." : "Replace owning raw pointers with smart pointers."],
    ["No using namespace std in headers", !looksLikeHeader || !hasUsingNamespaceStd, !looksLikeHeader || !hasUsingNamespaceStd ? "Header-like code does not import the entire std namespace." : "Remove using namespace std from headers."],
    ["Header guards present", !looksLikeHeader || hasHeaderGuard, !looksLikeHeader || hasHeaderGuard ? "Header guards are present or the input is not header-like." : "Add #pragma once or an include guard."],
    ["No global variables", !hasGlobals, hasGlobals ? "Move global state into scoped objects or functions." : "No global variables were detected."],
    ["Const correctness applied", hasConstCorrectness, hasConstCorrectness ? "const or constexpr is used." : "Apply const to immutable values and methods."],
    ["No raw memory management", !hasRawMemory, hasRawMemory ? "Replace new/delete with RAII containers or smart pointers." : "No explicit new/delete operations were found."],
    ["RAII pattern used", !hasRawMemory || hasRaii, !hasRawMemory || hasRaii ? "Resource ownership follows RAII or no manual resources were found." : "Use RAII wrappers for resource lifetime management."],
    ["No deprecated C functions", !hasDeprecatedCFunctions, hasDeprecatedCFunctions ? "Replace unsafe deprecated C functions with bounded alternatives." : "No deprecated unsafe C functions were found."],
  ];

  for (const [rule, passed, description] of practices) {
    bestPractices.push({ rule, status: passed ? "pass" : "fail", description });
  }

  return { bugs, security, performance, quality, bestPractices };
}

export default analyzeCpp;
