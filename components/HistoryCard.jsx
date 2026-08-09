"use client";

import { useState } from "react";

const languageStyles = {
  javascript: "bg-yellow-400/10 text-yellow-400 border border-yellow-400/20",
  python: "bg-blue-400/10 text-blue-400 border border-blue-400/20",
  java: "bg-orange-400/10 text-orange-400 border border-orange-400/20",
  "c++": "bg-cyan-400/10 text-cyan-400 border border-cyan-400/20",
  react: "bg-sky-400/10 text-sky-400 border border-sky-400/20",
};

export default function HistoryCard({ review, onDelete, onView }) {
  const [flipped, setFlipped] = useState(false);
  const score = review.result?.overallScore ?? 0;
  const scoreColor =
    score < 50
      ? "text-red-400"
      : score < 75
        ? "text-yellow-300"
        : "text-green-400";
  const date = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(review.savedAt));

  return (
    <article
      className="group cursor-pointer relative h-72"
      style={{ perspective: "1000px", transformStyle: "preserve-3d" }}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      {/* Front face */}
      <div
        className="absolute inset-0 rounded-xl bg-[#1c1c1c] border border-[#2a2a2a] p-5 transition-transform duration-500 backface-hidden flex flex-col h-full"
        style={{
          backfaceVisibility: "hidden",
          transform: flipped ? "rotateY(-180deg)" : "rotateY(0deg)",
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4 shrink-0">
          <span
            className={`px-3 py-1 rounded-md uppercase tracking-wide text-xs font-bold ${languageStyles[review.language?.toLowerCase()] ?? languageStyles.react}`}
          >
            {review.language}
          </span>
          <time
            dateTime={review.savedAt}
            className="text-sm font-medium text-[#606060]"
          >
            {date}
          </time>
        </div>

        <div className="mb-3 flex items-baseline gap-1 shrink-0">
          <span className={`text-5xl font-black ${scoreColor}`}>{score}</span>
          <span className="text-sm font-normal text-zinc-600">/100</span>
        </div>

        <p
          className="flex-1 overflow-y-auto text-sm leading-relaxed text-[#a0a0a0]"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#2a2a2a transparent",
          }}
        >
          {review.result?.summary}
        </p>
      </div>

      {/* Back face */}
      <div
        className="absolute inset-0 rounded-xl bg-[#111111] border border-green-400/30 p-5 flex flex-col h-full justify-between transition-transform duration-500"
        style={{
          backfaceVisibility: "hidden",
          transform: flipped ? "rotateY(0deg)" : "rotateY(180deg)",
        }}
      >
        <div className="flex-1 flex flex-col items-center justify-center">
          <div
            className="text-7xl font-black mt-3 mb-4"
            style={{
              color:
                score >= 75
                  ? "#4ade80"
                  : score >= 50
                    ? "#facc15"
                    : "#f87171",
            }}
          >
            {score}
          </div>
          <p className="text-[#a0a0a0] text-xs text-center leading-relaxed line-clamp-3 overflow-hidden">
            {review.result?.summary?.slice(0, 80)}
          </p>
        </div>

        <div className="shrink-0 mt-auto w-full flex items-center justify-between border-t border-[#2a2a2a] pt-4">
          <button
            type="button"
            onClick={() => onView(review)}
            className="text-[#f5f5f5] text-sm font-medium"
          >
            View Report →
          </button>
          <button
            type="button"
            onClick={() => onDelete(review.id)}
            className="text-red-400 text-sm font-medium"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
