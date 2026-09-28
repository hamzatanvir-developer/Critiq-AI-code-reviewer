import analyzeJavaScript from "./analyzers/javascriptAnalyzer.js";
import analyzePython from "./analyzers/pythonAnalyzer.js";
import analyzeJava from "./analyzers/javaAnalyzer.js";
import analyzeCpp from "./analyzers/cppAnalyzer.js";
import { calculateComplexity, calculateScore } from "./analyzers/scorer.js";
import { ANALYSIS_VERSION } from "./analysisVersion.js";

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
  const analysisResult = analyzer(source, language);
  const score = calculateScore(analysisResult);
  const complexity = calculateComplexity(source, analysisResult.metrics);

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
    analysisVersion: ANALYSIS_VERSION,
    analysis: analysisResult.analysis ?? {
      engine: "Critiq pattern checks",
      mode: "heuristic",
      syntaxValid: null,
      limitations: [
        "Experimental pattern-based checks; findings can be false positives or miss defects.",
        "Compiler/parser integration and safe automatic fixes for this language are not implemented yet.",
      ],
    },
  };
}

export default runStaticAnalysis;
