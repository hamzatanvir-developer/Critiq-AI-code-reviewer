import { lintPython, PYTHON_RULES, PYTHON_TARGET } from "./python/engine.js";

const QUALITY_PYFLAKES = new Set(["F401", "F403", "F405", "F541", "F841"]);
const HIGH_RISK = new Set([
  "invalid-syntax", "F821", "F823", "F822", "F706", "F707", "B006",
  "S102", "S307", "S506", "S602", "S608", "S609",
]);

function categoryFor(rule) {
  if (/^S\d/.test(rule)) return "security";
  if (/^(C4|PERF)/.test(rule)) return "performance";
  if (rule === "invalid-syntax" || (rule.startsWith("F") && !QUALITY_PYFLAKES.has(rule)) || rule.startsWith("B") || rule === "E722") return "bugs";
  return "quality";
}

export function analyzePython(code) {
  const report = lintPython(code);
  const result = { bugs: [], security: [], performance: [], quality: [], bestPractices: [] };
  for (const diagnostic of report.diagnostics) {
    const ruleId = diagnostic.code || "invalid-syntax";
    const category = categoryFor(ruleId);
    const help = diagnostic.subDiagnostics?.filter((item) => item.severity === "help").map((item) => item.message).join(" ");
    const advice = help || diagnostic.message;
    result[category].push({
      ruleId,
      line: diagnostic.start_location.row,
      column: diagnostic.start_location.column,
      endLine: diagnostic.end_location.row,
      endColumn: diagnostic.end_location.column,
      issue: diagnostic.message,
      description: diagnostic.message,
      severity: HIGH_RISK.has(ruleId) ? "high" : ["bugs", "security"].includes(category) ? "medium" : "low",
      fixable: ruleId === "F541" && Boolean(diagnostic.fix),
      ...(category === "security" && { recommendation: advice }),
      ...(category === "performance" && { suggestion: advice }),
      ...(category === "quality" && { improvement: advice }),
    });
  }
  const checks = [
    ["No undefined names", ["F821", "F822", "F823"]],
    ["No mutable defaults", ["B006"]],
    ["No bare except", ["E722"]],
    ["No shadowed builtins", ["A001", "A002", "A003", "A004", "A005", "A006"]],
    ["No dynamic code execution", ["S102", "S307"]],
    ["Identity comparisons for None", ["E711"]],
    ["Function annotations", ["ANN001", "ANN201"]],
    ["Public function docstrings", ["D102", "D103"]],
  ];
  result.bestPractices = report.syntaxValid ? checks.map(([rule, codes]) => ({
    rule,
    status: report.diagnostics.some((item) => codes.includes(item.code)) ? "fail" : "pass",
    description: `Checked with Ruff ${codes.join(", ")}. A pass means no matching finding, not proof of correctness.`,
  })) : [];
  result.metrics = report.metrics;
  result.analysis = {
    engine: "Ruff",
    engineVersion: report.version,
    mode: "parser",
    syntaxValid: report.syntaxValid,
    targetVersion: PYTHON_TARGET,
    selectedRules: [...PYTHON_RULES],
    limitations: [
      "Single-file Python checks with a Python 3.10 target; dependencies, inferred types and cross-file behavior are not verified.",
      "Security findings are review candidates, not proof of exploitable vulnerabilities. This is not a complete Pylint or Bandit scan.",
      "Repository configuration and noqa suppression comments do not disable this review's fixed rule profile.",
      "Only conservative fixes and formatting are automatic. Mutable defaults, imports, exception handling and equality semantics require manual review.",
    ],
  };
  return result;
}

export default analyzePython;
