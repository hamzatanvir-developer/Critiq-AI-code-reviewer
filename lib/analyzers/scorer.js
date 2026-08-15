const BUG_DEDUCTIONS = {
  high: 10,
  medium: 6,
  low: 3,
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function gradeForScore(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

export function calculateScore(analysisResult) {
  const result = analysisResult && typeof analysisResult === "object" ? analysisResult : {};
  const bugs = asArray(result.bugs);
  const security = asArray(result.security);
  const performance = asArray(result.performance);
  const quality = asArray(result.quality);
  const bestPractices = asArray(result.bestPractices);

  const bugsDeduction = bugs.reduce((total, bug) => {
    const severity = typeof bug?.severity === "string" ? bug.severity.toLowerCase() : "low";
    return total + (BUG_DEDUCTIONS[severity] ?? BUG_DEDUCTIONS.low);
  }, 0);
  const securityDeduction = security.length * 8;
  const performanceDeduction = performance.length * 4;
  const qualityDeduction = quality.length * 3;
  const failingPractices = bestPractices.filter(
    (practice) => String(practice?.status).toLowerCase() === "fail",
  ).length;
  const passingPractices = bestPractices.filter(
    (practice) => String(practice?.status).toLowerCase() === "pass",
  ).length;
  const bestPracticesDeduction = failingPractices * 2;
  const bonusPoints = passingPractices + (bugs.length === 0 ? 5 : 0) + (security.length === 0 ? 5 : 0);

  const score = clamp(
    100
      - bugsDeduction
      - securityDeduction
      - performanceDeduction
      - qualityDeduction
      - bestPracticesDeduction
      + bonusPoints,
    0,
    100,
  );

  return {
    score,
    grade: gradeForScore(score),
    breakdown: {
      startScore: 100,
      bugsDeduction,
      securityDeduction,
      performanceDeduction,
      qualityDeduction,
      bestPracticesDeduction,
      bonusPoints,
      finalScore: score,
    },
  };
}

function stripCommentsAndStrings(code) {
  return code.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)/g,
    (value) => value.replace(/[^\n]/g, " "),
  );
}

function countMatches(code, pattern) {
  return Array.from(code.matchAll(pattern)).length;
}

export function calculateComplexity(code) {
  const source = typeof code === "string" ? code : "";
  const linesOfCode = source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  const sanitized = stripCommentsAndStrings(source);
  const keywordDecisions = countMatches(
    sanitized,
    /\b(?:if|else|for|while|switch|catch)\b/g,
  );
  const operatorDecisions = countMatches(sanitized, /&&|\|\||\?(?![?.])/g);
  const decisionPoints = keywordDecisions + operatorDecisions;

  let score = 1 + Math.floor(decisionPoints / 3);
  if (linesOfCode > 50) score += 1;
  if (linesOfCode > 100) score += 1;
  if (linesOfCode > 200) score += 1;
  score = clamp(score, 1, 10);

  let level = "Simple";
  if (score >= 7) level = "Complex";
  else if (score >= 4) level = "Moderate";

  const reasons = [
    `The code contains ${linesOfCode} non-empty line${linesOfCode === 1 ? "" : "s"} of code.`,
    `The code contains ${decisionPoints} decision point${decisionPoints === 1 ? "" : "s"}.`,
  ];

  if (decisionPoints === 0) {
    reasons.push("The control flow is linear with no detected branching or loops.");
  } else if (decisionPoints <= 6) {
    reasons.push("The code has limited branching, keeping the control flow manageable.");
  } else {
    reasons.push("Frequent branching and looping increase the number of possible execution paths.");
  }

  if (linesOfCode > 100) {
    reasons.push("The code size adds maintenance and comprehension overhead.");
  }

  return { score, level, reasons };
}

