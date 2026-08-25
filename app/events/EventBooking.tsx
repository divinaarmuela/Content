'use client'

import { useCallback, useEffect, useState } from 'react'
import EmbeddedPayment from '../components/booking/EmbeddedPayment'
import CancellationPolicy from '../components/booking/CancellationPolicy'

/**
 * Booking for The Room, on the events page itself.
 *
 * Same engine as /book — the seat is claimed server-side and the payment
 * form is Stripe's, embedded here — but wearing this page's clothes rather
 * than the booking site's. Nobody is sent anywhere: pick a date, leave your
 * details, pay, done.
 */

type Slot = { min: number; label: string; resource_id: string }
type DaySlots = { day: string; slots: Slot[] }
type Service = {
  name: string; slug: string; description: string | null
  duration_min: number; price_cents: number; currency: string
  requires_payment: boolean; location: string | null
}

const MONO = 'var(--font-space-mono), monospace'
const line = 'rgba(255,255,255,0.16)'

const longDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

const field: React.CSSProperties = {
  width: '100%', background: 'transparent', border: `1px solid ${line}`,
  color: '#fff', padding: '12px 14px', fontSize: '0.95rem', outline: 'none',
}

export default function EventBooking({ slug }: { slug: string }) {
  const [service, setService] = useState<Service | null>(null)
  const [days, setDays] = useState<DaySlots[]>([])
  const [loading, setLoading] = useState(true)
  const [pick, setPick] = useState<{ day: string; slot: Slot } | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', company: '' })
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payment, setPayment] = useState<string | null>(null)
  const [done, setDone] = useState<{ ref: string; start_at: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/booking/public/slots?slug=${encodeURIComponent(slug)}&days=31`)
      if (!res.ok) return
      const json = await res.json()
      setService(json.service)
      setDays(json.availability ?? [])
    } finally { setLoading(false) }
  }, [slug])
  useEffect(() => { void load() }, [load])

  const submit = async () => {
    if (!pick || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/booking/public/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, day: pick.day, min: pick.slot.min, policy_agreed: agreed, ...form }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not reserve that seat')
        if (res.status === 409) { setPick(null); void load() }
        return
      }
      if (json.requires_payment) {
        const pay = await fetch('/api/booking/public/checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: json.ref }),
        })
        const pj = await pay.json()
        if (pay.ok && pj.client_secret) { setPayment(pj.client_secret); return }
        setError(pj.error ?? 'Could not start payment')
        return
      }
      setDone({ ref: json.ref, start_at: json.start_at })
    } catch {
      setError('Network problem — try again')
    } finally { setBusy(false) }
  }

  if (loading) {
    return <p style={{ color: 'rgba(255,255,255,0.5)', fontFamily: MONO, fontSize: 12 }}>Loading dates…</p>
  }

  if (!service || days.length === 0) {
    return (
      <p style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
        No dates are open right now. Email{' '}
        <a href="mailto:contact@mdmmarketing.com.au" style={{ color: '#fff' }}>contact@mdmmarketing.com.au</a>{' '}
        and we&rsquo;ll tell you when the next room opens.
      </p>
    )
  }

  if (done) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', border: `1px solid ${line}`, padding: 28, textAlign: 'left' }}>
        <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)' }}>YOU&rsquo;RE IN</p>
        <p style={{ marginTop: 12, fontSize: '1.05rem', lineHeight: 1.5 }}>
          {service.name} — {new Date(done.start_at).toLocaleString('en-AU', {
            weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
          })}
        </p>
        <p style={{ marginTop: 10, color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>
          Confirmation sent to {form.email}. Reference <span style={{ fontFamily: MONO }}>{done.ref}</span>.
        </p>
        <a href={`/book/manage/${done.ref}`}
          style={{ display: 'inline-block', marginTop: 18, fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.4)' }}>
          CHANGE OR CANCEL
        </a>
      </div>
    )
  }

  if (payment) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
        <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)', marginBottom: 14 }}>
          SEAT HELD FOR 30 MINUTES
        </p>
        <EmbeddedPayment clientSecret={payment} />
      </div>
    )
  }

  const price = service.price_cents > 0
    ? `A$${(service.price_cents / 100).toFixed(0)}`
    : 'Free'

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
      <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)' }}>
        1 · PICK A DATE
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {days.flatMap(d => d.slots.map(s => {
          const on = pick?.day === d.day && pick?.slot.min === s.min
          return (
            <button key={`${d.day}-${s.min}`} type="button"
              onClick={() => setPick({ day: d.day, slot: s })}
              style={{
                border: `1px solid ${on ? '#fff' : line}`,
                background: on ? '#fff' : 'transparent',
                color: on ? '#000' : '#fff',
                padding: '10px 14px', fontSize: '0.85rem', cursor: 'pointer',
              }}>
              {longDay(d.day)} · {s.label}
            </button>
          )
        }))}
      </div>

      {pick && (
        <>
          <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)', margin: '32px 0 12px' }}>
            2 · YOUR DETAILS
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            <input placeholder="Your name" value={form.name} style={field}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input placeholder="Email" type="email" value={form.email} style={field}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <input placeholder="Phone (optional)" value={form.phone} style={field}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <textarea placeholder="What do you do? (optional)" rows={3} value={form.notes}
              style={{ ...field, resize: 'vertical' }}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {/* bots fill every field; a person never sees this one */}
          <input tabIndex={-1} aria-hidden autoComplete="off" value={form.company}
            onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
            style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} />

          <div style={{ marginTop: 24 }}>
            <CancellationPolicy agreed={agreed} onAgreedChange={setAgreed} tone="event" />
          </div>

          {error && <p style={{ color: '#ff8a8a', marginTop: 14, fontSize: '0.9rem' }}>{error}</p>}

          <button type="button" onClick={() => void submit()}
            disabled={busy || !agreed || !form.name.trim() || !form.email.trim()}
            style={{
              marginTop: 20, background: '#fff', color: '#000', border: 'none',
              padding: '14px 26px', fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em',
              cursor: busy ? 'default' : 'pointer', opacity: busy || !agreed || !form.name.trim() || !form.email.trim() ? 0.4 : 1,
            }}>
            {busy ? 'HOLDING YOUR SEAT…' : `BOOK MY SEAT · ${price}`}
          </button>
        </>
      )}
    </div>
  )
}
