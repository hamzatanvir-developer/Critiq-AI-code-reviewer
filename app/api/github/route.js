const githubHeaders = {
  Accept: "application/vnd.github.v3+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

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

    if (url.protocol !== "https:" || url.hostname !== "api.github.com") {
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

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { url, type } = body;

  if (
    typeof url !== "string" ||
    !allowedTypes.has(type) ||
    !isAllowedGitHubUrl(url, type)
  ) {
    return Response.json({ error: "Invalid GitHub request." }, { status: 400 });
  }

  try {
    console.log("GitHub token exists:", !!process.env.GITHUB_TOKEN);

    const response = await fetch(url, {
      headers: githubHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    console.log("GitHub response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log("GitHub error:", errorText);

      return new Response(errorText, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    return Response.json(data, { status: response.status });
  } catch {
    return Response.json({ error: "GitHub request failed." }, { status: 502 });
  }
}
