'use client'

import { useState } from 'react'
import { CAL_TZ } from '../../lib/gcal-core'
import type { ShootStatus } from '../../lib/shoot-core'

/**
 * Yes / No, in the same dark visual world as the intake form. A cancelled
 * proposal reads as no longer available; an answered one shows the current
 * answer and still lets them change it — plans change, and a stale "yes"
 * nobody can retract is worse than a changed one the team hears about.
 */
export default function ShootAnswer({
  token, clientName, title, startsAt, endsAt, location, note, initialStatus,
}: {
  token: string
  clientName: string
  title: string
  startsAt: string
  endsAt: string
  location: string | null
  note: string | null
  initialStatus: ShootStatus
}) {
  const [status, setStatus] = useState<ShootStatus>(initialStatus)
  const [sending, setSending] = useState<'yes' | 'no' | null>(null)
  const [error, setError] = useState('')

  const day = new Date(startsAt).toLocaleDateString('en-AU', {
    timeZone: CAL_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', { timeZone: CAL_TZ, hour: 'numeric', minute: '2-digit' })

  const answer = async (a: 'yes' | 'no') => {
    if (sending) return
    setSending(a)
    setError('')
    try {
      const res = await fetch(`/api/shoot/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: a }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      setStatus(json.status as ShootStatus)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again')
    } finally {
      setSending(null)
    }
  }

  const pill = (a: 'yes' | 'no', label: string, active: boolean) => (
    <button
      type="button"
      onClick={() => void answer(a)}
      disabled={sending !== null}
      className={
        'rounded-full px-8 py-4 font-lamam text-[12px] font-bold uppercase tracking-widest transition-opacity ' +
        'disabled:opacity-50 ' +
        (a === 'yes'
          ? active
            ? 'bg-cream text-ink'
            : 'bg-cream text-ink hover:opacity-85'
          : active
            ? 'border border-cream/60 bg-transparent text-cream'
            : 'border border-cream/30 bg-transparent text-cream-dim hover:border-cream/60 hover:text-cream')
      }
    >
      {sending === a ? '…' : label}
    </button>
  )

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 py-16 text-cream">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/MDLogo-trim.png" alt="MD Media" className="mb-12 h-6 w-auto" />

      <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-faint">
        Shoot proposal{clientName ? ` · ${clientName}` : ''}
      </p>

      <h1 className="mt-5 max-w-[22ch] text-center font-lamah text-[30px] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        {title}
      </h1>

      <div className="mt-8 flex flex-col items-center gap-1.5 text-center">
        <p className="font-lamah text-[18px] text-cream">{day}</p>
        <p className="font-lamam text-[12px] uppercase tracking-widest text-cream-dim">
          {time(startsAt)} – {time(endsAt)} · Melbourne time
        </p>
        {location && <p className="mt-1 font-lamah text-[15px] text-cream-dim">{location}</p>}
      </div>

      {note && (
        <p className="mt-6 max-w-[48ch] text-center font-lamah text-[15px] leading-relaxed text-cream-dim">
          {note}
        </p>
      )}

      {status === 'cancelled' ? (
        <p className="mt-10 max-w-[40ch] text-center font-lamam text-[12px] uppercase tracking-widest leading-relaxed text-cream-faint">
          This proposal is no longer active — we&rsquo;ll be in touch with a new date.
        </p>
      ) : (
        <>
          {status !== 'pending' && (
            <p className="mt-10 font-lamam text-[11px] uppercase tracking-widest text-cream">
              {status === 'accepted'
                ? 'Locked in ✓ — a calendar invite is on its way to your inbox'
                : 'Noted — we’ll propose another date'}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            {pill('yes', status === 'accepted' ? 'Yes — confirmed' : 'Yes, works for us', status === 'accepted')}
            {pill('no', status === 'declined' ? 'No — declined' : 'No, that doesn’t work', status === 'declined')}
          </div>
          {status !== 'pending' && (
            <p className="mt-5 font-lamah text-[13px] text-cream-faint">
              Changed your mind? Just answer again — we&rsquo;ll get the update.
            </p>
          )}
          {error && <p className="mt-5 font-lamam text-[12px] tracking-widest text-[#E2725B]">{error}</p>}
        </>
      )}
    </div>
  )
}
