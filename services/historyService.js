import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

export async function saveReview(userId, reviewData) {
  const reviewFingerprint = JSON.stringify({
    code: reviewData.code,
    language: reviewData.language,
    result: reviewData.result,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(reviewFingerprint),
  );
  const reviewId = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const reviewDocument = doc(db, "reviews", userId, "items", reviewId);
  const existingReview = await getDoc(reviewDocument);

  if (existingReview.exists()) {
    return { id: reviewId, alreadySaved: true };
  }

  const review = {
    code: reviewData.code,
    language: reviewData.language,
    result: reviewData.result,
    savedAt: new Date().toISOString(),
  };

  await setDoc(reviewDocument, review);

  return { id: reviewId, alreadySaved: false };
}

export async function getUserReviews(userId) {
  const reviewsQuery = query(
    collection(db, "reviews", userId, "items"),
    orderBy("savedAt", "desc"),
  );
  const snapshot = await getDocs(reviewsQuery);

  return snapshot.docs.map((reviewDocument) => ({
    id: reviewDocument.id,
    ...reviewDocument.data(),
  }));
}

export function deleteReview(userId, reviewId) {
  return deleteDoc(doc(db, "reviews", userId, "items", reviewId));
}
