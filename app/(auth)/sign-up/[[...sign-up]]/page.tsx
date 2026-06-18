'use client'

import { useState } from 'react'
import { useSignUp } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { s, Field, ErrorBox, LoadingRow } from '../../auth-ui'

type Step = 'form' | 'verify'

export default function SignUpPage() {
  const { signUp } = useSignUp()
  const router = useRouter()

  const [step, setStep]         = useState<Step>('form')
  const [firstName, setFirst]   = useState('')
  const [lastName, setLast]     = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [showPw, setShowPw]     = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signUp) return
    setLoading(true); setError('')

    try {
      const { error: createErr } = await signUp.create({ firstName, lastName, emailAddress: email, password })
      if (createErr) { setError(createErr.message ?? 'Registration failed.'); setLoading(false); return }

      const { error: sendErr } = await signUp.verifications.sendEmailCode()
      if (sendErr) { setError(sendErr.message ?? 'Could not send code.'); setLoading(false); return }

      setStep('verify')
    } catch (err: unknown) {
      const e = err as { errors?: { message: string }[]; message?: string }
      setError(e.errors?.[0]?.message ?? e.message ?? 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signUp) return
    setLoading(true); setError('')

    try {
      const { error: verifyErr } = await signUp.verifications.verifyEmailCode({ code })
      if (verifyErr) { setError(verifyErr.message ?? 'Invalid code.'); setLoading(false); return }

      if (signUp.status === 'complete') {
        const { error: finalErr } = await signUp.finalize()
        if (finalErr) { setError(finalErr.message ?? 'Session error.'); setLoading(false); return }
        router.push('/dashboard')
      }
    } catch (err: unknown) {
      const e = err as { errors?: { message: string }[]; message?: string }
      setError(e.errors?.[0]?.message ?? e.message ?? 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card" style={s.card}>
      {step === 'form' ? (
        <>
          <div style={{ marginBottom: 28 }}>
            <h2 style={s.cardTitle}>Create account</h2>
            <p style={s.cardSub}>Request access to the MD Media workspace</p>
          </div>

          <form onSubmit={handleRegister} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <Field label="First name">
                <input value={firstName} onChange={e => setFirst(e.target.value)} placeholder="Divina" required style={s.input}
                  onFocus={e => Object.assign(e.target.style, s.inputFocus)}
                  onBlur={e => Object.assign(e.target.style, s.inputBlur)} />
              </Field>
              <Field label="Last name">
                <input value={lastName} onChange={e => setLast(e.target.value)} placeholder="Armuela" required style={s.input}
                  onFocus={e => Object.assign(e.target.style, s.inputFocus)}
                  onBlur={e => Object.assign(e.target.style, s.inputBlur)} />
              </Field>
            </div>

            <Field label="Work email">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@mdmmarketing.com.au" required style={s.input}
                onFocus={e => Object.assign(e.target.style, s.inputFocus)}
                onBlur={e => Object.assign(e.target.style, s.inputBlur)} />
            </Field>

            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <label style={s.label}>Password</label>
                <button type="button" onClick={() => setShowPw(v => !v)} style={s.showBtn}>{showPw ? 'Hide' : 'Show'}</button>
              </div>
              <input type={showPw ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required style={s.input}
                onFocus={e => Object.assign(e.target.style, s.inputFocus)}
                onBlur={e => Object.assign(e.target.style, s.inputBlur)} />
            </div>

            {error && <ErrorBox msg={error} />}

            <button type="submit" disabled={loading || !signUp}
              style={{ ...s.btn, opacity: loading ? 0.75 : 1 }}>
              {loading ? <LoadingRow label="Creating account…" /> : 'Create account'}
            </button>
          </form>

          <p style={s.foot}>Already have an account? <Link href="/sign-in" style={s.link}>Sign in</Link></p>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 28, textAlign:'center' }}>
            <div style={{ fontSize:32, marginBottom:12 }}>✉️</div>
            <h2 style={s.cardTitle}>Check your email</h2>
            <p style={s.cardSub}>We sent a 6-digit code to <strong style={{ color:'#3d3a52' }}>{email}</strong></p>
          </div>

          <form onSubmit={handleVerify} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <Field label="Verification code">
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456"
                maxLength={6} required autoFocus
                style={{ ...s.input, fontSize:22, letterSpacing:'0.25em', textAlign:'center', fontFamily:'monospace' }}
                onFocus={e => Object.assign(e.target.style, { ...s.inputFocus, fontSize:'22px', letterSpacing:'0.25em', textAlign:'center' })}
                onBlur={e => Object.assign(e.target.style, { ...s.inputBlur, fontSize:'22px', letterSpacing:'0.25em', textAlign:'center' })} />
            </Field>

            {error && <ErrorBox msg={error} />}

            <button type="submit" disabled={loading || !signUp}
              style={{ ...s.btn, opacity: loading ? 0.75 : 1 }}>
              {loading ? <LoadingRow label="Verifying…" /> : 'Verify email'}
            </button>
            <button type="button" onClick={() => { setStep('form'); setError('') }}
              style={{ ...s.btn, background:'transparent', color:'#7b7990', border:'1px solid #e8e7ef' }}>
              Back
            </button>
          </form>
        </>
      )}
    </div>
  )
}
