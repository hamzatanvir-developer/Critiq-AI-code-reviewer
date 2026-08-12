const models = ["gemini-2.0-flash"];
const maxRetries = 3;
const retryDelay = 3000;
const allowedLanguages = new Set(["JavaScript", "Python", "Java", "C++", "React"]);
const maxCodeLength = 50000;
const rateLimitWindow = 60_000;
const maxUserRequestsPerWindow = 6;
const maxIpRequestsPerWindow = 20;
const maxGeminiResponseLength = 250000;
const requestLog = new Map();

const rateLimitMock = {
  overallScore: 72,
  bugs: [
    {
      line: "N/A",
      issue: "Could not analyze - API limit reached",
      severity: "low",
    },
  ],
  security: [],
  performance: [],
  quality: [
    {
      issue: "API rate limit reached",
      improvement: "Try again in a moment",
    },
  ],
  complexity: {
    level: "Unavailable",
    score: 0,
    reasons: ["Complexity could not be calculated while the API limit is active."],
  },
  summary:
    "API rate limit reached. This is a mock response for testing. Please try again in a few seconds.",
};

function estimateComplexity(code) {
  const lines = code.split("\n").filter((line) => line.trim()).length;
  const decisions =
    code.match(/\b(if|else if|for|while|switch|case|catch)\b|&&|\|\||\?/g)
      ?.length ?? 0;
  const score = Math.max(1, Math.min(10, 1 + Math.floor(lines / 35) + Math.floor(decisions / 3)));
  const level = score <= 3 ? "Simple" : score <= 6 ? "Moderate" : "Complex";

  return {
    level,
    score,
    reasons: [
      `${lines} non-empty line${lines === 1 ? "" : "s"} of code were analyzed.`,
      `${decisions} branching or decision point${decisions === 1 ? "" : "s"} were detected.`,
      "This fallback estimate is based on code size and control-flow structure.",
    ],
  };
}

function normalizeResult(result, code) {
  const suppliedScore = Number(result?.complexity?.score);
  const hasValidComplexity =
    result?.complexity &&
    typeof result.complexity.level === "string" &&
    Number.isFinite(suppliedScore) &&
    suppliedScore >= 1 &&
    suppliedScore <= 10;

  if (result.refactoredCode && typeof result.refactoredCode !== "string") {
    result.refactoredCode = JSON.stringify(result.refactoredCode);
  }

  if (!result.refactoredCode) {
    result.refactoredCode = "";
  }

  return {
    ...result,
    complexity: hasValidComplexity
      ? {
          ...result.complexity,
          score: suppliedScore,
          reasons: Array.isArray(result.complexity.reasons)
            ? result.complexity.reasons
            : [],
        }
      : estimateComplexity(code),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function verifyFirebaseUser(request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, idToken] = authorization.split(" ");

  if (scheme !== "Bearer" || !idToken || idToken.length > 4096) {
    return null;
  }

  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (!firebaseApiKey) {
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

function buildPrompt(code, language) {
  return `Analyze this ${language} code. Return ONLY this JSON with no refactoredCode field:
{
  "overallScore": number,
  "bugs": [{ "line": string, "issue": string, "severity": "high" or "medium" or "low" }],
  "security": [{ "issue": string, "recommendation": string }],
  "performance": [{ "issue": string, "suggestion": string }],
  "quality": [{ "issue": string, "improvement": string }],
  "complexity": { "level": "Simple" or "Moderate" or "Complex", "score": number 1-10, "reasons": [string] },
  "bestPractices": [{ "rule": string, "status": "pass" or "fail", "description": string }],
  "summary": string
}

After the JSON on a new line write:
REFACTORED_CODE_START
then the complete refactored code
then REFACTORED_CODE_END

The refactored code must fix every identified bug and security issue, apply every performance and quality improvement, follow ${language} best practices, add missing error handling and input validation, improve naming and complex-logic comments, and be genuinely production-ready.

Code to analyze:
${code}`;
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

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "Gemini API key is not configured." },
      { status: 500 },
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

  const prompt = buildPrompt(code, language);
  let rateLimitReached = false;

  for (const model of models) {
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(45_000),
          },
        );

        if (response.status === 429) {
          rateLimitReached = true;

          if (retry < maxRetries) {
            await wait(retryDelay);
            continue;
          }

          break;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`Gemini ${model} request failed (${response.status}):`, errorBody);
          break;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
          console.error(`Gemini ${model} returned no response text.`);
          break;
        }

        if (text.length > maxGeminiResponseLength) {
          console.error(`Gemini ${model} returned an oversized response.`);
          break;
        }

        const refactoredStartMarker = "REFACTORED_CODE_START";
        const refactoredEndMarker = "REFACTORED_CODE_END";
        const refactoredStart = text.indexOf(refactoredStartMarker);
        const analysisText =
          refactoredStart === -1 ? text : text.slice(0, refactoredStart);
        const firstBrace = analysisText.indexOf("{");
        const lastBrace = analysisText.lastIndexOf("}");

        if (firstBrace === -1 || lastBrace === -1) {
          throw new Error("No JSON found");
        }

        const jsonString = analysisText.slice(firstBrace, lastBrace + 1);
        const parsedResult = JSON.parse(jsonString);
        const refactoredEnd =
          refactoredStart === -1
            ? -1
            : text.indexOf(
                refactoredEndMarker,
                refactoredStart + refactoredStartMarker.length,
              );
        parsedResult.refactoredCode =
          refactoredStart === -1
            ? ""
            : text
                .slice(
                  refactoredStart + refactoredStartMarker.length,
                  refactoredEnd === -1 ? text.length : refactoredEnd,
                )
                .trim();

        return Response.json(normalizeResult(parsedResult, code));
      } catch (error) {
        console.error(`Gemini ${model} request failed:`, error);
        break;
      }
    }
  }

  if (rateLimitReached) {
    return Response.json(rateLimitMock);
  }

  return Response.json(
    { error: "Gemini could not analyze the code." },
    { status: 502 },
  );
}
