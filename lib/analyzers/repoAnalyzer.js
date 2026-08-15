import runStaticAnalysis from "../staticAnalyzer.js";

const supportedLanguages = ["JavaScript", "Python", "Java", "C++", "React"];
const severityRank = { high: 3, medium: 2, low: 1 };

function normalizeLanguage(language) {
  const value = String(language ?? "").trim().toLowerCase();
  if (value === "javascript" || value === "typescript") return "JavaScript";
  if (value === "react" || value === "react typescript") return "React";
  if (value === "python") return "Python";
  if (value === "java") return "Java";
  if (value === "c++" || value === "cpp" || value === "c") return "C++";
  throw new RangeError(`Unsupported repository file language: ${language}`);
}

function gradeForScore(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

function fileWeight(content) {
  return Math.max(
    1,
    String(content ?? "")
      .split(/\r?\n/)
      .filter((line) => line.trim()).length,
  );
}

function issueSeverity(issue, category) {
  if (category === "security") return "high";
  const severity = String(issue?.severity ?? "").toLowerCase();
  if (severity in severityRank) return severity;
  return category === "bugs" ? "medium" : "low";
}

function recommendationText(issue, category) {
  return (
    issue?.recommendation ??
    issue?.suggestion ??
    issue?.improvement ??
    (category === "bugs" ? `Fix: ${issue?.issue ?? "bug"}` : issue?.issue) ??
    "Review and resolve this issue."
  );
}

function buildRecommendations(fileReports) {
  const grouped = new Map();

  for (const report of fileReports) {
    for (const category of ["bugs", "security", "performance", "quality"]) {
      for (const issue of report[category]) {
        const recommendation = recommendationText(issue, category);
        const severity = issueSeverity(issue, category);
        const key = recommendation.toLowerCase();
        const current = grouped.get(key) ?? {
          recommendation,
          priority: severity,
          occurrences: 0,
          files: new Set(),
        };

        current.occurrences += 1;
        current.files.add(report.path);
        if (severityRank[severity] > severityRank[current.priority]) {
          current.priority = severity;
        }
        grouped.set(key, current);
      }
    }

    for (const practice of report.bestPractices.filter(
      (item) => String(item?.status).toLowerCase() === "fail",
    )) {
      const recommendation = practice.description || `Follow ${practice.rule}.`;
      const key = recommendation.toLowerCase();
      const current = grouped.get(key) ?? {
        recommendation,
        priority: "low",
        occurrences: 0,
        files: new Set(),
      };
      current.occurrences += 1;
      current.files.add(report.path);
      grouped.set(key, current);
    }
  }

  return [...grouped.values()]
    .sort(
      (first, second) =>
        severityRank[second.priority] - severityRank[first.priority] ||
        second.occurrences - first.occurrences ||
        first.recommendation.localeCompare(second.recommendation),
    )
    .slice(0, 5)
    .map((item) => ({
      recommendation: item.recommendation,
      priority: item.priority,
      occurrences: item.occurrences,
      affectedFiles: item.files.size,
    }));
}

export function analyzeRepo(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("Repository analysis requires at least one file.");
  }

  let weightedScoreTotal = 0;
  let totalWeight = 0;
  const fileReports = files.map((file) => {
    if (typeof file?.path !== "string" || typeof file?.content !== "string") {
      throw new TypeError("Each repository file requires a path and content.");
    }

    const language = normalizeLanguage(file.language);
    const result = runStaticAnalysis(file.content, language);
    const weight = fileWeight(file.content);
    weightedScoreTotal += result.overallScore * weight;
    totalWeight += weight;

    return {
      path: file.path,
      language,
      score: result.overallScore,
      grade: result.grade,
      bugs: result.bugs,
      security: result.security,
      performance: result.performance,
      quality: result.quality,
      bestPractices: result.bestPractices,
      complexity: result.complexity,
    };
  });

  fileReports.sort(
    (first, second) =>
      first.score - second.score || first.path.localeCompare(second.path),
  );

  const overallScore = Math.round(weightedScoreTotal / totalWeight);
  const securityReport = fileReports.flatMap((report) =>
    report.security.map((issue) => ({ ...issue, file: report.path })),
  );
  const allIssues = fileReports.flatMap((report) =>
    ["bugs", "security", "performance", "quality"].flatMap((category) =>
      report[category].map((issue) => ({
        ...issue,
        file: report.path,
        category,
        severity: issueSeverity(issue, category),
      })),
    ),
  );
  const topIssues = allIssues
    .sort(
      (first, second) =>
        severityRank[second.severity] - severityRank[first.severity] ||
        first.file.localeCompare(second.file),
    )
    .slice(0, 10);

  const languageBreakdown = Object.fromEntries(
    supportedLanguages.map((language) => [language, { files: 0, avgScore: 0 }]),
  );
  for (const language of supportedLanguages) {
    const reports = fileReports.filter((report) => report.language === language);
    languageBreakdown[language] = {
      files: reports.length,
      avgScore: reports.length
        ? Math.round(
            reports.reduce((total, report) => total + report.score, 0) /
              reports.length,
          )
        : 0,
    };
  }

  const passedBestPractices = fileReports.reduce(
    (total, report) =>
      total +
      report.bestPractices.filter(
        (item) => String(item?.status).toLowerCase() === "pass",
      ).length,
    0,
  );
  const failedBestPractices = fileReports.reduce(
    (total, report) =>
      total +
      report.bestPractices.filter(
        (item) => String(item?.status).toLowerCase() === "fail",
      ).length,
    0,
  );

  return {
    overallScore,
    grade: gradeForScore(overallScore),
    summary: {
      totalFiles: fileReports.length,
      totalBugs: fileReports.reduce(
        (total, report) => total + report.bugs.length,
        0,
      ),
      totalSecurityIssues: securityReport.length,
      totalPerformanceIssues: fileReports.reduce(
        (total, report) => total + report.performance.length,
        0,
      ),
      totalQualityIssues: fileReports.reduce(
        (total, report) => total + report.quality.length,
        0,
      ),
      criticalIssues:
        fileReports.reduce(
          (total, report) =>
            total +
            report.bugs.filter(
              (bug) => String(bug?.severity).toLowerCase() === "high",
            ).length,
          0,
        ) + securityReport.length,
      passedBestPractices,
      failedBestPractices,
    },
    fileReports,
    topIssues,
    securityReport,
    languageBreakdown,
    recommendations: buildRecommendations(fileReports),
    codeHealthTrend: {
      excellent: fileReports.filter((report) => report.score >= 90).length,
      good: fileReports.filter(
        (report) => report.score >= 75 && report.score < 90,
      ).length,
      fair: fileReports.filter(
        (report) => report.score >= 60 && report.score < 75,
      ).length,
      poor: fileReports.filter((report) => report.score < 60).length,
    },
  };
}

export default analyzeRepo;
