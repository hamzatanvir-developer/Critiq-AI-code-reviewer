import { auth } from "@/lib/firebase";

export async function analyzeCode(codeOrRequestBody, language) {
  try {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return null;
    }

    const requestBody =
      typeof codeOrRequestBody === "object" && codeOrRequestBody !== null
        ? codeOrRequestBody
        : { code: codeOrRequestBody, language };
    const idToken = await currentUser.getIdToken();
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}
