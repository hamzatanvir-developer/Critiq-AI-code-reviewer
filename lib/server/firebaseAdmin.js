import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function adminApp() {
  const existing = getApps().find((app) => app.name === "critiq-jobs");
  if (existing) return existing;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    throw new Error("Background scans are not configured.");
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (credentials.project_id !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
    throw new Error("Firebase project configuration mismatch.");
  return initializeApp({ credential: cert(credentials) }, "critiq-jobs");
}

export const adminDb = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());
export function jobsConfigured() {
  if (process.env.NODE_ENV === "production" && process.env.INNGEST_DEV)
    return false;
  return (
    process.env.REPO_JOBS_ENABLED === "true" &&
    Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) &&
    Boolean(process.env.GITHUB_TOKEN) &&
    ((process.env.NODE_ENV !== "production" &&
      process.env.INNGEST_DEV === "1") ||
      Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY))
  );
}
