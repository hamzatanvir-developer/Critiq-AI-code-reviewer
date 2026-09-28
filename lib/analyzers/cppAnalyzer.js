import { inspectCpp } from "./cpp/engine.js";
import { CPP_RULES } from "./cpp/rules.js";

export function analyzeCpp(code) {
  const report = inspectCpp(code);
  const result = {
    bugs: [],
    security: [],
    performance: [],
    quality: [],
    bestPractices: [],
  };
  for (const { category, ...issue } of report.issues)
    result[category].push(issue);
  const practices = [
    ["Explicit exception handling", ["CPP101"]],
    ["Control-flow review", ["CPP102", "CPP103"]],
    ["Local allocation/deletion review", ["CPP104", "CPP105", "CPP106"]],
    ["Polymorphic destruction review", ["CPP107"]],
    ["Buffer and format-string review", ["CPP201", "CPP202", "CPP203"]],
    ["No hardcoded credentials detected", ["CPP204"]],
    ["Explicit ownership review", ["CPP405"]],
    ["Focused functions", ["CPP402", "CPP403"]],
  ];
  result.bestPractices = report.syntaxValid
    ? practices.map(([rule, ids]) => ({
        rule,
        status: report.issues.some((issue) => ids.includes(issue.ruleId))
          ? "fail"
          : "pass",
        description: `Checked with ${ids.join(", ")}. A pass means no matching structural finding, not compiler verification.`,
      }))
    : [];
  result.metrics = report.metrics;
  result.analysis = {
    engine: "Critiq C++ / Tree-sitter",
    engineVersion:
      "cpp-cst-1 / web-tree-sitter 0.27.0 / tree-sitter-cpp 0.23.4",
    mode: "parser",
    syntaxValid: report.syntaxValid,
    selectedRules: ["CPP001", ...Object.keys(CPP_RULES)],
    limitations: [
      "Parses complete C++ translation units with a pinned grammar, not a compiler or a selected ISO language-standard mode. Grammar acceptance does not prove compilation succeeds.",
      "This is Critiq's structural profile, not Cppcheck, clang-tidy, MISRA or CERT certification. Includes/macros are not expanded; conditional preprocessor branches are inspected without build configuration.",
      "No cross-file type, alias, lifetime, bounds, overflow or concurrency analysis is performed. Memory checks cover only specified adjacent statements; other security/performance findings require context.",
      "Only redundant standalone empty statements are automatically removed. Pointer ownership, NULL conversions, casts, flushes and error handling are not rewritten. Compile and test suggested code in your project.",
    ],
  };
  return result;
}

export default analyzeCpp;
