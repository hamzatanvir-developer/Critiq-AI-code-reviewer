import { withJavaTree, walk, isComment } from "./parser.js";
import { collectJavaFindings } from "./rules.js";

export function inspectJava(source) {
  return withJavaTree(source, (root) => {
    if (root.hasError) {
      const errors = [...walk(root)].filter((node) => node.type === "ERROR" || node.isMissing).slice(0, 20);
      return {
        syntaxValid: false,
        issues: errors.map((node) => ({
          category: "bugs", ruleId: "JAVA001", severity: "high",
          line: node.startPosition.row + 1, column: node.startPosition.column + 1,
          issue: node.isMissing ? `Missing ${node.type}.` : "Java syntax is invalid or unsupported by the configured grammar.",
          description: "Provide a complete Java compilation unit and resolve the syntax error before interpreting the quality score.",
          confidence: "structural", fixable: false,
        })),
        edits: [],
      };
    }
    return { syntaxValid: true, ...collectJavaFindings(root) };
  });
}

function sourceFingerprint(source) {
  return withJavaTree(source, (root) => {
    if (root.hasError) return null;
    const tokens = [];
    const comments = [];
    for (const node of walk(root)) {
      if (isComment(node)) comments.push(node.text);
      else if (!node.childCount) tokens.push([node.type, node.text]);
    }
    // Comments can move during formatting, but should not disappear or change.
    return JSON.stringify({ tokens, comments: comments.sort() });
  });
}

export async function fixJava(source) {
  const original = inspectJava(source);
  if (!original.syntaxValid) return {
    code: source, appliedRules: [], supported: true,
    message: "Resolve Java syntax errors before applying automatic fixes.",
  };
  let output = source;
  for (const edit of original.edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + output.slice(edit.end);
  }
  const appliedRules = original.edits.length ? ["JAVA406"] : [];
  // Explicit plugins/options; never resolve a repository's executable config.
  try {
    const [{ format }, { default: javaPlugin }] = await Promise.all([
      import("prettier"), import("prettier-plugin-java"),
    ]);
    const formatted = await format(output, {
      parser: "java", plugins: [javaPlugin], tabWidth: 4, printWidth: 100, endOfLine: "lf",
    });
    const expectedTokens = sourceFingerprint(output);
    if (formatted.length <= 50_000 && expectedTokens !== null && expectedTokens === sourceFingerprint(formatted)) {
      if (formatted !== output) appliedRules.push("prettier-java");
      output = formatted;
    }
  } catch {
    // Formatting is optional. Preserve the analyzed source/fixes on failure.
  }
  return {
    code: output, appliedRules, supported: true,
    message: output === source
      ? "No supported automatic changes were applied. Remaining Java findings need manual review."
      : "Applied conservative empty-statement fixes and/or token-checked formatting. Type checking, compilation and behavior still require your project tests.",
  };
}
