'use client'
import Link from 'next/link'
import { useContext } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/context/AuthContext'

export default function Header() {
  const { user, logoutUser } = useContext(AuthContext)
  const router = useRouter()

  const handleLogout = async () => {
    await logoutUser()
    router.push('/')
  }

  return (
    <div className="w-full flex justify-center pt-6 px-4 absolute top-0 left-0 z-50">
      <nav className="flex items-center justify-between gap-8 bg-[#1a1a2e]/80 backdrop-blur-md border border-purple-900/30 rounded-2xl px-6 py-3 shadow-[0_0_30px_rgba(124,58,237,0.1)] w-full max-w-3xl">
        
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-lg font-bold bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">
            Critiq
          </span>
        </Link>

        <div className="flex items-center gap-6">
          <Link href="/" className="text-zinc-400 hover:text-purple-400 transition-colors text-sm">
            Home
          </Link>
          <Link href="/history" className="text-zinc-400 hover:text-purple-400 transition-colors text-sm">
            History
          </Link>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <>
              <span className="text-zinc-500 text-xs max-w-[120px] truncate hidden sm:block">{user.email}</span>
              <button
                onClick={handleLogout}
                className="bg-purple-700 hover:bg-purple-600 text-white transition-all rounded-xl px-4 py-2 text-sm font-medium"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className="bg-purple-700 hover:bg-purple-600 text-white transition-all rounded-xl px-4 py-2 text-sm font-medium"
            >
              Login
            </Link>
          )}
        </div>

      </nav>
    </div>
  )
}
