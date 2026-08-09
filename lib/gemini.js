import { auth } from "@/lib/firebase";

export async function analyzeCode(code, language) {
  try {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return null;
    }

    const idToken = await currentUser.getIdToken();
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}
