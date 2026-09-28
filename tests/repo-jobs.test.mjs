import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  return next(specifier, context);
} });
const { createGitHubClient, discoverTree, openRepositorySnapshot, readSnapshotFile, readSnapshotBatch, parseRepositoryUrl } = await import("../lib/server/githubSnapshot.js");
const { buildScanPlan, emptyTotals, JOB_LIMITS } = await import("../lib/server/repoJobs/policy.js");
const { createJobHandlers } = await import("../lib/server/repoJobs/http.js");
const { createRepositoryJobStore } = await import("../lib/server/repoJobs/store.js");
const { runRepositoryJob } = await import("../lib/server/repoJobs/runner.js");
const { ANALYSIS_VERSION } = await import("../lib/analysisVersion.js");
const sha = (letter) => letter.repeat(40);
const entry = (path = "app.js", content = "export const n = 1;", hash = sha("c")) => ({ path, type: "blob", mode: "100644", sha: hash, size: Buffer.byteLength(content) });
const blob = (content, hash = sha("c")) => ({ sha: hash, encoding: "base64", content: Buffer.from(content).toString("base64") });

test("repository URLs reject off-host, credentials and ambiguous branch paths", () => {
  assert.deepEqual(parseRepositoryUrl("https://github.com/acme/repo.git"), { owner: "acme", repository: "repo" });
  for (const url of ["https://github.com.evil.test/a/b", "http://github.com/a/b", "https://user@github.com/a/b", "https://github.com/a/b/tree/main", "https://github.com/a/b?ref=main"]) assert.throws(() => parseRepositoryUrl(url));
});

test("private metadata prevents all tree and source requests", async () => {
  const calls = [];
  await assert.rejects(openRepositorySnapshot(async (path) => { calls.push(path); return { private: true }; }), /public/);
  assert.deepEqual(calls, [""]);
});

test("snapshots pin commit and root tree rather than reading a moving HEAD", async () => {
  const calls = [];
  const snapshot = await openRepositorySnapshot(async (path) => {
    calls.push(path);
    if (!path) return { private: false };
    if (path === "/commits/HEAD") return { sha: sha("a"), commit: { tree: { sha: sha("b") } } };
    assert.equal(path, `/git/trees/${sha("b")}?recursive=1`);
    return { tree: [entry()], truncated: false };
  });
  assert.equal(snapshot.commitSha, sha("a"));
  assert.equal(snapshot.complete, true);
  assert.equal(calls.length, 3);
});

test("truncated trees traverse subtrees, including repeated hashes at distinct paths", async () => {
  const tree = await discoverTree(async (path) => {
    if (path.endsWith("?recursive=1")) return { tree: [entry("partial.js")], truncated: true };
    if (path.endsWith(sha("b"))) return { tree: ["one", "two"].map((name) => ({ path: name, sha: sha("d"), type: "tree", mode: "040000" })) };
    return { tree: [entry()] };
  }, sha("b"));
  assert.equal(tree.complete, true);
  assert.deepEqual(tree.entries.filter((item) => item.type === "blob").map((item) => item.path), ["one/app.js", "two/app.js"]);
});

test("discovery limits and failed subtrees never claim full coverage", async () => {
  const first = await discoverTree(async () => ({ tree: [entry("a.js"), entry("b.js")], truncated: false }), sha("b"), { maxEntries: 1 });
  assert.equal(first.complete, false);
  assert.ok(first.reasons.includes("entry-limit"));
  const second = await discoverTree(async (path) => {
    if (path.includes("?")) return { tree: [], truncated: true };
    throw new Error("offline");
  }, sha("b"));
  assert.equal(second.complete, false);
});

test("blob reads reject symlinks, oversized and malformed source without truncating", async () => {
  let calls = 0;
  const get = async () => { calls++; return blob("abc"); };
  assert.equal((await readSnapshotFile(get, { ...entry(), mode: "120000" })).reason, "not-regular-file");
  assert.equal((await readSnapshotFile(get, { ...entry(), size: 200001 })).reason, "file-size-limit");
  assert.equal(calls, 0);
  assert.equal((await readSnapshotFile(get, entry("a.js", "abc"))).content, "abc");
  assert.equal((await readSnapshotFile(async () => blob("x".repeat(50001)), entry("a.js", "x".repeat(50001)))).reason, "file-size-limit");
  assert.equal((await readSnapshotFile(async () => blob("\0"), entry("a.js", "\0"))).reason, "binary-file");
  assert.equal((await readSnapshotFile(async () => ({ ...blob("abc"), sha: sha("d") }), entry())).reason, "invalid-blob");
});

test("GitHub responses have byte limits, deadlines, safe errors and no redirects", async () => {
  const client = createGitHubClient({ owner: "a", repository: "b", deadline: Date.now() + 1000, token: "test-secret", fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, "error");
    return new Response("x".repeat(50));
  } });
  await assert.rejects(client("", 10), /size limit/);
  const limited = createGitHubClient({ owner: "a", repository: "b", deadline: Date.now() + 1000, fetchImpl: async () => new Response("secret error", { status: 429 }) });
  await assert.rejects(limited(""), (error) => error.status === 429 && !error.message.includes("secret"));
  const expired = createGitHubClient({ owner: "a", repository: "b", deadline: 0, fetchImpl: () => assert.fail("must not fetch") });
  await assert.rejects(expired(""), /budget/);
});

test("source fetching is limited to four concurrent downloads and preserves order", async () => {
  let active = 0, peak = 0;
  const rows = await readSnapshotBatch(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return blob("abc");
  }, Array.from({ length: 20 }, (_, i) => entry(`${i}.js`, "abc")));
  assert.equal(peak, 4);
  assert.equal(rows[19].path, "19.js");
});

test("scan plans support thousands of files while excluding secrets, symlinks and unsupported syntax", () => {
  const entries = Array.from({ length: 2000 }, (_, i) => entry(`src/f${i}.js`));
  entries.push(entry("src/.env"), entry("a.ts"), { ...entry("link.js"), mode: "120000" });
  const plan = buildScanPlan({ entries, complete: true, reasons: [] });
  assert.equal(plan.files.length, 2000);
  assert.equal(plan.batches.length, 200);
  assert.equal(plan.overview.totalFiles, 2003);
  assert.ok(plan.files.every((file) => file.language === "JavaScript"));
  const large = buildScanPlan({ entries: Array.from({ length: 1000 }, (_, i) => ({ ...entry(`${i}.js`), size: 200_000 })), complete: false, reasons: ["tree-request-limit"] });
  assert.equal(large.files.length, JOB_LIMITS.bytes / 200_000);
  assert.equal(large.overview.treeComplete, false);
});

// Serial transactional fake: exercises replay and state guards without credentials.
function memoryDb() {
  const docs = new Map();
  const doc = (path) => ({ path, id: path.split("/").at(-1), collection: (name) => collection(`${path}/${name}`), get: async () => snap(path) });
  const collection = (path) => ({ doc: (id) => doc(`${path}/${id}`) });
  const snap = (path) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  const writer = () => {
    const writes = [];
    return {
      get: async (ref) => snap(ref.path),
      set: (ref, data) => writes.push(() => docs.set(ref.path, structuredClone(data))),
      update: (ref, data) => writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(data) })),
      commit: async () => writes.forEach((write) => write()),
    };
  };
  return { docs, collection, batch: writer, runTransaction: async (action) => { const tx = writer(); const result = await action(tx); await tx.commit(); return result; } };
}

test("durable store reuses active jobs and rejects out-of-order or duplicate batch accounting", async () => {
  const db = memoryDb(); const store = createRepositoryJobStore(db);
  const job = await store.createJob("alice", { owner: "a", repository: "b" });
  assert.equal((await store.createJob("alice", { owner: "a", repository: "c" })).id, job.id);
  const row = { path: "a.js", reason: "analyzer-failed" };
  await assert.rejects(store.commitBatch(job.id, 1, [row]), /Out-of-order/);
  await store.commitBatch(job.id, 0, [row]);
  await store.commitBatch(job.id, 0, [row]);
  assert.equal((await store.getJob(job.id)).totals.processed, 1);
  await store.finishJob(job.id, "cancelled");
  assert.equal(await store.commitBatch(job.id, 1, [row]), false);
  await store.finishJob(job.id, "completed");
  assert.equal((await store.getJob(job.id)).status, "cancelled");
});

test("persistent daily quota and expiry do not rely on process memory", async () => {
  const store = createRepositoryJobStore(memoryDb());
  for (let i = 0; i < 3; i++) { const job = await store.createJob("alice", {}); await store.finishJob(job.id, "cancelled"); }
  await assert.rejects(store.createJob("alice", {}), (error) => error.status === 429);
  const bob = await store.createJob("bob", {});
  assert.equal(bob.ownerId, "bob");
});

test("job endpoints require auth and never disclose another user's job or files", async () => {
  const job = { id: "job", ownerId: "alice", status: "running", totals: emptyTotals() };
  let reads = 0;
  const handlers = createJobHandlers({ configured: () => true, verify: async (token) => ({ uid: token }), store: { getJob: async () => job, pageFiles: async () => { reads++; return {}; } } });
  const context = { params: Promise.resolve({ id: "job" }) };
  assert.equal((await handlers.status(new Request("https://app.test/api/repo-jobs/job"), context)).status, 401);
  assert.equal((await handlers.status(new Request("https://app.test/api/repo-jobs/job?files=1", { headers: { Authorization: "Bearer bob" } }), context)).status, 404);
  assert.equal(reads, 0);
  const response = await handlers.status(new Request("https://app.test/api/repo-jobs/job", { headers: { Authorization: "Bearer alice" } }), context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.ownerId, undefined);
});

test("queue failures retain the job for redelivery and disabled configuration fails clearly", async () => {
  const job = { id: "x", ownerId: "alice", status: "queued", totals: emptyTotals() };
  const deps = { configured: () => true, verify: async () => ({ uid: "alice" }), store: { createJob: async () => job }, send: async () => { throw new Error("offline"); } };
  const request = () => new Request("https://app.test/api/repo-jobs", { method: "POST", headers: { origin: "https://app.test", "Content-Type": "application/json", Authorization: "Bearer valid" }, body: JSON.stringify({ repoUrl: "https://github.com/a/b" }) });
  const response = await createJobHandlers(deps).create(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).job.id, "x");
  assert.equal((await createJobHandlers({ ...deps, configured: () => false }).create(request())).status, 503);
});

test("durable runner processes batches without AI, returns tiny step payloads, and tolerates replay", async () => {
  const store = createRepositoryJobStore(memoryDb());
  const job = await store.createJob("alice", { owner: "a", repository: "b" });
  const content = "export const n = 1;";
  const fakeGet = async (path) => {
    if (!path) return { private: false, name: "repo" };
    if (path === "/commits/HEAD") return { sha: sha("a"), commit: { tree: { sha: sha("b") } } };
    if (path.includes("/trees/")) return { tree: [entry("app.js", content)], truncated: false };
    assert.equal(path, `/git/blobs/${sha("c")}`);
    return blob(content);
  };
  const report = { score: 100, bugs: [], security: [], quality: [], performance: [], analysis: { syntaxValid: true } };
  const step = { run: async (_name, action) => { const value = await action(); assert.ok(JSON.stringify(value ?? null).length < 1000); return value; } };
  const options = { jobId: job.id, step, store, createClient: () => fakeGet, analyze: () => ({ fileReports: [report] }) };
  await runRepositoryJob(options);
  await runRepositoryJob(options);
  const result = await store.getJob(job.id);
  assert.equal(result.status, "completed");
  assert.equal(result.totals.analyzed, 1);
  assert.equal(result.analysisVersion, ANALYSIS_VERSION);
});
