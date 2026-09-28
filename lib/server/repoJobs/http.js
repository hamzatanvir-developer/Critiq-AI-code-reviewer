import { parseRepositoryUrl } from "../githubSnapshot.js";
import { gradeFor } from "./policy.js";

const json = (value, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function publicJob(job) {
  if (!job) return null;
  const { ownerId: _owner, expiresAt: _expiry, ...safe } = job;
  const score = job.totals.weight
    ? Math.round(job.totals.weightedScore / job.totals.weight)
    : null;
  return { ...safe, score, grade: score === null ? null : gradeFor(score) };
}

export function createJobHandlers({ store, verify, configured, send }) {
  async function authorize(request) {
    if (!configured())
      throw Object.assign(
        new Error(
          "Background scans need server configuration. Use Quick scan until setup is complete.",
        ),
        { status: 503 },
      );
    if (
      request.method !== "GET" &&
      (request.headers.get("origin") !== new URL(request.url).origin ||
        !request.headers.get("content-type")?.startsWith("application/json"))
    )
      throw Object.assign(new Error("Request rejected."), { status: 403 });
    const [scheme, token] = (request.headers.get("authorization") ?? "").split(
      " ",
    );
    if (scheme !== "Bearer" || !token || token.length > 4096)
      throw Object.assign(new Error("Authentication required."), {
        status: 401,
      });
    try {
      const uid = (await verify(token)).uid;
      if (typeof uid !== "string" || !uid) throw new Error("Invalid identity.");
      return uid;
    } catch {
      throw Object.assign(new Error("Authentication required."), {
        status: 401,
      });
    }
  }
  const handle = (action) => async (request, context) => {
    try {
      return await action(request, context, await authorize(request));
    } catch (error) {
      return json(
        {
          error: error.status
            ? error.message
            : "Background scan request failed. Try again.",
        },
        error.status ?? 503,
      );
    }
  };
  const owned = async (context, uid) => {
    const { id } = await context.params;
    const job = await store.getJob(id);
    if (!job || job.ownerId !== uid)
      throw Object.assign(new Error("Scan not found."), { status: 404 });
    return job;
  };
  return {
    latest: handle(async (_request, _context, uid) =>
      json({ job: publicJob(await store.latestJob(uid)) }),
    ),
    create: handle(async (request, _context, uid) => {
      const text = await request.text();
      if (text.length > 2048) return json({ error: "Request too large." }, 413);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "Invalid JSON." }, 400);
      }
      const repository = parseRepositoryUrl(body?.repoUrl);
      const job = await store.createJob(uid, repository);
      if (job.status === "queued") {
        try {
          await send({
            id: `repo-${job.id}`,
            name: "critiq/repository.scan.requested",
            data: { jobId: job.id, ownerId: uid },
          });
        } catch {
          return json(
            {
              job: publicJob(job),
              error:
                "Scan saved but queue delivery is unconfirmed. Click Start scan again to retry delivery without creating another job.",
            },
            503,
          );
        }
      }
      return json({ job: publicJob(job) }, 202);
    }),
    status: handle(async (request, context, uid) => {
      const job = await owned(context, uid);
      const params = new URL(request.url).searchParams;
      if (params.get("files") !== "1") return json({ job: publicJob(job) });
      const after = params.get("after") ?? "";
      if (after && !/^\d{6}$/.test(after))
        return json({ error: "Invalid page cursor." }, 400);
      return json({
        job: publicJob(job),
        ...(await store.pageFiles(job.id, after)),
      });
    }),
    cancel: handle(async (_request, context, uid) => {
      const job = await owned(context, uid);
      await store.finishJob(job.id, "cancelled");
      return json({ job: publicJob(await store.getJob(job.id)) });
    }),
  };
}
