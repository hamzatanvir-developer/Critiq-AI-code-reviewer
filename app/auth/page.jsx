"use client";

import { useRouter } from "next/navigation";
import { useContext, useState } from "react";

import { AuthContext } from "@/context/AuthContext";

export default function AuthPage() {
  const { loginUser, registerUser } = useContext(AuthContext);
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  function toggleMode() {
    setMode(isLogin ? "register" : "login");
    setConfirmPassword("");
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!isLogin && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        await loginUser(email, password);
      } else {
        await registerUser(email, password);
      }

      router.push("/");
    } catch (authError) {
      setError(authError.message || "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-gray-950 px-4 py-12 text-white">
      <section className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-2xl shadow-black/20">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isLogin ? "Welcome back" : "Create an account"}
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            {isLogin
              ? "Sign in to continue to Critiq."
              : "Register to save and revisit your reviews."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="text-sm font-medium text-gray-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="mt-2 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2.5 text-white outline-none placeholder:text-gray-500 focus:border-gray-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="text-sm font-medium text-gray-300"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              className="mt-2 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2.5 text-white outline-none placeholder:text-gray-500 focus:border-gray-500"
            />
          </div>

          {!isLogin && (
            <div>
              <label
                htmlFor="confirm-password"
                className="text-sm font-medium text-gray-300"
              >
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
                className="mt-2 w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2.5 text-white outline-none placeholder:text-gray-500 focus:border-gray-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-white px-4 py-2.5 font-semibold text-gray-950 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-600 disabled:text-gray-300"
          >
            {loading
              ? isLogin
                ? "Logging in..."
                : "Registering..."
              : isLogin
                ? "Login"
                : "Register"}
          </button>

          {error && (
            <p role="alert" className="text-center text-sm text-red-400">
              {error}
            </p>
          )}
        </form>

        <div className="mt-6 border-t border-gray-800 pt-6 text-center">
          <button
            type="button"
            onClick={toggleMode}
            disabled={loading}
            className="text-sm font-medium text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed"
          >
            {isLogin
              ? "Need an account? Register"
              : "Already have an account? Login"}
          </button>
        </div>
      </section>
    </main>
  );
}
