import runStaticAnalysis from "./staticAnalyzer.js";
import { suggestRefactor } from "./refactorer.js";

const categories = ["bugs", "security", "performance", "quality"];
const countIssues = (result) => categories.reduce((total, category) => total + result[category].length, 0);

function issueCounts(result) {
  const counts = new Map();
  for (const category of categories) {
    for (const issue of result[category]) {
      const key = `${category}:${issue.ruleId || issue.issue}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

export async function reviewCode(code, language) {
  const result = runStaticAnalysis(code, language);
  const suggestion = await suggestRefactor(code, language);
  let output = suggestion.code;
  let revised = output === code ? result : runStaticAnalysis(output, language);
  const beforeCounts = issueCounts(result);
  const addsFindings = [...issueCounts(revised)].some(([rule, count]) => count > (beforeCounts.get(rule) || 0));
  let message = suggestion.message;
  // A syntax-valid rewrite can still be wrong. Reject new findings or lower scores;
  // never alter a score to make a rewrite appear successful.
  if (output !== code && (revised.analysis.syntaxValid === false || addsFindings || revised.overallScore < result.overallScore)) {
    output = code;
    revised = result;
    message = "Automatic changes failed validation and were discarded. The original code is preserved.";
  }
  const changed = output !== code;
  result.refactoredCode = output;
  result.refactoring = {
    status: changed ? "changed" : "unchanged",
    supported: suggestion.supported,
    message,
    appliedRules: changed ? suggestion.appliedRules : [],
    originalScore: result.overallScore,
    resultingScore: revised.overallScore,
    resolvedFindings: Math.max(0, countIssues(result) - countIssues(revised)),
    remainingFindings: countIssues(revised),
    syntaxChecked: revised.analysis.syntaxValid === true,
    behaviorVerified: false,
  };
  result.summary = result.analysis.syntaxValid === false
    ? "The source could not be parsed. Resolve the syntax errors before interpreting a quality score or requesting automatic fixes."
    : `Static checks found ${result.bugs.length} bug findings, ${result.security.length} security review findings, ${result.performance.length} performance findings and ${result.quality.length} quality findings. The rule-based score is ${result.overallScore}/100; this is not a guarantee of correctness or security.`;
  return result;
}
