"use client";

import { useState } from "react";

const tabs = ["Bugs", "Security", "Performance", "Quality"];

const severityStyles = {
  high: "bg-red-500/15 text-red-400 ring-red-500/30",
  medium: "bg-yellow-500/15 text-yellow-300 ring-yellow-500/30",
  low: "bg-gray-500/15 text-gray-300 ring-gray-500/30",
};

export default function ReviewCard({ result, onSave, isSaving }) {
  const [activeTab, setActiveTab] = useState("Bugs");

  const scoreColor =
    result.overallScore < 50
      ? "border-red-500 text-red-400"
      : result.overallScore < 75
        ? "border-yellow-400 text-yellow-300"
        : "border-green-500 text-green-400";

  const activeItems = result[activeTab.toLowerCase()] ?? [];

  function copyReport() {
    return navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  }

  function renderItem(item, index) {
    if (activeTab === "Bugs") {
      const severity = item.severity?.toLowerCase();

      return (
        <article key={index} className="rounded-lg border border-gray-800 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${severityStyles[severity] ?? severityStyles.low}`}
            >
              {item.severity}
            </span>
            <span className="font-mono text-sm text-gray-400">
              Line {item.line}
            </span>
          </div>
          <p className="text-gray-200">{item.issue}</p>
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
      <article key={index} className="rounded-lg border border-gray-800 p-4">
        <p className="text-gray-200">{item.issue}</p>
        <p className="mt-3 text-sm leading-6 text-gray-400">
          <span className="font-medium text-gray-300">{detailLabel}:</span>{" "}
          {detail}
        </p>
      </article>
    );
  }

  return (
    <section className="w-full rounded-xl border border-gray-800 bg-gray-950 p-6 text-white">
      <div className="flex flex-col items-center text-center">
        <div
          className={`flex size-36 flex-col items-center justify-center rounded-full border-4 ${scoreColor}`}
        >
          <span className="text-5xl font-bold">{result.overallScore}</span>
          <span className="mt-1 text-sm font-medium">/ 100</span>
        </div>
        <p className="mt-6 max-w-3xl leading-7 text-gray-300">{result.summary}</p>
      </div>

      <div className="mt-8 border-b border-gray-800">
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-white text-white"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-3" role="tabpanel">
        {activeItems.length > 0 ? (
          activeItems.map(renderItem)
        ) : (
          <p className="rounded-lg border border-gray-800 py-10 text-center text-gray-500">
            No issues found
          </p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-gray-800 pt-6">
        <button
          type="button"
          onClick={copyReport}
          className="rounded-md bg-gray-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-600"
        >
          Copy Report
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-md bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-900 disabled:text-green-300"
        >
          {isSaving ? "Saving..." : "Save Review"}
        </button>
      </div>
    </section>
  );
}
