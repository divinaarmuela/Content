'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, HardDriveDownload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTable } from '@/lib/db-client'
import type { WorkflowActivity } from '@/lib/db-types'
import Chip from '../ui/Chip'
import { flagsOf, mayFlag } from '../../lib/card-flag-core'
import { linkKindOf } from '../../lib/card-link-core'
import type { Slide } from '../../lib/version-files-core'
import type { BoardViewer } from '../../lib/board-view-core'

/**
 * THE EDITOR'S TOOLS ON A CARD (the Video Editors SOP, 11 Sep 2026).
 *
 * Five small things, in the order the SOP asks for them: which shoot the
 * footage is from; "I have seen it" the day it lands; "this will not make
 * the date" the moment it is known; the final export brought in from the
 * client's Google Drive folder (read only — the file is COPIED into our
 * store, never moved or written back, CLAUDE.md trap 13); and where the
 * source files were handed over (a Dropbox link on the card).
 */
type DriveRow = { id: string; name: string; type: 'image' | 'video'; bytes: number | null }

export default function EditorCardTools({ item, viewer, activity, frozen, working, onFilesFromDrive }: {
  item: { id: string; client_id: string; owner_id: string | null; batch_id: string | null; group_id?: string | null; link_url?: string | null; status: string }
  viewer: BoardViewer
  activity: readonly WorkflowActivity[]
  /** booked in or posted: nothing here changes any more */
  frozen: boolean
  working: boolean
  onFilesFromDrive: (files: Slide[]) => void
}) {
  const isManager = viewer.role === 'account_manager' || viewer.role === 'super_admin'
  const holder = item.owner_id === viewer.id
  const mine = mayFlag(viewer, item.owner_id)
  const flags = useMemo(() => flagsOf(activity as never, viewer.id), [activity, viewer.id])

  /* ── which shoot ── */
  const byClient = useMemo(() => ({ client_id: item.client_id }), [item.client_id])
  const { rows: shoots } = useTable<{ id: string; client_id: string; title: string; status?: string }>('batches', { by: byClient })
  const byShoot = useMemo(() => (item.batch_id ? { batch_id: item.batch_id } : { batch_id: '__none__' }), [item.batch_id])
  const { rows: groups } = useTable<{ id: string; batch_id: string; title: string; target?: number }>('deliverable_groups', { by: byShoot })
  const [saving, setSaving] = useState<string | null>(null)
  const save = async (patch: Record<string, unknown>, said: string) => {
    setSaving(said)
    try {
      const res = await fetch(`/api/production/items/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
      toast.success(said)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that')
    } finally {
      setSaving(null)
    }
  }

  /* ── the two flags ── */
  const [riskOpen, setRiskOpen] = useState(false)
  const [riskNote, setRiskNote] = useState('')
  const flag = async (kind: 'acknowledged' | 'deadline_risk') => {
    setSaving(kind)
    try {
      const res = await fetch(`/api/production/items/${item.id}/flag`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, note: kind === 'deadline_risk' ? riskNote : undefined }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not flag it')
      toast.success(kind === 'acknowledged' ? 'Acknowledged — the team knows you are on it' : 'Flagged — the account managers have been told')
      setRiskOpen(false); setRiskNote('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not flag it')
    } finally {
      setSaving(null)
    }
  }

  /* ── a file from Google Drive (read only: copied in, never written back) ── */
  const [driveOpen, setDriveOpen] = useState(false)
  const [drive, setDrive] = useState<DriveRow[] | null>(null)
  const [driveNote, setDriveNote] = useState<string | null>(null)
  const [bringing, setBringing] = useState<string | null>(null)
  useEffect(() => {
    if (!driveOpen || drive !== null) return
    let cancelled = false
    fetch(`/api/social/schedule/drive?itemId=${encodeURIComponent(item.id)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json?.error) { setDriveNote(String(json.error)); setDrive([]) }
        else { setDrive((json?.files ?? []) as DriveRow[]); setDriveNote(null) }
      })
      .catch(() => { if (!cancelled) { setDriveNote('Google Drive did not answer. Try again in a moment.'); setDrive([]) } })
    return () => { cancelled = true }
  }, [driveOpen, drive, item.id])
  const bringAcross = async (row: DriveRow) => {
    setBringing(row.id)
    try {
      const res = await fetch('/api/social/schedule/drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, file_ids: [row.id] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not bring that file across'))
      const files = (json?.files ?? []) as Slide[]
      if (files.length === 0) throw new Error('Nothing came across')
      onFilesFromDrive(files)
      setDriveOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not bring that file across')
    } finally {
      setBringing(null)
    }
  }

  /* ── the source files ── */
  const [source, setSource] = useState(item.link_url ?? '')
  useEffect(() => { setSource(item.link_url ?? '') }, [item.link_url])
  const sourceCheck = linkKindOf(source)
  const saveSource = async () => {
    const url = source.trim()
    setSaving('source')
    try {
      const res = url
        ? await fetch(`/api/production/items/${item.id}/link`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
        })
        : await fetch(`/api/production/items/${item.id}/link`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save the link')
      toast.success(url ? 'Source files link saved' : 'Source files link removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the link')
    } finally {
      setSaving(null)
    }
  }

  const button = 'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50'
  const busy = saving !== null || working
  const shootTitle = shoots.find(s => s.id === item.batch_id)?.title ?? null

  return (
    <div className="flex flex-col gap-4 border-b border-border px-5 py-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">The editor’s corner</p>

      {/* which shoot */}
      <div className="flex flex-col gap-2">
        <label htmlFor="card-shoot" className="text-[13px] font-semibold">Which shoot is this from?</label>
        {mine && !frozen ? (
          <select id="card-shoot" value={item.batch_id ?? ''} disabled={busy}
            onChange={e => void save({ batch_id: e.target.value || null, group_id: null }, e.target.value ? 'Shoot saved' : 'Shoot cleared')}
            className="h-11 rounded-full border border-border bg-surface px-4 text-[14px]">
            <option value="">Not from a shoot</option>
            {shoots.filter(s => s.status !== 'wrapped' || s.id === item.batch_id).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        ) : (
          <p className="text-[14px]">{shootTitle ?? 'Not from a shoot'}</p>
        )}
        {item.batch_id && groups.length > 0 && (
          <>
            <label htmlFor="card-group" className="text-[13px] font-semibold">Which deliverable?</label>
            {mine && !frozen ? (
              <select id="card-group" value={item.group_id ?? ''} disabled={busy}
                onChange={e => void save({ group_id: e.target.value || null }, 'Deliverable saved')}
                className="h-11 rounded-full border border-border bg-surface px-4 text-[14px]">
                <option value="">Not one in particular</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.title}{g.target ? ` (${g.target})` : ''}</option>)}
              </select>
            ) : (
              <p className="text-[14px]">{groups.find(g => g.id === item.group_id)?.title ?? 'Not one in particular'}</p>
            )}
          </>
        )}
      </div>

      {/* the two flags */}
      <div className="flex flex-wrap items-center gap-2">
        {flags.acknowledged ? (
          <Chip tone="green">Acknowledged</Chip>
        ) : holder ? (
          <Button variant="outline" className={button} disabled={busy} onClick={() => void flag('acknowledged')}>
            <Check className="h-4 w-4" aria-hidden /> Acknowledge — I am on it
          </Button>
        ) : (
          <span className="text-[13px] text-muted-foreground">{item.owner_id ? 'Not acknowledged yet.' : 'Nobody holds this yet.'}</span>
        )}
        {flags.risk && <Chip tone="red">At risk: {flags.risk}</Chip>}
        {mine && !frozen && !riskOpen && (
          <Button variant="ghost" className={button} disabled={busy} onClick={() => setRiskOpen(true)}>
            <AlertTriangle className="h-4 w-4" aria-hidden /> Flag a deadline risk
          </Button>
        )}
      </div>
      {riskOpen && (
        <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
          <label htmlFor="card-risk" className="text-[13px] font-semibold">Why is the date at risk? One line — the account managers are told.</label>
          <textarea id="card-risk" rows={2} autoFocus value={riskNote} onChange={e => setRiskNote(e.target.value)}
            placeholder="Footage for scene 3 is missing; waiting on the videographer"
            className="min-h-11 resize-none rounded-inner border border-border bg-surface p-2.5 text-[14px]" />
          <div className="flex items-center gap-2">
            <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
              disabled={busy || !riskNote.trim()} onClick={() => void flag('deadline_risk')}>Flag it</Button>
            <Button variant="ghost" className="h-11 rounded-full px-4 text-[14px] font-semibold" onClick={() => { setRiskOpen(false); setRiskNote('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* a file from Google Drive */}
      {mine && !frozen && (
        <div className="flex flex-col gap-2">
          {!driveOpen ? (
            <Button variant="outline" className={`${button} w-fit`} disabled={busy} onClick={() => setDriveOpen(true)}>
              <HardDriveDownload className="h-4 w-4" aria-hidden /> Pick the final from Google Drive
            </Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">The client’s Drive folder</p>
                <Button variant="ghost" className="h-11 rounded-full px-4 text-[13px] font-semibold" onClick={() => setDriveOpen(false)}>Close</Button>
              </div>
              <p className="text-[12px] text-muted-foreground">A copy is brought in as a new version. Nothing in Drive is moved or changed.</p>
              {driveNote && <p role="alert" className="text-[13px] font-medium text-accent-red-deep">{driveNote}</p>}
              {drive === null ? (
                <p role="status" className="py-4 text-center text-[13px] text-muted-foreground">Looking in Drive…</p>
              ) : drive.length === 0 && !driveNote ? (
                <p className="py-4 text-center text-[13px] text-muted-foreground">No pictures or videos in this client’s Drive folder.</p>
              ) : (
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                  {drive.map(row => (
                    <li key={row.id} className="flex items-center justify-between gap-2 rounded-inner px-2 py-1 hover:bg-muted">
                      <span className="min-w-0 truncate text-[13px]">{row.name}<span className="ml-1 text-muted-foreground">· {row.type}</span></span>
                      <Button variant="outline" className="h-11 shrink-0 rounded-full px-3 text-[13px] font-semibold"
                        disabled={bringing !== null || busy} onClick={() => void bringAcross(row)}>
                        {bringing === row.id ? 'Bringing…' : 'Use this'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* the source files */}
      <div className="flex flex-col gap-2">
        <label htmlFor="card-source" className="text-[13px] font-semibold">Source files (Dropbox)<span className="ml-1 font-normal text-muted-foreground">— where the project and raw files were handed over</span></label>
        {(mine || isManager) && !frozen ? (
          <div className="flex flex-wrap items-center gap-2">
            <input id="card-source" value={source} onChange={e => setSource(e.target.value)} placeholder="https://www.dropbox.com/…"
              className="h-11 min-w-0 flex-1 rounded-full border border-border bg-surface px-4 text-[14px]" />
            <Button variant="outline" className={button} disabled={busy || (source.trim() !== '' && !sourceCheck.ok) || source.trim() === (item.link_url ?? '')}
              onClick={() => void saveSource()}>Save</Button>
          </div>
        ) : item.link_url ? (
          <a href={item.link_url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-[14px] underline underline-offset-4">
            {linkKindOf(item.link_url).ok ? (linkKindOf(item.link_url) as { label: string }).label : 'Link'}<span className="sr-only">, opens in a new tab</span>
          </a>
        ) : (
          <p className="text-[13px] text-muted-foreground">Not handed over yet.</p>
        )}
        {source.trim() !== '' && !sourceCheck.ok && <p role="alert" className="text-[12px] font-medium text-accent-red-deep">{sourceCheck.reason}</p>}
      </div>
    </div>
  )
}
