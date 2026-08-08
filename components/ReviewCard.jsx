"use client";

import { useState } from "react";

const tabs = ["Bugs", "Security", "Performance", "Quality", "Best Practices", "Refactored"];

const severityStyles = {
  high: "bg-red-900/40 text-red-400",
  medium: "bg-yellow-900/40 text-yellow-400",
  low: "bg-zinc-800 text-zinc-400",
};

export default function ReviewCard({ result, onSave, isSaving }) {
  const [activeTab, setActiveTab] = useState("Bugs");

  const scoreColor =
    result.overallScore < 50
      ? "border-red-500 text-red-500"
      : result.overallScore < 75
        ? "border-yellow-500 text-yellow-500"
        : "border-green-500 text-green-500";

  const activeItems = result[activeTab.toLowerCase()] ?? [];
  const bestPractices = result.bestPractices ?? [];

  function copyReport() {
    return navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  }

  function copyCode() {
    return navigator.clipboard.writeText(result.refactoredCode ?? "");
  }

  function renderBestPractice(item, index) {
    const isPass = item.status?.toLowerCase() === "pass";

    return (
      <div
        key={index}
        className={`flex items-start gap-3 rounded-lg bg-[#13131a] p-3 mb-2 ${
          isPass ? "border-l-2 border-green-600" : "border-l-2 border-red-600"
        }`}
      >
        <span className={isPass ? "text-green-400 text-base leading-none" : "text-red-400 text-base leading-none"}>
          {isPass ? "✓" : "✗"}
        </span>
        <div>
          <div className="text-sm font-medium text-white">{item.rule}</div>
          <div className="mt-0.5 text-xs text-zinc-500">{item.description}</div>
        </div>
      </div>
    );
  }

  const complexity = result.complexity ?? { level: "Simple", score: 1, reasons: [] };
  const complexityBadgeStyles = {
    Simple: "bg-green-900/20 text-green-400 border border-green-900/30",
    Moderate: "bg-yellow-900/20 text-yellow-400 border border-yellow-900/30",
    Complex: "bg-red-900/20 text-red-400 border border-red-900/30",
  };
  const complexityBarStyles = {
    Simple: "w-[33%] bg-green-400",
    Moderate: "w-[66%] bg-yellow-400",
    Complex: "w-full bg-red-400",
  };

  function renderItem(item, index) {
    if (activeTab === "Bugs") {
      const severity = item.severity?.toLowerCase();

      return (
        <article key={index} className="mb-3 rounded-lg border-l-4 border-purple-600 bg-[#13131a] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${severityStyles[severity] ?? severityStyles.low}`}
            >
              {item.severity}
            </span>
            <span className="font-mono text-sm text-zinc-400">
              Line {item.line}
            </span>
          </div>
          <p className="mb-1 font-medium text-white">{item.issue}</p>
        </article>
      );
    }

    const detail =
      activeTab === "Security"
        ? item.recommendation
        : activeTab === "Performance"
          ? item.suggestion
          : item.improvement;

    const detailLabel =
      activeTab === "Security"
        ? "Recommendation"
        : activeTab === "Performance"
          ? "Suggestion"
          : "Improvement";

    return (
      <article key={index} className="mb-3 rounded-lg border-l-4 border-purple-600 bg-[#13131a] p-4">
        <p className="mb-1 font-medium text-white">{item.issue}</p>
        <p className="text-sm leading-6 text-zinc-400">
          <span className="font-medium text-zinc-300">{detailLabel}:</span>{" "}
          {detail}
        </p>
      </article>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl rounded-2xl border border-purple-900/30 bg-[#1a1a2e] p-8 text-white shadow-[0_0_40px_rgba(124,58,237,0.1)] animate-fade-in">
      <div className="flex flex-col items-center text-center">
        <div
          className={`mx-auto mb-6 flex h-32 w-32 flex-col items-center justify-center rounded-full border-4 glow-pulse ${scoreColor}`}
        >
          <span className="text-4xl font-bold">{result.overallScore}</span>
          <span className="text-sm text-zinc-500">/100</span>
        </div>
        <p className="mx-auto mb-8 max-w-2xl italic leading-relaxed text-zinc-400">
          {result.summary}
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-zinc-800/60 bg-[#13131a] p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-zinc-300">Complexity</span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${complexityBadgeStyles[complexity.level] ?? complexityBadgeStyles.Simple}`}
          >
            {complexity.level}
          </span>
        </div>

        <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${complexityBarStyles[complexity.level] ?? complexityBarStyles.Simple}`}
          />
        </div>

        {Array.isArray(complexity.reasons) && complexity.reasons.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-zinc-500">
            {complexity.reasons.map((reason, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="mt-2 h-1 w-1 rounded-full bg-zinc-500" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mb-6 border-b border-purple-900/20">
        <div className="flex gap-6 overflow-x-auto" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-purple-500 text-purple-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3" role="tabpanel">
        {activeTab === "Best Practices" ? (
          bestPractices.length > 0 ? (
            <div>
              {bestPractices.map(renderBestPractice)}
            </div>
          ) : (
            <p className="rounded-lg border border-purple-900/20 bg-[#13131a] py-10 text-center text-zinc-500">
              No issues found
            </p>
          )
        ) : activeTab === "Refactored" ? (
          <div className="rounded-lg border border-purple-900/20 bg-[#13131a] p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">Improved Code</h3>
                  <span className="rounded-full border border-purple-900/30 bg-purple-900/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-300">
                    AI Rewritten
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="rounded-lg border border-zinc-700 bg-[#0d0d0f] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-purple-900/40 hover:text-white"
              >
                Copy Code
              </button>
            </div>

            {result.refactoredCode && result.refactoredCode.trim().length > 0 ? (
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-[#0d0d0f] p-6 font-mono text-sm text-green-400">
                <code>{result.refactoredCode}</code>
              </pre>
            ) : (
              <p className="py-10 text-center text-zinc-500">
                No refactored code available
              </p>
            )}
          </div>
        ) : activeItems.length > 0 ? (
          activeItems.map(renderItem)
        ) : (
          <p className="rounded-lg border border-purple-900/20 bg-[#13131a] py-10 text-center text-zinc-500">
            No issues found
          </p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-purple-900/20 pt-6">
        <button
          type="button"
          onClick={copyReport}
          className="rounded-lg border border-zinc-700 bg-[#13131a] px-6 py-2 text-zinc-400 transition-colors hover:text-white"
        >
          Copy Report
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-lg bg-purple-700 px-6 py-2 text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-80"
        >
          {isSaving ? "Saving..." : "Save Review"}
        </button>
      </div>
    </section>
  );
}
