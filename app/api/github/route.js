import { checkRateLimit } from "@/lib/server/rateLimit";
import { createGitHubClient } from "@/lib/server/githubSnapshot";

const allowedTypes = new Set(["tree", "content", "metadata"]);

async function verifyFirebaseUser(request) {
  const [scheme, idToken] = (request.headers.get("authorization") ?? "").split(
    " ",
  );
  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (scheme !== "Bearer" || !idToken || !firebaseApiKey) return null;

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

    if (!response.ok) return null;
    const data = await response.json();
    return data.users?.[0]?.localId ?? null;
  } catch {
    return null;
  }
}

function isAllowedGitHubUrl(value, type) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.hostname !== "api.github.com" || url.username || url.password || url.port || url.hash) {
      return false;
    }

    const repositoryRoot = "[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+";
    const patterns = {
      tree: new RegExp(`^/repos/${repositoryRoot}/git/trees/HEAD$`),
      content: new RegExp(`^/repos/${repositoryRoot}/contents/.+`),
      metadata: new RegExp(`^/repos/${repositoryRoot}$`),
    };

    return patterns[type]?.test(url.pathname) ?? false;
  } catch {
    return false;
  }
}

export async function POST(request) {
  const userId = await verifyFirebaseUser(request);

  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`github:${userId}`, 60, 60_000);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many GitHub requests. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { url, type } = body ?? {};

  if (
    typeof url !== "string" ||
    !allowedTypes.has(type) ||
    !isAllowedGitHubUrl(url, type)
  ) {
    return Response.json({ error: "Invalid GitHub request." }, { status: 400 });
  }

  try {
    const parsed = new URL(url);
    const [, , owner, repository] = parsed.pathname.split("/");
    const get = createGitHubClient({ owner, repository, deadline: Date.now() + 10_000 });
    const metadata = await get("");
    if (metadata.private !== false) return Response.json({ error: "Only public repositories are supported." }, { status: 404 });
    const suffix = parsed.pathname.split("/").slice(4).join("/");
    const data = type === "metadata" ? metadata : await get(`/${suffix}${parsed.search}`);
    return Response.json(data);
  } catch {
    return Response.json({ error: "GitHub request failed." }, { status: 502 });
  }
}
