import { runStaticAnalysis } from "@/lib/staticAnalyzer";

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
  } catch (error) {
    console.error("Static code analysis failed:", error);
    return Response.json(
      { error: "Static code analysis failed." },
      { status: 500 },
    );
  }
  staticResult.summary = `Code scored ${staticResult.overallScore}/100. Found ${staticResult.bugs.length} bugs, ${staticResult.security.length} security issues, ${staticResult.performance.length} performance issues.`;
  staticResult.refactoredCode = "";

  try {
    let groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "user",
              content: `Write a 2 sentence summary of this ${language} code quality (score: ${staticResult.overallScore}/100, bugs: ${staticResult.bugs.length}, security issues: ${staticResult.security.length}). Then provide a fully refactored production-ready version.

Format:
SUMMARY_START
your 2 sentence summary
SUMMARY_END
REFACTORED_CODE_START
complete refactored code
REFACTORED_CODE_END

Code:
${code.slice(0, 2000)}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 4000,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );

    if (groqResponse.status === 404) {
      groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "mixtral-8x7b-32768",
            messages: [
              {
                role: "user",
                content: `Write a 2 sentence summary of this ${language} code quality (score: ${staticResult.overallScore}/100, bugs: ${staticResult.bugs.length}, security issues: ${staticResult.security.length}). Then provide a fully refactored production-ready version.

Format:
SUMMARY_START
your 2 sentence summary
SUMMARY_END
REFACTORED_CODE_START
complete refactored code
REFACTORED_CODE_END

Code:
${code.slice(0, 2000)}`,
              },
            ],
            temperature: 0.1,
            max_tokens: 4000,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
    }

    if (!groqResponse.ok) {
      throw new Error(`Groq returned status ${groqResponse.status}`);
    }

    const groqData = await groqResponse.json();
    const text = groqData.choices?.[0]?.message?.content || "";
    console.log("Groq response length:", text.length);
    const summaryMatch = text.match(/SUMMARY_START([\s\S]*?)SUMMARY_END/);
    const refactoredMatch = text.match(/REFACTORED_CODE_START([\s\S]*?)REFACTORED_CODE_END/);
    console.log("Refactored code found:", !!refactoredMatch);

    staticResult.summary = summaryMatch
      ? summaryMatch[1].trim()
      : `Code scored ${staticResult.overallScore}/100 with ${staticResult.bugs.length} bugs found.`;
    staticResult.refactoredCode = refactoredMatch ? refactoredMatch[1].trim() : "";
  } catch (error) {
    console.log(
      "Groq failed, using static analysis only:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return Response.json(staticResult);
}
