import { lintJavaScript } from "./javascript/engine.js";

const SECURITY_RULES = new Set([
  "no-eval", "no-implied-eval", "no-new-func", "no-script-url",
  "react/no-danger", "react/jsx-no-target-blank", "critiq/security",
]);
const QUALITY_RULES = new Set([
  "no-unused-vars", "no-var", "prefer-const", "no-console", "max-params",
  "max-lines-per-function", "max-depth", "complexity", "no-nested-ternary",
  "react/prop-types", "react/display-name",
]);

export function analyzeJavaScript(code, language = "JavaScript") {
  const { messages, metrics } = lintJavaScript(code, language);
  const result = { bugs: [], security: [], performance: [], quality: [], bestPractices: [] };
  for (const message of messages) {
    if (!message.ruleId && !message.fatal) continue;
    const ruleId = message.ruleId || "syntax-error";
    const category = SECURITY_RULES.has(ruleId) ? "security"
      : QUALITY_RULES.has(ruleId) ? "quality" : "bugs";
    result[category].push({
      ruleId,
      line: message.line || 1,
      column: message.column || 1,
      issue: message.message,
      description: message.message,
      severity: message.fatal || message.severity === 2 ? "high" : "low",
      fixable: Boolean(message.fix),
      ...(category === "security" && { recommendation: "Review the flagged operation and remove unsafe data flows; do not evaluate untrusted code or render unsanitized HTML." }),
      ...(category === "quality" && { improvement: message.message }),
    });
  }

  const checks = [
    ["No undefined identifiers", ["no-undef"]],
    ["No duplicate object keys", ["no-dupe-keys"]],
    ["No unreachable statements", ["no-unreachable"]],
    ["Strict equality", ["eqeqeq"]],
    ["Block-scoped declarations", ["no-var", "prefer-const"]],
    ["No dynamic code execution", ["no-eval", "no-implied-eval", "no-new-func"]],
    ...(language.toLowerCase() === "react" ? [["React Hooks rules", ["react-hooks/rules-of-hooks", "react-hooks/exhaustive-deps"]], ["Stable list keys", ["react/jsx-key"]]] : []),
  ];
  const syntaxValid = !messages.some((message) => message.fatal);
  result.bestPractices = syntaxValid ? checks.map(([rule, ids]) => ({
    rule,
    status: messages.some((message) => ids.includes(message.ruleId)) ? "fail" : "pass",
    description: `Checked with ${ids.join(", ")}. A passing check is not a proof of program correctness.`,
  })) : [];
  result.analysis = {
    engine: "ESLint",
    mode: "parser",
    syntaxValid,
    limitations: [
      "Single-file analysis: project types, runtime behavior and cross-file data flow are not verified.",
      "Browser and Node.js globals are allowed because snippets do not specify a runtime.",
      "The score measures configured rules, not security certification or production readiness.",
    ],
  };
  result.metrics = metrics;
  return result;
}

export default analyzeJavaScript;
