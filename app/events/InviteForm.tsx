'use client'

import { useState } from 'react'

const MONO = 'var(--font-space-mono), monospace'

/**
 * The Room invite request — replaces the old mailto button. Persists via the
 * public /api/room-invite route; the copy above the form already promises
 * "tell us a little about what you do", so that is exactly what it asks.
 *
 * Inputs are 16px so iOS never auto-zooms, and the two-column row collapses
 * to a single column on narrow screens via auto-fit.
 */
export default function InviteForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [about, setAbout] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const input: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.22)',
    borderRadius: 12,
    padding: '15px 18px',
    fontFamily: MONO,
    fontSize: 16,
    color: '#ffffff',
    outline: 'none',
  }

  const label: React.CSSProperties = {
    display: 'block',
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
    margin: '0 0 8px',
    textAlign: 'left',
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/room-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, about }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      setState('done')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div style={{ maxWidth: 540, margin: '0 auto' }}>
        <p style={{ fontFamily: MONO, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#ffffff', margin: 0, lineHeight: 1.7 }}>
          Request received. ✓<br />
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>Rooms are announced to the list first — you&rsquo;ll hear from us.</span>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 640, margin: '0 auto', textAlign: 'left' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
        <div>
          <label htmlFor="room-name" style={label}>Name</label>
          <input
            id="room-name" type="text" required value={name}
            onChange={e => { setName(e.target.value); if (state === 'error') setState('idle') }}
            placeholder="Your name" style={input}
          />
        </div>
        <div>
          <label htmlFor="room-email" style={label}>Email</label>
          <input
            id="room-email" type="email" required value={email}
            onChange={e => { setEmail(e.target.value); if (state === 'error') setState('idle') }}
            placeholder="your@email.com" style={input}
          />
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <label htmlFor="room-about" style={label}>What do you do?</label>
        <input
          id="room-about" type="text" value={about}
          onChange={e => setAbout(e.target.value)}
          placeholder="e.g. founder, skincare brand" style={input}
        />
      </div>
      <div style={{ marginTop: 28, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <button
          type="submit" disabled={state === 'sending'}
          style={{
            background: '#ffffff', color: '#0B0B0B', fontFamily: MONO, fontWeight: 700,
            fontSize: 14, letterSpacing: '0.04em', padding: '17px 36px', borderRadius: 100,
            border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10,
            opacity: state === 'sending' ? 0.6 : 1,
          }}
        >
          {state === 'sending' ? 'sending…' : 'request an invite'} <span style={{ fontSize: 16 }}>→</span>
        </button>
        {state === 'error' && (
          <p style={{ fontFamily: MONO, fontSize: 12, color: '#E2725B', margin: 0 }}>{message}</p>
        )}
      </div>
    </form>
  )
}
