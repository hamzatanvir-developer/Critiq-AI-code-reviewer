import { runStaticAnalysis } from "@/lib/staticAnalyzer";
import refactorCode from "@/lib/refactorer";

const allowedLanguages = new Set(["JavaScript", "Python", "Java", "C++", "React"]);
const maxCodeLength = 50000;
const rateLimitWindow = 60_000;
const maxUserRequestsPerWindow = 20;
const maxIpRequestsPerWindow = 50;
const requestLog = new Map();

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

    if (!response.ok) return null;

    const data = await response.json();
    return data.users?.[0]?.localId ?? null;
  } catch {
    return null;
  }
}

function exceedsRateLimit(key, limit) {
  const now = Date.now();
  const recentRequests = (requestLog.get(key) ?? []).filter(
    (timestamp) => now - timestamp < rateLimitWindow,
  );

  if (recentRequests.length >= limit) {
    requestLog.set(key, recentRequests);
    return true;
  }

  recentRequests.push(now);
  requestLog.set(key, recentRequests);
  return false;
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
  console.log("POST /api/analyze hit");

  if (!isTrustedBrowserRequest(request)) {
    return Response.json({ error: "Request rejected." }, { status: 403 });
  }

  const userId = await verifyFirebaseUser(request);
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const clientIp = getClientIp(request);
  const userRateLimited = exceedsRateLimit(
    `user:${userId}`,
    maxUserRequestsPerWindow,
  );
  const ipRateLimited = exceedsRateLimit(
    `ip:${clientIp}`,
    maxIpRequestsPerWindow,
  );

  if (userRateLimited || ipRateLimited) {
    return Response.json(
      { error: "Too many requests. Please wait a minute and try again." },
      { status: 429 },
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
    staticResult = runStaticAnalysis(code, language);
    console.log("Static analysis result:");
    console.log("Score:", staticResult.overallScore);
    console.log("Bugs count:", staticResult.bugs?.length);
    console.log("Security count:", staticResult.security?.length);
    console.log("Performance count:", staticResult.performance?.length);
    console.log("Quality count:", staticResult.quality?.length);
    console.log("BestPractices count:", staticResult.bestPractices?.length);
    console.log("First bug:", JSON.stringify(staticResult.bugs?.[0]));
    staticResult.refactoredCode = refactorCode(code, language, staticResult);
  } catch (error) {
    console.error("Static code analysis failed:", error);
    return Response.json(
      { error: "Static code analysis failed." },
      { status: 500 },
    );
  }
  staticResult.summary = `Code scored ${staticResult.overallScore}/100. Found ${staticResult.bugs.length} bugs, ${staticResult.security.length} security issues, ${staticResult.performance.length} performance issues.`;

  try {
    const prompt = `Write a 2 sentence professional code quality summary for this ${language} code.
Score: ${staticResult.overallScore}/100
Bugs found: ${staticResult.bugs?.length || 0}
Security issues: ${staticResult.security?.length || 0}
Performance issues: ${staticResult.performance?.length || 0}

Code:
${code.slice(0, 500)}`;
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY ?? "")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!geminiResponse.ok) {
      throw new Error(`Gemini returned status ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const summary = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (summary) staticResult.summary = summary;
  } catch (error) {
    console.log(
      "Gemini failed, using static analysis summary:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return Response.json(staticResult);
}
