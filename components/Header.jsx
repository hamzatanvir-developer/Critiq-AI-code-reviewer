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

  const getInitial = (email) => {
    return email ? email.charAt(0).toUpperCase() : '?'
  }

  return (
    <div className="w-full flex justify-center pt-5 px-6 fixed top-0 left-0 z-50">
      <nav className="flex items-center justify-between bg-[#13131a]/90 backdrop-blur-xl border border-purple-900/20 rounded-2xl px-8 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] w-full max-w-6xl">
        
        {/* Logo - Left */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center shadow-[0_0_12px_rgba(124,58,237,0.5)]">
            <span className="text-white text-xs font-black">C</span>
          </div>
          <span className="text-lg font-bold bg-gradient-to-r from-white to-purple-300 bg-clip-text text-transparent">
            Critiq
          </span>
        </Link>

        {/* Nav - Center */}
        <div className="flex items-center gap-1 bg-[#0d0d0f] rounded-xl p-1">
          <Link href="/" className="text-zinc-400 hover:text-white hover:bg-purple-900/30 transition-all text-sm px-4 py-2 rounded-lg">
            Home
          </Link>
          <Link href="/history" className="text-zinc-400 hover:text-white hover:bg-purple-900/30 transition-all text-sm px-4 py-2 rounded-lg">
            History
          </Link>
        </div>

        {/* Right - Auth */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center shadow-[0_0_10px_rgba(124,58,237,0.4)]">
                  <span className="text-white text-sm font-bold">{getInitial(user.email)}</span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="relative group bg-[#0d0d0f] border border-purple-900/40 text-zinc-400 hover:text-white rounded-xl px-5 py-2 text-sm font-medium transition-all overflow-hidden"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-purple-700 to-purple-900 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" />
                <span className="relative">Logout</span>
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className="relative group bg-purple-700 hover:bg-purple-600 text-white rounded-xl px-5 py-2 text-sm font-medium transition-all shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:shadow-[0_0_30px_rgba(124,58,237,0.5)]"
            >
              Login
            </Link>
          )}
        </div>

      </nav>
    </div>
  )
}
