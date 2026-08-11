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
  ts: "TypeScript",
  tsx: "React TypeScript",
  py: "Python",
  java: "Java",
  cpp: "C++",
  c: "C",
  css: "CSS",
  json: "JSON",
};

const severityStyles = {
  high: "border-red-400/30 bg-red-400/10 text-red-300",
  medium: "border-yellow-400/30 bg-yellow-400/10 text-yellow-300",
  low: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
};

function getScoreColor(score) {
  if (score < 50) return "text-red-400";
  if (score < 75) return "text-yellow-300";
  return "text-green-400";
}

function getFileLanguage(filePath) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return languageByExtension[extension] ?? "Text";
}

function parseRepositoryUrl(repoUrl) {
  const url = new URL(repoUrl);

  if (url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Enter a valid public GitHub repository URL.");
  }

  const [username, rawRepositoryName] = url.pathname
    .split("/")
    .filter(Boolean);
  const reponame = rawRepositoryName?.replace(/\.git$/i, "");

  if (!username || !reponame) {
    throw new Error("The URL must include a GitHub username and repository.");
  }

  return { username, reponame };
}

export default function RepoAnalyzer() {
  const { user } = useContext(AuthContext);
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [filesAnalyzed, setFilesAnalyzed] = useState(0);

  async function analyzeRepository(event) {
    event?.preventDefault();
    setError(null);
    setResult(null);
    setMetadata(null);
    setFilesAnalyzed(0);

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

      setProgress("Filtering important files...");
      const importantFiles = filterImportantFiles(tree);

      if (importantFiles.length === 0) {
        throw new Error("No supported source files were found in this repository.");
      }

      setProgress("Reading file contents...");
      const readableFiles = [];

      for (const filePath of importantFiles) {
        const content = await fetchFileContent(username, reponame, filePath);

        if (content !== null) {
          readableFiles.push({
            path: filePath,
            content,
            language: getFileLanguage(filePath),
          });
        }
      }

      if (readableFiles.length === 0) {
        throw new Error("GitHub did not return readable content for these files.");
      }

      setFilesAnalyzed(readableFiles.length);
      setProgress(`Analyzing ${readableFiles.length} files with AI...`);
      const data = await analyzeRepoWithGroq(readableFiles, repoDetails);

      if (!data) {
        throw new Error("The AI could not analyze this repository. Try again shortly.");
      }

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

  const techStack = Array.isArray(result?.techStack) ? result.techStack : [];
  const fileReports = Array.isArray(result?.fileReports)
    ? result.fileReports
    : [];
  const criticalBugs = Array.isArray(result?.criticalBugs)
    ? result.criticalBugs
    : [];
  const securityIssues = Array.isArray(result?.securityIssues)
    ? result.securityIssues
    : [];
  const strengths = Array.isArray(result?.strengths) ? result.strengths : [];
  const improvements = Array.isArray(result?.improvements)
    ? result.improvements
    : [];

  return (
    <section className="mx-auto w-full max-w-6xl text-[#f5f5f5]">
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
            disabled={loading || repoUrl.trim().length === 0}
            className="shrink-0 rounded-xl bg-[#f5f5f5] px-6 py-3 font-bold text-[#111111] transition-all hover:bg-[#e0e0e0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Analyze Repository
          </button>
        </div>
        <p className="mt-2 text-xs text-[#606060]">
          Works with any public GitHub repository. Max 20 files analyzed.
        </p>
      </form>

      {loading && (
        <div className="mt-6 flex flex-col items-center justify-center gap-4 rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] px-4 py-10 text-center">
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
          <div className="flex items-center font-mono text-sm text-cyan-300">
            <span>{progress}</span>
            <span className="ml-1 animate-pulse">...</span>
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {result && (
        <div className="mt-8 space-y-6">
          <section className="overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-[#606060]">
                  Repository Health
                </p>
                <h2 className="break-words text-2xl font-black sm:text-4xl">
                  {metadata?.name}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#a0a0a0] sm:text-base">
                  {metadata?.description || result.summary}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-5">
                <div>
                  <span
                    className={`block text-6xl font-black ${getScoreColor(result.overallScore ?? 0)}`}
                  >
                    {result.overallScore ?? 0}
                  </span>
                  <span className="text-xs text-[#606060]">out of 100</span>
                </div>
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-[#3a3a3a] bg-[#111111] text-5xl font-black text-white">
                  {result.healthGrade ?? "—"}
                </div>
              </div>
            </div>

            <div className="mt-7 grid gap-3 border-t border-[#2a2a2a] pt-6 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl bg-[#161616] p-4">
                <p className="text-xs text-[#606060]">Files analyzed</p>
                <p className="mt-1 text-2xl font-bold">{filesAnalyzed}</p>
              </div>
              <div className="rounded-xl bg-[#161616] p-4">
                <p className="text-xs text-[#606060]">Total issues</p>
                <p className="mt-1 text-2xl font-bold">
                  {result.totalIssues ?? 0}
                </p>
              </div>
              <div className="rounded-xl bg-[#161616] p-4 sm:col-span-2 lg:col-span-1">
                <p className="mb-2 text-xs text-[#606060]">Tech stack</p>
                <div className="flex flex-wrap gap-2">
                  {techStack.map((technology) => (
                    <span
                      key={technology}
                      className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs text-cyan-300"
                    >
                      {technology}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-xl font-bold">File Reports</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {fileReports.map((report) => (
                <article
                  key={report.path}
                  className="flex h-full min-w-0 flex-col rounded-xl border border-[#2a2a2a] bg-[#1c1c1c] p-5"
                >
                  <p className="break-all font-mono text-xs text-cyan-300">
                    {report.path}
                  </p>
                  <div className="my-4 flex items-end justify-between gap-4">
                    <span
                      className={`text-4xl font-black ${getScoreColor(report.score ?? 0)}`}
                    >
                      {report.score ?? 0}
                      <span className="ml-1 text-xs font-normal text-[#606060]">
                        /100
                      </span>
                    </span>
                    <span className="text-xs text-[#606060]">
                      {report.issues ?? 0} issues
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#a0a0a0]">
                    {report.summary}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-6">
              <h3 className="mb-4 text-xl font-bold text-red-300">
                Critical Bugs
              </h3>
              <div className="space-y-3">
                {criticalBugs.length > 0 ? (
                  criticalBugs.map((bug, index) => (
                    <article
                      key={`${bug.file}-${index}`}
                      className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="break-all font-mono text-xs text-[#a0a0a0]">
                          {bug.file}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${severityStyles[bug.severity?.toLowerCase()] ?? severityStyles.low}`}
                        >
                          {bug.severity ?? "low"}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-[#f5f5f5]">
                        {bug.issue}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[#606060]">No critical bugs found.</p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 sm:p-6">
              <h3 className="mb-4 text-xl font-bold text-yellow-200">
                Security Issues
              </h3>
              <div className="space-y-3">
                {securityIssues.length > 0 ? (
                  securityIssues.map((issue, index) => (
                    <article
                      key={`${issue.file}-${index}`}
                      className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-4"
                    >
                      <p className="break-all font-mono text-xs text-yellow-300">
                        {issue.file}
                      </p>
                      <p className="mt-2 text-sm text-[#f5f5f5]">
                        {issue.issue}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#a0a0a0]">
                        {issue.recommendation}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[#606060]">
                    No security issues found.
                  </p>
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-green-400/15 bg-[#1c1c1c] p-5 sm:p-6">
              <h3 className="mb-4 text-xl font-bold text-green-300">
                Strengths
              </h3>
              <ul className="space-y-3">
                {strengths.map((strength, index) => (
                  <li key={index} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 text-green-400">✓</span>
                    <span className="leading-relaxed text-[#a0a0a0]">
                      {strength}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-purple-400/15 bg-[#1c1c1c] p-5 sm:p-6">
              <h3 className="mb-4 text-xl font-bold text-purple-300">
                Improvements
              </h3>
              <ol className="space-y-3">
                {improvements.map((improvement, index) => (
                  <li key={index} className="flex items-start gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-400/10 font-mono text-xs text-purple-300">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed text-[#a0a0a0]">
                      {improvement}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
