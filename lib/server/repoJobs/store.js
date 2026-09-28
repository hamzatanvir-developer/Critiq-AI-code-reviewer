import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { adminDb } from "../firebaseAdmin.js";
import { ANALYSIS_VERSION } from "../../analysisVersion.js";
import {
  addBatchTotals,
  emptyTotals,
  JOB_LIMITS,
  jobExpired,
  terminal,
} from "./policy.js";

export function createRepositoryJobStore(db) {
  const userKey = (uid) => createHash("sha256").update(uid).digest("hex");
  const jobRef = (id) => db.collection("repoJobs").doc(id);
  const validJobId = (id) =>
    typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
  const expiry = () => new Date(Date.now() + 7 * 86400_000);
  const clean = (value) => JSON.parse(JSON.stringify(value));

  async function createJob(ownerId, repository) {
    const account = db.collection("repoJobQuotas").doc(userKey(ownerId));
    const ref = jobRef(randomUUID());
    return db.runTransaction(async (tx) => {
      const quota = (await tx.get(account)).data() ?? {};
      if (quota.activeJobId) {
        const existing = (await tx.get(jobRef(quota.activeJobId))).data();
        if (existing && !terminal(existing.status) && !jobExpired(existing))
          return { ...existing, id: quota.activeJobId };
      }
      const now = Date.now();
      const starts = (quota.starts ?? []).filter(
        (time) => now - time < 86400_000,
      );
      if (starts.length >= 3)
        throw Object.assign(
          new Error("Daily background scan limit reached (3 per account)."),
          { status: 429 },
        );
      const job = {
        id: ref.id,
        ownerId,
        repository,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        deadline: now + JOB_LIMITS.lifetimeMs,
        analysisVersion: ANALYSIS_VERSION,
        nextBatch: 0,
        totals: emptyTotals(),
      };
      tx.set(ref, { ...job, expiresAt: expiry() });
      tx.set(account, { activeJobId: ref.id, starts: [...starts, now] });
      return job;
    });
  }

  async function getJob(id) {
    if (!validJobId(id)) return null;
    const ref = jobRef(id);
    return db.runTransaction(async (tx) => {
      const job = (await tx.get(ref)).data();
      if (!job) return null;
      if (!terminal(job.status) && jobExpired(job)) {
        job.status = "failed";
        job.error = "Scan expired. Partial results remain available.";
        tx.update(ref, { status: job.status, error: job.error });
      }
      return job;
    });
  }

  async function latestJob(ownerId) {
    const quota = (
      await db.collection("repoJobQuotas").doc(userKey(ownerId)).get()
    ).data();
    return quota?.activeJobId ? getJob(quota.activeJobId) : null;
  }

  async function finishJob(id, status, error = null) {
    const ref = jobRef(id);
    await db.runTransaction(async (tx) => {
      const job = (await tx.get(ref)).data();
      if (!job || terminal(job.status)) return;
      tx.update(ref, { status, error, updatedAt: Date.now() });
    });
  }

  async function savePlan(id, snapshot, plan) {
    const ref = jobRef(id);
    // Small separate manifest documents avoid Firestore's per-document limit.
    for (let offset = 0; offset < plan.batches.length; offset += 50) {
      const batch = db.batch();
      plan.batches
        .slice(offset, offset + 50)
        .forEach((entries, i) =>
          batch.set(ref.collection("batches").doc(String(offset + i)), {
            entries,
            expiresAt: expiry(),
          }),
        );
      await batch.commit();
    }
    await db.runTransaction(async (tx) => {
      const job = (await tx.get(ref)).data();
      if (!job || terminal(job.status) || jobExpired(job)) return;
      tx.update(ref, {
        status: "running",
        commitSha: snapshot.commitSha,
        overview: plan.overview,
        batchCount: plan.batches.length,
        metadata: clean({
          name: snapshot.metadata.name ?? job.repository.repository,
          description: snapshot.metadata.description ?? "",
        }),
        updatedAt: Date.now(),
      });
    });
  }

  async function commitBatch(id, index, rows) {
    const ref = jobRef(id);
    return db.runTransaction(async (tx) => {
      const job = (await tx.get(ref)).data();
      if (!job || terminal(job.status) || jobExpired(job)) return false;
      if (job.nextBatch > index) return true; // Retried step already committed.
      if (job.nextBatch !== index)
        throw new Error("Out-of-order repository batch.");
      for (let i = 0; i < rows.length; i++) {
        const rowId = String(index * JOB_LIMITS.batchSize + i).padStart(6, "0");
        tx.set(ref.collection("files").doc(rowId), {
          ...clean(rows[i]),
          expiresAt: expiry(),
        });
      }
      tx.update(ref, {
        nextBatch: index + 1,
        totals: addBatchTotals(job.totals, rows),
        updatedAt: Date.now(),
      });
      return true;
    });
  }

  async function getBatch(id, index) {
    const snapshot = await jobRef(id)
      .collection("batches")
      .doc(String(index))
      .get();
    if (!snapshot.exists) throw new Error("Repository batch is missing.");
    return snapshot.data().entries;
  }

  async function pageFiles(id, after = "") {
    let query = jobRef(id).collection("files").orderBy("__name__").limit(10);
    if (after) query = query.startAfter(after);
    const snapshot = await query.get();
    const files = snapshot.docs.map((doc) => {
      const { expiresAt: _expiry, ...row } = doc.data();
      return { ...row, id: doc.id };
    });
    return { files, nextCursor: files.length === 10 ? files.at(-1).id : null };
  }
  return {
    jobRef,
    validJobId,
    createJob,
    getJob,
    latestJob,
    finishJob,
    savePlan,
    commitBatch,
    getBatch,
    pageFiles,
  };
}
export const jobRef = (...args) =>
  createRepositoryJobStore(adminDb()).jobRef(...args);
export const createJob = (...args) =>
  createRepositoryJobStore(adminDb()).createJob(...args);
export const getJob = (...args) =>
  createRepositoryJobStore(adminDb()).getJob(...args);
export const latestJob = (...args) =>
  createRepositoryJobStore(adminDb()).latestJob(...args);
export const finishJob = (...args) =>
  createRepositoryJobStore(adminDb()).finishJob(...args);
export const savePlan = (...args) =>
  createRepositoryJobStore(adminDb()).savePlan(...args);
export const commitBatch = (...args) =>
  createRepositoryJobStore(adminDb()).commitBatch(...args);
export const getBatch = (...args) =>
  createRepositoryJobStore(adminDb()).getBatch(...args);
export const pageFiles = (...args) =>
  createRepositoryJobStore(adminDb()).pageFiles(...args);
export const validJobId = (id) =>
  typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
