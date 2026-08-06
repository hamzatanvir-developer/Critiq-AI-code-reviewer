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
    <article className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-white transition-colors hover:border-gray-700 hover:bg-gray-900/80">
      <div className="flex items-center justify-between gap-4">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${languageColor}`}
        >
          {review.language}
        </span>
        <time dateTime={review.savedAt} className="text-sm text-gray-500">
          {date}
        </time>
      </div>

      <div className={`mt-5 text-3xl font-bold ${scoreColor}`}>
        {score}
        <span className="ml-1 text-sm font-medium text-gray-500">/ 100</span>
      </div>

      <p className="mt-3 line-clamp-2 min-h-12 text-sm leading-6 text-gray-400">
        {review.result?.summary}
      </p>

      <div className="mt-5 flex items-center justify-end gap-3 border-t border-gray-800 pt-4">
        <button
          type="button"
          onClick={() => onView(review)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
        >
          View Report
        </button>
        <button
          type="button"
          onClick={() => onDelete(review.id)}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
        >
          Delete
        </button>
      </div>
    </article>
  );
}
