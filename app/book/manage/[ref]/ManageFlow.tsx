'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * A customer moving or cancelling their own booking, using the reference
 * from their confirmation email. No login: the reference is the key, and it
 * only ever opens this one booking.
 */

type Slot = { min: number; label: string; resource_id: string }
type DaySlots = { day: string; slots: Slot[] }
type Loaded = {
  booking: { ref: string; status: string; start_at: string; customer_name: string }
  service: { name: string; duration_min: number }
  resource: { label: string }
  availability: DaySlots[]
}

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })

export default function ManageFlow({ bookingRef }: { bookingRef: string }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<'moved' | 'cancelled' | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  // Stripe returns here after payment. Landing on a page headed "your
  // booking" with cancel controls reads like an admin screen rather than
  // "that worked" — so say the thing they came here to hear, first.
  const justPaid = useSearchParams().get('paid') === '1'

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/booking/public/manage?ref=${encodeURIComponent(bookingRef)}`)
      if (!res.ok) { setMissing(true); return }
      const json = await res.json()
      setData(json)
      setPickedDay(d => d ?? json.availability?.[0]?.day ?? null)
    } catch { setMissing(true) }
  }, [bookingRef])
  useEffect(() => { void load() }, [load])

  const act = async (payload: Record<string, unknown>) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/booking/public/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: bookingRef, ...payload }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'That did not work'); if (res.status === 409) void load(); return }
      setOutcome(payload.action === 'cancel' ? 'cancelled' : 'moved')
      void load()
    } catch {
      setError('Network problem — try again')
    } finally { setBusy(false) }
  }

  if (missing) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg">We couldn&rsquo;t find that booking.</p>
        <p className="mt-2 text-sm" style={{ opacity: 0.6 }}>
          Check the link in your confirmation email, or contact us.
        </p>
      </div>
    )
  }
  if (!data) return <p className="py-16 text-center text-sm" style={{ opacity: 0.6 }}>Loading…</p>

  const cancelled = data.booking.status === 'cancelled'

  return (
    <div className="flex flex-col gap-8">
      {justPaid && !cancelled && (
        <div className="flex flex-col gap-2 border p-5" style={{ borderColor: 'var(--bk-line)' }}>
          <p className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>Payment received</p>
          <p className="text-2xl font-medium tracking-tight">You&rsquo;re booked in</p>
          <p className="text-sm leading-relaxed" style={{ opacity: 0.75 }}>
            A confirmation is on its way to your inbox. Keep this page — it&rsquo;s
            where you can move or cancel your booking later.
          </p>
        </div>
      )}

      <header className="flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>
          {justPaid ? 'The details' : 'Your booking'}
        </p>
        <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">{data.service.name}</h1>
        <p className="text-sm" style={{ opacity: cancelled ? 0.5 : 1, textDecoration: cancelled ? 'line-through' : 'none' }}>
          {stamp(data.booking.start_at)} · with {data.resource.label}
        </p>
        <p className="font-mono text-[11px]" style={{ opacity: 0.5 }}>Ref {data.booking.ref}</p>
      </header>

      {outcome === 'cancelled' || cancelled ? (
        <p className="border p-6 text-sm" style={{ borderColor: 'var(--bk-line)' }}>
          This booking is cancelled. Nothing further is needed — book again any time.
        </p>
      ) : (
        <>
          {outcome === 'moved' && (
            <p className="border p-4 text-sm" style={{ borderColor: 'var(--bk-line)' }}>
              Moved. A confirmation with the new time is on its way.
            </p>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.55 }}>Move it</h2>
            {data.availability.length === 0 ? (
              <p className="text-sm" style={{ opacity: 0.7 }}>No other times are open — email us and we&rsquo;ll sort it.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {data.availability.map(d => (
                    <button key={d.day} type="button" onClick={() => setPickedDay(d.day)}
                      className="border px-3 py-2 text-xs transition-colors"
                      style={d.day === pickedDay
                        ? { borderColor: 'var(--bk-ink)', background: 'var(--bk-ink)', color: 'var(--bk-bg)' }
                        : { borderColor: 'var(--bk-line)' }}>
                      {dayLabel(d.day)}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(data.availability.find(d => d.day === pickedDay)?.slots ?? []).map(s => (
                    <button key={s.min} type="button" disabled={busy}
                      onClick={() => void act({ action: 'move', day: pickedDay, min: s.min })}
                      className="border px-3 py-2 font-mono text-xs transition-opacity hover:opacity-70 disabled:opacity-40"
                      style={{ borderColor: 'var(--bk-line)' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

          <section className="flex flex-col gap-2 border-t pt-6" style={{ borderColor: 'var(--bk-line)' }}>
            {confirmCancel ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">Cancel this booking?</span>
                <button type="button" disabled={busy} onClick={() => void act({ action: 'cancel' })}
                  className="px-4 py-2 text-[11px] uppercase tracking-[0.14em]"
                  style={{ background: '#b91c1c', color: '#fff' }}>
                  {busy ? 'Cancelling…' : 'Yes, cancel it'}
                </button>
                <button type="button" onClick={() => setConfirmCancel(false)}
                  className="text-[11px] uppercase tracking-[0.14em]" style={{ opacity: 0.6 }}>
                  Keep it
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmCancel(true)}
                className="w-fit text-[11px] uppercase tracking-[0.14em] transition-opacity hover:opacity-100"
                style={{ opacity: 0.6 }}>
                Cancel this booking
              </button>
            )}
          </section>
        </>
      )}
    </div>
  )
}
