'use client'

import { useCallback, useEffect, useState } from 'react'
import Chip from '../ui/Chip'
import TintCard from '../ui/TintCard'
import PlatformIcon from '../social/PlatformIcon'
import type { TodayState } from '../../lib/today-posts-core'

type Row = {
  id: string
  client_id: string
  client: string
  at: string | null
  caption: string
  media: { images: number; videos: number; thumb: string | null }
  platforms: { platform: string; account: string | null; kind: string; status: string | null; url: string | null; error: string | null }[]
  state: TodayState
  madeBy: string | null
  approvedBy: string | null
  bookedBy: string | null
  bookedAt: string | null
  zernio: { checked: boolean; status: string | null } | null
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' }) : '—'
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null
const platformWord = (p: string) => ({ instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', twitter: 'X', threads: 'Threads', pinterest: 'Pinterest' }[p] ?? p)
const statusWord = (s: string | null) => {
  if (!s) return null
  if (/publish|posted|live/i.test(s)) return 'live'
  if (/fail|error/i.test(s)) return 'failed'
  if (/pending|scheduled/i.test(s)) return 'waiting'
  return s
}

/**
 * TODAY — every post going out today, latest time first (the owner, 4 Nov
 * 2026): what it is and where, whether it still needs approval or is booked,
 * who made, approved and booked it, and what Zernio says right now.
 */
export default function TodayPanel({ clientId, asColumn, onCount }: {
  clientId: string
  /** drawn as the board's last column (12 Nov 2026, the owner: "a going out today kind of column"), not a card on top */
  asColumn?: boolean
  onCount?: (n: number) => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/social/today', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load today')
      setRows(json.rows)
      setCheckedAt(json.checkedAt)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load today')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [load])

  const shown = (rows ?? []).filter(r => !clientId || r.client_id === clientId)
  const needs = shown.filter(r => r.state.needsAction).length
  const count = rows === null ? null : shown.length
  useEffect(() => { if (count !== null) onCount?.(count) }, [count, onCount])
  const title = rows === null ? 'Going out today'
    : shown.length === 0 ? 'Nothing going out today'
    : `Going out today · ${shown.length} post${shown.length === 1 ? '' : 's'}${needs ? ` · ${needs} need${needs === 1 ? 's' : ''} you` : ''}`

  const wrap = (children: React.ReactNode) => asColumn
    ? <div className="flex min-h-[120px] flex-col gap-2.5" data-today-column>{needs > 0 && <p className="rounded-inner bg-tint-amber px-3 py-2 text-[13px] font-semibold">{needs} need{needs === 1 ? 's' : ''} you</p>}{children}</div>
    : <TintCard tone={needs > 0 ? 'amber' : 'surface'} title={title}>{children}</TintCard>
  return wrap(
    <>
      <div className={`${asColumn ? '' : '-mt-2 '}flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground`}>
        <span>Latest time first · status checked{checkedAt ? ` at ${time(checkedAt)}` : ''}</span>
        <button type="button" onClick={load} disabled={busy}
          className="inline-flex min-h-9 items-center font-semibold text-foreground underline-offset-4 hover:underline disabled:opacity-50">
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {error && <p role="alert" className="text-[13px] font-medium text-foreground">{error}</p>}
      {rows === null && !error && <p className="text-[13px] text-muted-foreground">Checking today’s posts…</p>}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {shown.map(r => (
            <li key={r.id}>
              <a href={`/dashboard/scheduler?post=${r.id}`}
                className="flex gap-3 rounded-inner border border-border bg-surface p-3 hover:border-foreground/30">
                <div className="flex w-16 shrink-0 flex-col items-start gap-1.5">
                  <span className="text-[17px] font-semibold tabular-nums text-foreground">{time(r.at)}</span>
                  {r.media.thumb
                    ? <img src={r.media.thumb} alt="" className="h-16 w-16 rounded-md object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                    : <span className="flex h-16 w-16 items-center justify-center rounded-md bg-foreground/[0.06] text-[11px] text-muted-foreground">{r.media.videos ? 'Video' : 'Text'}</span>}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-foreground">{r.client}</span>
                    <Chip tone={r.state.tone}>{r.state.label}</Chip>
                  </div>
                  {r.caption && <p className="line-clamp-1 text-[13px] text-foreground">{r.caption}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {r.platforms.map((p, i) => {
                      const st = statusWord(p.status)
                      return (
                        <span key={i} title={p.error ?? undefined}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[12px] text-foreground">
                          <PlatformIcon platform={p.platform} size={14} />
                          {platformWord(p.platform)} {p.kind}
                          {st && <span className={st === 'failed' ? 'font-semibold text-red-600' : st === 'live' ? 'font-semibold' : 'text-muted-foreground'}>· {st}</span>}
                        </span>
                      )
                    })}
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {[
                      r.madeBy && `Made by ${r.madeBy}`,
                      r.approvedBy && `approved by ${r.approvedBy}`,
                      r.bookedBy && `booked by ${r.bookedBy}${r.bookedAt ? ` (${when(r.bookedAt)})` : ''}`,
                    ].filter(Boolean).join(' · ') || 'Nobody has booked it yet'}
                    {r.zernio && !r.zernio.checked && ' · status could not be checked, try again'}
                    {!r.zernio && !r.state.needsAction && r.state.label !== 'Posted' && ' · not sent for publishing yet'}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      {asColumn && rows !== null && shown.length === 0 && !error && (
        <div className="rounded-inner border border-dashed border-border px-3 py-7 text-center text-[13px] text-muted-foreground">Nothing going out today.</div>
      )}
    </>,
  )
}
