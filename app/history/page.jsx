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
      <main className="flex flex-1 items-center justify-center bg-gray-950 text-gray-400">
        Checking authentication...
      </main>
    );
  }

  return (
    <main className="flex-1 bg-gray-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <h1 className="text-4xl font-bold tracking-tight">Review History</h1>

        {loading ? (
          <p className="py-20 text-center text-gray-400">Loading reviews...</p>
        ) : reviews.length === 0 ? (
          <section className="mt-10 rounded-xl border border-gray-800 bg-gray-900 px-6 py-16 text-center">
            <p className="text-lg text-gray-300">
              No reviews yet. Go analyze some code.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-6 rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-gray-950 transition-colors hover:bg-gray-200"
            >
              Analyze Code
            </button>
          </section>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
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
          className="fixed inset-0 z-50 overflow-y-auto bg-black/80 px-4 py-10 backdrop-blur-sm sm:px-6"
          role="dialog"
          aria-modal="true"
          aria-label="Review report"
        >
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedReview(null)}
                className="rounded-md border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
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
