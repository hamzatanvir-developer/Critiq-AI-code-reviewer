# Durable repository scans

Critiq has **Quick scan** (up to 20 files in one request) and **Background scan** (Inngest durable steps, Firestore progress and paginated reports). Both use static analysis, not AI. Background scans remain disabled until configured.

## Deployment setup

1. Connect an Inngest app/environment to the Vercel project. Set server-only `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, then sync `/api/inngest`. Never set `INNGEST_DEV` in production; Critiq refuses to enable jobs if it is present.
2. Create a dedicated Firebase service account for the same `NEXT_PUBLIC_FIREBASE_PROJECT_ID`. It needs Firestore read/write and Firebase Auth user lookup access for revoked/disabled-user checks. Store its JSON in server-only `FIREBASE_SERVICE_ACCOUNT_JSON`. Do not commit credentials, paste them into chat, or prefix them with `NEXT_PUBLIC_`.
3. Set server-only `GITHUB_TOKEN` for public repository reads. Private repositories are rejected even when that token could access them.
4. Set `REPO_JOBS_ENABLED=true` and redeploy. The signed Inngest route declares `maxDuration=60`; verify your hosting plan supports it. Checkpointing is disabled so each persisted step gets a separate invocation. No unawaited task is left running after a response.
5. Configure Firestore TTL on `expiresAt` for collection groups **repoJobs**, **batches**, and **files**. Documents independently expire after seven days; deleting a parent does not delete subcollections. TTL deletion is eventual. Without TTL configuration, records remain stored. `repoJobQuotas` retains only the latest job pointer and rolling start timestamps.
6. Keep the supplied Firestore catch-all deny rule for job collections. Firebase Admin bypasses rules; owner checks in the server endpoints are essential.

References: [Inngest deployment](https://www.inngest.com/docs/deploy/vercel), [Firebase Admin setup](https://firebase.google.com/docs/admin/setup), [Firestore TTL](https://firebase.google.com/docs/firestore/ttl).

Locally, use a separate test Firebase project/service account, the Inngest Dev Server, `INNGEST_DEV=1`, and `REPO_JOBS_ENABLED=true`. Do not use production data for tests.

## Guarantees and limits

- A verified Firebase user creates a persisted job. Events contain only job and owner IDs. Repeated starts reuse an active job; uncertain event delivery can be retried with Start scan. Event IDs, function idempotency and transactional batch counters prevent double-counting on replay.
- Each scan pins one commit, traverses its immutable tree, and reads blobs by SHA. Source, build scripts and repository configuration are never executed. Public visibility is checked before discovery and each background batch.
- Truncated recursive trees trigger bounded non-recursive traversal, following [GitHub's guidance](https://docs.github.com/en/rest/git/trees#get-a-tree). Discovery caps: 50,000 entries, 64 tree requests and a per-step network deadline. Incomplete totals are lower bounds, not a full inventory. Discovery is one durable step, not unlimited traversal.
- Scan caps: **5,000 prioritized files, 25 MB source bytes**; per-file caps: **200 KB and 50,000 characters**. Dependencies, generated assets, tests/spec folders, environment files, unsupported languages and symlinks are excluded. Unknown sizes and overlong paths are skipped. Source is never truncated into artificial syntax errors.
- Ten files per batch, four concurrent downloads, two executing steps globally and one per account. One active job and three starts per rolling 24 hours per account. Jobs expire after two hours. Provider rate limits and hosting quotas still apply.
- Reports above 200 KB become explicit skips rather than silently truncated findings. Ten reports per page bound response sizes. Aggregate scores cover analyzed files only, weighted by nonempty source lines; skipped files are not treated as clean.
- Cancellation is cooperative: an in-flight download or analysis may finish, but its transaction cannot commit after cancellation. Closing/reloading the browser does not cancel the server job. The UI restores the owner's latest job; tokens and reports are not kept in localStorage.
- Source is not stored in job documents or orchestration events. Paths and findings are stored in Firestore. Partial reports survive failures. Temporary download failures retry their batch; exhausted retries mark the job failed.
- Analyzer-version changes stop older jobs to prevent mixing rule versions. Cross-job blob caching and a historical job-list UI remain future work.
- Inngest steps still execute on the hosting runtime. This is not a dedicated OS sandbox, compiler-aware audit, or unlimited scan service.

## Verification before enabling for users

Run `npm test`, `npm run lint`, `npm run build`, and `node scripts/smoke-jobs-build.mjs`. Tests use mocked GitHub/auth and a transactional storage fake; **they are not live Firestore/Inngest end-to-end tests**.

In staging, verify a real scan, reload/tab closure, mid-batch cancellation, interruption/retry, revoked tokens, cross-user access, private repositories, TTL and Inngest signature rejection. Monitor costs and quotas before increasing limits.

The scoped dependency override pins `gaxios@6`'s `uuid` to 11.1.1 for GHSA-w5hq-g745-h8pq; gaxios uses its compatible `v4()` API. Revisit the override when upstream updates.
