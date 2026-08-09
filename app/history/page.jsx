"use client";

import { useRouter } from "next/navigation";
import { useContext, useEffect, useState } from "react";

import HistoryCard from "@/components/HistoryCard";
import ReviewCard from "@/components/ReviewCard";
import { AuthContext } from "@/context/AuthContext";
import {
  deleteReview,
  getUserReviews,
} from "@/services/historyService";

export default function HistoryPage() {
  const { user, loading: authLoading } = useContext(AuthContext);
  const router = useRouter();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [selectedReview, setSelectedReview] = useState(null);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      router.replace("/auth");
      return;
    }

    let active = true;

    async function loadReviews() {
      setLoading(true);

      try {
        const userReviews = await getUserReviews(user.uid);

        if (active) {
          setReviews(userReviews);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadReviews();

    return () => {
      active = false;
    };
  }, [authLoading, router, user]);

  async function handleDelete(reviewId) {
    if (!user || deletingId) {
      return;
    }

    setDeletingId(reviewId);

    try {
      await deleteReview(user.uid, reviewId);
      const userReviews = await getUserReviews(user.uid);
      setReviews(userReviews);

      if (selectedReview?.id === reviewId) {
        setSelectedReview(null);
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111111] text-[#a0a0a0]">
        Checking authentication...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#111111] px-6 py-8 text-[#f5f5f5]">
      <div className="mx-auto w-full max-w-7xl">
        <h1 className="mb-8 pt-8 text-3xl font-bold font-space text-[#f5f5f5]">
          Review History
        </h1>

        {loading ? (
          <section className="flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-cyan-400/10 bg-[#141414] px-6 py-16 text-center shadow-[inset_0_0_80px_rgba(34,211,238,0.025)]">
            <div className="relative mb-7 h-32 w-40">
              <div className="absolute inset-x-4 bottom-1 h-14 rounded-xl border border-cyan-400/30 bg-[#0d1719] shadow-[0_0_28px_rgba(34,211,238,0.16)]">
                <div className="absolute inset-x-5 top-3 h-1 rounded-full bg-cyan-300/30" />
                <div className="absolute inset-x-8 top-7 h-1 rounded-full bg-cyan-300/15" />
              </div>

              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="absolute left-1/2 top-0 h-20 w-16 rounded-lg border border-[#3a3a3a] bg-[#1c1c1c] p-2 shadow-xl"
                  style={{
                    animation: `historyCardShuffle 1.5s ease-in-out ${index * 0.28}s infinite`,
                  }}
                >
                  <div className="mb-2 h-2 w-6 rounded-full bg-cyan-400/70" />
                  <div className="mb-1.5 h-1 w-full rounded-full bg-[#3a3a3a]" />
                  <div className="mb-1.5 h-1 w-4/5 rounded-full bg-[#333333]" />
                  <div className="h-1 w-2/3 rounded-full bg-[#2a2a2a]" />
                </div>
              ))}

              <div
                className="absolute inset-x-2 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent shadow-[0_0_12px_rgba(103,232,249,0.9)]"
                style={{ animation: "historyScan 1.3s ease-in-out infinite" }}
              />
            </div>

            <p className="font-mono text-sm font-bold tracking-[0.28em] text-cyan-300">
              LOADING HISTORY
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              {[0, 1, 2, 3, 4].map((index) => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 rounded-full bg-cyan-400"
                  style={{
                    animation: `historyDot 1s ease-in-out ${index * 0.12}s infinite`,
                  }}
                />
              ))}
            </div>

            <div className="mt-6 h-1 w-48 overflow-hidden rounded-full bg-[#2a2a2a]">
              <div
                className="h-full w-1/2 rounded-full bg-gradient-to-r from-cyan-500 via-sky-300 to-purple-400"
                style={{ animation: "historyProgress 1.4s ease-in-out infinite" }}
              />
            </div>
          </section>
        ) : reviews.length === 0 ? (
          <section className="py-20 text-center">
            <p className="mb-4 text-[#a0a0a0]">
              No reviews yet. Go analyze some code.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-lg bg-[#f5f5f5] px-6 py-2 text-[#111111] transition-colors hover:bg-[#e0e0e0]"
            >
              Analyze Code
            </button>
          </section>
        ) : (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-fr"
            style={{ perspective: "1000px" }}
          >
            {reviews.map((review) => (
              <div key={review.id} className="relative h-full">
                <HistoryCard
                  review={review}
                  onDelete={handleDelete}
                  onView={setSelectedReview}
                />

                {deletingId === review.id && (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center overflow-hidden rounded-xl border border-red-400/20 bg-[#0b0b0b]/95 backdrop-blur-md">
                    <div className="relative mb-2 h-24 w-24">
                      <span
                        className="absolute left-5 top-0 h-3 w-3 rounded-sm bg-red-300"
                        style={{ animation: "paperDrop 1s ease-in infinite" }}
                      />
                      <span
                        className="absolute left-11 top-1 h-2.5 w-2.5 rounded-sm bg-orange-300"
                        style={{
                          animation: "paperDrop 1s ease-in 0.25s infinite",
                        }}
                      />
                      <span
                        className="absolute right-5 top-0 h-2 w-2 rounded-sm bg-yellow-200"
                        style={{
                          animation: "paperDrop 1s ease-in 0.5s infinite",
                        }}
                      />

                      <svg
                        viewBox="0 0 64 64"
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-16 w-16 -translate-x-1/2 text-red-400 drop-shadow-[0_0_16px_rgba(248,113,113,0.45)]"
                        style={{
                          animation:
                            "trashShake 0.55s ease-in-out infinite",
                        }}
                      >
                        <path
                          d="M20 20h24l-2 34H22L20 20Z"
                          fill="currentColor"
                          opacity="0.22"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M16 16h32M26 10h12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                        <path
                          d="M28 28v16M36 28v16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>

                    <p className="font-mono text-sm font-bold tracking-[0.2em] text-red-300">
                      DELETING REVIEW
                    </p>

                    <div className="mt-3 h-1 w-36 overflow-hidden rounded-full bg-[#2a2a2a]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-red-500 via-orange-400 to-yellow-300"
                        style={{
                          animation: "deleteProgress 1.2s ease-in-out infinite",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedReview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ animation: "backdropIn 0.3s ease forwards" }}
          role="dialog"
          aria-modal="true"
          aria-label="Review report"
        >
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => setSelectedReview(null)}
          />

          <div
            className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[#1c1c1c] border border-[#2a2a2a] rounded-2xl shadow-[0_0_80px_rgba(74,222,128,0.15)]"
            style={{
              animation:
                "modalPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedReview(null)}
              aria-label="Close report"
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-[#111111] border border-[#2a2a2a] text-[#a0a0a0] hover:text-[#f5f5f5] hover:border-green-400 transition-all flex items-center justify-center text-sm"
            >
              ✕
            </button>

            <div className="p-6 pr-16 border-b border-[#2a2a2a] flex items-center gap-4">
              <div
                className="text-5xl font-black"
                style={{
                  color:
                    selectedReview.result?.overallScore >= 75
                      ? "#4ade80"
                      : selectedReview.result?.overallScore >= 50
                        ? "#facc15"
                        : "#f87171",
                }}
              >
                {selectedReview.result?.overallScore}
              </div>
              <div>
                <p className="text-lg font-bold text-[#f5f5f5]">
                  {selectedReview.language} Review
                </p>
                <p className="text-sm text-[#606060]">
                  Overall score out of 100
                </p>
              </div>
            </div>

            <div className="p-6">
              <ReviewCard
                result={selectedReview.result}
                sourceCode={selectedReview.code}
                onSave={null}
                isSaving={false}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
