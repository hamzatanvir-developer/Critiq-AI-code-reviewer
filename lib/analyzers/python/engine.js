import { PositionEncoding, Workspace } from "@astral-sh/ruff-wasm-nodejs";

export const PYTHON_TARGET = "py310";
export const PYTHON_RULES = [
  "E4", "E7", "E9", "W", "F", "B", "S", "A", "C4", "SIM", "N",
  "RET", "PERF", "C90", "ANN001", "ANN201", "D101", "D102", "D103",
  "PLR0911", "PLR0912", "PLR0913", "PLR0915", "PLW0602", "PLW0603",
];
// The WASM diagnostic API does not expose applicability (safe vs unsafe).
// Never apply every returned fix. Only this small reviewed allowlist is eligible.
const FIXABLE_RULES = new Set(["F541", "W291", "W293"]);
const SKIP_METRIC_TOKENS = new Set([
  "Comment", "Newline", "NonLogicalNewline", "Indent", "Dedent", "EndOfFile",
]);
const DECISION_TOKENS = new Set(["If", "Elif", "For", "While", "Except", "And", "Or"]);

function withWorkspace(callback) {
  const workspace = new Workspace({
    "target-version": PYTHON_TARGET,
    "line-length": 88,
    lint: {
      select: PYTHON_RULES,
      "flake8-annotations": { "suppress-dummy-args": true },
      mccabe: { "max-complexity": 10 },
    },
    format: { "docstring-code-format": false },
  }, PositionEncoding.Utf16);
  try {
    return callback(workspace);
  } finally {
    workspace.free();
  }
}

/** Ruff 0.16.8 exposes lexer tokens as debug text, with UTF-8 byte ranges.
 * Keep this version-pinned adapter isolated, tested, and fail closed if its
 * serialization changes. Rules themselves are evaluated by Ruff, not regexes.
 */
function readTokens(workspace, source) {
  const bytes = Buffer.from(source, "utf8");
  const tokens = [];
  for (const line of workspace.tokens(source).split(/\r?\n/)) {
    if (["", "[", "]"].includes(line.trim())) continue;
    const match = line.match(/^\s*(\w+) (\d+)\.\.(\d+)(?: \(flags = [^\n]+\))?,\s*$/);
    if (!match) throw new Error("Unsupported Ruff token serialization.");
    const token = { kind: match[1], start: Number(match[2]), end: Number(match[3]) };
    if (token.start > token.end || token.end > bytes.length) {
      throw new Error("Invalid Ruff token range.");
    }
    tokens.push(token);
  }
  return { bytes, tokens };
}

function inspect(workspace, source) {
  const initial = workspace.check(source);
  if (initial.some((item) => item.code === "invalid-syntax")) {
    return { diagnostics: initial, syntaxValid: false, metrics: undefined };
  }
  const { bytes, tokens } = readTokens(workspace, source);
  const masked = Buffer.from(bytes);
  for (const token of tokens) {
    if (token.kind !== "Comment") continue;
    // Ignore suppression directives only in actual Python comments. Same-width
    // masking preserves diagnostic/edit positions and never changes the output.
    const comment = bytes.subarray(token.start, token.end).toString("utf8");
    for (const match of comment.matchAll(/noqa/gi)) {
      const offset = token.start + Buffer.byteLength(comment.slice(0, match.index));
      masked.write("xxxx", offset, "ascii");
    }
  }
  const diagnostics = workspace.check(masked.toString("utf8"));
  const lines = new Set();
  const lineAt = new Uint32Array(bytes.length + 1);
  let row = 1;
  for (let offset = 0; offset <= bytes.length; offset += 1) {
    lineAt[offset] = row;
    if (bytes[offset] === 10) row += 1;
  }
  for (const token of tokens) {
    if (SKIP_METRIC_TOKENS.has(token.kind)) continue;
    for (let line = lineAt[token.start]; line <= lineAt[Math.max(token.start, token.end - 1)]; line += 1) {
      lines.add(line);
    }
  }
  return {
    diagnostics,
    syntaxValid: true,
    tokens,
    metrics: {
      linesOfCode: lines.size,
      decisionPoints: tokens.filter((token) => DECISION_TOKENS.has(token.kind)).length,
    },
  };
}

export function lintPython(source) {
  if (typeof source !== "string" || source.length > 50_000) {
    throw new RangeError("Python analysis requires a string of at most 50,000 characters.");
  }
  return withWorkspace((workspace) => ({ ...inspect(workspace, source), version: Workspace.version() }));
}

function positionOffset(source, position) {
  const lines = source.split("\n");
  if (position.row < 1 || position.row > lines.length || position.column < 1 || position.column > lines[position.row - 1].length + 1) {
    throw new Error("Invalid Ruff edit position.");
  }
  let offset = position.column - 1;
  for (let row = 0; row < position.row - 1; row += 1) offset += lines[row].length + 1;
  return offset;
}

function applyFix(source, diagnostic, tokens) {
  if (!FIXABLE_RULES.has(diagnostic.code) || !diagnostic.fix?.edits?.length) return null;
  const edits = diagnostic.fix.edits.map((edit) => ({
    start: positionOffset(source, edit.location),
    end: positionOffset(source, edit.end_location),
    content: edit.content ?? "",
  })).sort((a, b) => a.start - b.start);
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (edit.start > edit.end || (index > 0 && edits[index - 1].end > edit.start)) return null;
    // Whitespace in multiline strings is data, not formatting. Keep it intact.
    if (diagnostic.code !== "F541") {
      const start = Buffer.byteLength(source.slice(0, edit.start));
      const end = Buffer.byteLength(source.slice(0, edit.end));
      if (tokens.some((token) => token.kind.includes("String") && start < token.end && end > token.start)) return null;
    }
  }
  let output = source;
  for (const edit of edits.reverse()) output = output.slice(0, edit.start) + edit.content + output.slice(edit.end);
  return output;
}

export function fixPython(source) {
  if (typeof source !== "string" || source.length > 50_000) {
    throw new RangeError("Python refactoring requires a string of at most 50,000 characters.");
  }
  return withWorkspace((workspace) => {
    const original = inspect(workspace, source);
    if (!original.syntaxValid) {
      return { code: source, supported: true, appliedRules: [], message: "Resolve Python syntax errors before applying automatic fixes." };
    }
    let output = source;
    let inspected = original;
    const appliedRules = new Set();
    // Reparse after each diagnostic's atomic edit set; never apply stale ranges.
    // Bound the passes so pathological input cannot trigger unbounded rewriting.
    for (let pass = 0; pass < 50; pass += 1) {
      let next = null;
      for (const diagnostic of inspected.diagnostics) {
        next = applyFix(output, diagnostic, inspected.tokens);
        if (next !== null && next !== output) {
          appliedRules.add(diagnostic.code);
          break;
        }
        next = null;
      }
      if (next === null) break;
      output = next;
      inspected = inspect(workspace, output);
      if (!inspected.syntaxValid) return { code: source, supported: true, appliedRules: [], message: "Automatic fixes were discarded because the result could not be parsed." };
    }
    const formatted = workspace.format(output);
    if (formatted.length > 50_000) {
      return { code: source, appliedRules: [], supported: true, message: "The formatted output exceeds the analysis limit. The original code is preserved." };
    }
    if (formatted !== output) appliedRules.add("ruff-format");
    return {
      code: formatted,
      appliedRules: [...appliedRules],
      supported: true,
      message: formatted === source
        ? "No supported automatic changes are available. Review remaining findings manually."
        : "Applied conservative Ruff fixes and formatting. Behavior-changing findings are left for manual review; test this code in your project.",
    };
  });
}
