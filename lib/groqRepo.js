"use client";

import { auth } from "@/lib/firebase";

export async function analyzeRepoWithGroq(files, repoMetadata) {
  try {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return null;
    }

    const idToken = await currentUser.getIdToken();
    const response = await fetch("/api/analyze-repo", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files, repoMetadata }),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

export default analyzeRepoWithGroq;
