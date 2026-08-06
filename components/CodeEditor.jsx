"use client";

import { useState } from "react";

const languages = ["JavaScript", "Python", "Java", "C++", "React"];

export default function CodeEditor({ onAnalyze, loading }) {
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState(languages[0]);
  const [scrollTop, setScrollTop] = useState(0);

  const lineNumbers = Array.from(
    { length: code.split("\n").length },
    (_, index) => index + 1,
  ).join("\n");

  function handleSubmit(event) {
    event.preventDefault();
    onAnalyze(code, language);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full space-y-4 rounded-xl border border-gray-800 bg-gray-950 p-6 text-white"
    >
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="language" className="text-sm font-medium text-gray-300">
          Language
        </label>
        <select
          id="language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-gray-500"
        >
          {languages.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-h-[300px] overflow-hidden rounded-lg border border-gray-800 bg-gray-900 focus-within:border-gray-600">
        <div
          aria-hidden="true"
          className="w-14 shrink-0 overflow-hidden border-r border-gray-800 bg-gray-950 text-right font-mono text-sm leading-6 text-gray-500"
        >
          <pre
            className="px-3 py-4"
            style={{ transform: `translateY(-${scrollTop}px)` }}
          >
            {lineNumbers}
          </pre>
        </div>

        <textarea
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          placeholder="Paste your code here..."
          spellCheck="false"
          className="min-h-[300px] flex-1 resize-y bg-gray-900 p-4 font-mono text-sm leading-6 text-white outline-none placeholder:text-gray-500"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading || code.trim().length === 0}
          className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-gray-950 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
        >
          {loading ? "Analyzing..." : "Analyze Code"}
        </button>
      </div>
    </form>
  );
}
