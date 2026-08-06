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
    <header className="border-b border-gray-800 bg-gray-950 text-white">
      <nav className="mx-auto grid h-16 w-full max-w-7xl grid-cols-3 items-center px-6">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Critiq
        </Link>

        <div className="flex items-center justify-center gap-6 text-sm text-gray-300">
          <Link href="/" className="transition-colors hover:text-white">
            Home
          </Link>
          <Link
            href="/history"
            className="transition-colors hover:text-white"
          >
            History
          </Link>
        </div>

        <div className="flex items-center justify-end gap-4 text-sm">
          {user ? (
            <>
              <span className="truncate text-gray-300">{user.email}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-gray-700 px-3 py-2 transition-colors hover:bg-gray-800"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className="rounded-md border border-gray-700 px-3 py-2 transition-colors hover:bg-gray-800"
            >
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
