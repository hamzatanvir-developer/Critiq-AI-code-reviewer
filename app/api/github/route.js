const githubHeaders = {
  Accept: "application/vnd.github.v3+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

function isValidName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]+$/.test(value);
}

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

export async function GET(request) {
  const userId = await verifyFirebaseUser(request);

  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const parameters = new URL(request.url).searchParams;
  const action = parameters.get("action");
  const username = parameters.get("username");
  const reponame = parameters.get("reponame");

  if (!isValidName(username) || !isValidName(reponame)) {
    return Response.json({ error: "Invalid repository." }, { status: 400 });
  }

  let endpoint;

  if (action === "tree") {
    endpoint = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(reponame)}/git/trees/HEAD?recursive=1`;
  } else if (action === "metadata") {
    endpoint = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(reponame)}`;
  } else if (action === "file") {
    const filePath = parameters.get("filePath");

    if (!filePath || filePath.includes("..") || filePath.length > 500) {
      return Response.json({ error: "Invalid file path." }, { status: 400 });
    }

    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
    endpoint = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(reponame)}/contents/${encodedPath}`;
  } else {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }

  try {
    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers: githubHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();

    return Response.json(data, { status: response.status });
  } catch {
    return Response.json({ error: "GitHub request failed." }, { status: 502 });
  }
}
