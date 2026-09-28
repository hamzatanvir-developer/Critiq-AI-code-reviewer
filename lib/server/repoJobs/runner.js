import { ANALYSIS_VERSION } from "../../analysisVersion.js";
import { buildScanPlan, JOB_LIMITS, terminal } from "./policy.js";
import {
  openRepositorySnapshot,
  readSnapshotBatch,
} from "../githubSnapshot.js";

// Only small control values cross step boundaries. Source and reports stay out
// of orchestration events; report documents are committed idempotently in storage.
export async function runRepositoryJob({
  jobId,
  step,
  store,
  createClient,
  analyze,
}) {
  const batchCount = await step.run("prepare-snapshot", async () => {
    const job = await store.getJob(jobId);
    if (!job || terminal(job.status)) return 0;
    if (job.analysisVersion !== ANALYSIS_VERSION)
      throw new Error("Analyzer version changed; start a new scan.");
    if (job.status === "running") return job.batchCount;
    const snapshot = await openRepositorySnapshot(
      createClient(job.repository),
      {
        maxEntries: JOB_LIMITS.treeEntries,
        maxTreeRequests: JOB_LIMITS.treeRequests,
      },
    );
    const plan = buildScanPlan(snapshot);
    await store.savePlan(jobId, snapshot, plan);
    return plan.batches.length;
  });
  for (let index = 0; index < batchCount; index++) {
    const keepGoing = await step.run(`analyze-batch-${index}`, async () => {
      const job = await store.getJob(jobId);
      if (!job || terminal(job.status)) return false;
      if (job.analysisVersion !== ANALYSIS_VERSION)
        throw new Error("Analyzer version changed; start a new scan.");
      if (job.nextBatch > index) return true;
      const get = createClient(job.repository);
      // Do not continue reading a repo which has become private mid-job.
      if ((await get("")).private !== false)
        throw new Error("Repository is no longer public.");
      const entries = await store.getBatch(jobId, index);
      const fetched = await readSnapshotBatch(get, entries);
      if (
        fetched.some((file) =>
          ["github-rate-limit", "fetch-failed"].includes(file.reason),
        )
      )
        throw new Error("Temporary GitHub failure; retrying this batch.");
      const rows = fetched.map((file, i) => {
        const base = {
          path: file.path,
          blobSha: file.blobSha,
          language: entries[i].language,
        };
        if (file.reason) return { ...base, reason: file.reason };
        try {
          const report = analyze([
            {
              path: file.path,
              content: file.content,
              language: entries[i].language,
            },
          ]).fileReports[0];
          const row = {
            ...base,
            report,
            weight: Math.max(
              1,
              file.content.split(/\r?\n/).filter((line) => line.trim()).length,
            ),
          };
          // Do not silently truncate findings or exceed Firestore document limits.
          return Buffer.byteLength(JSON.stringify(row)) > 200_000
            ? { ...base, reason: "report-size-limit" }
            : row;
        } catch {
          return { ...base, reason: "analyzer-failed" };
        }
      });
      return store.commitBatch(jobId, index, rows);
    });
    if (!keepGoing) return { status: "stopped" };
  }
  await step.run("finish", () => store.finishJob(jobId, "completed"));
  return { jobId };
}
