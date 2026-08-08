"use client";

const languageStyles = {
  javascript: "bg-yellow-500/15 text-yellow-300 ring-yellow-500/30",
  python: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  java: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  "c++": "bg-purple-500/15 text-purple-300 ring-purple-500/30",
  react: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/30",
};

export default function HistoryCard({ review, onDelete, onView }) {
  const score = review.result?.overallScore ?? 0;
  const scoreColor =
    score < 50
      ? "text-red-400"
      : score < 75
        ? "text-yellow-300"
        : "text-green-400";
  const languageColor =
    languageStyles[review.language?.toLowerCase()] ??
    "bg-gray-500/15 text-gray-300 ring-gray-500/30";
  const date = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(review.savedAt));

  return (
    <article className="animate-fade-in rounded-xl border border-purple-900/30 bg-[#1a1a2e] p-5 text-white transition-all hover:shadow-[0_0_20px_rgba(124,58,237,0.15)]">
      <div className="mb-3 flex items-center justify-between gap-4">
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${languageColor}`}
        >
          {review.language}
        </span>
        <time dateTime={review.savedAt} className="text-xs text-zinc-500">
          {date}
        </time>
      </div>

      <div className={`mb-1 text-3xl font-bold ${scoreColor}`}>
        {score}
        <span className="ml-1 text-sm text-zinc-500">/100</span>
      </div>

      <p className="text-zinc-400 text-sm leading-relaxed mb-4">
        {review.result?.summary}
      </p>

      <div className="mt-4 flex gap-2 border-t border-purple-900/20 pt-4">
        <button
          type="button"
          onClick={() => onView(review)}
          className="flex-1 rounded-lg bg-purple-700 px-4 py-2 text-sm text-white transition-colors hover:bg-purple-600"
        >
          View Report
        </button>
        <button
          type="button"
          onClick={() => onDelete(review.id)}
          className="rounded-lg border border-red-900/50 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-900/20"
        >
          Delete
        </button>
      </div>
    </article>
  );
}
