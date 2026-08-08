"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useContext } from "react";

import { AuthContext } from "@/context/AuthContext";

export default function Header() {
  const { user, logoutUser } = useContext(AuthContext);
  const router = useRouter();

  async function handleLogout() {
    await logoutUser();
    router.push("/");
  }

  return (
    <header className="border-b border-purple-900/30 bg-[#0d0d0f] text-white">
      <nav
        className="flex w-full items-center justify-between px-6 py-4"
        style={{
          background:
            "linear-gradient(to bottom, rgba(124,58,237,0.05), transparent)",
        }}
      >
        <Link
          href="/"
          className="flex items-center font-space text-xl font-bold tracking-tight bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent"
        >
          <span className="mr-2 h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
          Critiq
        </Link>

        <div className="flex items-center gap-6 text-sm text-zinc-400">
          <Link
            href="/"
            className="relative transition-colors after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-purple-500 after:transition-all hover:text-purple-400 hover:after:w-full"
          >
            Home
          </Link>
          <Link
            href="/history"
            className="relative transition-colors after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 after:bg-purple-500 after:transition-all hover:text-purple-400 hover:after:w-full"
          >
            History
          </Link>
        </div>

        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <span className="max-w-[150px] truncate text-sm text-zinc-500">
                {user.email}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg border border-purple-700 px-4 py-2 text-sm text-purple-400 transition-all hover:bg-purple-700 hover:text-white"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className="rounded-lg border border-purple-700 px-4 py-2 text-sm text-purple-400 transition-all hover:bg-purple-700 hover:text-white"
            >
              Login
            </Link>
          )}
        </div>

        <div className="h-px w-full bg-gradient-to-r from-transparent via-purple-500 to-transparent" />
      </nav>
    </header>
  );
}
