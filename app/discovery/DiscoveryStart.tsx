'use client'

import { useEffect, useState } from 'react'

/** where this browser's own form is remembered, so coming back to the general link carries on where they stopped */
const KEY = 'mdm-discovery-form'

export default function DiscoveryStart() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resume, setResume] = useState<string | null>(null)
  useEffect(() => { try { const t = localStorage.getItem(KEY); if (t && /^[0-9a-f-]{36}$/i.test(t)) setResume(t) } catch { /* private window */ } }, [])

  const begin = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      let token = resume
      if (!token) {
        const res = await fetch('/api/discovery/start', { method: 'POST' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || typeof json.token !== 'string') throw new Error(json?.error ?? 'The form could not be opened. Please try again.')
        token = json.token as string
        try { localStorage.setItem(KEY, token) } catch { /* private window: the form still opens */ }
      }
      window.location.assign(`/intake/${token}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The form could not be opened. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink text-cream antialiased">
      <header className="border-b border-cream/15">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-5 w-auto" />
          <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-dim">Discovery form</p>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="font-lamah text-[44px] font-semibold leading-[1.05] tracking-tight sm:text-[64px]">Tell us about your business</h1>
        <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-cream-dim">
          A few short questions so we come to our first conversation prepared. It takes about ten minutes, short answers are fine, and you can skip anything you are not sure about.
        </p>
        <div className="mt-10">
          <button type="button" onClick={() => void begin()} disabled={busy}
            className="inline-flex min-h-12 items-center gap-3 border border-cream bg-cream px-7 font-lamam text-[12px] uppercase tracking-widest text-ink transition hover:bg-transparent hover:text-cream disabled:opacity-60">
            {busy ? 'Opening the form…' : resume ? 'Carry on with your form' : 'Begin'} <span aria-hidden>→</span>
          </button>
          {resume && !busy && (
            <button type="button" onClick={() => { try { localStorage.removeItem(KEY) } catch { /* nothing kept */ } setResume(null) }}
              className="ml-4 inline-flex min-h-12 items-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim underline underline-offset-4 hover:text-cream">
              Start a new one
            </button>
          )}
          {error && <p role="alert" className="mt-4 text-[14px] text-[#E2725B]">{error}</p>}
        </div>
      </main>
    </div>
  )
}
