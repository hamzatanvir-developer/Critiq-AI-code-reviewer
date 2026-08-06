const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
const maxRetries = 3;
const retryDelay = 3000;

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
  summary:
    "API rate limit reached. This is a mock response for testing. Please try again in a few seconds.",
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function analyzeCode(code, language) {
  const prompt = `You are an expert code reviewer. Analyze this ${language} code and return ONLY a valid JSON response with exactly this structure, no markdown, no backticks, just pure JSON:
{
  "overallScore": number out of 100,
  "bugs": [{ "line": "string", "issue": "string", "severity": "high" or "medium" or "low" }],
  "security": [{ "issue": "string", "recommendation": "string" }],
  "performance": [{ "issue": "string", "suggestion": "string" }],
  "quality": [{ "issue": "string", "improvement": "string" }],
  "summary": "2-3 sentence summary of the code"
}

Code to analyze:
${code}`;

  let rateLimitReached = false;

  for (const model of models) {
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
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
          break;
        }

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;

        return JSON.parse(text);
      } catch {
        break;
      }
    }
  }

  if (rateLimitReached) {
    return rateLimitMock;
  }

  return null;
}
