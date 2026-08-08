const models = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
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

function buildPrompt(code, language) {
  return `You are an expert code reviewer. Analyze this ${language} code and return ONLY a valid JSON response with exactly this structure, no markdown, no backticks, just pure JSON:
{
  "overallScore": number out of 100,
  "bugs": [{ "line": "string", "issue": "string", "severity": "high" or "medium" or "low" }],
  "security": [{ "issue": "string", "recommendation": "string" }],
  "performance": [{ "issue": "string", "suggestion": "string" }],
  "quality": [{ "issue": "string", "improvement": "string" }],
  "summary": "2-3 sentence summary of the code"
}

If the code provided does not match the specified language, do not analyze it.
Instead return this exact JSON:
{
  "overallScore": 0,
  "bugs": [],
  "security": [],
  "performance": [],
  "quality": [],
  "summary": "The code does not match the selected language. Please paste valid ${language} code and select the correct language."
}

Code to analyze:
${code}`;
}

export async function POST(request) {
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
    typeof language !== "string" ||
    language.trim().length === 0
  ) {
    return Response.json(
      { error: "Code and language are required." },
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

        return Response.json(JSON.parse(text));
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
