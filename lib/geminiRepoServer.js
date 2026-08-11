import "server-only";

const GEMINI_MODEL = "gemini-2.0-flash";

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

export async function analyzeRepoWithGemini(files, repoMetadata) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return null;
    }

    const fileContents = files
      .map((file) => `File: ${file.path}\n${file.content}`)
      .join("\n\n---\n\n");

    const prompt = `You are an expert code reviewer analyzing a GitHub repository.
Analyze these ${files.length} files from the ${repoMetadata.name} repository and return ONLY valid JSON:
{
  "overallScore": number out of 100,
  "healthGrade": "A" or "B" or "C" or "D" or "F",
  "techStack": array of detected technologies,
  "totalIssues": number,
  "criticalBugs": array of { "file", "issue", "severity": "high" or "medium" or "low" },
  "securityIssues": array of { "file", "issue", "recommendation" },
  "strengths": array of strings,
  "improvements": array of strings,
  "fileReports": array of { "path", "score": number out of 100, "issues": number, "summary": string },
  "summary": string
}

Files to analyze:
${fileContents}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    return typeof responseText === "string" ? extractJson(responseText) : null;
  } catch {
    return null;
  }
}
