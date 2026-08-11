import "server-only";

function extractJson(responseText) {
  const trimmedText = responseText.trim();

  try {
    return JSON.parse(trimmedText);
  } catch {
    const jsonStart = trimmedText.indexOf("{");
    const jsonEnd = trimmedText.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd <= jsonStart) {
      return null;
    }

    try {
      return JSON.parse(trimmedText.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
  }
}

export async function analyzeRepoWithGroqServer(files, repoMetadata) {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return null;
    }

    const fileContents = files
      .map((file) => `File: ${file.path}\n${file.content}`)
      .join("\n---\n");

    const prompt = `You are an expert code reviewer. Analyze this GitHub repository and return ONLY valid JSON with no markdown, no backticks, just pure JSON:
{
  "overallScore": number out of 100,
  "healthGrade": "A" or "B" or "C" or "D" or "F",
  "techStack": array of detected technologies,
  "totalIssues": number,
  "criticalBugs": [{ "file", "issue", "severity": "high" or "medium" or "low" }],
  "securityIssues": [{ "file", "issue", "recommendation" }],
  "strengths": array of strings,
  "improvements": array of strings,
  "fileReports": [{ "path", "score", "issues", "summary" }],
  "summary": 2-3 sentence overall project summary
}

Repository: ${repoMetadata.name}
Description: ${repoMetadata.description ?? "No description provided"}
Files analyzed: ${files.length}

${fileContents}`;

    console.log("Groq API Key exists:", !!process.env.GROQ_API_KEY);

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 4000,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      },
    );

    console.log("Groq response status:", response.status);

    if (!response.ok) {
      console.log("Groq error:", await response.text());
      return null;
    }

    const data = await response.json();
    const responseText = data.choices?.[0]?.message?.content;

    return typeof responseText === "string" ? extractJson(responseText) : null;
  } catch {
    return null;
  }
}
