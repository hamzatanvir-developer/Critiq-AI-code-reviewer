import { jobHandlers } from "@/lib/server/repoJobs/handlers";

export const runtime = "nodejs";
export const GET = jobHandlers.status;
export const DELETE = jobHandlers.cancel;
