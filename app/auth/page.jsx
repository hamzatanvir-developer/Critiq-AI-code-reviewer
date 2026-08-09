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
    <main className="flex min-h-[calc(100dvh-6rem)] items-start justify-center bg-[#111111] px-4 py-6 text-white sm:min-h-[calc(100dvh-8rem)] sm:items-center sm:py-8">
      <section className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c] p-5 shadow-[0_0_40px_rgba(0,0,0,0.15)] sm:p-8">
        <div className="text-center">
          <h1 className="font-space text-3xl font-bold bg-gradient-to-r from-[#f5f5f5] to-[#a0a0a0] bg-clip-text text-transparent">
            Critiq
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-400">
            {isLogin
              ? "Sign in to review code with AI assistance."
              : "Create an account to save and revisit your reviews."}
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <div className="inline-flex rounded-xl border border-[#2a2a2a] bg-[#111111] p-1">
            <button
              type="button"
              onClick={() => !isLogin && toggleMode()}
              disabled={loading}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                isLogin
                  ? "bg-[#f5f5f5] text-[#111111]"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => isLogin && toggleMode()}
              disabled={loading}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                !isLogin
                  ? "bg-[#f5f5f5] text-[#111111]"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Register
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-zinc-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="w-full rounded-lg border border-[#2a2a2a] bg-[#111111] px-4 py-3 text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-[#f5f5f5]"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm text-zinc-400"
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
              className="w-full rounded-lg border border-[#2a2a2a] bg-[#111111] px-4 py-3 text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-[#f5f5f5]"
            />
          </div>

          {!isLogin && (
            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1 block text-sm text-zinc-400"
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
                className="w-full rounded-lg border border-[#2a2a2a] bg-[#111111] px-4 py-3 text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-[#f5f5f5]"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#f5f5f5] py-3 font-semibold text-[#111111] transition-all hover:bg-[#e0e0e0] disabled:cursor-not-allowed disabled:opacity-80"
          >
            {loading ? "Loading..." : isLogin ? "Login" : "Register"}
          </button>

          {error && (
            <p role="alert" className="mt-2 text-center text-sm text-red-400">
              {error}
            </p>
          )}
        </form>

      </section>
    </main>
  );
}
