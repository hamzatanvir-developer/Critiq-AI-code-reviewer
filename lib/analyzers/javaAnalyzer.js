import { inspectJava } from "./java/engine.js";
import { JAVA_RULES } from "./java/rules.js";

export function analyzeJava(code) {
  const report = inspectJava(code);
  const result = { bugs: [], security: [], performance: [], quality: [], bestPractices: [] };
  for (const { category, ...issue } of report.issues) result[category].push(issue);
  const practices = [
    ["Explicit exception handling", ["JAVA101"]],
    ["String comparison review", ["JAVA103"]],
    ["equals/hashCode contract review", ["JAVA104"]],
    ["No hardcoded credentials detected", ["JAVA201"]],
    ["Cryptographic algorithm review", ["JAVA202", "JAVA203"]],
    ["Encapsulation", ["JAVA401"]],
    ["Naming conventions", ["JAVA402", "JAVA403"]],
    ["Focused methods", ["JAVA404", "JAVA405"]],
  ];
  result.bestPractices = report.syntaxValid ? practices.map(([rule, ids]) => ({
    rule,
    status: report.issues.some((item) => ids.includes(item.ruleId)) ? "fail" : "pass",
    description: `Checked with ${ids.join(", ")}. A pass means no matching structural finding, not compiler verification.`,
  })) : [];
  result.metrics = report.metrics;
  result.analysis = {
    engine: "Critiq Java / Tree-sitter",
    engineVersion: "java-cst-1 / web-tree-sitter 0.27.0 / prettier-plugin-java 2.11.0",
    mode: "parser",
    syntaxValid: report.syntaxValid,
    selectedRules: ["JAVA001", ...Object.keys(JAVA_RULES)],
    limitations: [
      "Complete Java compilation units are parsed using the pinned Java Orchard grammar. Accepted grammar syntax is not a guarantee that javac will compile the code.",
      "This is Critiq's structural rule profile, not PMD, SpotBugs, or full OWASP coverage. No classpath, bytecode, cross-file type resolution, or data-flow analysis is performed.",
      "Null dereferences, resource leaks, arithmetic overflow and thread safety cannot be proven by this engine. Review security/performance candidates in context.",
      "Only standalone empty statements are automatically removed. Formatting is accepted only when the remaining tokens and comment text are unchanged; behavior-sensitive changes remain manual.",
    ],
  };
  return result;
}

export default analyzeJava;
