import { withCppTree, walk } from "./parser.js";
import { collectCppFindings } from "./rules.js";

export function inspectCpp(source) {
  return withCppTree(source, (root) => {
    if (root.hasError)
      return {
        syntaxValid: false,
        edits: [],
        issues: [...walk(root)]
          .filter((node) => node.type === "ERROR" || node.isMissing)
          .slice(0, 20)
          .map((node) => ({
            category: "bugs",
            ruleId: "CPP001",
            severity: "high",
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            issue: node.isMissing
              ? `Missing ${node.type}.`
              : "C++ syntax is invalid or unsupported by the configured grammar.",
            description:
              "Provide a complete translation unit. Macro-dependent syntax may require a compiler with the project's compilation database.",
            confidence: "structural",
            fixable: false,
          })),
      };
    return { syntaxValid: true, ...collectCppFindings(root) };
  });
}

export function fixCpp(source) {
  const original = inspectCpp(source);
  if (!original.syntaxValid)
    return {
      code: source,
      appliedRules: [],
      supported: true,
      message:
        "Resolve unsupported or invalid C++ syntax before applying automatic fixes.",
    };
  let output = source;
  for (const edit of original.edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + output.slice(edit.end);
  }
  return {
    code: output,
    appliedRules: output === source ? [] : ["CPP404"],
    supported: true,
    message:
      output === source
        ? "No supported automatic changes are available. Remaining C++ findings need manual review; an unchanged score is expected."
        : "Removed standalone empty statements. Ownership, pointer, security and API changes remain manual; compile and test with your project configuration.",
  };
}
