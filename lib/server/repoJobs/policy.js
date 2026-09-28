import {
  filterImportantFiles,
  getFileLanguage,
  getFullFileTree,
} from "../../repoTree.js";

export const JOB_LIMITS = Object.freeze({
  files: 5000,
  bytes: 25_000_000,
  batchSize: 10,
  treeEntries: 50_000,
  treeRequests: 64,
  lifetimeMs: 2 * 60 * 60_000,
});
export const terminal = (status) =>
  ["completed", "cancelled", "failed"].includes(status);
export const jobExpired = (job, now = Date.now()) => now >= job.deadline;
export const gradeFor = (score) =>
  score >= 90
    ? "A"
    : score >= 75
      ? "B"
      : score >= 60
        ? "C"
        : score >= 45
          ? "D"
          : "F";

export function buildScanPlan(snapshot) {
  const regular = snapshot.entries.filter(
    (entry) =>
      entry.type === "blob" && ["100644", "100755"].includes(entry.mode),
  );
  const indexed = new Map(regular.map((entry) => [entry.path, entry]));
  const candidates = filterImportantFiles(regular, JOB_LIMITS.files);
  let bytes = 0;
  const files = [];
  const skipped = [];
  for (const path of candidates) {
    const entry = indexed.get(path);
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > 200_000
    ) {
      skipped.push({ path, reason: "file-size-limit" });
      continue;
    }
    if (bytes + entry.size > JOB_LIMITS.bytes) {
      skipped.push({ path, reason: "job-byte-limit" });
      continue;
    }
    if (path.length > 1000) {
      skipped.push({ path, reason: "path-length-limit" });
      continue;
    }
    bytes += entry.size;
    files.push({
      path,
      sha: entry.sha,
      mode: entry.mode,
      size: entry.size,
      type: "blob",
      language: getFileLanguage(path),
    });
  }
  const overview = getFullFileTree(snapshot.entries);
  return {
    files,
    overview: {
      totalFiles: overview.totalFiles,
      analyzableFiles: overview.analyzableFiles,
      languages: overview.languages,
      treeComplete: snapshot.complete,
      incompleteReasons: snapshot.reasons,
      selectedFiles: files.length,
      excludedOrOverLimitFiles: overview.totalFiles - files.length,
      preflightSkippedFiles: skipped.length,
    },
    batches: Array.from(
      { length: Math.ceil(files.length / JOB_LIMITS.batchSize) },
      (_, i) =>
        files.slice(i * JOB_LIMITS.batchSize, (i + 1) * JOB_LIMITS.batchSize),
    ),
  };
}

export const emptyTotals = () => ({
  processed: 0,
  analyzed: 0,
  skipped: 0,
  invalidSyntax: 0,
  bugs: 0,
  security: 0,
  performance: 0,
  quality: 0,
  weightedScore: 0,
  weight: 0,
});

export function addBatchTotals(previous, rows) {
  const totals = { ...previous };
  for (const row of rows) {
    totals.processed++;
    if (!row.report) {
      totals.skipped++;
      continue;
    }
    totals.analyzed++;
    if (row.report.analysis.syntaxValid === false) totals.invalidSyntax++;
    for (const category of ["bugs", "security", "performance", "quality"])
      totals[category] += row.report[category].length;
    totals.weightedScore += row.report.score * row.weight;
    totals.weight += row.weight;
  }
  return totals;
}
