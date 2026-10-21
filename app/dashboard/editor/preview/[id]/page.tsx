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
import { stackVersions, type Stack, type StackFile } from '../../../../lib/version-stack-core'
import { isFootage, isVideo } from '../../../../lib/drive-scan-core'
import PreviewFrame, { AiScanning, ScanSteps, usePreviewAccess } from '../PreviewFrame'

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
          <Stacks item={item} rows={seen.rows} />
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

/** the card's videos and the scanned Drive files, as the stacks' input */
function stackFilesOf(item: ContentItem, rows: readonly DriveSeen[]): StackFile[] {
  const round = roundOf(item)
  const card: StackFile[] = currentFiles(item).filter(f => !isRetiredAt(f, round) && isVideo({ mime: f.mime, name: f.name })).map(f => {
    const first = assetHistory(item, assetIdOf(f))[0] ?? f
    return { key: `a:${assetIdOf(f)}`, name: f.name, at: first.uploaded_at, source: 'card', kind: null, matchKey: null, ask: false, busy: false, thumb: null, confidence: null, otherCard: null }
  })
  const drive: StackFile[] = rows
    .filter(r => !['taken', 'ignored', 'footage'].includes(r.state) && isVideo({ mime: r.mime, name: r.path }) && !isFootage({ name: r.path }))
    .map(r => {
      const scan = (r.scan ?? null) as { kind?: string; asset?: string | null; same_as?: string | null; ask?: boolean; confidence?: number; frames?: (string | null)[]; other_card?: { title?: string } | null } | null
      const a = scan?.asset ?? null
      const matchKey = !a ? null : a.startsWith('seen:') ? `s:${a.slice(5)}` : a.startsWith('card:') ? `o:${a.slice(5)}` : `a:${a}`
      return {
        key: `s:${r.id}`, name: r.path, at: r.created_time ?? r.modified ?? r.first_seen_at, source: 'drive', kind: scan?.kind ?? null, matchKey,
        ask: !!scan?.ask, busy: r.state === 'new' || r.state === 'scanning', thumb: scan?.frames?.find(Boolean) ?? null,
        confidence: typeof scan?.confidence === 'number' ? scan.confidence : null, otherCard: scan?.other_card?.title ?? null,
        sameAs: scan?.same_as?.startsWith('seen:') ? `s:${scan.same_as.slice(5)}` : null,
      }
    })
  // a file matched to a video on ANOTHER card: that video is its earlier version (New Menu Medley's draft is on the
  // Flinders Lane card, so Ryan's cut in this card's Drive is V2 — live, 21 Oct 2026)
  const others: StackFile[] = []
  for (const r of rows) {
    const scan = (r.scan ?? null) as { asset?: string | null; other_card?: { title?: string } | null; compared?: { asset: string; name: string }[] } | null
    const a = scan?.asset
    if (!a?.startsWith('card:') || others.some(o => o.key === `o:${a.slice(5)}`)) continue
    others.push({
      key: `o:${a.slice(5)}`, name: scan?.compared?.find(c => c.asset === a)?.name ?? 'a video', at: '', source: 'other', kind: null, matchKey: null,
      ask: false, busy: false, thumb: null, confidence: null, otherCard: scan?.other_card?.title ?? null,
    })
  }
  return [...others, ...card, ...drive]
}

/**
 * THE VIDEOS, STACKED (the owner, 21 Oct 2026: "the ui should immediately show the latest version stacked view …
 * currently i have to read one by one"): one row per video, its latest version on top with V1 · V2 · V3 beside it,
 * what needs a look first. Open a row for every version under it.
 */
function Stacks({ item, rows }: { item: ContentItem; rows: DriveSeen[] }) {
  const stacks = useMemo(() => stackVersions(stackFilesOf(item, rows)), [item, rows])
  if (!stacks.length) return null
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Film className="h-4 w-4" aria-hidden /> Videos <span className="text-muted-foreground">({stacks.length})</span></h2>
        <span className="text-[12px] text-muted-foreground">Latest version first · versions worked out by the AI, never from names</span>
      </header>
      <ul className="flex flex-col gap-2">{stacks.map(s => <StackRow key={s.key} s={s} />)}</ul>
    </section>
  )
}

function StackRow({ s }: { s: Stack }) {
  const l = s.latest
  const newestFirst = [...s.entries].reverse()
  return (
    <li className={`rounded-inner border bg-background ${s.ask && !s.busy ? 'border-accent-amber' : 'border-border'}`}>
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
          {l.thumb
            ? <img src={l.thumb} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
            : <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted"><Film className="h-4 w-4 text-muted-foreground" aria-hidden /></span>}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[15px] font-semibold">{s.title}</span>
            <span className="flex flex-wrap items-center gap-1">
              {s.versions.map(v => (
                <span key={v} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${v === l.label ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>{v}</span>
              ))}
              {l.graded && <span className="rounded-full bg-tint-green px-2 py-0.5 text-[11px] font-bold">Graded</span>}
              <span className="ml-1 truncate text-[12px] text-muted-foreground">latest: {l.name} · {l.source === 'card' ? 'on the card' : l.source === 'other' ? `on “${l.otherCard}”` : 'in Drive'}</span>
            </span>
          </span>
          <span className="shrink-0">
            {s.busy ? <AiScanning n={s.entries.filter(e => e.busy).length} />
              : s.otherCard ? <span className="rounded-full bg-tint-amber px-2.5 py-1 text-[12px] font-semibold">Belongs to “{s.otherCard}”?</span>
              : s.ask ? <span className="rounded-full bg-tint-amber px-2.5 py-1 text-[12px] font-semibold">Check this one</span>
              : <span className="text-[12px] text-muted-foreground">{s.entries.length} {s.entries.length === 1 ? 'file' : 'files'}</span>}
          </span>
        </summary>
        <ol className="flex flex-col gap-1 border-t border-border px-3 py-2">
          {newestFirst.map(e => (
            <li key={e.key} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="w-7 font-bold">{e.label}</span>
              {e.graded && <span className="rounded-full bg-tint-green px-1.5 text-[11px] font-semibold">graded</span>}
              {e.sameAsEarlier && <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">same file again</span>}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="text-[12px] text-muted-foreground">
                {e.source === 'card' ? 'on the card' : e.source === 'other' ? `on the card “${e.otherCard}”` : e.busy ? 'AI scanning…' : `${e.kind ? KIND_WORDS[e.kind as CutKind] ?? e.kind : 'in Drive'}${e.confidence !== null ? ` · ${Math.round(e.confidence * 100)}% sure` : ''}`}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </li>
  )
}

/** NEW IN DRIVE — what the minute check found, and what the AI made of it */
function Inbox({ item, rows }: { item: ContentItem; rows: DriveSeen[] }) {
  const open = rows.filter(r => (OPEN_STATES as string[]).includes(r.state)).sort((a, b) => b.first_seen_at.localeCompare(a.first_seen_at))
  const done = rows.filter(r => !(OPEN_STATES as string[]).includes(r.state) && r.state !== 'footage')
  // camera originals and footage are never cuts: one line, not a list (live, 21 Oct 2026: a card full of MXF rows)
  const footage = rows.filter(r => r.state === 'footage')
  const scanning = open.filter(r => r.state === 'new' || r.state === 'scanning').length
  const rule = stageRule(item.status)
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Sparkles className="h-4 w-4 text-accent-blue" aria-hidden /> Every file the AI checked</h2>
        <AiScanning n={scanning} />
      </header>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {rule.who === 'editor' ? 'New or changed files are offered to the editor.' : rule.who === 'colourist' ? 'New files are offered to the colourist as graded versions.' : rule.why}
      </p>
      {open.length === 0 && <p className="text-[14px] text-muted-foreground">Nothing new in this card’s Drive links.</p>}
      <ul className="flex flex-col gap-2">
        {open.map(r => <SeenRow key={r.id} r={r} item={item} />)}
      </ul>
      {footage.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] text-muted-foreground">{footage.length} shoot footage {footage.length === 1 ? 'file' : 'files'} skipped — camera files are never versions</summary>
          <p className="mt-2 text-[12px] text-muted-foreground">{[...new Set(footage.map(r => r.path))].join(' · ')}</p>
        </details>
      )}
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
  const scan = (r.scan ?? null) as {
    kind?: CutKind; asset?: string | null; confidence?: number; reasons?: string[]; ask?: boolean; model?: string; error?: string
    steps?: Record<string, string>; frames?: (string | null)[]; duration_ms?: number
    compared?: { asset: string; name: string; sound: number | null; lengthGapMs: number | null; colourShift: number | null }[]
  } | null
  const target = scan?.asset ? currentFiles(item).find(f => assetIdOf(f) === scan.asset) : null
  const busy = r.state === 'new' || r.state === 'scanning'
  const scannable = ['new', 'scanning', 'scanned', 'locked', 'failed'].includes(r.state) && !quiet
  const [again, setAgain] = useState(false)
  const rescan = async () => {
    setAgain(true)
    try {
      const res = await fetch('/api/editor-preview/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen_id: r.id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not scan it')
      toast.success('Queued for the AI — watch the steps light up')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not scan it') } finally { setAgain(false) }
  }
  const duration = scan?.duration_ms ?? r.duration_ms
  return (
    <li className={`flex flex-col gap-2 rounded-inner border p-3 ${scan?.ask && !busy ? 'border-accent-amber' : 'border-border'} ${quiet ? 'bg-background/50' : 'bg-background'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-semibold" title={r.path}>{r.path}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${busy ? 'bg-accent-blue/15 text-accent-blue-deep' : r.state === 'locked' ? 'bg-muted text-muted-foreground' : r.state === 'scanned' ? 'bg-tint-amber' : r.state === 'failed' ? 'bg-tint-red' : 'bg-muted'}`}>
          {busy && <Sparkles className="h-3 w-3 animate-pulse" aria-hidden />}{r.state === 'locked' && <Lock className="h-3 w-3" aria-hidden />}
          {STATE_WORDS[r.state as SeenState] ?? r.state}
        </span>
      </div>
      <span className="text-[12px] text-muted-foreground">
        {[r.size ? formatBytes(r.size) : null, duration ? `${(duration / 1000).toFixed(1)}s` : null, r.width && r.height ? `${r.width}×${r.height}` : null, `found ${new Date(r.first_seen_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}`].filter(Boolean).join(' · ')}
      </span>
      {scannable && (busy || scan?.steps) && <ScanSteps state={r.state} steps={scan?.steps} />}
      {scan?.frames?.some(Boolean) && (
        <div className="flex gap-1.5 overflow-x-auto" aria-label="Frames the AI looked at">
          {scan.frames.map((u, i) => u ? <img key={i} src={u} alt={`Frame ${i + 1}`} className="h-20 w-auto rounded-md border border-border object-cover" /> : null)}
        </div>
      )}
      {scan?.kind && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/60 p-2.5">
          <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <Sparkles className="h-3.5 w-3.5 text-accent-blue" aria-hidden />
            <b>{KIND_WORDS[scan.kind]}</b>{target ? <> of <b>{target.name}</b></> : null}
            {typeof scan.confidence === 'number' && <span className="text-muted-foreground">· {Math.round(scan.confidence * 100)}% sure</span>}
            {scan.ask && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold">Check this one</span>}
          </span>
          {scan.reasons?.length ? <span className="text-[12px] text-muted-foreground">{scan.reasons.join(' · ')}</span> : null}
          {scan.model && <span className="text-[11px] text-muted-foreground">Decided by {scan.model === 'measures only' ? `the measures alone — the AI wasn’t reached${(scan as { ai_error?: string }).ai_error ? ` (${(scan as { ai_error?: string }).ai_error})` : ''}` : `AI (${scan.model}) checked against the measures`}</span>}
        </div>
      )}
      {scan?.compared?.length ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer font-semibold text-muted-foreground">Checked against {(scan as { checked?: number }).checked ?? scan.compared.length} {((scan as { checked?: number }).checked ?? scan.compared.length) === 1 ? 'video' : 'videos'} — the closest {scan.compared.length} (not matches)</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {scan.compared.map(c => (
              <li key={c.asset} className="text-muted-foreground">
                <b className="text-foreground">{c.name}</b> — sound {c.sound === null ? '—' : `${Math.round(c.sound * 100)}%`} · length {c.lengthGapMs === null ? '—' : c.lengthGapMs <= 150 ? 'same' : `${(c.lengthGapMs / 1000).toFixed(1)}s off`} {c.lengthGapMs !== null && c.lengthGapMs <= 150 && c.colourShift !== null ? ` · colour ${c.colourShift >= 6 ? 'changed' : 'same'}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {scan?.error && <span className="text-[12px] text-accent-red-deep">{scan.error}</span>}
      {r.state === 'locked' && !quiet && <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><Hourglass className="h-3 w-3" aria-hidden />{stageRule(item.status).why}</span>}
      {(r.state === 'failed' || r.state === 'new' || (r.state === 'scanning' && Date.now() - Date.parse(String((scan as { started_at?: string } | null)?.started_at ?? r.updated_at)) > 6 * 60_000)) && !quiet && (
        <Button variant="outline" size="sm" className="self-start" disabled={again} onClick={rescan}>{again ? 'Scanning…' : r.state === 'failed' ? 'Scan again' : 'Scan now'}</Button>
      )}
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
  // the folder a video LIVES in: where its first cut came from (the owner, 21 Oct 2026: version 1 handed in as
  // subfolders — every later version of a video goes in that video's folder, wherever its new file sits in Drive)
  const folderOfVideo = (assetId: string) => {
    for (const v of assetHistory(item, assetId)) {
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
