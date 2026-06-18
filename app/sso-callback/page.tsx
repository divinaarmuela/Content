'use client'

import { useEffect } from 'react'
import { useClerk } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'

export default function SSOCallbackPage() {
  const { handleRedirectCallback } = useClerk()
  const router = useRouter()

  useEffect(() => {
    handleRedirectCallback({
      signInForceRedirectUrl: '/dashboard',
      signUpForceRedirectUrl: '/dashboard',
    }).catch(() => router.push('/sign-in'))
  }, [handleRedirectCallback, router])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f9f8fc', fontFamily: "var(--font-sans, sans-serif)",
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin .8s linear infinite' }}>
          <circle cx="12" cy="12" r="10" stroke="#e8e7ef" strokeWidth="2.5" />
          <path d="M12 2A10 10 0 0122 12" stroke="#5d5fef" strokeWidth="2.5" strokeLinecap="round" />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </svg>
        <p style={{ fontSize: 13, color: '#7b7990', fontWeight: 500, margin: 0 }}>Completing sign in…</p>
      </div>
    </div>
  )
}
