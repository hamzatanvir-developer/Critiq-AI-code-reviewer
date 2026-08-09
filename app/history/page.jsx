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
    if (!user) {
      return;
    }

    setLoading(true);

    try {
      await deleteReview(user.uid, reviewId);
      const userReviews = await getUserReviews(user.uid);
      setReviews(userReviews);

      if (selectedReview?.id === reviewId) {
        setSelectedReview(null);
      }
    } finally {
      setLoading(false);
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
          <p className="py-20 text-center text-[#a0a0a0]">Loading reviews...</p>
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
              <HistoryCard
                key={review.id}
                review={review}
                onDelete={handleDelete}
                onView={setSelectedReview}
              />
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
                onSave={() => {}}
                isSaving={false}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
