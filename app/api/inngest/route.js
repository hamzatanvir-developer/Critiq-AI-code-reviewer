import { serve } from "inngest/next";
import { inngest } from "@/lib/server/repoJobs/inngest";
import { scanRepository } from "@/lib/server/repoJobs/function";
import { jobsConfigured } from "@/lib/server/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;
const handlers = serve({ client: inngest, functions: [scanRepository] });
const unavailable = () =>
  Response.json(
    { error: "Background scans are not configured." },
    { status: 503 },
  );
// SDK verifies Inngest signatures. Never replace this with a browser-auth bypass.
export const GET = (...args) =>
  jobsConfigured() ? handlers.GET(...args) : unavailable();
export const POST = (...args) =>
  jobsConfigured() ? handlers.POST(...args) : unavailable();
export const PUT = (...args) =>
  jobsConfigured() ? handlers.PUT(...args) : unavailable();
