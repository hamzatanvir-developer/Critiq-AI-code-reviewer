"use client";

import { useEffect, useState } from "react";

const isTerminal = (job) =>
  ["completed", "cancelled", "failed"].includes(job?.status);

export default function BackgroundRepoScan({ user }) {
  const [url, setUrl] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const activeJobId = job?.id;
  const activeJobStatus = job?.status;

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.job) setJob(data.job);
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  // Reloading or closing the tab never cancels server work. No report data or
  // tokens are stored in browser storage; latest job is looked up by owner.
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/repo-jobs", {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!disposed) {
          if (!response.ok)
            setError(data.error || "Unable to restore the last scan.");
          else setJob((current) => current ?? data.job);
        }
      } catch {
        if (!disposed)
          setError("Unable to restore the last scan. Try again shortly.");
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [user]);

  useEffect(() => {
    if (
      !activeJobId ||
      ["completed", "cancelled", "failed"].includes(activeJobStatus) ||
      !user
    )
      return;
    let disposed = false;
    let timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/repo-jobs/${activeJobId}`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (disposed) return;
        if (!response.ok)
          throw new Error(data.error || "Progress update failed.");
        setJob(data.job);
        setError("");
        if (!isTerminal(data.job)) timer = setTimeout(poll, 5000);
      } catch (err) {
        if (!disposed) {
          setError(err.message);
          timer = setTimeout(poll, 15000);
        }
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeJobId, activeJobStatus, user]);

  async function start(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request("/api/repo-jobs", {
        method: "POST",
        body: JSON.stringify({ repoUrl: url }),
      });
      setJob(data.job);
      setFiles([]);
      setCursor(null);
      setPageLoaded(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      setJob(
        (await request(`/api/repo-jobs/${job.id}`, { method: "DELETE" })).job,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadFiles() {
    setBusy(true);
    setError("");
    try {
      const data = await request(
        `/api/repo-jobs/${job.id}?files=1${cursor ? `&after=${cursor}` : ""}`,
      );
      setFiles((previous) =>
        cursor ? [...previous, ...data.files] : data.files,
      );
      setCursor(data.nextCursor);
      setPageLoaded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totals = job?.totals ?? {};
  const selected = job?.overview?.selectedFiles ?? 0;
  const percent = selected
    ? Math.min(100, Math.round((totals.processed / selected) * 100))
    : 0;
  return (
    <section className="space-y-5 text-[#f5f5f5]">
      <form
        onSubmit={start}
        className="space-y-3 rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5"
      >
        <h2 className="text-xl font-bold">Background repository scan</h2>
        <p className="text-sm text-[#a0a0a0]">
          You can close this page and return later. Public repositories only; up
          to 5,000 prioritized files and 25 MB of source per scan. Exclusions
          and incomplete coverage are reported.
        </p>
        <label htmlFor="background-repo" className="block text-sm">
          GitHub repository URL
        </label>
        <input
          id="background-repo"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/owner/repository"
          className="w-full rounded-xl border border-[#2a2a2a] bg-[#111111] p-3"
        />
        <button
          disabled={busy || !user}
          className="rounded-xl bg-[#f5f5f5] px-5 py-3 font-semibold text-[#111111] disabled:opacity-50"
        >
          {busy ? "Please wait…" : "Start scan / retry queue delivery"}
        </button>
        <p className="text-xs text-[#a0a0a0]">
          One active scan per account, three starts per day. Reports expire
          after seven days when server retention is configured.
        </p>
      </form>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-400/30 p-4 text-sm text-red-300"
        >
          {error}
        </p>
      )}
      {job && (
        <div className="space-y-5 rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="break-all font-bold">
              {job.repository.owner}/{job.repository.repository}
            </h3>
            <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-sm text-cyan-300">
              {job.status}
            </span>
          </div>
          {job.commitSha && (
            <p className="break-all font-mono text-xs text-[#a0a0a0]">
              Commit: {job.commitSha}
            </p>
          )}
          <div
            role="progressbar"
            aria-label="Repository scan progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded-full bg-[#303030]"
          >
            <div
              className="h-full bg-cyan-400 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p aria-live="polite" className="text-sm text-[#a0a0a0]">
            {totals.processed ?? 0} / {selected || "…"} selected files processed
            · {totals.analyzed ?? 0} analyzed · {totals.skipped ?? 0} skipped
          </p>
          {job.overview && (
            <p className="text-xs text-[#a0a0a0]">
              {job.overview.totalFiles} files discovered;{" "}
              {job.overview.excludedOrOverLimitFiles} excluded or outside scan
              limits.{" "}
              {job.overview.treeComplete
                ? "Tree discovery complete."
                : `Tree incomplete: ${job.overview.incompleteReasons.join(", ")}. Totals are lower bounds.`}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                "Score (analyzed files)",
                job.score === null ? "—" : `${job.score}/100`,
              ],
              ["Bug findings", totals.bugs],
              ["Security findings", totals.security],
              ["Invalid syntax", totals.invalidSyntax],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-[#111111] p-3">
                <p className="text-xs text-[#a0a0a0]">{label}</p>
                <p className="mt-2 text-2xl font-bold">{value ?? 0}</p>
              </div>
            ))}
          </div>
          {job.error && <p className="text-sm text-red-300">{job.error}</p>}
          {!isTerminal(job) && (
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-300"
            >
              Cancel scan
            </button>
          )}
          <p className="text-xs text-[#a0a0a0]">
            Rule-based results are not a compiler or security certification.
            Source code is not executed. Scores exclude unreadable, oversized
            and unsupported files.
          </p>
          {files.map((file) => (
            <details
              key={file.id}
              className="rounded-xl border border-[#303030] p-3"
            >
              <summary className="cursor-pointer break-all text-sm">
                {file.path} —{" "}
                {file.report
                  ? `${file.report.score}/100`
                  : `Skipped: ${file.reason}`}
              </summary>
              {file.report && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-[#a0a0a0]">
                    {file.report.analysis.engine}
                  </p>
                  {["bugs", "security", "performance", "quality"].map(
                    (category) => (
                      <section key={category}>
                        <h4 className="text-sm font-bold capitalize">
                          {category} ({file.report[category].length})
                        </h4>
                        <ul className="mt-2 space-y-2 text-sm text-[#a0a0a0]">
                          {file.report[category].map((issue, i) => (
                            <li key={i} className="break-words">
                              {issue.ruleId} · Line {issue.line ?? "—"}:{" "}
                              {issue.issue}
                              <p className="text-xs">
                                {issue.recommendation ||
                                  issue.improvement ||
                                  issue.suggestion ||
                                  issue.description}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ),
                  )}
                </div>
              )}
            </details>
          ))}
          {isTerminal(job) && (!pageLoaded || cursor) && (
            <button
              onClick={loadFiles}
              disabled={busy}
              className="rounded-lg border border-[#444] px-4 py-2 text-sm"
            >
              {pageLoaded ? "Load next 10 files" : "View file reports"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
