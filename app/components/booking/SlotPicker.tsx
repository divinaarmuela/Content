'use client'

import { useMemo, useState } from 'react'

/**
 * Pick a date and a time — a month calendar, not a list of every slot.
 *
 * A month of a working studio is ~250 openings. As chips that is a wall
 * nobody can read; as a calendar it is one glance to see which days are
 * free, and a short column of times for the day you chose. Shared by the
 * booking site and the events page so both stay the same thing.
 *
 * Palette comes from the caller via CSS custom properties, so it can sit on
 * the ink booking page or the events page without knowing about either.
 */

export type PickerSlot = { min: number; label: string; resource_id: string }
export type PickerDay = { day: string; slots: PickerSlot[] }

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
/** Monday-first column for a JS day index (0 = Sunday). */
const col = (jsDay: number) => (jsDay + 6) % 7

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export default function SlotPicker({
  days, value, onChange, ink, line, accentInk,
}: {
  days: PickerDay[]
  value: { day: string; slot: PickerSlot } | null
  onChange: (v: { day: string; slot: PickerSlot } | null) => void
  /** foreground colour */
  ink: string
  /** hairline / border colour */
  line: string
  /** text colour on a filled (selected) surface */
  accentInk: string
}) {
  const byDay = useMemo(() => new Map(days.map(d => [d.day, d.slots])), [days])
  const firstAvailable = days[0]?.day
  const [openDay, setOpenDay] = useState<string | null>(value?.day ?? null)

  // start the calendar on the month of the first day that has anything
  const [cursor, setCursor] = useState(() => {
    const base = firstAvailable ? new Date(`${firstAvailable}T00:00:00`) : new Date()
    return { y: base.getFullYear(), m: base.getMonth() }
  })

  const first = new Date(cursor.y, cursor.m, 1)
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const lead = col(first.getDay())
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  // is there anything at all before / after this month?
  const monthKey = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`
  const hasEarlier = days.some(d => d.day.slice(0, 7) < monthKey)
  const hasLater = days.some(d => d.day.slice(0, 7) > monthKey)
  const step = (n: number) => setCursor(c => {
    const d = new Date(c.y, c.m + n, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })

  const openSlots = openDay ? byDay.get(openDay) ?? [] : []
  const longDay = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  const navBtn: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${line}`, color: ink,
    width: 30, height: 30, cursor: 'pointer', lineHeight: 1, fontSize: 14,
  }

  return (
    // auto-fit rather than two fixed columns: on a phone the times drop
    // below the month instead of being squeezed beside it
    <div style={{ display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'start' }}>
      {/* ── the month ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button type="button" onClick={() => step(-1)} disabled={!hasEarlier}
            aria-label="Previous month"
            style={{ ...navBtn, opacity: hasEarlier ? 1 : 0.25, cursor: hasEarlier ? 'pointer' : 'default' }}>‹</button>
          <span style={{ flex: 1, textAlign: 'center', fontSize: '0.9rem' }}>
            {first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
          </span>
          <button type="button" onClick={() => step(1)} disabled={!hasLater}
            aria-label="Next month"
            style={{ ...navBtn, opacity: hasLater ? 1 : 0.25, cursor: hasLater ? 'pointer' : 'default' }}>›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {WEEKDAYS.map((d, i) => (
            <span key={i} style={{ textAlign: 'center', fontSize: 10, letterSpacing: '0.08em', opacity: 0.4, paddingBottom: 6 }}>
              {d}
            </span>
          ))}

          {cells.map((dayNum, i) => {
            if (dayNum === null) return <span key={i} />
            const key = iso(cursor.y, cursor.m, dayNum)
            const count = byDay.get(key)?.length ?? 0
            const free = count > 0
            const chosen = openDay === key
            return (
              <button
                key={i}
                type="button"
                disabled={!free}
                onClick={() => { setOpenDay(key); onChange(null) }}
                aria-label={free ? `${longDay(key)}, ${count} times` : `${longDay(key)}, unavailable`}
                style={{
                  aspectRatio: '1', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  border: `1px solid ${chosen ? ink : free ? line : 'transparent'}`,
                  background: chosen ? ink : 'transparent',
                  color: chosen ? accentInk : ink,
                  opacity: free ? 1 : 0.22,
                  cursor: free ? 'pointer' : 'default',
                  fontSize: '0.82rem', padding: 0,
                }}
              >
                {dayNum}
                {/* a dot says "something is open here" without shouting a number */}
                <span style={{
                  width: 3, height: 3, borderRadius: '50%',
                  background: free ? (chosen ? accentInk : ink) : 'transparent',
                  opacity: chosen ? 0.9 : 0.55,
                }} />
              </button>
            )
          })}
        </div>
      </div>

      {/* ── that day's times ── */}
      <div>
        {!openDay ? (
          <p style={{ fontSize: '0.85rem', opacity: 0.5, lineHeight: 1.6 }}>
            Pick a day to see what&rsquo;s open.
          </p>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: 12 }}>{longDay(openDay)}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
              {openSlots.map(s => {
                const on = value?.day === openDay && value?.slot.min === s.min
                return (
                  <button key={s.min} type="button"
                    onClick={() => onChange({ day: openDay, slot: s })}
                    style={{
                      border: `1px solid ${on ? ink : line}`,
                      background: on ? ink : 'transparent',
                      color: on ? accentInk : ink,
                      padding: '11px 8px', fontSize: '0.82rem', cursor: 'pointer',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                    {s.label}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
