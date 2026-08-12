"use client";

import { useState } from "react";

const tabs = ["Bugs", "Security", "Performance", "Quality", "Best Practices", "Refactored"];

const severityStyles = {
  high: "bg-red-900/40 text-red-400",
  medium: "bg-yellow-900/40 text-yellow-400",
  low: "bg-zinc-800 text-zinc-400",
};

function estimateComplexity(code = "") {
  const lines = code.split("\n").filter((line) => line.trim()).length;
  const decisions =
    code.match(/\b(if|else if|for|while|switch|case|catch)\b|&&|\|\||\?/g)
      ?.length ?? 0;
  const score = Math.max(
    1,
    Math.min(10, 1 + Math.floor(lines / 35) + Math.floor(decisions / 3)),
  );

  return {
    level: score <= 3 ? "Simple" : score <= 6 ? "Moderate" : "Complex",
    score,
    reasons: [
      `${lines} non-empty line${lines === 1 ? "" : "s"} of code were analyzed.`,
      `${decisions} branching or decision point${decisions === 1 ? "" : "s"} were detected.`,
      "The score is based on code size and control-flow structure.",
    ],
  };
}

export default function ReviewCard({
  result,
  onSave,
  isSaving,
  saveStatus = "idle",
  sourceCode = "",
}) {
  const [activeTab, setActiveTab] = useState("Bugs");
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const scoreColor =
    result.overallScore < 50
      ? "border-red-500 text-red-500"
      : result.overallScore < 75
        ? "border-yellow-500 text-yellow-500"
        : "border-green-500 text-green-500";

  const activeItems = result[activeTab.toLowerCase()] ?? [];
  const bestPractices = result.bestPractices ?? [];
  const complexity = result.complexity ?? estimateComplexity(sourceCode);

  function formatList(items, formatItem) {
    if (!Array.isArray(items) || items.length === 0) {
      return "No issues found.";
    }

    return items.map((item, index) => `${index + 1}. ${formatItem(item)}`).join("\n\n");
  }

  function formatReport() {
    const complexity = result.complexity ?? {};

    return `CRITIQ CODE REVIEW REPORT
==========================

OVERALL SCORE
${result.overallScore ?? "N/A"}/100

SUMMARY
${result.summary ?? "No summary available."}

COMPLEXITY
Level: ${complexity.level ?? "N/A"}
Score: ${complexity.score ?? "N/A"}
Reasons:
${Array.isArray(complexity.reasons) && complexity.reasons.length > 0 ? complexity.reasons.map((reason) => `- ${reason}`).join("\n") : "- No complexity notes provided."}

BUGS
${formatList(result.bugs, (item) => `Line: ${item.line ?? "N/A"}\nSeverity: ${item.severity ?? "N/A"}\nIssue: ${item.issue ?? "N/A"}`)}

SECURITY
${formatList(result.security, (item) => `Issue: ${item.issue ?? "N/A"}\nRecommendation: ${item.recommendation ?? "N/A"}`)}

PERFORMANCE
${formatList(result.performance, (item) => `Issue: ${item.issue ?? "N/A"}\nSuggestion: ${item.suggestion ?? "N/A"}`)}

QUALITY
${formatList(result.quality, (item) => `Issue: ${item.issue ?? "N/A"}\nImprovement: ${item.improvement ?? "N/A"}`)}

BEST PRACTICES
${formatList(result.bestPractices, (item) => `[${item.status?.toUpperCase() ?? "N/A"}] ${item.rule ?? "Unnamed rule"}\n${item.description ?? "No description."}`)}

REFACTORED CODE
---------------
${result.refactoredCode?.trim() || "No refactored code available."}
`;
  }

  async function copyReport() {
    await navigator.clipboard.writeText(formatReport());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function renderBestPractice(item, index) {
    const isPass = item.status?.toLowerCase() === "pass";

    return (
      <div
        key={index}
        className={`mb-2 flex items-start gap-3 rounded-lg bg-[#161616] p-4 ${
          isPass ? "border-l-2 border-green-600" : "border-l-2 border-red-600"
        }`}
      >
        <span className={isPass ? "text-green-400 text-base leading-none" : "text-red-400 text-base leading-none"}>
          {isPass ? "✓" : "✗"}
        </span>
        <div>
          <div className="text-base font-semibold text-white">{item.rule}</div>
          <div className="mt-1 text-sm text-zinc-400">{item.description}</div>
        </div>
      </div>
    );
  }

  function renderItem(item, index) {
    if (activeTab === "Bugs") {
      const severity = item.severity?.toLowerCase();

      return (
        <article key={index} className="mb-3 rounded-lg border-l-4 border-[#3a3a3a] bg-[#161616] p-4">
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
      <article key={index} className="mb-3 rounded-lg border-l-4 border-[#3a3a3a] bg-[#161616] p-4">
        <p className="mb-1 font-medium text-white">{item.issue}</p>
        <p className="text-sm leading-6 text-zinc-400">
          <span className="font-medium text-zinc-300">{detailLabel}:</span>{" "}
          {detail}
        </p>
      </article>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl animate-fade-in overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-4 text-white shadow-[0_0_40px_rgba(0,0,0,0.15)] sm:p-8">
      {result.isRefactoredAnalysis && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-green-400/20 bg-green-400/5 p-4">
          <span className="text-2xl">✓</span>
          <div>
            <p className="text-sm font-semibold text-green-400">
              Refactored Code Analysis
            </p>
            <p className="text-xs text-[#a0a0a0]">
              Score improved from {result.originalScore}/100 to{" "}
              {result.overallScore}/100 (+{result.improvement} points)
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center text-center">
        <div
          className={`mx-auto mb-6 flex h-28 w-28 flex-col items-center justify-center rounded-full border-4 glow-pulse sm:h-32 sm:w-32 ${scoreColor}`}
        >
          <span className="text-4xl font-bold">{result.overallScore}</span>
          <span className="text-sm text-zinc-500">/100</span>
        </div>
        <p className="mx-auto mb-8 max-w-2xl italic leading-relaxed text-zinc-400">
          {result.summary}
        </p>
      </div>

      <div
        className="relative mb-8 overflow-hidden rounded-2xl p-4 sm:p-6"
        style={{
          background: "linear-gradient(135deg, #161616 0%, #1a1a1a 100%)",
          border: "1px solid #2a2a2a",
        }}
      >
        {/* Header row */}
        <div className="relative z-10 mb-6 flex flex-col gap-4 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#606060] mb-1 font-medium">
              Code Complexity
            </p>
            <h3 className="text-3xl font-black text-[#f5f5f5]">
              {complexity.level}
            </h3>
          </div>
          <div
            className="flex flex-row items-baseline gap-2 min-[420px]:flex-col min-[420px]:items-end min-[420px]:gap-0"
          >
            <span
              className="text-5xl font-black"
              style={{
                color:
                  complexity.level === "Simple"
                    ? "#4ade80"
                    : complexity.level === "Moderate"
                      ? "#facc15"
                      : "#f87171",
              }}
            >
              {complexity.score}
            </span>
            <span className="text-xs text-[#606060]">out of 10</span>
          </div>
        </div>

        {/* Progress segments */}
        <div className="flex gap-1 mb-6 relative z-10">
          {[...Array(10)].map((_, i) => (
            <div
              key={i}
              className="h-2 flex-1 rounded-full transition-all duration-500"
              style={{
                backgroundColor:
                  i < complexity.score
                    ? complexity.level === "Simple"
                      ? "#4ade80"
                      : complexity.level === "Moderate"
                        ? "#facc15"
                        : "#f87171"
                    : "#2a2a2a",
                animationDelay: `${i * 0.1}s`,
                opacity: i < complexity.score ? 1 : 0.3,
              }}
            />
          ))}
        </div>

        {/* Reasons */}
        <div className="space-y-2 relative z-10">
          {complexity.reasons.map((reason, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-[#606060] font-mono text-xs mt-0.5">
                0{i + 1}
              </span>
              <p className="text-[#a0a0a0] text-sm leading-relaxed">
                {reason}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 border-b border-[#2a2a2a]">
        <div className="flex gap-4 overflow-x-auto pb-1 sm:gap-6" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-[#f5f5f5] text-[#f5f5f5]"
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
            <p className="rounded-lg border border-[#2a2a2a] bg-[#161616] py-10 text-center text-zinc-500">
              No issues found
            </p>
          )
        ) : activeTab === "Refactored" ? (
          <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-3 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">Improved Code</h3>
                  <span className="rounded-full border border-[#3a3a3a] bg-[#111111] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#a0a0a0]">
                    AI Rewritten
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(result.refactoredCode);
                  setCodeCopied(true);
                  setTimeout(() => setCodeCopied(false), 1500);
                }}
                className="rounded-lg border border-[#2a2a2a] px-3 py-1.5 text-xs text-[#a0a0a0] transition-all hover:text-[#f5f5f5]"
              >
                {codeCopied ? "✓ Copied" : "Copy Code"}
              </button>
            </div>

            {result.refactoredCode && String(result.refactoredCode).trim().length > 0 ? (
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[#111111] p-3 font-mono text-xs text-green-400 sm:p-6 sm:text-sm">
                <code>{String(result.refactoredCode)}</code>
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
            <p className="rounded-lg border border-[#2a2a2a] bg-[#161616] py-10 text-center text-zinc-500">
            No issues found
          </p>
        )}
      </div>

      <div className="mt-8 flex flex-col gap-3 border-t border-[#2a2a2a] pt-6 min-[420px]:flex-row min-[420px]:flex-wrap min-[420px]:justify-end">
        <button
          type="button"
          onClick={copyReport}
          disabled={copied}
          className="w-full rounded-lg border border-[#3a3a3a] bg-[#161616] px-6 py-2 text-zinc-400 transition-colors hover:text-white min-[420px]:w-auto"
        >
          {copied ? "Copied!" : "Copy Report"}
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || saveStatus === "saved" || saveStatus === "already"}
            className={`relative w-full overflow-hidden rounded-lg px-6 py-2 font-bold transition-all duration-300 disabled:cursor-not-allowed min-[420px]:w-auto min-[420px]:min-w-44 ${
              saveStatus === "saved"
                ? "bg-green-400 text-[#07140b] shadow-[0_0_28px_rgba(74,222,128,0.45)]"
                : saveStatus === "already"
                  ? "bg-amber-400 text-[#1c1202] shadow-[0_0_28px_rgba(251,191,36,0.4)]"
                  : isSaving
                    ? "text-white shadow-[0_0_30px_rgba(168,85,247,0.35)]"
                    : "bg-[#f5f5f5] text-[#111111] hover:bg-[#e0e0e0]"
            }`}
            style={
              isSaving
                ? {
                    background:
                      "linear-gradient(90deg, #7c3aed, #06b6d4, #7c3aed)",
                    backgroundSize: "200% 100%",
                    animation: "saveShimmer 1.1s linear infinite",
                  }
                : undefined
            }
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-3">
                <span className="relative h-5 w-5">
                  <span className="absolute inset-0 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] animate-pulse">
                    ↓
                  </span>
                </span>
                <span className="font-mono text-sm tracking-wide">
                  Securing Review...
                </span>
              </span>
            ) : saveStatus === "saved" ? (
              <span
                className="flex items-center justify-center gap-2"
                style={{ animation: "saveSuccessPop 0.5s ease forwards" }}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#07140b] text-xs text-green-300">
                  ✓
                </span>
                Review Saved!
              </span>
            ) : saveStatus === "already" ? (
              <span
                className="flex items-center justify-center gap-2"
                style={{ animation: "saveSuccessPop 0.5s ease forwards" }}
              >
                <span className="animate-pulse">✦</span>
                Already Saved
                <span className="animate-pulse">✦</span>
              </span>
            ) : (
              "Save Review"
            )}
          </button>
        )}
      </div>
    </section>
  );
}
