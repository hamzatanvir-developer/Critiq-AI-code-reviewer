import "server-only";
import analyzeRepo from "../../analyzers/repoAnalyzer.js";
import { createGitHubClient } from "../githubSnapshot.js";
import * as store from "./store.js";
import { inngest } from "./inngest.js";
import { runRepositoryJob } from "./runner.js";

export const scanRepository = inngest.createFunction(
  {
    id: "scan-repository-v1",
    triggers: { event: "critiq/repository.scan.requested" },
    concurrency: [{ limit: 2 }, { limit: 1, key: "event.data.ownerId" }],
    idempotency: "event.data.jobId",
    retries: 3,
    checkpointing: false, // One persisted step per invocation; no unawaited tasks.
    onFailure: async ({ event }) => {
      const id = event.data.event?.data?.jobId;
      if (store.validJobId(id))
        await store.finishJob(
          id,
          "failed",
          "Scan failed after retries. Partial results remain available; start a new scan to retry.",
        );
    },
  },
  async ({ event, step }) =>
    runRepositoryJob({
      jobId: event.data.jobId,
      step,
      store,
      analyze: analyzeRepo,
      createClient: (repository) =>
        createGitHubClient({ ...repository, deadline: Date.now() + 25_000 }),
    }),
);
