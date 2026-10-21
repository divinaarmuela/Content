'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import type { Client, ContentItem, DriveSeen } from '@/lib/db-types'
import { KIND_WORDS, STATE_WORDS, type CutKind, type SeenState } from '../../../../lib/drive-scan-core'
import PreviewFrame, { AiScanning, usePreviewAccess } from '../PreviewFrame'

/**
 * THE NEW EDITOR — AI SCANS (preview). Every file the minute check found in any card's Drive links, newest first:
 * what it is, what the AI said, and where it stands. One place to see that the AI is looking, and what it decided.
 */
const FILTERS: { key: string; label: string; states: SeenState[] | null }[] = [
  { key: 'open', label: 'Needs a look', states: ['new', 'scanning', 'scanned', 'failed'] },
  { key: 'waiting', label: 'Waiting', states: ['locked'] },
  { key: 'all', label: 'Everything', states: null },
]

export default function EditorPreviewScans() {
  const { allowed } = usePreviewAccess()
  const seen = useTable<DriveSeen>('drive_seen', { enabled: allowed })
  const items = useTable<ContentItem>('content_items', { enabled: allowed })
  const clients = useTable<Client>('clients', { enabled: allowed })
  const [filter, setFilter] = useState('open')
  const itemById = useMemo(() => new Map(items.rows.map(i => [i.id, i])), [items.rows])
  const clientName = useMemo(() => new Map(clients.rows.map(c => [c.id, c.name])), [clients.rows])
  const f = FILTERS.find(x => x.key === filter)!
  const rows = useMemo(() => seen.rows
    .filter(r => !f.states || (f.states as string[]).includes(r.state))
    .sort((a, b) => b.first_seen_at.localeCompare(a.first_seen_at))
    .slice(0, 300), [seen.rows, f])
  const scanning = seen.rows.filter(r => r.state === 'new' || r.state === 'scanning').length

  return (
    <PreviewFrame>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(x => (
          <button key={x.key} type="button" onClick={() => setFilter(x.key)} aria-pressed={filter === x.key}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${filter === x.key ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{x.label}</button>
        ))}
        <AiScanning n={scanning} className="ml-auto" />
      </div>
      {seen.loading ? null : rows.length === 0 && <p className="text-[14px] text-muted-foreground">Nothing here. Files appear as soon as the check finds them in a card’s Drive links.</p>}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map(r => {
          const item = itemById.get(r.item_id)
          const scan = (r.scan ?? null) as { kind?: CutKind; confidence?: number; model?: string } | null
          const busy = r.state === 'new' || r.state === 'scanning'
          return (
            <li key={r.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold" title={r.path}>{r.path}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {item ? <Link href={`/dashboard/editor/preview/${item.id}`} className="hover:underline">{clientName.get(String(item.client_id)) ?? 'No client'} · {item.title}</Link> : 'A card no longer here'}
                  {' · '}{new Date(r.first_seen_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                  {r.last_modifying_user ? ` · by ${r.last_modifying_user}` : ''}
                </p>
              </div>
              {scan?.kind && <span className="text-[13px]"><b>{KIND_WORDS[scan.kind]}</b>{typeof scan.confidence === 'number' ? <span className="text-muted-foreground"> · {Math.round(scan.confidence * 100)}%</span> : null}</span>}
              <span className={`inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2 py-0.5 text-[12px] font-semibold sm:self-auto ${busy ? 'bg-accent-blue/15 text-accent-blue-deep' : r.state === 'scanned' ? 'bg-tint-amber' : 'bg-muted text-muted-foreground'}`}>
                {busy && <Sparkles className="h-3 w-3 animate-pulse" aria-hidden />}{r.state === 'locked' && <Lock className="h-3 w-3" aria-hidden />}
                {STATE_WORDS[r.state as SeenState] ?? r.state}
              </span>
            </li>
          )
        })}
      </ul>
    </PreviewFrame>
  )
}
