import "server-only";
import { adminAuth, jobsConfigured } from "../firebaseAdmin.js";
import * as store from "./store.js";
import { inngest } from "./inngest.js";
import { createJobHandlers } from "./http.js";

export const jobHandlers = createJobHandlers({
  store,
  configured: jobsConfigured,
  verify: (token) => adminAuth().verifyIdToken(token, true),
  send: (event) => inngest.send(event),
});
