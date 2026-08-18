function addFix(fixes, fix) {
  if (!fixes.includes(fix)) fixes.push(fix);
}

function findClosingBrace(source, openingIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
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
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function indentBlock(block, spaces = 2) {
  const indentation = " ".repeat(spaces);
  return block
    .split("\n")
    .map((line) => (line.trim() ? `${indentation}${line}` : line))
    .join("\n");
}

function replaceJavaScriptVariables(source, fixes) {
  const original = source;
  source = source.replace(/\bvar\s+([A-Za-z_$][\w$]*)/g, (match, name, offset) => {
    const declarationEnd = original.indexOf(";", offset + match.length);
    const remainingCode = original.slice(
      declarationEnd === -1 ? offset + match.length : declarationEnd + 1,
    );
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const isReassigned = new RegExp(
      `(?:^|[^\\w$])${escapedName}\\s*(?:[+\\-*/%]?=|\\+\\+|--)`,
      "m",
    ).test(remainingCode);
    return `${isReassigned ? "let" : "const"} ${name}`;
  });
  if (source !== original) addFix(fixes, "replaced var declarations");
  return source;
}

function wrapUnprotectedAsyncFunctions(source, fixes) {
  const matches = [...source.matchAll(/async\s+function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/g)];
  for (const match of matches.reverse()) {
    const openingIndex = match.index + match[0].lastIndexOf("{");
    const closingIndex = findClosingBrace(source, openingIndex);
    if (closingIndex === -1) continue;
    const body = source.slice(openingIndex + 1, closingIndex);
    if (/\btry\s*\{/.test(body)) continue;
    const wrappedBody = `\n  try {${indentBlock(body, 2)}\n  } catch (error) {\n    console.error('Error:', error);\n    throw error;\n  }\n`;
    source = `${source.slice(0, openingIndex + 1)}${wrappedBody}${source.slice(closingIndex)}`;
    addFix(fixes, "added async error handling");
  }
  return source;
}

function addJavaScriptInputValidation(source, fixes) {
  const pattern = /function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{/g;
  const matches = [...source.matchAll(pattern)];
  for (const match of matches.reverse()) {
    const parameters = match[1]
      .split(",")
      .map((parameter) => parameter.trim().replace(/=.*$/, "").replace(/^\.\.\./, ""))
      .filter((parameter) => /^[A-Za-z_$][\w$]*$/.test(parameter));
    if (!parameters.length) continue;
    const openingIndex = match.index + match[0].lastIndexOf("{");
    const closingIndex = findClosingBrace(source, openingIndex);
    if (closingIndex === -1) continue;
    const body = source.slice(openingIndex + 1, closingIndex);
    if (/\b(?:typeof|instanceof|throw\s+new\s+(?:TypeError|Error)|===?\s*(?:null|undefined))\b/.test(body.slice(0, 500))) continue;
    const checks = parameters
      .map((parameter) => `  if (${parameter} === undefined || ${parameter} === null) {\n    throw new TypeError('${parameter} is required');\n  }`)
      .join("\n");
    source = `${source.slice(0, openingIndex + 1)}\n${checks}${source.slice(openingIndex + 1)}`;
    addFix(fixes, "added input validation");
  }
  return source;
}

function refactorJavaScript(code, fixes) {
  let source = replaceJavaScriptVariables(code, fixes);

  const strictEquality = source
    .replace(/(^|[^=!])==(?!=)/g, "$1===")
    .replace(/(^|[^!])!=(?!=)/g, "$1!==");
  if (strictEquality !== source) addFix(fixes, "enforced strict equality");
  source = strictEquality;

  const withoutLogs = source.replace(/^[\t ]*console\.log\([^\n;]*\);?[\t ]*\r?\n?/gm, "");
  if (withoutLogs !== source) addFix(fixes, "removed console.log statements");
  source = withoutLogs;

  source = wrapUnprotectedAsyncFunctions(source, fixes);

  const filledCatches = source.replace(
    /catch\s*\([^)]*\)\s*\{\s*\}/g,
    "catch(error) { console.error('Error:', error); }",
  );
  if (filledCatches !== source) addFix(fixes, "filled empty catch blocks");
  source = filledCatches;

  source = addJavaScriptInputValidation(source, fixes);

  const safeHtml = source.replace(
    /\.innerHTML\s*=\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`))/g,
    ".textContent = $1",
  );
  if (safeHtml !== source) addFix(fixes, "replaced unsafe innerHTML strings");
  source = safeHtml;

  const withoutEval = source.replace(/\beval\s*\([^;\n]*\);?/g, "// eval() removed - security risk");
  if (withoutEval !== source) addFix(fixes, "removed eval calls");
  source = withoutEval;

  if (!/^\s*['\"]use strict['\"];?/m.test(source)) {
    source = `'use strict';\n\n${source}`;
    addFix(fixes, "enabled strict mode");
  }

  const saferLoops = source.replace(/\bfor\s*\(\s*var\b/g, "for (let");
  if (saferLoops !== source) addFix(fixes, "replaced var in loops");
  return saferLoops;
}

function refactorPython(code, fixes) {
  let source = code;
  let transformed = source.replace(/^(\s*)except\s*:/gm, "$1except Exception as e:");
  if (transformed !== source) addFix(fixes, "typed bare except clauses");
  source = transformed;

  transformed = source.replace(/==\s*None\b/g, "is None");
  if (transformed !== source) addFix(fixes, "used is None comparisons");
  source = transformed;
  transformed = source.replace(/!=\s*None\b/g, "is not None");
  if (transformed !== source) addFix(fixes, "used is not None comparisons");
  source = transformed;

  const lines = source.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^(\s*)def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:\s*$/);
    if (!match) continue;
    const nextMeaningful = lines.slice(index + 1).find((line) => line.trim());
    if (nextMeaningful?.trim().startsWith('"""') || nextMeaningful?.trim().startsWith("'''")) continue;
    lines.splice(index + 1, 0, `${match[1]}    """Execute ${match[2]} with validated inputs."""`);
    addFix(fixes, "added function docstrings");
  }
  source = lines.join("\n");

  transformed = source.replace(/\bprint\s*\(/g, "logging.info(");
  if (transformed !== source) {
    source = transformed;
    if (!/^\s*import\s+logging\b/m.test(source)) source = `import logging\n\n${source}`;
    addFix(fixes, "replaced print with logging");
  }
  return source;
}

function refactorJava(code, fixes) {
  let source = code;
  const withModifiers = source.replace(
    /^(\s*)(?!public\b|protected\b|private\b|static\b|final\b)([A-Za-z_$][\w$<>[\], ?]*\s+[A-Za-z_$][\w$]*\s*(?:\([^;{}]*\)|(?:=[^;]*)?)\s*[;{])/gm,
    "$1private $2",
  );
  if (withModifiers !== source) addFix(fixes, "added missing access modifiers");
  source = withModifiers;

  const stringEquals = source.replace(
    /\b([A-Za-z_$][\w$]*)\s*==\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    "$2.equals($1)",
  );
  if (stringEquals !== source) addFix(fixes, "replaced String identity comparisons");
  source = stringEquals;

  const nullChecked = source.replace(
    /^(\s*)([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(([^;]*)\);\s*$/gm,
    (match, indent, object, method, args) => {
      if (["System", "Math", "Objects", "Collections"].includes(object)) return match;
      return `${indent}if (${object} != null) {\n${indent}    ${object}.${method}(${args});\n${indent}}`;
    },
  );
  if (nullChecked !== source) addFix(fixes, "added object null checks");
  return nullChecked;
}

function refactorCpp(code, fixes) {
  let source = code;
  const pointerComments = source.replace(
    /^(\s*)([A-Za-z_]\w*(?:::\w+)*(?:<[^;>]+>)?)\s*\*\s*([A-Za-z_]\w*)/gm,
    "$1// TODO: replace raw pointer with std::unique_ptr where ownership applies\n$1$2* $3",
  );
  if (pointerComments !== source) addFix(fixes, "flagged raw pointers for smart-pointer migration");
  source = pointerComments;

  if (!/^\s*#\s*(?:pragma\s+once|ifndef\b)/m.test(source)) {
    source = `#pragma once\n\n${source}`;
    addFix(fixes, "added header guard");
  }

  const modernNulls = source.replace(/\bNULL\b/g, "nullptr");
  if (modernNulls !== source) addFix(fixes, "replaced NULL with nullptr");
  return modernNulls;
}

export function refactorCode(code, language, analysisResult) {
  const source = typeof code === "string" ? code : String(code ?? "");
  const normalizedLanguage = String(language ?? "").trim().toLowerCase();
  const fixes = [];
  let refactored = source;

  if (["javascript", "react", "typescript", "tsx"].includes(normalizedLanguage)) {
    refactored = refactorJavaScript(source, fixes);
  } else if (normalizedLanguage === "python") {
    refactored = refactorPython(source, fixes);
  } else if (normalizedLanguage === "java") {
    refactored = refactorJava(source, fixes);
  } else if (["c++", "cpp", "c"].includes(normalizedLanguage)) {
    refactored = refactorCpp(source, fixes);
  }

  const detectedIssues = ["bugs", "security", "performance", "quality"]
    .reduce((total, category) => total + (analysisResult?.[category]?.length ?? 0), 0);
  const fixSummary = fixes.length
    ? fixes.join(", ")
    : detectedIssues
      ? "manual review required for detected issues"
      : "no automatic fixes required";
  const commentPrefix = normalizedLanguage === "python" ? "#" : "//";
  return `${commentPrefix} Refactored by Critiq - Issues fixed: ${fixSummary}\n${refactored}`;
}

export default refactorCode;
