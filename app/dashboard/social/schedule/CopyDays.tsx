'use client'

import { useEffect, useMemo, useState } from 'react'
import { dayKeyInZone, formatInZone } from '@/app/lib/timezone-core'
import { utcToZoned, zonedToUtc } from '@/app/lib/booking-core'
import { copiesKeepApproval, copyDayChoices, copyTimes, type Answers } from '@/app/lib/post-window-core'

/**
 * DUPLICATE: TICK THE DAYS (the owner, 23 Nov 2026: "please make it easy"; Renee: the same story every day for a week).
 * Fourteen day buttons with tomorrow already ticked, one time of day (the original's own, changeable), and, when the
 * original has been approved, one choice: the copies start as drafts, or they keep the approval and are booked in.
 */
export default function CopyDays({ tz, copy, chosen, onChange }: {
  tz: string
  copy: { at: string | null; nowMs: number; mayKeep: boolean }
  /** what somebody picked for the copies; undefined until they pick */
  chosen: boolean | undefined
  onChange: (patch: Partial<Answers>) => void
}) {
  // BOOKED IN UNLESS TOLD OTHERWISE (the owner, 25 Nov 2026 — see copiesKeepApproval)
  const keep = copiesKeepApproval(chosen, copy.mayKeep)
  const days = useMemo(() => copyDayChoices(copy.nowMs, tz, (t, z) => dayKeyInZone(t, z)), [copy.nowMs, tz])
  const [picked, setPicked] = useState<string[]>(() => days.slice(0, 1))
  // the original's own time of day; a post with no time yet starts at nine in the morning
  const [minutes, setMinutes] = useState<number>(() => (copy.at ? utcToZoned(new Date(copy.at), tz).minutes : 9 * 60))
  useEffect(() => {
    // the answer always says what the copies start as, so the default is what is sent, not only what is shown
    onChange({ copies: copyTimes(picked, minutes, tz, zonedToUtc), keep_approval: copiesKeepApproval(chosen, copy.mayKeep) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the answer follows the ticks and the time, nothing else
  }, [picked, minutes, tz])
  const toggle = (d: string) => setPicked(p => (p.includes(d) ? p.filter(x => x !== d) : [...p, d]))
  const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  const choice = 'inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] font-semibold'
  return (
    <div className="flex flex-col gap-3" data-copy-days>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days the copies go out">
        {days.map(d => {
          const on = picked.includes(d)
          const at = zonedToUtc(d, 12 * 60, tz)
          return (
            <button key={d} type="button" aria-pressed={on} onClick={() => toggle(d)}
              className={`${choice} ${on ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface text-foreground'}`}>
              {at ? formatInZone(at.toISOString(), tz, 'date') : d}
            </button>
          )
        })}
      </div>
      <label className="flex w-fit items-center gap-2 text-[13px] font-semibold">
        At
        <input type="time" value={hhmm} step={300} aria-label="Time of day for the copies"
          onChange={e => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isFinite(h) && Number.isFinite(m)) setMinutes(h * 60 + m) }}
          className="h-11 rounded-full border border-border bg-surface px-3 text-[13px]" />
        <span className="font-normal text-muted-foreground">{picked.length === 0 ? 'No days ticked' : picked.length === 1 ? '1 copy' : `${picked.length} copies`}</span>
      </label>
      {copy.mayKeep && (
        <div className="flex flex-col gap-1.5" role="group" aria-label="What the copies need">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={keep} onClick={() => onChange({ keep_approval: true })}
              className={`${choice} ${keep ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface text-foreground'}`}>Keep the approval and book them</button>
            <button type="button" aria-pressed={!keep} onClick={() => onChange({ keep_approval: false })}
              className={`${choice} ${!keep ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface text-foreground'}`}>Start as drafts</button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {keep
              ? 'The copies are booked in as they are, with no new check. Change one afterwards and it goes back for approval.'
              : 'The copies go through the usual checks before they can go out.'}
          </p>
        </div>
      )}
    </div>
  )
}
