'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, Film, FolderOpen, Hourglass, Link2, Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow, useTable } from '@/lib/db-client'
import type { Client, ContentItem, DriveSeen, DriveSource } from '@/lib/db-types'
import { STEPS, agoWords, stepOf } from '../../../../lib/editor-preview-core'
import { KIND_WORDS, OPEN_STATES, STATE_WORDS, stageRule, type CutKind, type SeenState } from '../../../../lib/drive-scan-core'
import { assetHistory, assetIdOf, currentFiles, isRetiredAt } from '../../../../lib/final-files-core'
import { roundOf, versionLabel } from '../../../../lib/edit-round-core'
import { clipApprovalsOf } from '../../../../lib/clip-approvals-core'
import { formatBytes } from '../../../../lib/drive-pull-core'
import PreviewFrame, { AiScanning, usePreviewAccess } from '../PreviewFrame'

/**
 * THE NEW EDITOR — A CARD (preview). Where the card is on the road; the Drive links it was given and when each was
 * last read; what is new in them and what the AI made of it; and its videos, each with its versions. Reads the real
 * card live; the buttons that move it arrive next, on test clients first.
 */
export default function EditorPreviewCard() {
  const { id } = useParams<{ id: string }>()
  const { allowed } = usePreviewAccess()
  const { row: item, loading } = useRow<ContentItem>('content_items', allowed ? id : null)
  const { row: client } = useRow<Client>('clients', item?.client_id ? String(item.client_id) : null)
  const seen = useTable<DriveSeen>('drive_seen', { enabled: allowed, by: { item_id: id } as Partial<DriveSeen> })
  const sources = useTable<DriveSource>('drive_sources', { enabled: allowed, by: { item_id: id } as Partial<DriveSource> })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t) }, [])

  if (!allowed) return <PreviewFrame tabs={false}><span /></PreviewFrame>
  if (loading) return <PreviewFrame tabs={false}><Skeleton className="h-96 w-full" /></PreviewFrame>
  if (!item) return <PreviewFrame tabs={false}><p className="text-muted-foreground">This card isn’t there any more.</p></PreviewFrame>

  return (
    <PreviewFrame tabs={false} title={item.title} summary={<>{client?.name ?? 'No client'} · <Link className="underline" href={`/dashboard/editor/${item.id}`}>open on the live Editor</Link></>}>
      <Link href="/dashboard/editor/preview" className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Board</Link>
      <Stepper status={item.status} />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Inbox item={item} rows={seen.rows} />
          <Videos item={item} seen={seen.rows} />
        </div>
        <Sources item={item} rows={sources.rows} now={now} />
      </div>
    </PreviewFrame>
  )
}

function Stepper({ status }: { status: unknown }) {
  const at = stepOf(status)
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Where this card is">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span aria-current={i === at ? 'step' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${i < at ? 'bg-tint-green' : i === at ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>
            {i < at && <Check className="h-3.5 w-3.5" aria-hidden />}{s}
          </span>
          {i < STEPS.length - 1 && <span aria-hidden className="h-px w-4 bg-border" />}
        </li>
      ))}
    </ol>
  )
}

/** NEW IN DRIVE — what the minute check found, and what the AI made of it */
function Inbox({ item, rows }: { item: ContentItem; rows: DriveSeen[] }) {
  const open = rows.filter(r => (OPEN_STATES as string[]).includes(r.state)).sort((a, b) => b.first_seen_at.localeCompare(a.first_seen_at))
  const done = rows.filter(r => !(OPEN_STATES as string[]).includes(r.state))
  const scanning = open.filter(r => r.state === 'new' || r.state === 'scanning').length
  const rule = stageRule(item.status)
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Sparkles className="h-4 w-4 text-accent-blue" aria-hidden /> New in Drive</h2>
        <AiScanning n={scanning} />
      </header>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {rule.who === 'editor' ? 'New or changed files are offered to the editor.' : rule.who === 'colourist' ? 'New files are offered to the colourist as graded versions.' : rule.why}
      </p>
      {open.length === 0 && <p className="text-[14px] text-muted-foreground">Nothing new in this card’s Drive links.</p>}
      <ul className="flex flex-col gap-2">
        {open.map(r => <SeenRow key={r.id} r={r} item={item} />)}
      </ul>
      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-semibold text-muted-foreground">Already handled ({done.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">{done.map(r => <SeenRow key={r.id} r={r} item={item} quiet />)}</ul>
        </details>
      )}
    </section>
  )
}

function SeenRow({ r, item, quiet }: { r: DriveSeen; item: ContentItem; quiet?: boolean }) {
  const scan = (r.scan ?? null) as { kind?: CutKind; asset?: string | null; confidence?: number; reasons?: string[]; ask?: boolean } | null
  const target = scan?.asset ? currentFiles(item).find(f => assetIdOf(f) === scan.asset) : null
  const busy = r.state === 'new' || r.state === 'scanning'
  return (
    <li className={`flex flex-col gap-1.5 rounded-inner border border-border p-3 ${quiet ? 'bg-background/50' : 'bg-background'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-semibold" title={r.path}>{r.path}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${busy ? 'bg-accent-blue/15 text-accent-blue-deep' : r.state === 'locked' ? 'bg-muted text-muted-foreground' : r.state === 'scanned' ? 'bg-tint-amber' : 'bg-muted'}`}>
          {busy && <Sparkles className="h-3 w-3 animate-pulse" aria-hidden />}{r.state === 'locked' && <Lock className="h-3 w-3" aria-hidden />}
          {STATE_WORDS[r.state as SeenState] ?? r.state}
        </span>
      </div>
      <span className="text-[12px] text-muted-foreground">
        {[r.size ? formatBytes(r.size) : null, r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : null, r.width && r.height ? `${r.width}×${r.height}` : null, r.last_modifying_user ? `by ${r.last_modifying_user}` : null, `found ${new Date(r.first_seen_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}`].filter(Boolean).join(' · ')}
      </span>
      {scan?.kind && (
        <span className="text-[13px]"><b>{KIND_WORDS[scan.kind]}</b>{target ? <> of <b>{target.name}</b></> : null}{typeof scan.confidence === 'number' ? <span className="text-muted-foreground"> · {Math.round(scan.confidence * 100)}% sure</span> : null}</span>
      )}
      {scan?.reasons?.length ? <span className="text-[12px] text-muted-foreground">{scan.reasons.join(' · ')}</span> : null}
      {r.state === 'locked' && !quiet && <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><Hourglass className="h-3 w-3" aria-hidden />{stageRule(item.status).why}</span>}
    </li>
  )
}

/**
 * THE VIDEOS — grouped under the folders they were handed in from (the owner, 21 Oct 2026: "sub folder need to stay …
 * so we can see"), each with its own line of versions: the video is the thing that has versions, not the card.
 */
function Videos({ item, seen }: { item: ContentItem; seen: DriveSeen[] }) {
  const round = roundOf(item)
  const live = currentFiles(item).filter(f => !isRetiredAt(f, round))
  const approved = new Set(clipApprovalsOf(item).map(a => a.file_id))
  const fromDrive = useMemo(() => new Map(seen.map(s => [s.drive_file_id, s])), [seen])
  // the folder a video came from: its Drive path where we have it (any of its cuts), else where it was uploaded
  const folderOfVideo = (assetId: string) => {
    for (const v of [...assetHistory(item, assetId)].reverse()) {
      const s = v.drive_file_id ? fromDrive.get(v.drive_file_id) : null
      if (s) { const i = s.path.lastIndexOf('/'); return i < 0 ? 'Top of the link' : s.path.slice(0, i) }
      const kept = (v as { drive_path?: string | null }).drive_path
      if (kept) { const i = kept.lastIndexOf('/'); return i < 0 ? 'Top of the link' : kept.slice(0, i) }
    }
    return assetHistory(item, assetId).some(v => v.source === 'drive') ? 'From Drive' : 'Uploaded'
  }
  const groups = new Map<string, typeof live>()
  for (const f of live) { const k = folderOfVideo(assetIdOf(f)); groups.set(k, [...(groups.get(k) ?? []), f]) }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[17px] font-semibold"><Film className="h-4 w-4" aria-hidden /> Videos <span className="text-muted-foreground">({live.length})</span></h2>
      {live.length === 0 && <p className="text-[14px] text-muted-foreground">No videos handed in yet.</p>}
      <div className="flex flex-col gap-5">
        {ordered.map(([folder, files]) => (
          <div key={folder}>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground"><FolderOpen className="h-3.5 w-3.5" aria-hidden />{folder} <span>({files.length})</span></h3>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {files.map(f => {
                const line = assetHistory(item, assetIdOf(f))
                return (
                  <li key={f.id} className="flex flex-col gap-2 rounded-inner border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/dashboard/editor/${item.id}/video/${f.id}`} className="min-w-0 truncate text-[14px] font-semibold hover:underline" title={f.name}>{f.name}</Link>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold">{versionLabel(item, f.version)}</span>
                    </div>
                    {approved.has(f.id) && <span className="self-start rounded-full bg-tint-green px-2 py-0.5 text-[12px] font-semibold">Approved by the client</span>}
                    <ol className="flex flex-col gap-1 border-l-2 border-border pl-3" aria-label={`${f.name}: its versions`}>
                      {line.map(v => {
                        const s = v.drive_file_id ? fromDrive.get(v.drive_file_id) : null
                        return (
                          <li key={v.id} className="text-[12px]">
                            <b>{versionLabel(item, v.version)}</b>
                            <span className="text-muted-foreground"> · {new Date(v.uploaded_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}{v.source === 'drive' ? ` · from Drive${s ? ` (${s.path})` : ''}` : ' · uploaded'}</span>
                          </li>
                        )
                      })}
                    </ol>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

/** THE DRIVE LINKS — every link the card was given, and when each was last read */
function Sources({ item, rows, now }: { item: ContentItem; rows: DriveSource[]; now: number }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/editor-preview/${item.id}/sources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not add that link')
      setLink('')
      toast.success('Link added — it’s read on the next check')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add that link') } finally { setBusy(false) }
  }
  return (
    <aside className="flex flex-col gap-3 self-start rounded-card bg-tint-blue p-5">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold"><FolderOpen className="h-4 w-4" aria-hidden /> Drive links</h2>
      <p className="text-[13px] text-muted-foreground">Any link — a master folder with subfolders, the colourist’s own, a new one for the next version. Only read, never changed.</p>
      {rows.length === 0 && <p className="text-[14px]">No links yet.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map(s => (
          <li key={s.id} className="flex flex-col gap-0.5 rounded-inner bg-background p-3">
            <a href={s.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 truncate text-[13px] font-semibold hover:underline">
              <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />{s.kind === 'folder' ? 'Folder' : 'File'} · {s.drive_id.slice(0, 10)}… <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
            <span className="text-[12px] text-muted-foreground">{agoWords(s.last_checked_at, now)}{typeof s.file_count === 'number' ? ` · ${s.file_count} files` : ''}</span>
            {s.last_error && <span className="text-[12px] text-accent-red-deep">{s.last_error}</span>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={link} onChange={e => setLink(e.target.value)} placeholder="Paste a Google Drive link" aria-label="Add a Drive link" className="bg-background" />
        <Button onClick={add} disabled={busy || !link.trim()}>Add</Button>
      </div>
    </aside>
  )
}
