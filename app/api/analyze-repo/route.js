import analyzeRepo from "@/lib/analyzers/repoAnalyzer";
import { filterImportantFiles, getFileLanguage, getFullFileTree } from "@/lib/repoTree";

const maxFileLength = 3000;
const routeDeadlineMs = 19_000;

function isTrustedRequest(request) {
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";
  try {
    return origin === new URL(request.url).origin && contentType.toLowerCase().startsWith("application/json");
  } catch {
    return false;
  }
}

async function verifyFirebaseUser(request) {
  const [scheme, idToken] = (request.headers.get("authorization") ?? "").split(" ");
  const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (scheme !== "Bearer" || !idToken || idToken.length > 4096 || !firebaseApiKey) return null;
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.users?.[0]?.localId ?? null;
  } catch {
    return null;
  }
}

function parseRepoUrl(repoUrl) {
  const url = new URL(repoUrl);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Enter a valid public GitHub repository URL.");
  }
  const [owner, rawRepository] = url.pathname.split("/").filter(Boolean);
  const repository = rawRepository?.replace(/\.git$/i, "");
  const validPart = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repository || !validPart.test(owner) || !validPart.test(repository)) {
    throw new Error("The URL must include a valid GitHub owner and repository.");
  }
  return { owner, repository };
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
}

async function fetchGitHubJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: githubHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub request failed (${response.status}): ${message.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchSourceFile(owner, repository, path, timeoutMs) {
  try {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const data = await fetchGitHubJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}`,
      timeoutMs,
    );
    if (data.type !== "file" || typeof data.content !== "string") return null;
    const content = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8").slice(0, maxFileLength);
    return content ? { path, content, language: getFileLanguage(path) } : null;
  } catch (error) {
    console.warn(`Could not read ${path}:`, error.message);
    return null;
  }
}

async function generateProjectSummary(report, metadata, timeoutMs) {
  if (!process.env.GROQ_API_KEY) throw new Error("Groq API key is not configured.");
  const prompt = `Write exactly three concise professional sentences summarizing this repository report. Do not use markdown.
Repository: ${metadata.name}
Description: ${metadata.description || "No description provided"}
Score: ${report.overallScore}/100 (${report.grade})
Analyzed files: ${report.summary.totalFiles}
Bugs: ${report.summary.totalBugs}
Security issues: ${report.summary.totalSecurityIssues}
Critical issues: ${report.summary.criticalIssues}`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 250,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Groq summary failed (${response.status}).`);
  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error("Groq returned an empty summary.");
  return summary;
}

export async function POST(request) {
  console.log("POST /api/analyze-repo hit");
  console.log("GROQ_API_KEY exists:", !!process.env.GROQ_API_KEY);
  console.log("GITHUB_TOKEN exists:", !!process.env.GITHUB_TOKEN);
  const deadline = Date.now() + routeDeadlineMs;

  if (!isTrustedRequest(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  if (!(await verifyFirebaseUser(request))) return Response.json({ error: "Authentication required." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  let repository;
  try {
    repository = parseRepoUrl(body?.repoUrl);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  try {
    const { owner, repository: name } = repository;
    const baseUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const [treeData, metadataData] = await Promise.all([
      fetchGitHubJson(`${baseUrl}/git/trees/HEAD?recursive=1`, 5_000),
      fetchGitHubJson(baseUrl, 5_000),
    ]);
    const tree = (treeData.tree ?? []).filter((entry) => entry.type === "blob" && typeof entry.path === "string");
    const overview = getFullFileTree(tree);
    const importantFiles = filterImportantFiles(tree);
    if (!importantFiles.length) return Response.json({ error: "No supported source files were found." }, { status: 400 });

    const contentTimeout = Math.max(500, Math.min(5_000, deadline - Date.now()));
    const files = (await Promise.all(
      importantFiles.map((path) => fetchSourceFile(owner, name, path, contentTimeout)),
    )).filter(Boolean);
    console.log("Files fetched:", files.length);
    if (!files.length) return Response.json({ error: "GitHub did not return readable source files." }, { status: 502 });

    const report = analyzeRepo(files);
    console.log("Static analysis done, score:", report.overallScore);
    const repoMetadata = {
      name: metadataData.name,
      description: metadataData.description,
      language: metadataData.language,
      stars: metadataData.stargazers_count,
      forks: metadataData.forks_count,
      size: metadataData.size,
      default_branch: metadataData.default_branch,
    };
    const result = {
      ...report,
      repoMetadata,
      fullRepoOverview: {
        totalFiles: overview.totalFiles,
        analyzedFiles: files.length,
        skippedFiles: Math.max(0, overview.totalFiles - files.length),
        analyzableFiles: overview.analyzableFiles,
        languages: overview.languages,
        structure: overview.structure,
      },
    };

    const remainingMs = deadline - Date.now();
    if (remainingMs > 500) {
      try {
        result.aiSummary = await generateProjectSummary(report, repoMetadata, Math.min(10_000, remainingMs));
      } catch (error) {
        console.error("Groq project summary failed:", error.message);
      }
    }
    return Response.json(result);
  } catch (error) {
    console.error("Repository analysis failed:", error);
    const status = /GitHub request failed \(404\)/.test(error.message) ? 404 : 502;
    return Response.json(
      { error: status === 404 ? "Repository not found or not public." : "Repository analysis failed. Please try again." },
      { status },
    );
  }
}
