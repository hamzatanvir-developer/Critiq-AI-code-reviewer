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
      className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] text-[#f5f5f5] shadow-[0_0_40px_rgba(0,0,0,0.15)]"
    >
      <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#161616] px-4 py-3">
        <label
          htmlFor="language"
          className="relative h-3 w-14 shrink-0 overflow-hidden text-transparent before:absolute before:left-0 before:top-0 before:h-3 before:w-3 before:rounded-full before:bg-red-500 after:absolute after:right-0 after:top-0 after:h-3 after:w-3 after:rounded-full after:bg-green-500 bg-[radial-gradient(circle_at_center,_#d4d4d4_0_6px,_transparent_7px)] bg-no-repeat"
        >
          Language
        </label>
        <select
          id="language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="rounded-lg border border-[#2a2a2a] bg-[#111111] px-3 py-1 text-sm text-[#f5f5f5] outline-none"
        >
          {languages.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="flex overflow-hidden bg-[#0d0d0f]">
        <div
          aria-hidden="true"
          className="hidden w-14 shrink-0 overflow-hidden border-r border-[#2a2a2a] bg-[#161616] text-right font-mono text-sm leading-6 text-zinc-500"
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
          className="w-full min-h-[400px] resize-none bg-[#111111] p-6 font-mono text-sm leading-relaxed text-[#a0ffb0] outline-none placeholder:text-zinc-700"
        />
      </div>

      <div className="border-t border-[#2a2a2a] bg-[#161616] px-4 py-3">
        <button
          type="submit"
          disabled={loading || code.trim().length === 0}
          className="w-full rounded-lg bg-[#f5f5f5] py-3 text-base font-bold text-[#111111] transition-all hover:bg-[#e0e0e0] disabled:cursor-not-allowed disabled:opacity-80"
        >
          {loading ? "Analyzing..." : "Analyze Code"}
        </button>
      </div>
    </form>
  );
}
