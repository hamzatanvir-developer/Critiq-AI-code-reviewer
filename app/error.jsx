"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, retry }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[calc(100dvh-6rem)] items-center justify-center bg-[#111111] px-4 text-[#f5f5f5] sm:min-h-[calc(100dvh-8rem)]">
      <section className="w-full max-w-lg rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-300">
          Unexpected error
        </p>
        <h1 className="mt-3 text-3xl font-black">Critiq hit a problem</h1>
        <p className="mt-3 text-sm leading-6 text-[#a0a0a0]">
          Your account and saved reviews are safe. Retry the page, or return home if the problem continues.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-6 rounded-xl bg-[#f5f5f5] px-6 py-3 font-bold text-[#111111] transition-colors hover:bg-[#e0e0e0]"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
