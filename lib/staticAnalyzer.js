import analyzeJavaScript from "./analyzers/javascriptAnalyzer.js";
import analyzePython from "./analyzers/pythonAnalyzer.js";
import analyzeJava from "./analyzers/javaAnalyzer.js";
import analyzeCpp from "./analyzers/cppAnalyzer.js";
import { calculateComplexity, calculateScore } from "./analyzers/scorer.js";

function selectAnalyzer(language) {
  const normalizedLanguage = String(language ?? "").trim().toLowerCase();

  if (normalizedLanguage === "javascript" || normalizedLanguage === "react") {
    return analyzeJavaScript;
  }

  if (normalizedLanguage === "python") return analyzePython;
  if (normalizedLanguage === "java") return analyzeJava;
  if (normalizedLanguage === "c++" || normalizedLanguage === "cpp") return analyzeCpp;

  throw new RangeError(`Unsupported language: ${language}`);
}

export function runStaticAnalysis(code, language) {
  const source = typeof code === "string" ? code : "";
  const analyzer = selectAnalyzer(language);
  const analysisResult = analyzer(source);
  const score = calculateScore(analysisResult);
  const complexity = calculateComplexity(source);

  return {
    overallScore: score.score,
    grade: score.grade,
    bugs: analysisResult.bugs,
    security: analysisResult.security,
    performance: analysisResult.performance,
    quality: analysisResult.quality,
    bestPractices: analysisResult.bestPractices,
    complexity: {
      level: complexity.level,
      score: complexity.score,
      reasons: complexity.reasons,
    },
    breakdown: score.breakdown,
    summary: null,
    refactoredCode: null,
    isStaticAnalysis: true,
  };
}

export default runStaticAnalysis;
