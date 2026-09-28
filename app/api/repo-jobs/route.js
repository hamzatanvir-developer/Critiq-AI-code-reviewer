import { jobHandlers } from "@/lib/server/repoJobs/handlers";

export const runtime = "nodejs";
export const GET = jobHandlers.latest;
export const POST = jobHandlers.create;
