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
      <nav className="flex items-center justify-between bg-[#1c1c1c]/90 backdrop-blur-xl border border-[#2a2a2a] rounded-2xl px-8 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] w-full max-w-5xl">
        
        {/* Logo - Left */}
        <Link href="/" className="flex items-center gap-2.5">
          {/* Spinning gradient logo */}
          <div
            className="relative w-10 h-10 flex items-center justify-center"
            style={{ animation: 'logoSpin 0.8s ease forwards' }}
          >
            <div
              className="absolute inset-0 rounded-xl"
              style={{
                background: 'conic-gradient(from 0deg, #4ade80, #06b6d4, #a855f7, #f59e0b, #4ade80)',
                animation: 'spinGradient 2s linear infinite',
                borderRadius: '12px',
              }}
            />
            <div className="absolute inset-[2px] rounded-[10px] bg-[#111111] flex items-center justify-center z-10">
              <span className="text-white font-black text-lg">C</span>
            </div>
          </div>

          {/* Name ejects from right after logo appears */}
          <div
            className="overflow-hidden"
            style={{ animation: 'nameEject 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.6s both' }}
          >
            <div className="flex flex-col">
              <span className="text-lg font-black text-[#f5f5f5] leading-none tracking-tight">
                Critiq
              </span>
             
            </div>
          </div>
        </Link>

        {/* Nav - Center */}
        <div className="flex items-center gap-1 bg-[#111111] rounded-xl p-1">
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
                className="bg-[#f5f5f5] text-[#111111] hover:bg-[#e0e0e0] rounded-xl px-5 py-2 text-sm font-medium transition-all"
              >
                <span className="relative">Logout</span>
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className="bg-[#f5f5f5] text-[#111111] hover:bg-[#e0e0e0] rounded-xl px-5 py-2 text-sm font-medium transition-all"
            >
              Login
            </Link>
          )}
        </div>

      </nav>
    </div>
  )
}
