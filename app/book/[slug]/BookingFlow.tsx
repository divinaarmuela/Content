'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ServiceCopy from '../../components/booking/ServiceCopy'
import EmbeddedPayment from '../../components/booking/EmbeddedPayment'
import CancellationPolicy from '../../components/booking/CancellationPolicy'
import SlotPicker from '../../components/booking/SlotPicker'
import { isUsablePhone } from '../../lib/booking-core'

/**
 * The customer's side of a booking: pick a day, pick a time, leave details.
 *
 * Deliberately one screen with three quiet steps rather than a wizard — the
 * whole job is "when suits you", and every extra click loses someone. Slots
 * are re-checked by the server on submit, so a stale page can never book a
 * time that has gone.
 */

type Slot = { min: number; label: string; resource_id: string }
type DaySlots = { day: string; slots: Slot[] }
type Service = {
  name: string; slug: string; description: string | null
  duration_min: number; price_cents: number; currency: string
  requires_payment: boolean
  image_url: string | null; location: string | null; category: string | null
}

/** "90" -> "1 hr 30 min" */
const durationLabel = (min: number) => {
  const h = Math.floor(min / 60); const m = min % 60
  if (h && m) return `${h} hr ${m} min`
  if (h) return `${h} hr`
  return `${m} min`
}

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
const longDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

export default function BookingFlow({ slug }: { slug: string }) {
  const [service, setService] = useState<Service | null>(null)
  const [days, setDays] = useState<DaySlots[]>([])
  const [loading, setLoading] = useState(true)
  const [gone, setGone] = useState(false)
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', company: '' })
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ ref: string; start_at: string } | null>(null)
  /** set once the slot is held and Stripe is ready to take the money */
  const [payment, setPayment] = useState<{ clientSecret: string; when: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/booking/public/slots?slug=${encodeURIComponent(slug)}&days=21`)
      if (!res.ok) { setGone(true); return }
      const json = await res.json()
      setService(json.service)
      setDays(json.availability ?? [])
      setPickedDay(d => d ?? json.availability?.[0]?.day ?? null)
    } catch {
      setGone(true)
    } finally {
      setLoading(false)
    }
  }, [slug])
  useEffect(() => { void load() }, [load])

  const slotsForDay = useMemo(
    () => days.find(d => d.day === pickedDay)?.slots ?? [],
    [days, pickedDay],
  )

  const price = service && service.price_cents > 0
    ? `${service.currency === 'AUD' ? 'A$' : `${service.currency} $`}${(service.price_cents / 100).toFixed(2)}`
    : 'Free'

  const submit = async () => {
    if (!pickedSlot || !pickedDay || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/booking/public/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, day: pickedDay, min: pickedSlot.min, policy_agreed: agreed, ...form }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not book that time')
        // the slot list is stale the moment someone else books — refresh it
        if (res.status === 409) { setPickedSlot(null); void load() }
        return
      }
      // a paid service holds the slot, then shows the payment form in place.
      // Confirmation comes from the webhook, never from the return page.
      if (json.requires_payment) {
        const pay = await fetch('/api/booking/public/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: json.ref }),
        })
        const payJson = await pay.json()
        if (pay.ok && payJson.client_secret) {
          setPayment({ clientSecret: payJson.client_secret, when: json.start_at })
          return
        }
        setError(payJson.error ?? 'Could not start payment')
        return
      }
      setDone({ ref: json.ref, start_at: json.start_at })
    } catch {
      setError('Network problem — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p style={{ opacity: 0.6 }} className="py-16 text-center text-sm">Loading available times…</p>
  }
  if (gone || !service) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg">This booking link isn&rsquo;t available.</p>
        <p className="mt-2 text-sm opacity-60">It may have been switched off. Try mdmmarketing.com.au.</p>
      </div>
    )
  }

  if (payment) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.5 }}>Almost done</p>
          <h2 className="text-2xl font-medium tracking-tight">{service.name}</h2>
          <p className="text-sm" style={{ opacity: 0.7 }}>
            {new Date(payment.when).toLocaleString('en-AU', {
              weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
            })} · {price}
          </p>
          <p className="mt-1 text-xs" style={{ opacity: 0.55 }}>
            Your time is held for 30 minutes while you pay.
          </p>
        </div>
        <EmbeddedPayment clientSecret={payment.clientSecret} />
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4 border p-6" style={{ borderColor: 'var(--bk-line)' }}>
        <p className="text-xs uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>Confirmed</p>
        <h2 className="text-2xl font-medium tracking-tight">You&rsquo;re booked in</h2>
        <p className="text-sm leading-relaxed">
          {service.name} — <strong>{new Date(done.start_at).toLocaleString('en-AU', {
            weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
          })}</strong>
        </p>
        <p className="text-sm" style={{ opacity: 0.7 }}>
          A confirmation is on its way to {form.email}. Your reference is{' '}
          <span className="font-mono">{done.ref}</span>.
        </p>
        <a href={`/book/manage/${done.ref}`}
          className="w-fit border px-4 py-2 text-[11px] uppercase tracking-[0.14em] transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--bk-line)' }}>
          Move or cancel this booking
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        {service.image_url && (
          /* No forced aspect ratio: object-cover on a 16:9 box crops whatever
             shape the photo actually is, which is how a head ends up cut off.
             The image keeps its own proportions, capped so a tall portrait
             cannot take over the page. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={service.image_url} alt={service.name}
            className="w-full max-h-[540px] object-contain"
            style={{ background: 'rgba(249,244,235,0.04)' }} />
        )}
        <div className="flex flex-col gap-2">
          {service.category && (
            <p className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.5 }}>{service.category}</p>
          )}
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{service.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em]"
            style={{ opacity: 0.6 }}>
            <span>{price}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{durationLabel(service.duration_min)}</span>
            {service.location && <><span style={{ opacity: 0.5 }}>·</span><span>{service.location}</span></>}
          </p>
        </div>
        {service.description && (
          <div className="border-t pt-4" style={{ borderColor: 'var(--bk-line)' }}>
            <ServiceCopy copy={service.description} />
          </div>
        )}
      </header>

      {days.length === 0 ? (
        <p className="border p-6 text-sm" style={{ borderColor: 'var(--bk-line)', opacity: 0.75 }}>
          No times are open at the moment. Email{' '}
          <a href="mailto:contact@mdmmarketing.com.au" className="underline">contact@mdmmarketing.com.au</a>{' '}
          and we&rsquo;ll find one.
        </p>
      ) : (
        <>
          {/* ── when ── */}
          <section className="flex flex-col gap-4">
            <h2 className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>1 · Choose a time</h2>
            <SlotPicker
              days={days}
              value={pickedDay && pickedSlot ? { day: pickedDay, slot: pickedSlot } : null}
              onChange={v => { setPickedDay(v?.day ?? null); setPickedSlot(v?.slot ?? null) }}
              ink="var(--bk-ink)"
              line="var(--bk-line)"
              accentInk="var(--bk-bg)"
            />
          </section>

          {/* ── details ── */}
          {pickedSlot && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>2 · Your details</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs" style={{ opacity: 0.8 }}>
                  Name
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="border bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--bk-line)' }} autoComplete="name" />
                </label>
                <label className="flex flex-col gap-1 text-xs" style={{ opacity: 0.8 }}>
                  Email
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="border bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--bk-line)' }} autoComplete="email" />
                </label>
                <label className="flex flex-col gap-1 text-xs sm:col-span-2" style={{ opacity: 0.8 }}>
                  Phone
                  <input type="tel" inputMode="tel" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="border bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--bk-line)' }} autoComplete="tel" />
                </label>
                <label className="flex flex-col gap-1 text-xs sm:col-span-2" style={{ opacity: 0.8 }}>
                  Anything we should know? <span style={{ opacity: 0.6 }}>(optional)</span>
                  <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="resize-y border bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--bk-line)' }} />
                </label>
              </div>

              {/* bots fill everything; people never see this */}
              <input tabIndex={-1} autoComplete="off" aria-hidden="true"
                value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }} />

              <CancellationPolicy agreed={agreed} onAgreedChange={setAgreed} />

              {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

              <button type="button" onClick={() => void submit()}
                disabled={busy || !agreed || !form.name.trim() || !form.email.trim() || !isUsablePhone(form.phone)}
                className="w-fit px-6 py-3 text-[11px] uppercase tracking-[0.16em] transition-opacity disabled:opacity-40"
                style={{ background: 'var(--bk-ink)', color: 'var(--bk-bg)' }}>
                {busy ? 'Booking…' : `Book ${dayLabel(pickedDay!)} at ${pickedSlot.label}`}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  )
}
