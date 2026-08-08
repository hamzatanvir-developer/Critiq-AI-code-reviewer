"use client";

const languageStyles = {
  javascript: "bg-yellow-400/10 text-yellow-400 border border-yellow-400/20",
  python: "bg-blue-400/10 text-blue-400 border border-blue-400/20",
  java: "bg-orange-400/10 text-orange-400 border border-orange-400/20",
  "c++": "bg-cyan-400/10 text-cyan-400 border border-cyan-400/20",
  react: "bg-sky-400/10 text-sky-400 border border-sky-400/20",
};

export default function HistoryCard({ review, onDelete, onView }) {
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
    <article className="animate-fade-in cursor-pointer rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5 text-white transition-all hover:border-purple-900/50">
      <div className="mb-4 flex items-start justify-between gap-4">
        <span
          className={`px-3 py-1 rounded-md uppercase tracking-wide text-xs font-bold ${languageStyles[review.language?.toLowerCase()] ?? languageStyles.react}`}
        >
          {review.language}
        </span>
        <time dateTime={review.savedAt} className="text-sm text-zinc-400 font-medium">
          {date}
        </time>
      </div>

      <div className="mb-3 flex items-baseline gap-1">
        <span className={`text-5xl font-black ${scoreColor}`}>{score}</span>
        <span className="text-sm font-normal text-zinc-600">/100</span>
      </div>

      <p className="mb-5 text-sm leading-relaxed text-zinc-500">
        {review.result?.summary}
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-zinc-800/50 pt-4">
        <button
          type="button"
          onClick={() => onView(review)}
          className="text-sm font-medium text-purple-400 transition-colors hover:text-purple-300"
        >
          View Report →
        </button>
        <button
          type="button"
          onClick={() => onDelete(review.id)}
          className="bg-red-900/20 border border-red-900/40 text-red-400 hover:bg-red-900/40 text-xs px-3 py-1.5 rounded-lg transition-all font-medium"
        >
          Delete
        </button>
      </div>
    </article>
  );
}
