import { createGitHubClient, openRepositorySnapshot, parseRepositoryUrl, readSnapshotBatch } from "@/lib/server/githubSnapshot";
import analyzeRepo from "@/lib/analyzers/repoAnalyzer";
import { filterImportantFiles, getFileLanguage, getFullFileTree } from "@/lib/repoTree";
import { checkRateLimit } from "@/lib/server/rateLimit";

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

export async function POST(request) {
  const deadline = Date.now() + routeDeadlineMs;

  if (!isTrustedRequest(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const userId = await verifyFirebaseUser(request);
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
  const rateLimit = checkRateLimit(`repo:${userId}`, 6, 60_000);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many repository analyses. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  let repository;
  try {
    repository = parseRepositoryUrl(body?.repoUrl);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  try {
    const get = createGitHubClient({ ...repository, deadline });
    const snapshot = await openRepositorySnapshot(get, { maxTreeRequests: 6 });
    const metadataData = snapshot.metadata;
    const tree = snapshot.entries.filter((entry) => entry.type === "blob");
    const overview = getFullFileTree(tree);
    const regular = tree.filter((entry) => ["100644", "100755"].includes(entry.mode));
    const importantFiles = filterImportantFiles(regular);
    if (!importantFiles.length) return Response.json({ error: "No supported source files were found." }, { status: 400 });
    const indexed = new Map(regular.map((entry) => [entry.path, entry]));
    const fetched = await readSnapshotBatch(get, importantFiles.map((path) => indexed.get(path)));
    const files = fetched.filter((file) => !file.reason).map((file) => ({ ...file, language: getFileLanguage(file.path) }));
    if (!files.length) return Response.json({ error: "GitHub did not return readable source files." }, { status: 502 });

    const report = analyzeRepo(files);
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
      commitSha: snapshot.commitSha,
      fullRepoOverview: {
        totalFiles: overview.totalFiles,
        analyzedFiles: files.length,
        skippedFiles: Math.max(0, overview.totalFiles - files.length),
        analyzableFiles: overview.analyzableFiles,
        languages: overview.languages,
        structure: overview.structure,
        treeTruncated: !snapshot.complete,
        incompleteReasons: snapshot.reasons,
        fileSkips: fetched.filter((file) => file.reason).map(({ path, reason }) => ({ path, reason })),
        scope: "sample",
        unreadableOrOversizedFiles: importantFiles.filter((path) => !files.some((file) => file.path === path)),
      },
    };

    result.projectSummary = `Static analysis reviewed ${files.length} selected files out of ${overview.totalFiles}. The sampled files scored ${report.overallScore}/100 with ${report.summary.totalBugs} bug findings and ${report.summary.totalSecurityIssues} security review findings. Unanalyzed files are not covered by this score.`;
    return Response.json(result);
  } catch (error) {
    console.error("Repository analysis failed:", error.reason ?? "analysis-error");
    const status = error.status ?? 502;
    return Response.json(
      { error: status === 404 ? "Repository not found or not public." : "Repository analysis failed. Please try again." },
      { status },
    );
  }
}
