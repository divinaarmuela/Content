'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import EmbeddedPayment from '../components/booking/EmbeddedPayment'
import CancellationPolicy from '../components/booking/CancellationPolicy'
import SlotPicker from '../components/booking/SlotPicker'
import ServiceCopy from '../components/booking/ServiceCopy'
import HoldTimer from '../components/booking/HoldTimer'
import { isUsablePhone } from '../lib/booking-core'

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

/**
 * Widths that grow with the screen.
 *
 * These were fixed pixel widths, so on a large monitor the booking block sat
 * at phone size inside a page whose headings run to 1180px — it read as an
 * afterthought. min(100%, …) comes first so the clamp's floor can never
 * overflow a narrow phone.
 */
const CATALOGUE_W = 'min(100%, clamp(620px, 62vw, 900px))'
const FLOW_W = 'min(100%, clamp(560px, 54vw, 780px))'
const CARD_W = 'min(100%, clamp(520px, 44vw, 660px))'
const line = 'rgba(255,255,255,0.16)'

const shortDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
const longDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

// 16px exactly: iOS Safari zooms the whole page when a focused input is
// smaller than that, which throws the layout around mid-booking
const field: React.CSSProperties = {
  width: '100%', background: 'transparent', border: `1px solid ${line}`,
  color: '#fff', padding: '13px 14px', fontSize: '16px', outline: 'none',
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
  const [payment, setPayment] = useState<{ clientSecret: string; ref: string; when: string; expiresAt: number | null } | null>(null)
  const [expired, setExpired] = useState(false)
  const [done, setDone] = useState<{ ref: string; start_at: string } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  // Changing step swaps the content but keeps the scroll position, so on a
  // phone you land halfway down whatever replaced it. Bring the section back
  // into view whenever the step changes.
  useEffect(() => {
    // the payment step scrolls itself once Stripe's iframe is mounted —
    // doing it here too would fight that and land on the heading
    if (!payment && (done || slug)) {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [payment, done, slug])

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
        if (pay.ok && pj.client_secret) { setPayment({ clientSecret: pj.client_secret, ref: json.ref, when: json.start_at, expiresAt: pj.expires_at ?? null }); return }
        setError(pj.error ?? 'Could not start payment')
        return
      }
      setDone({ ref: json.ref, start_at: json.start_at })
    } catch {
      setError('Network problem — try again')
    } finally { setBusy(false) }
  }

  if (loading) {
    // hold the height the catalogue will need. A one-line placeholder makes
    // the whole section collapse, so anything scrolling to it lands in the
    // wrong place and then gets shoved as the real content arrives.
    return (
      <div style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontFamily: MONO, fontSize: 12 }}>Loading…</p>
      </div>
    )
  }

  if (!catalogue || catalogue.length === 0) {
    return (
      <p style={{ color: 'rgba(255,255,255,0.6)', width: CARD_W, margin: '0 auto', lineHeight: 1.6 }}>
        Nothing is open for booking right now. Email{' '}
        <a href="mailto:contact@mdmmarketing.com.au" style={{ color: '#fff' }}>contact@mdmmarketing.com.au</a>.
      </p>
    )
  }

  if (done) {
    return (
      <div ref={topRef} style={{ width: CARD_W, margin: '0 auto', border: `1px solid ${line}`, padding: 28, textAlign: 'left', scrollMarginTop: 90 }}>
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

  if (expired) {
    return (
      <div style={{ width: CARD_W, margin: '0 auto', border: `1px solid ${line}`, padding: 28, textAlign: 'left' }}>
        <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)' }}>HOLD EXPIRED</p>
        <p style={{ marginTop: 12, fontSize: '1.05rem', lineHeight: 1.5 }}>That seat was released</p>
        <p style={{ marginTop: 10, color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem', lineHeight: 1.6 }}>
          We hold a seat for 30 minutes while you pay. Yours ran out, so it went back
          on the calendar — you have not been charged. Pick another time below.
        </p>
        <button type="button"
          onClick={() => { setExpired(false); setPayment(null); setPick(null); void load() }}
          style={{ marginTop: 18, background: '#fff', color: '#000', border: 'none', padding: '13px 22px', fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em', cursor: 'pointer' }}>
          PICK ANOTHER TIME
        </button>
      </div>
    )
  }

  if (payment) {
    return (
      <div ref={topRef} style={{ width: FLOW_W, margin: '0 auto', textAlign: 'left', scrollMarginTop: 90 }}>
        <div style={{ fontFamily: MONO, marginBottom: 14 }}>
          <HoldTimer expiresAt={payment.expiresAt} onExpired={() => setExpired(true)} tone="event" />
        </div>
        <EmbeddedPayment
          clientSecret={payment.clientSecret}
          onComplete={() => { setDone({ ref: payment.ref, start_at: payment.when }); setPayment(null) }}
        />
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
      <div style={{ width: CATALOGUE_W, margin: '0 auto', textAlign: 'left' }}>
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
    <div ref={topRef} style={{ width: FLOW_W, margin: '0 auto', textAlign: 'left', scrollMarginTop: 90 }}>
      <button type="button"
        onClick={() => { setSlug(null); setService(null); setDays([]); setPick(null) }}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', cursor: 'pointer', padding: 0, marginBottom: 18 }}>
        ← ALL SESSIONS
      </button>
      <p style={{ fontSize: '1.15rem', marginBottom: 6 }}>{service.name}</p>
      <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', marginBottom: 26 }}>
        {price} · {service.duration_min} MIN{service.location ? ` · ${service.location.toUpperCase()}` : ''}
      </p>
      {/* what's included / what you receive — the same copy /book shows.
          Somebody deciding on a session needs this BEFORE the calendar, not
          after they have already picked a time. */}
      <div style={{ borderTop: `1px solid ${line}`, paddingTop: 20, marginBottom: 30 }}>
        <ServiceCopy copy={service.description} headingFont={MONO} />
      </div>
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
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <input placeholder="Your name" value={form.name} style={field}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input placeholder="Email" type="email" value={form.email} style={field}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <input placeholder="Phone" type="tel" inputMode="tel" autoComplete="tel"
              value={form.phone} style={field}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <textarea placeholder="What do you do? (optional)" rows={3} value={form.notes}
              style={{ ...field, resize: 'vertical', gridColumn: '1 / -1' }}
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
            disabled={busy || !agreed || !form.name.trim() || !form.email.trim() || !isUsablePhone(form.phone)}
            style={{
              marginTop: 20, background: '#fff', color: '#000', border: 'none',
              padding: '14px 26px', fontFamily: MONO, fontSize: 11, letterSpacing: '0.16em',
              cursor: busy ? 'default' : 'pointer', opacity: busy || !agreed || !form.name.trim() || !form.email.trim() || !isUsablePhone(form.phone) ? 0.4 : 1,
            }}>
            {busy ? 'HOLDING YOUR SEAT…' : `BOOK MY SEAT · ${price}`}
          </button>
        </>
      )}
    </div>
  )
}
