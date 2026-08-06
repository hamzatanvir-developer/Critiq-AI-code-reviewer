import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

export async function saveReview(userId, reviewData) {
  const review = {
    code: reviewData.code,
    language: reviewData.language,
    result: reviewData.result,
    savedAt: new Date().toISOString(),
  };

  const document = await addDoc(
    collection(db, "reviews", userId, "items"),
    review,
  );

  return document.id;
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
