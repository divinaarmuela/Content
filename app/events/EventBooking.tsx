'use client'

import { useCallback, useEffect, useState } from 'react'
import EmbeddedPayment from '../components/booking/EmbeddedPayment'
import CancellationPolicy from '../components/booking/CancellationPolicy'
import SlotPicker from '../components/booking/SlotPicker'

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

const shortDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
const longDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

const field: React.CSSProperties = {
  width: '100%', background: 'transparent', border: `1px solid ${line}`,
  color: '#fff', padding: '12px 14px', fontSize: '0.95rem', outline: 'none',
}

type Listed = {
  name: string; slug: string; category: string | null
  duration_min: number; price_cents: number; currency: string
  image_url: string | null; location: string | null; teaser: string
}

export default function EventBooking() {
  const [catalogue, setCatalogue] = useState<Listed[] | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
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

  useEffect(() => {
    void fetch('/api/booking/public/services')
      .then(r => (r.ok ? r.json() : { services: [] }))
      .then(j => setCatalogue(j.services ?? []))
      .catch(() => setCatalogue([]))
      .finally(() => setLoading(false))
  }, [])

  const load = useCallback(async () => {
    if (!slug) return
    const res = await fetch(`/api/booking/public/slots?slug=${encodeURIComponent(slug)}&days=31`)
    if (!res.ok) return
    const json = await res.json()
    setService(json.service)
    setDays(json.availability ?? [])
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
    return <p style={{ color: 'rgba(255,255,255,0.5)', fontFamily: MONO, fontSize: 12 }}>Loading…</p>
  }

  if (!catalogue || catalogue.length === 0) {
    return (
      <p style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
        Nothing is open for booking right now. Email{' '}
        <a href="mailto:contact@mdmmarketing.com.au" style={{ color: '#fff' }}>contact@mdmmarketing.com.au</a>.
      </p>
    )
  }

  if (done) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', border: `1px solid ${line}`, padding: 28, textAlign: 'left' }}>
        <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)' }}>YOU&rsquo;RE IN</p>
        <p style={{ marginTop: 12, fontSize: '1.05rem', lineHeight: 1.5 }}>
          {service?.name ?? "Your session"} — {new Date(done.start_at).toLocaleString('en-AU', {
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

  // ── step 1: choose what to book ──
  if (!slug || !service) {
    const groups: { name: string; items: Listed[] }[] = []
    for (const c of catalogue) {
      const key = c.category?.trim() || 'Sessions'
      const g = groups.find(x => x.name === key)
      if (g) g.items.push(c); else groups.push({ name: key, items: [c] })
    }
    return (
      <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'left' }}>
        {groups.map(g => (
          <div key={g.name} style={{ marginBottom: 36 }}>
            <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.45)', marginBottom: 14 }}>
              {g.name.toUpperCase()}
            </p>
            {g.items.map(c => (
              <button key={c.slug} type="button" onClick={() => setSlug(c.slug)}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', gap: 18,
                  background: 'transparent', border: 'none', borderTop: `1px solid ${line}`,
                  color: '#fff', padding: '18px 0', cursor: 'pointer', textAlign: 'left',
                }}>
                {c.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image_url} alt="" aria-hidden
                    style={{ width: 92, height: 64, objectFit: 'contain', flexShrink: 0, background: 'rgba(255,255,255,0.04)' }} />
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '1.02rem', lineHeight: 1.3 }}>{c.name}</span>
                  {c.teaser && (
                    <span style={{ display: 'block', marginTop: 4, fontSize: '0.82rem', color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.teaser}
                    </span>
                  )}
                </span>
                <span style={{ flexShrink: 0, textAlign: 'right' }}>
                  <span style={{ display: 'block', fontSize: '1rem' }}>
                    {c.price_cents > 0 ? `A$${(c.price_cents / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : 'Free'}
                  </span>
                  <span style={{ display: 'block', fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)' }}>
                    {c.duration_min >= 60 ? `${Math.floor(c.duration_min / 60)}H${c.duration_min % 60 ? ` ${c.duration_min % 60}M` : ''}` : `${c.duration_min}M`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    )
  }

  const price = service.price_cents > 0
    ? `A$${(service.price_cents / 100).toFixed(0)}`
    : 'Free'

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'left' }}>
      <button type="button"
        onClick={() => { setSlug(null); setService(null); setDays([]); setPick(null) }}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', cursor: 'pointer', padding: 0, marginBottom: 18 }}>
        ← ALL SESSIONS
      </button>
      <p style={{ fontSize: '1.15rem', marginBottom: 6 }}>{service.name}</p>
      <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', marginBottom: 26 }}>
        {price} · {service.duration_min} MIN{service.location ? ` · ${service.location.toUpperCase()}` : ''}
      </p>
      {days.length === 0 && (
        <p style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
          No times are open for this one right now. Email{' '}
          <a href="mailto:contact@mdmmarketing.com.au" style={{ color: '#fff' }}>contact@mdmmarketing.com.au</a>.
        </p>
      )}
      <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
        1 · CHOOSE A TIME
      </p>
      <SlotPicker
        days={days}
        value={pick}
        onChange={setPick}
        ink="#ffffff"
        line={line}
        accentInk="#000000"
      />

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
