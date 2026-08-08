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
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
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
          className="fixed inset-0 z-50 overflow-y-auto bg-[#111111]/80 px-4 py-10 backdrop-blur-sm sm:px-6"
          role="dialog"
          aria-modal="true"
          aria-label="Review report"
        >
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedReview(null)}
                className="rounded-md border border-[#2a2a2a] bg-[#1c1c1c] px-4 py-2 text-sm font-medium text-[#a0a0a0] transition-colors hover:text-[#f5f5f5]"
              >
                Close
              </button>
            </div>
            <ReviewCard
              result={selectedReview.result}
              onSave={() => {}}
              isSaving={false}
            />
          </div>
        </div>
      )}
    </main>
  );
}
