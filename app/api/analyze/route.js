import { reviewCode } from "@/lib/reviewCode";
import { checkRateLimit } from "@/lib/server/rateLimit";

const allowedLanguages = new Set(["JavaScript", "Python", "Java", "C++", "React"]);
const maxCodeLength = 50000;
const rateLimitWindow = 60_000;
const maxUserRequestsPerWindow = 20;
const maxIpRequestsPerWindow = 50;

async function verifyFirebaseUser(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, idToken] = authorization.split(" ");

  if (scheme !== "Bearer" || !idToken || idToken.length > 4096) return null;

  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!firebaseApiKey) return null;

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
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

function getClientIp(request) {
  return (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function isTrustedBrowserRequest(request) {
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";

  if (!origin || !contentType.toLowerCase().startsWith("application/json")) {
    return false;
  }

  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function POST(request) {
  if (!isTrustedBrowserRequest(request)) {
    return Response.json({ error: "Request rejected." }, { status: 403 });
  }

  const userId = await verifyFirebaseUser(request);
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const clientIp = getClientIp(request);
  const userLimit = checkRateLimit(
    `user:${userId}`,
    maxUserRequestsPerWindow,
    rateLimitWindow,
  );
  const ipLimit = checkRateLimit(
    `ip:${clientIp}`,
    maxIpRequestsPerWindow,
    rateLimitWindow,
  );

  if (!userLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(userLimit.retryAfter, ipLimit.retryAfter);
    return Response.json(
      { error: "Too many requests. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { code, language } = body;
  if (
    typeof code !== "string" ||
    code.trim().length === 0 ||
    code.length > maxCodeLength ||
    typeof language !== "string" ||
    !allowedLanguages.has(language)
  ) {
    return Response.json(
      { error: "Invalid code or language." },
      { status: 400 },
    );
  }

  let staticResult;
  try {
    staticResult = await reviewCode(code, language);
  } catch (error) {
    console.error("Static code analysis failed:", error);
    return Response.json(
      { error: "Static code analysis failed." },
      { status: 500 },
    );
  }
  return Response.json(staticResult);
}
