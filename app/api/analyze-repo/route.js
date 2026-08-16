import analyzeRepo from "@/lib/analyzers/repoAnalyzer";

const maxFiles = 8;
const maxFileLength = 3000;
const maxTotalLength = 250_000;

function isTrustedRequest(request) {
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";

  try {
    return (
      origin === new URL(request.url).origin &&
      contentType.toLowerCase().startsWith("application/json")
    );
  } catch {
    return false;
  }
}

async function verifyFirebaseUser(request) {
  const [scheme, idToken] = (request.headers.get("authorization") ?? "").split(
    " ",
  );
  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (scheme !== "Bearer" || !idToken || !firebaseApiKey) return null;

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

function isValidPayload(files, repoMetadata) {
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.length > maxFiles ||
    typeof repoMetadata?.name !== "string"
  ) {
    return false;
  }

  let totalLength = 0;
  for (const file of files) {
    if (
      typeof file?.path !== "string" ||
      typeof file?.content !== "string" ||
      typeof file?.language !== "string" ||
      file.content.length > maxFileLength
    ) {
      return false;
    }
    totalLength += file.content.length;
  }

  return totalLength <= maxTotalLength;
}

async function generateProjectSummary(report, repoMetadata) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq API key is not configured.");

  const prompt = `You are a senior engineering lead writing an executive repository assessment.
Write exactly three concise professional sentences. Do not use markdown, headings, bullets, or scores not supplied below.

Repository: ${repoMetadata.name}
Description: ${repoMetadata.description || "No description provided"}
Primary language: ${repoMetadata.language || "Unknown"}
Overall score: ${report.overallScore}/100 (${report.grade})
Files analyzed: ${report.summary.totalFiles}
Bugs: ${report.summary.totalBugs}
Security issues: ${report.summary.totalSecurityIssues}
Performance issues: ${report.summary.totalPerformanceIssues}
Quality issues: ${report.summary.totalQualityIssues}
Critical issues: ${report.summary.criticalIssues}
Best practices passed: ${report.summary.passedBestPractices}
Best practices failed: ${report.summary.failedBestPractices}`;

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
        max_tokens: 250,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq summary failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error("Groq returned an empty project summary.");
  return summary;
}

export async function POST(request) {
  console.log("Analyze repo route hit");
  console.log("GROQ_API_KEY exists:", !!process.env.GROQ_API_KEY);
  console.log("GITHUB_TOKEN exists:", !!process.env.GITHUB_TOKEN);

  if (!isTrustedRequest(request)) {
    return Response.json({ error: "Request rejected." }, { status: 403 });
  }

  const userId = await verifyFirebaseUser(request);
  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const limitedFiles = Array.isArray(body.files)
    ? body.files.slice(0, maxFiles).map((file) => ({
        ...file,
        content:
          typeof file?.content === "string"
            ? file.content.slice(0, maxFileLength)
            : file?.content,
      }))
    : body.files;

  if (!isValidPayload(limitedFiles, body.repoMetadata)) {
    return Response.json({ error: "Invalid repository data." }, { status: 400 });
  }

  console.log("Files fetched:", limitedFiles.length);

  let report;
  try {
    report = analyzeRepo(limitedFiles);
    console.log("Static analysis done, score:", report.overallScore);
  } catch (error) {
    console.error("Static repository analysis failed:", error);
    return Response.json(
      { error: "Repository contains an unsupported or invalid source file." },
      { status: 400 },
    );
  }

  try {
    const aiSummary = await generateProjectSummary(report, body.repoMetadata);
    return Response.json({
      ...report,
      aiSummary,
    });
  } catch (error) {
    console.error("Groq project summary failed:", error);
    return Response.json(report);
  }
}
