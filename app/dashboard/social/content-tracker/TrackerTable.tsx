'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackerOrder, type TrackerInput, type TrackerLine, type TrackerStatus } from '../../../lib/content-tracker-core'

/**
 * THE TEAM'S SHEET, LIVE (the owner, 20 Oct 2026, pasting the Google sheet's columns). Required numbers, notes,
 * responsible and "In Asana" are typed here and saved as they are left; everything else is counted from what is
 * booked or posted.
 */

export type TrackerClient = { id: string; name: string; logo: string | null }

const STATUS_LOOK: Record<TrackerStatus, string> = {
  Complete: 'bg-accent-green/15 text-accent-green border-accent-green/40',
  'In progress': 'bg-accent-amber/15 text-amber-700 dark:text-amber-300 border-accent-amber/50',
  'Not started': 'bg-accent-red/10 text-accent-red border-accent-red/40',
  'No target set': 'bg-muted text-muted-foreground border-border',
}
const UNTIL = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })

export default function TrackerTable({ month, lines, clients, addable, loading, onSaved }: {
  month: string
  lines: TrackerLine[]
  clients: TrackerClient[]
  /** active clients not on the sheet yet: one is added by giving it a row */
  addable: { id: string; name: string }[]
  loading: boolean
  /** the server's answer changes the counts (Needed, Status): reload quietly */
  onSaved: () => void
}) {
  const byId = new Map(clients.map(c => [c.id, c]))
  const name = (id: string) => byId.get(id)?.name ?? 'Unknown client'
  const sorted = [...lines].sort((a, b) => trackerOrder(a, b, name))
  const done = lines.filter(l => l.status === 'Complete').length
  const targeted = lines.filter(l => l.status !== 'No target set').length

  const save = async (clientId: string, patch: TrackerInput) => {
    const res = await fetch('/api/content-tracker', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, month, ...patch }),
    }).catch(() => null)
    if (!res?.ok) { toast.error((await res?.json().catch(() => null))?.error ?? 'Could not save'); return }
    onSaved()
  }

  return (
    <section className="overflow-hidden rounded-inner border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-semibold">Deliverables</h2>
        <span className="text-[13px] text-muted-foreground">
          {targeted ? `${done} of ${targeted} clients complete` : 'Set each client’s required graphics and reels to track them'}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium">Client</th>
              <th className="px-2 py-2 text-center font-medium" colSpan={2}>Graphics<br /><span className="normal-case tracking-normal">required · scheduled</span></th>
              <th className="px-2 py-2 text-center font-medium" colSpan={2}>Reels<br /><span className="normal-case tracking-normal">required · scheduled</span></th>
              <th className="px-2 py-2 text-center font-medium">Stories</th>
              <th className="px-2 py-2 font-medium">Scheduled until</th>
              <th className="px-2 py-2 text-center font-medium">LinkedIn</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Needed</th>
              <th className="px-2 py-2 font-medium">Notes</th>
              <th className="px-2 py-2 font-medium">Responsible</th>
              <th className="px-3 py-2 text-center font-medium">In Asana</th>
            </tr>
          </thead>
          <tbody>
            {loading && lines.length === 0 ? (
              <tr><td colSpan={13} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={13} className="p-6 text-center text-muted-foreground">Nothing published through Zernio this month yet. Add a client below to set their targets.</td></tr>
            ) : sorted.map(l => {
              const c = byId.get(l.clientId)
              return (
                <tr key={l.clientId} className="border-t border-border align-middle hover:bg-muted/30">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Logo src={c?.logo ?? null} name={name(l.clientId)} />
                      <span className="max-w-[180px] truncate font-medium" title={name(l.clientId)}>{name(l.clientId)}</span>
                    </span>
                  </td>
                  <td className="px-1 py-2 text-center">
                    <NumberCell value={l.graphics.required} carried={l.carried} label={`Required graphics for ${name(l.clientId)}`}
                      onSave={v => save(l.clientId, { required_graphics: v })} />
                  </td>
                  <td className="px-2 py-2 text-center"><Count have={l.graphics.scheduled} need={l.graphics.required} /></td>
                  <td className="px-1 py-2 text-center">
                    <NumberCell value={l.reels.required} carried={l.carried} label={`Required reels for ${name(l.clientId)}`}
                      onSave={v => save(l.clientId, { required_reels: v })} />
                  </td>
                  <td className="px-2 py-2 text-center"><Count have={l.reels.scheduled} need={l.reels.required} /></td>
                  <td className="px-2 py-2 text-center tabular-nums">{l.stories || '–'}</td>
                  <td className="whitespace-nowrap px-2 py-2">{l.scheduledUntil ? UNTIL.format(new Date(l.scheduledUntil)) : '–'}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{l.linkedin || '–'}</td>
                  <td className="px-2 py-2">
                    <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold', STATUS_LOOK[l.status])}>{l.status}</span>
                  </td>
                  <td className="px-2 py-2 text-[12px]">{l.needed ?? (l.status === 'Complete' ? <Check className="h-4 w-4 text-accent-green" aria-label="Nothing needed" /> : '–')}</td>
                  <td className="px-1 py-2"><TextCell value={l.notes} wide label={`Notes for ${name(l.clientId)}`} onSave={v => save(l.clientId, { notes: v })} /></td>
                  <td className="px-1 py-2"><TextCell value={l.responsible} label={`Who is responsible for ${name(l.clientId)}`} onSave={v => save(l.clientId, { responsible: v })} /></td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={l.inAsana} aria-label={`${name(l.clientId)} is in Asana`}
                      onChange={e => void save(l.clientId, { in_asana: e.target.checked })}
                      className="h-4 w-4 cursor-pointer accent-foreground" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2">
        <p className="max-w-3xl text-[12px] text-muted-foreground">
          Scheduled counts the client’s posts in Zernio for this month, already published or still waiting to go; a post on several networks counts once. Posts the client puts up themselves are not counted.
          Scheduled until is their last post waiting in Zernio. Required numbers carry over from last month until changed (grey).
        </p>
        {addable.length > 0 && (
          <select value="" aria-label="Add a client to the sheet"
            onChange={e => { if (e.target.value) void save(e.target.value, { in_asana: false }) }}
            className="h-9 rounded-full border border-border bg-surface px-3 text-[13px]">
            <option value="">+ Add a client</option>
            {addable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
    </section>
  )
}

function Count({ have, need }: { have: number; need: number | null }) {
  const tone = need === null ? '' : have >= need ? 'text-accent-green' : have === 0 ? 'text-accent-red' : 'text-amber-700 dark:text-amber-300'
  return <span className={cn('text-[15px] font-semibold tabular-nums', tone)}>{have}</span>
}

function NumberCell({ value, carried, label, onSave }: { value: number | null; carried: boolean; label: string; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => { setText(value === null ? '' : String(value)) }, [value])
  const commit = () => {
    const next = text.trim() === '' ? null : Math.max(0, Math.round(Number(text)))
    if (next !== null && !Number.isFinite(next)) { setText(value === null ? '' : String(value)); return }
    if (next !== value || carried) onSave(next)
  }
  return (
    <input value={text} inputMode="numeric" aria-label={label} placeholder="–"
      onChange={e => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={cn('h-8 w-12 rounded-md border border-transparent bg-transparent text-center tabular-nums hover:border-border focus:border-foreground focus:outline-none',
        carried && 'text-muted-foreground')} />
  )
}

function TextCell({ value, wide, label, onSave }: { value: string; wide?: boolean; label: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])
  return (
    <input value={text} aria-label={label} placeholder="–" title={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== value.trim()) onSave(text) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={cn('h-8 rounded-md border border-transparent bg-transparent px-2 hover:border-border focus:border-foreground focus:outline-none',
        wide ? 'w-56' : 'w-36')} />
  )
}

function Logo({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{name.charAt(0).toUpperCase()}</span>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setBroken(true)} className="h-6 w-6 shrink-0 rounded-full object-cover" />
}
