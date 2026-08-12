import { analyzeRepoWithGroqServer } from "@/lib/groqRepoServer";

const maxFiles = 10;
const maxFileLength = 500;
const maxTotalLength = 250_000;

function isTrustedRequest(request) {
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";

  try {
    return (
      origin === new URL(request.url).origin &&
      contentType.toLowerCase().startsWith("application/json")
    );
  } catch {
    return false;
  }
}

async function verifyFirebaseUser(request) {
  const [scheme, idToken] = (request.headers.get("authorization") ?? "").split(
    " ",
  );
  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (scheme !== "Bearer" || !idToken || !firebaseApiKey) {
    return null;
  }

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.users?.[0]?.localId ?? null;
  } catch {
    return null;
  }
}

function isValidPayload(files, repoMetadata) {
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.length > maxFiles ||
    typeof repoMetadata?.name !== "string"
  ) {
    return false;
  }

  let totalLength = 0;

  for (const file of files) {
    if (
      typeof file?.path !== "string" ||
      typeof file?.content !== "string" ||
      typeof file?.language !== "string" ||
      file.content.length > maxFileLength
    ) {
      return false;
    }

    totalLength += file.content.length;
  }

  return totalLength <= maxTotalLength;
}

export async function POST(request) {
  if (!isTrustedRequest(request)) {
    return Response.json({ error: "Request rejected." }, { status: 403 });
  }

  const userId = await verifyFirebaseUser(request);

  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const limitedFiles = Array.isArray(body.files)
    ? body.files.slice(0, maxFiles).map((file) => ({
        ...file,
        content:
          typeof file?.content === "string"
            ? file.content.slice(0, maxFileLength)
            : file?.content,
      }))
    : body.files;

  if (!isValidPayload(limitedFiles, body.repoMetadata)) {
    return Response.json({ error: "Invalid repository data." }, { status: 400 });
  }

  const result = await analyzeRepoWithGroqServer(
    limitedFiles,
    body.repoMetadata,
  );

  if (!result) {
    return Response.json(
      { error: "Repository analysis failed." },
      { status: 502 },
    );
  }

  return Response.json(result);
}
