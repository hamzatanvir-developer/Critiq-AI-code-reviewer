"use client";

import { useRouter } from "next/navigation";
import { useContext, useEffect, useState } from "react";

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

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/auth");
    }
  }, [authLoading, router, user]);

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

  if (authLoading || !user) {
    return (
      <main className="flex flex-1 items-center justify-center bg-gray-950 text-gray-400">
        Checking authentication...
      </main>
    );
  }

  return (
    <main className="flex-1 bg-gray-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10 text-center">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Critiq</h1>
          <p className="mt-3 text-lg text-gray-400">
            AI-powered code reviewer
          </p>
        </header>

        <div className="space-y-8">
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
            <ReviewCard
              result={result}
              onSave={handleSave}
              isSaving={isSaving}
            />
          )}
        </div>
      </div>
    </main>
  );
}
