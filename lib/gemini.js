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

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
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

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;

    return JSON.parse(text);
  } catch {
    return null;
  }
}
