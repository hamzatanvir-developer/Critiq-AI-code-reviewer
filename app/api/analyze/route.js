const models = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
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
  return `You are an expert code reviewer. Analyze this ${language} code and return ONLY a valid JSON response with exactly this structure, no markdown, no backticks, just pure JSON:
{
  "overallScore": number out of 100,
  "bugs": [{ "line": "string", "issue": "string", "severity": "high" or "medium" or "low" }],
  "security": [{ "issue": "string", "recommendation": "string" }],
  "performance": [{ "issue": "string", "suggestion": "string" }],
  "quality": [{ "issue": "string", "improvement": "string" }],
  "refactoredCode": "the improved version of the entire code with all fixes applied",
  "complexity": {
    "level": "Simple" or "Moderate" or "Complex",
    "score": number from 1 to 10,
    "reasons": ["reason 1", "reason 2", "reason 3"]
  },
  "bestPractices": [
    {
      "rule": "rule name",
      "status": "pass" or "fail",
      "description": "explanation"
    }
  ],
  "summary": "2-3 sentence summary of the code"
}

Also provide a refactoredCode field containing the complete rewritten version of the code with all bugs fixed, security issues resolved, and best practices applied. Keep the same language and functionality but improve the code quality.
Also analyze the code complexity and return a complexity object with:
- level: Simple (score 1-3), Moderate (score 4-6), or Complex (score 7-10)
- score: complexity score from 1 to 10
- reasons: array of 2-3 specific reasons explaining the complexity rating
Consider: nesting depth, number of functions, loops, conditionals, and code length.
Also check language-specific best practices and return a bestPractices array.
For JavaScript/React check: proper variable naming (camelCase), no var usage,
arrow functions, error handling, no console.logs in production code.
For Python check: PEP8 naming conventions, docstrings present, no bare except,
proper indentation, type hints.
For Java check: class naming (PascalCase), method naming (camelCase),
proper access modifiers, exception handling.
For C++ check: memory management, header guards, naming conventions,
avoid global variables.
Return 5 best practice checks relevant to the detected language.
Each with status pass or fail and a short description.

If the code provided does not match the specified language, do not analyze it.
Instead return this exact JSON:
{
  "overallScore": 0,
  "bugs": [],
  "security": [],
  "performance": [],
  "quality": [],
  "refactoredCode": "",
  "complexity": {
    "level": "Simple",
    "score": 1,
    "reasons": []
  },
  "bestPractices": [],
  "summary": "The code does not match the selected language. Please paste valid ${language} code and select the correct language."
}

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
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                maxOutputTokens: 8192,
              },
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

        return Response.json(normalizeResult(JSON.parse(text), code));
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
