'use client'

import { useState } from 'react'
import { useSignIn } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { s, Field, ErrorBox, LoadingRow, GoogleIcon } from '../../auth-ui'

export default function SignInPage() {
  const { signIn } = useSignIn()
  const router = useRouter()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [showPw, setShowPw]     = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signIn) return
    setLoading(true)
    setError('')

    try {
      const { error: pwError } = await signIn.password({ emailAddress: email, password })
      if (pwError) { setError(pwError.message ?? 'Sign in failed.'); setLoading(false); return }

      if (signIn.status === 'complete') {
        const { error: finalError } = await signIn.finalize()
        if (finalError) { setError(finalError.message ?? 'Session error.'); setLoading(false); return }
        router.push('/dashboard')
      }
    } catch (err: unknown) {
      const e = err as { errors?: { message: string }[]; message?: string }
      setError(e.errors?.[0]?.message ?? e.message ?? 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card" style={s.card}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={s.cardTitle}>Welcome back</h2>
        <p style={s.cardSub}>Sign in to your MD Media account</p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@mdmmarketing.com.au" required autoFocus style={s.input}
            onFocus={e => Object.assign(e.target.style, s.inputFocus)}
            onBlur={e => Object.assign(e.target.style, s.inputBlur)} />
        </Field>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={s.label}>Password</label>
            <button type="button" onClick={() => setShowPw(v => !v)} style={s.showBtn}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <input type={showPw ? 'text' : 'password'} value={password}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••" required style={s.input}
            onFocus={e => Object.assign(e.target.style, s.inputFocus)}
            onBlur={e => Object.assign(e.target.style, s.inputBlur)} />
        </div>

        {error && <ErrorBox msg={error} />}

        <button type="submit" disabled={loading || !signIn}
          style={{ ...s.btn, opacity: loading ? 0.75 : 1 }}>
          {loading ? <LoadingRow label="Signing in…" /> : 'Sign in'}
        </button>
      </form>

      <div style={s.divider}>
        <div style={s.dividerLine} />
        <span style={s.dividerLabel}>or</span>
        <div style={s.dividerLine} />
      </div>

      <button
        type="button"
        onClick={async () => {
          if (!signIn) return
          await signIn.sso({
            strategy: 'oauth_google',
            redirectUrl: `${window.location.origin}/sso-callback`,
            redirectCallbackUrl: `${window.location.origin}/dashboard`,
          })
        }}
        style={s.googleBtn}
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <p style={s.foot}>
        Need access? <Link href="/sign-up" style={s.link}>Request an account</Link>
      </p>
    </div>
  )
}
