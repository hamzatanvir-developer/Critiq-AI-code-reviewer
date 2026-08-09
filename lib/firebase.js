import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

function getFirebaseAuth() {
  try {
    return initializeAuth(app, {
      persistence: [
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
    });
  } catch (error) {
    if (error?.code === "auth/already-initialized") {
      return getAuth(app);
    }

    throw error;
  }
}

export const auth = getFirebaseAuth();
export const db = getFirestore(app);

export function registerUser(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logoutUser() {
  const userId = auth.currentUser?.uid;

  await signOut(auth);

  if (userId && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(`critiq:last-review:${userId}`);
    } catch {
      // Logout still succeeds when browser storage is unavailable.
    }
  }
}

export function subscribeToAuthChanges(callback, errorCallback) {
  return onAuthStateChanged(auth, callback, errorCallback);
}
