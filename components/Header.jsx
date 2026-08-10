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
    <div className="fixed left-0 top-0 z-50 flex w-full justify-center px-2 pt-3 sm:px-6 sm:pt-5">
      <nav className="flex w-full max-w-5xl items-center justify-between gap-2 rounded-2xl border border-[#2a2a2a] bg-[#1c1c1c]/90 px-3 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:px-6 sm:py-4 lg:px-8">
        
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
            className="hidden overflow-hidden sm:block"
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
        <div className="flex min-w-0 items-center gap-0.5 rounded-xl bg-[#111111] p-1 sm:gap-1">
          <Link href="/" className="rounded-lg px-2.5 py-2 text-xs text-zinc-400 transition-all hover:bg-purple-900/30 hover:text-white sm:px-4 sm:text-sm">
            Home
          </Link>
          <Link href="/history" className="rounded-lg px-2.5 py-2 text-xs text-zinc-400 transition-all hover:bg-purple-900/30 hover:text-white sm:px-4 sm:text-sm">
            History
          </Link>
        </div>

        {/* Right - Auth */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {user ? (
            <>
              <div className="hidden items-center gap-2.5 min-[390px]:flex">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center shadow-[0_0_10px_rgba(124,58,237,0.4)]">
                  <span className="text-white text-sm font-bold">{getInitial(user.email)}</span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-xl bg-[#f5f5f5] px-3 py-2 text-xs font-medium text-[#111111] transition-all hover:bg-[#e0e0e0] sm:px-5 sm:text-sm"
              >
                <span className="relative">Logout</span>
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className="rounded-xl bg-[#f5f5f5] px-3 py-2 text-xs font-medium text-[#111111] transition-all hover:bg-[#e0e0e0] sm:px-5 sm:text-sm"
            >
              Login
            </Link>
          )}
        </div>

      </nav>
    </div>
  )
}
