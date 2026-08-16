import runStaticAnalysis from "../../../lib/staticAnalyzer.js";

const aiModel = "llama-3.3-70b-versatile";
const allowedLanguages = new Set(["JavaScript", "Python", "Java", "C++", "React"]);
const maxCodeLength = 50000;
const rateLimitWindow = 60_000;
const maxUserRequestsPerWindow = 20;
const maxIpRequestsPerWindow = 50;
const maxAiResponseLength = 250000;
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

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return "";

  const contentStart = start + startMarker.length;
  const end = text.indexOf(endMarker, contentStart);
  return text.slice(contentStart, end === -1 ? text.length : end).trim();
}

function fallbackSummary(staticResult) {
  return `Code scored ${staticResult.overallScore}/100. Found ${staticResult.bugs.length} bugs, ${staticResult.security.length} security issues.`;
}

async function generateAiEnhancements(code, language, staticResult) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq API key is not configured.");

  const aiPrompt = `You are a senior code reviewer.

This ${language} code has been statically analyzed with these results:
- Score: ${staticResult.overallScore}/100
- Bugs found: ${staticResult.bugs.length}
- Security issues: ${staticResult.security.length}
- Performance issues: ${staticResult.performance.length}

Write:
1. A 2-3 sentence professional summary of the code quality
2. A fully refactored production-ready version fixing ALL issues

Format your response as:
SUMMARY_START
your summary here
SUMMARY_END
REFACTORED_CODE_START
your refactored code here
REFACTORED_CODE_END

Code to refactor:
${code}`;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: "user", content: aiPrompt }],
        temperature: 0.1,
        max_tokens: 4000,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq request failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Groq returned no response text.");
  }
  if (text.length > maxAiResponseLength) {
    throw new Error("Groq returned an oversized response.");
  }

  return {
    summary: extractBetween(text, "SUMMARY_START", "SUMMARY_END"),
    refactoredCode: extractBetween(
      text,
      "REFACTORED_CODE_START",
      "REFACTORED_CODE_END",
    ),
  };
}

export async function POST(request) {
  const startTime = Date.now();
  console.log("Code review request started");

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

  const staticResult = runStaticAnalysis(code, language);

  try {
    const aiResult = await generateAiEnhancements(code, language, staticResult);
    return Response.json({
      ...staticResult,
      summary: aiResult.summary || "Code analyzed successfully.",
      refactoredCode: aiResult.refactoredCode || "",
    });
  } catch (error) {
    console.error("Groq enhancement request failed:", error);
    return Response.json({
      ...staticResult,
      summary: fallbackSummary(staticResult),
      refactoredCode: "",
    });
  } finally {
    console.log("Groq response time:", Date.now() - startTime, "ms");
  }
}
