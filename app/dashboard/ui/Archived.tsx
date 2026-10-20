'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Archive, ArchiveRestore } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { archiveWords, type ArchiveKind } from '../../lib/archive-core'

/**
 * ARCHIVE, THE SHARED HALF ON SCREEN (the owner, 20 Oct 2026: "so we dont have to see it in the page and its clean …
 * the page so we can unarchive things"). Every page that archives — Shoots, Editor, Designer, Boards — uses the same
 * three pieces: the call, the "Archived (n)" switch by the page title, and the archived list with Bring back.
 */

/** Archive (or bring back) one shoot, card or board. True when it worked; the live lists move it by themselves. */
export async function setArchived(kind: ArchiveKind, id: string, archive: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/production/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, id, archive }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error ?? 'Could not do that')
    toast.success(archiveWords(kind, !archive).done)
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not do that')
    return false
  }
}

/** "Archived (3)" — switches the page between its live list and what was put away */
export function ArchivedToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <Button variant="outline" onClick={onToggle} aria-pressed={open}
      className={`h-11 rounded-full border-border px-4 text-[14px] font-semibold ${open ? 'bg-foreground text-background hover:bg-foreground/90 hover:text-background' : 'bg-surface'}`}>
      <Archive className="h-4 w-4" aria-hidden />
      {open ? 'Back to the page' : `Archived${count ? ` (${count})` : ''}`}
    </Button>
  )
}

export type ArchivedRow = { id: string; title: string; client?: string | null; archived_at?: string | null; note?: string | null }

/** what was put away, newest first, each with Bring back */
export function ArchivedList({ kind, rows, mayRestore = () => true, empty }: {
  kind: ArchiveKind
  rows: ArchivedRow[]
  mayRestore?: (row: ArchivedRow) => boolean
  empty: string
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const sorted = [...rows].sort((a, b) => String(b.archived_at ?? '').localeCompare(String(a.archived_at ?? '')))
  if (sorted.length === 0) {
    return <p className="rounded-card border border-border bg-surface px-6 py-12 text-center text-[15px] text-muted-foreground">{empty}</p>
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Archived">
      {sorted.map(r => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            {r.client && <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{r.client}</p>}
            <p className="truncate text-[15px] font-semibold">{r.title || 'Untitled'}</p>
            <p className="text-[13px] text-muted-foreground">
              {r.archived_at ? `Archived ${new Date(r.archived_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Archived'}
              {r.note ? ` · ${r.note}` : ''}
            </p>
          </div>
          {mayRestore(r) && (
            <Button variant="outline" disabled={busy === r.id}
              className="h-11 rounded-full border-border bg-surface px-4 text-[14px] font-semibold"
              onClick={async () => { setBusy(r.id); await setArchived(kind, r.id, false); setBusy(null) }}>
              <ArchiveRestore className="h-4 w-4" aria-hidden /> {archiveWords(kind, true).button}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
