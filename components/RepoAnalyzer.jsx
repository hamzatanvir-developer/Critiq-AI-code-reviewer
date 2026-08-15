"use client";

import { useContext, useState } from "react";

import { AuthContext } from "@/context/AuthContext";
import { analyzeRepoWithGroq } from "@/lib/groqRepo";
import {
  fetchFileContent,
  fetchRepoMetadata,
  fetchRepoTree,
  filterImportantFiles,
} from "@/services/repoService";

const languageByExtension = {
  js: "JavaScript",
  jsx: "React",
  ts: "JavaScript",
  tsx: "React",
  py: "Python",
  java: "Java",
  cpp: "C++",
  c: "C++",
};

const severityStyles = {
  high: "border-red-400/30 bg-red-400/10 text-red-300",
  medium: "border-yellow-400/30 bg-yellow-400/10 text-yellow-300",
  low: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
};

const priorityStyles = {
  high: "bg-red-400/10 text-red-300 ring-red-400/20",
  medium: "bg-yellow-400/10 text-yellow-300 ring-yellow-400/20",
  low: "bg-blue-400/10 text-blue-300 ring-blue-400/20",
};

function getScoreColor(score) {
  if (score < 60) return "text-red-400";
  if (score < 75) return "text-yellow-300";
  if (score < 90) return "text-blue-300";
  return "text-green-400";
}

function getFileLanguage(filePath) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return languageByExtension[extension] ?? null;
}

function parseRepositoryUrl(repoUrl) {
  const url = new URL(repoUrl);
  if (url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Enter a valid public GitHub repository URL.");
  }

  const [username, rawRepositoryName] = url.pathname.split("/").filter(Boolean);
  const reponame = rawRepositoryName?.replace(/\.git$/i, "");
  if (!username || !reponame) {
    throw new Error("The URL must include a GitHub username and repository.");
  }
  return { username, reponame };
}

function IssueBadge({ severity = "low" }) {
  const normalized = String(severity).toLowerCase();
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${severityStyles[normalized] ?? severityStyles.low}`}
    >
      {normalized}
    </span>
  );
}

function DetailGroup({ title, items, accent = "text-[#f5f5f5]" }) {
  if (!items?.length) return null;
  return (
    <div>
      <h5 className={`mb-2 text-xs font-bold uppercase tracking-wider ${accent}`}>
        {title} · {items.length}
      </h5>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={`${item.issue ?? item.rule}-${index}`}
            className="rounded-lg border border-[#2a2a2a] bg-[#151515] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-relaxed text-[#d4d4d4]">
                {item.issue ?? item.rule}
              </p>
              {item.severity && <IssueBadge severity={item.severity} />}
            </div>
            {(item.recommendation || item.suggestion || item.improvement || item.description) && (
              <p className="mt-1.5 text-xs leading-relaxed text-[#777]">
                {item.recommendation || item.suggestion || item.improvement || item.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RepoAnalyzer() {
  const { user } = useContext(AuthContext);
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState(null);
  const [metadata, setMetadata] = useState(null);

  async function analyzeRepository(event) {
    event?.preventDefault();
    setError(null);
    setResult(null);
    setMetadata(null);

    if (!repoUrl.trim().toLowerCase().includes("github.com")) {
      setError("Enter a valid GitHub repository URL.");
      return;
    }
    if (!user) {
      setError("Sign in before analyzing a repository.");
      return;
    }

    setLoading(true);
    try {
      const { username, reponame } = parseRepositoryUrl(repoUrl.trim());
      setProgress("Fetching repository structure...");
      const tree = await fetchRepoTree(repoUrl.trim());

      setProgress("Fetching repository details...");
      const repoDetails = await fetchRepoMetadata(username, reponame);
      setMetadata(repoDetails);

      setProgress("Selecting high-impact source files...");
      const importantFiles = filterImportantFiles(tree);
      if (!importantFiles.length) {
        throw new Error("No supported source files were found in this repository.");
      }

      setProgress("Reading source files...");
      const readableFiles = [];
      for (const filePath of importantFiles) {
        const language = getFileLanguage(filePath);
        if (!language) continue;
        const content = await fetchFileContent(username, reponame, filePath);
        if (content !== null) readableFiles.push({ path: filePath, content, language });
      }

      if (!readableFiles.length) {
        throw new Error("GitHub did not return readable supported source files.");
      }

      setProgress(`Building report for ${readableFiles.length} files...`);
      const data = await analyzeRepoWithGroq(readableFiles, repoDetails);
      if (!data) throw new Error("The repository report could not be generated. Try again shortly.");
      setResult(data);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Unable to analyze this repository.",
      );
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  const reportSummary = result?.summary ?? {};
  const fileReports = Array.isArray(result?.fileReports) ? result.fileReports : [];
  const securityReport = Array.isArray(result?.securityReport) ? result.securityReport : [];
  const topIssues = Array.isArray(result?.topIssues) ? result.topIssues : [];
  const recommendations = Array.isArray(result?.recommendations) ? result.recommendations : [];
  const languageBreakdown = result?.languageBreakdown ?? {};
  const health = result?.codeHealthTrend ?? {};
  const totalPractices =
    (reportSummary.passedBestPractices ?? 0) +
    (reportSummary.failedBestPractices ?? 0);
  const passRate = totalPractices
    ? Math.round(((reportSummary.passedBestPractices ?? 0) / totalPractices) * 100)
    : 100;
  const totalHealthFiles = Math.max(1, reportSummary.totalFiles ?? 0);

  return (
    <section className="mx-auto w-full max-w-7xl text-[#f5f5f5]">
      <form
        onSubmit={analyzeRepository}
        className="rounded-2xl border border-[#2a2a2a] bg-[#161616] p-4 sm:p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/username/repository"
            aria-label="GitHub repository URL"
            disabled={loading}
            className="w-full rounded-xl border border-[#2a2a2a] bg-[#1c1c1c] px-4 py-3 text-sm text-[#f5f5f5] outline-none transition-colors placeholder:text-[#606060] focus:border-[#606060] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !repoUrl.trim()}
            className="shrink-0 rounded-xl bg-[#f5f5f5] px-6 py-3 font-bold text-[#111111] transition-all hover:bg-[#e0e0e0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Analyze Repository
          </button>
        </div>
        <p className="mt-2 text-xs text-[#606060]">
          Works with public GitHub repositories. Up to 20 high-impact files are analyzed.
        </p>
      </form>

      {loading && (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] px-4 py-10 text-center">
          <div className="flex h-10 items-end gap-1.5" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
              <span
                key={index}
                className="h-8 w-1.5 rounded-full bg-cyan-400"
                style={{
                  animation: "equalizer 1s ease-in-out infinite",
                  animationDelay: `${index * 0.12}s`,
                }}
              />
            ))}
          </div>
          <p className="font-mono text-sm text-cyan-300">
            {progress}<span className="animate-pulse">...</span>
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-8 space-y-6">
          <section className="rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-8">
            <div className="flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#606060]">Repository report card</p>
                <h2 className="mt-2 break-words text-3xl font-black sm:text-5xl">{metadata?.name}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[#a0a0a0]">
                  {metadata?.description || "No repository description provided."}
                </p>
                <p className="mt-4 max-w-4xl border-l-2 border-green-400/50 pl-4 text-sm leading-7 text-[#d0d0d0]">
                  {result.aiSummary}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4 rounded-2xl border border-[#2a2a2a] bg-[#111111] p-5">
                <div>
                  <span className={`block text-6xl font-black sm:text-7xl ${getScoreColor(result.overallScore ?? 0)}`}>
                    {result.overallScore ?? 0}
                  </span>
                  <span className="text-xs text-[#606060]">weighted score / 100</span>
                </div>
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-[#333] bg-[#181818] text-5xl font-black">
                  {result.grade}
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 border-t border-[#2a2a2a] pt-6 lg:grid-cols-4">
              {[
                ["Total Files", reportSummary.totalFiles ?? 0, "text-white"],
                ["Critical Issues", reportSummary.criticalIssues ?? 0, "text-red-400"],
                ["Security Issues", reportSummary.totalSecurityIssues ?? 0, "text-yellow-300"],
                ["Best Practices Pass", `${passRate}%`, "text-green-400"],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-xl border border-[#292929] bg-[#161616] p-4">
                  <p className="text-[11px] uppercase tracking-wider text-[#606060]">{label}</p>
                  <p className={`mt-2 text-2xl font-black sm:text-3xl ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-6">
            <h3 className="text-xl font-bold">Code Health Overview</h3>
            <div className="mt-5 flex h-5 overflow-hidden rounded-full bg-[#111]">
              {[
                ["excellent", "bg-green-400"], ["good", "bg-blue-400"],
                ["fair", "bg-yellow-400"], ["poor", "bg-red-400"],
              ].map(([key, color]) => (
                <div
                  key={key}
                  className={`${color} transition-all duration-700`}
                  style={{ width: `${((health[key] ?? 0) / totalHealthFiles) * 100}%` }}
                  title={`${key}: ${health[key] ?? 0}`}
                />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Excellent", health.excellent ?? 0, "bg-green-400"],
                ["Good", health.good ?? 0, "bg-blue-400"],
                ["Fair", health.fair ?? 0, "bg-yellow-400"],
                ["Poor", health.poor ?? 0, "bg-red-400"],
              ].map(([label, count, dot]) => (
                <div key={label} className="flex items-center gap-2 text-sm text-[#a0a0a0]">
                  <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                  <span>{label}</span><strong className="ml-auto text-white">{count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-6">
            <h3 className="text-xl font-bold">Language Breakdown</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {Object.entries(languageBreakdown).map(([language, data]) => (
                <article key={language} className="rounded-xl border border-[#2a2a2a] bg-[#151515] p-4">
                  <p className="font-semibold">{language}</p>
                  <div className="mt-4 flex items-end justify-between">
                    <span className={`text-3xl font-black ${getScoreColor(data.avgScore)}`}>{data.avgScore}</span>
                    <span className="text-xs text-[#707070]">{data.files} file{data.files === 1 ? "" : "s"}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-red-400/20 bg-[#1c1c1c] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4 border-b border-red-400/10 pb-4">
              <h3 className="text-xl font-bold text-red-300">Security Report</h3>
              <span className="rounded-full bg-red-400/10 px-3 py-1 text-xs font-bold text-red-300">{securityReport.length} findings</span>
            </div>
            {securityReport.length ? (
              <div className="mt-4 space-y-3">
                {securityReport.map((issue, index) => (
                  <article key={`${issue.file}-${index}`} className="rounded-xl border border-[#2a2a2a] bg-[#151515] p-4">
                    <p className="break-all font-mono text-xs text-red-300">{issue.file}</p>
                    <p className="mt-2 text-sm font-semibold">{issue.issue}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#8a8a8a]">{issue.recommendation}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-green-400/20 bg-green-400/5 p-4 text-sm font-medium text-green-300">
                ✓ No security issues found
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-6">
            <h3 className="text-xl font-bold">Top Issues</h3>
            <div className="mt-4 space-y-3">
              {topIssues.length ? topIssues.map((issue, index) => (
                <article key={`${issue.file}-${issue.category}-${index}`} className="flex flex-col gap-3 rounded-xl border border-[#2a2a2a] bg-[#151515] p-4 sm:flex-row sm:items-start">
                  <div className="flex items-center gap-2 sm:w-28 sm:shrink-0">
                    <span className="font-mono text-xs text-[#555]">#{String(index + 1).padStart(2, "0")}</span>
                    <IssueBadge severity={issue.severity} />
                  </div>
                  <div className="min-w-0">
                    <p className="break-all font-mono text-xs text-cyan-300">{issue.file}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#d4d4d4]">{issue.issue}</p>
                  </div>
                </article>
              )) : <p className="text-sm text-green-300">No issues found across the analyzed files.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-6">
            <h3 className="text-xl font-bold">File-by-File Report</h3>
            <p className="mt-1 text-xs text-[#606060]">Worst-scoring files appear first. Select a file to inspect every finding.</p>
            <div className="mt-5 space-y-3">
              {fileReports.map((report) => {
                const issueCount = report.bugs.length + report.security.length + report.performance.length + report.quality.length;
                return (
                  <details key={report.path} className="group rounded-xl border border-[#2a2a2a] bg-[#151515] open:border-[#3a3a3a]">
                    <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-xs text-cyan-300">{report.path}</p>
                        <p className="mt-1 text-xs text-[#606060]">{report.language} · {report.bugs.length} bugs · {issueCount} total findings</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className={`text-3xl font-black ${getScoreColor(report.score)}`}>{report.score}</span>
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#333] bg-[#111] text-lg font-black">{report.grade}</span>
                        <span className="text-[#606060] transition-transform group-open:rotate-180">⌄</span>
                      </div>
                    </summary>
                    <div className="grid gap-5 border-t border-[#2a2a2a] p-4 lg:grid-cols-2">
                      <DetailGroup title="Bugs" items={report.bugs} accent="text-red-300" />
                      <DetailGroup title="Security" items={report.security} accent="text-red-300" />
                      <DetailGroup title="Performance" items={report.performance} accent="text-yellow-300" />
                      <DetailGroup title="Quality" items={report.quality} accent="text-blue-300" />
                      <DetailGroup title="Best Practices" items={report.bestPractices} accent="text-green-300" />
                      <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-purple-300">Complexity</p>
                        <p className="mt-2 text-2xl font-black">{report.complexity?.level} · {report.complexity?.score}/10</p>
                        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[#777]">
                          {report.complexity?.reasons?.map((reason, index) => <li key={index}>• {reason}</li>)}
                        </ul>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-green-400/15 bg-[#1c1c1c] p-5 sm:p-6">
            <h3 className="text-xl font-bold text-green-300">Recommendations</h3>
            <ol className="mt-5 space-y-3">
              {recommendations.map((item, index) => (
                <li key={`${item.recommendation}-${index}`} className="flex gap-4 rounded-xl border border-[#2a2a2a] bg-[#151515] p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-400/10 font-mono text-sm font-bold text-green-300">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${priorityStyles[item.priority] ?? priorityStyles.low}`}>{item.priority} priority</span>
                      <span className="text-[11px] text-[#555]">{item.occurrences} occurrence{item.occurrences === 1 ? "" : "s"} · {item.affectedFiles} file{item.affectedFiles === 1 ? "" : "s"}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[#c4c4c4]">{item.recommendation}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </section>
  );
}
