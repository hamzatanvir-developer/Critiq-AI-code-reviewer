"use client";

import { useRouter } from "next/navigation";
import { useContext, useState } from "react";

import CodeEditor from "@/components/CodeEditor";
import ReviewCard from "@/components/ReviewCard";
import { AuthContext } from "@/context/AuthContext";
import { analyzeCode } from "@/lib/gemini";
import { saveReview } from "@/services/historyService";

export default function HomePage() {
  const { user, loading: authLoading } = useContext(AuthContext);
  const router = useRouter();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [analyzedCode, setAnalyzedCode] = useState("");
  const [analyzedLanguage, setAnalyzedLanguage] = useState("");

  async function handleAnalyze(code, language) {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const analysis = await analyzeCode(code, language);

      if (!analysis) {
        setError("Unable to analyze the code. Please try again.");
        return;
      }

      setAnalyzedCode(code);
      setAnalyzedLanguage(language);
      setResult(analysis);
      setTimeout(() => {
        document
          .getElementById('review-section')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    } catch {
      setError("Unable to analyze the code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!user || !result) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await saveReview(user.uid, {
        code: analyzedCode,
        language: analyzedLanguage,
        result,
        savedAt: new Date().toISOString(),
      });
    } catch {
      setError("Unable to save the review. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0d0f] text-gray-400">
        Checking authentication...
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col bg-[#0d0d0f] text-white">
        <section className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <h1 className="mb-4 text-5xl font-bold leading-tight text-white md:text-7xl font-space">
            AI-powered code review
            <br />
            for every <span className="bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">developer.</span>
          </h1>

          <p className="mb-8 max-w-xl text-lg text-zinc-400">
            Paste your code. Get instant feedback on bugs, security, performance,
            and quality. Powered by Google Gemini AI.
          </p>

          <div className="relative w-full overflow-hidden my-8 py-2">
            <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0d0d0f] to-transparent z-10" />
            <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#0d0d0f] to-transparent z-10" />
            <div className="flex gap-16 ticker-track">
              {['JavaScript', 'Python', 'Java', 'C++', 'React',
                'JavaScript', 'Python', 'Java', 'C++', 'React',
                'JavaScript', 'Python', 'Java', 'C++', 'React'].map((lang, i) => (
                <span key={i} className="flex items-center gap-2 text-zinc-400 text-sm font-medium whitespace-nowrap shrink-0">
                  <span className={`w-2 h-2 rounded-full ${
                    lang === 'JavaScript' ? 'bg-yellow-400' :
                    lang === 'Python' ? 'bg-blue-400' :
                    lang === 'Java' ? 'bg-orange-400' :
                    lang === 'C++' ? 'bg-cyan-400' : 'bg-sky-400'
                  }`} />
                  {lang}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            <button
              type="button"
              onClick={() => router.push("/auth")}
              className="rounded-lg bg-purple-700 px-10 py-4 text-lg font-semibold text-white transition-all hover:bg-purple-600"
            >
              Get Started Free
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto w-full max-w-5xl pt-28 pb-12">
        <div className={result ? "space-y-8" : "flex min-h-[calc(100vh-6rem)] items-center justify-center"}>
          <div className={result ? "w-full space-y-8" : "w-full"}>
            <CodeEditor onAnalyze={handleAnalyze} loading={loading} />

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-center text-sm text-red-400"
              >
                {error}
              </p>
            )}

            {result && (
              <div id="review-section">
                <ReviewCard
                  result={result}
                  onSave={handleSave}
                  isSaving={isSaving}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
