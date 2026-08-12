const models = ["llama-3.3-70b-versatile"];
const maxRetries = 3;
const retryDelay = 3000;
const allowedLanguages = new Set(["JavaScript", "Python", "Java", "C++", "React"]);
const maxCodeLength = 50000;
const rateLimitWindow = 60_000;
const maxUserRequestsPerWindow = 20;
const maxIpRequestsPerWindow = 50;
const maxGeminiResponseLength = 250000;
const requestLog = new Map();

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

function buildPrompt(code, language, originalAnalysis) {
  if (originalAnalysis) {
    return `You are a senior code reviewer doing a comparative analysis.

ORIGINAL CODE ANALYSIS:
- Original Score: ${originalAnalysis.overallScore}/100
- Bugs found: ${originalAnalysis.bugs?.length || 0}
- Security issues: ${originalAnalysis.security?.length || 0}
- Performance issues: ${originalAnalysis.performance?.length || 0}
- Quality issues: ${originalAnalysis.quality?.length || 0}
- Summary: ${originalAnalysis.summary}

Now analyze this REFACTORED version of that code.
The refactored code claims to fix all the above issues.

IMPORTANT SCORING RULES:
- If refactored code fixes all bugs: score MUST be higher than ${originalAnalysis.overallScore}
- If refactored code fixes most issues: score MUST be at least ${Math.min(95, originalAnalysis.overallScore + 10)}
- Score relative to the original, not in isolation
- Acknowledge improvements made from the original

Return ONLY this JSON:
{
  "overallScore": number (MUST be higher than ${originalAnalysis.overallScore} if issues are fixed),
  "bugs": [],
  "security": [],
  "performance": [],
  "quality": [],
  "complexity": {},
  "bestPractices": [],
  "summary": string (mention improvements from original),
  "isRefactoredAnalysis": true,
  "originalScore": ${originalAnalysis.overallScore},
  "improvement": number (difference from original score)
}

After the closing } of the JSON, on a new line write exactly:
REFACTORED_CODE_START
Then write the complete refactored ${language} code.
Then write exactly:
REFACTORED_CODE_END

Do not truncate the refactored code. Write the complete version.

Refactored code to analyze (${language}):
${code}`;
  }

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

After the closing } of the JSON, on a new line write exactly:
REFACTORED_CODE_START
Then write the complete refactored ${language} code.
Then write exactly:
REFACTORED_CODE_END

Do not truncate the refactored code. Write the complete version.

The refactored code MUST:
- Fix every single bug listed above
- Resolve every security vulnerability
- Apply every performance improvement
- Follow all ${language} best practices strictly
- Add comprehensive error handling with try/catch everywhere
- Add input validation for all parameters
- Use clear descriptive variable and function names
- Add JSDoc or inline comments for complex logic
- Be completely production-ready code that would pass a senior engineer review
- Score at minimum 90/100 if analyzed again
- Be significantly better than the original in every measurable way
- Never introduce new bugs or issues
- Keep the same functionality but improve everything else

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

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "Groq API key is not configured." },
      { status: 500 },
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { code, language, originalAnalysis } = body;

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

  const prompt = buildPrompt(code, language, originalAnalysis);
  let rateLimitReached = false;

  for (const model of models) {
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      try {
        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.1,
              max_tokens: 6000,
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(60_000),
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
        const text = data.choices?.[0]?.message?.content;

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
    return Response.json(
      { error: "Rate limit reached. Please wait a minute." },
      { status: 429 },
    );
  }

  return Response.json(
    { error: "Could not analyze the code." },
    { status: 502 },
  );
}
