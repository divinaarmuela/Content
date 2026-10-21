'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ExternalLink, Film, FolderOpen, Hourglass, Link2, Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow, useTable } from '@/lib/db-client'
import type { Client, ContentItem, DriveSeen, DriveSource, TeamUser, WorkKind } from '@/lib/db-types'
import { STEPS, agoWords, initialsOfName, stepOf, videoNext, type NextTone } from '../../../../lib/editor-preview-core'
import { KIND_WORDS, OPEN_STATES, STATE_WORDS, isFootage, isVideo, stageRule, type CutKind, type SeenState } from '../../../../lib/drive-scan-core'
import { assetHistory, assetIdOf, currentFiles, isRetiredAt } from '../../../../lib/final-files-core'
import { roundOf } from '../../../../lib/edit-round-core'
import { clipApprovalsOf } from '../../../../lib/clip-approvals-core'
import { gradedRoundOf, needsColourGrade } from '../../../../lib/colour-grade-core'
import { formatBytes } from '../../../../lib/drive-pull-core'
import { isTestClient } from '../../../../lib/test-clients-core'
import { stackVersions, type Stack, type StackFile } from '../../../../lib/version-stack-core'
import { editingPortalPath, portalHasWork } from '../../../../lib/editing-portal-core'
import { onePortalPath, workTab } from '../../../../lib/one-portal-core'
import { ColourGradePanel } from '../../../board/ColourGradePanel'
import { ManagerActions } from '../../../board/CardAnswers'
import EditorCardDrawer from '../../../board/EditorCardDrawer'
import PreviewFrame, { AiScanning, ScanSteps, usePreviewAccess } from '../PreviewFrame'

/**
 * THE NEW EDITOR — A CARD (preview). Built for the people doing the work (the owner, 22 Oct 2026: "think of the
 * editors people viewing the tasks and easy to use" — "the current ui is confusing i need to confirm and many ai
 * summary texts"):
 *   - where the card is, who holds it, and the card's own buttons — the SAME ones the live Editor card has
 *     (board/CardAnswers, ColourGradePanel), so both pages move a card the one way;
 *   - its videos FIRST, under the subfolders they came from, one row each: its version (V1, V2…), graded or not,
 *     and its next step in plain words — with the colour grade, to the portal, on the portal, approved;
 *   - a new cut found in Drive is one line on its video: Confirm, or Not this. The AI's reasoning sits behind "Why?",
 *     and the file-by-file scan record is folded away at the foot.
 */
export default function EditorPreviewCard() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { allowed, me } = usePreviewAccess()
  const { row: item, loading } = useRow<ContentItem>('content_items', allowed ? id : null)
  const { row: client } = useRow<Client>('clients', item?.client_id ? String(item.client_id) : null)
  const { row: kind } = useRow<WorkKind>('work_kinds', item?.work_kind_id ? String(item.work_kind_id) : null)
  const team = useTable<TeamUser>('team_users', { enabled: allowed })
  const seen = useTable<DriveSeen>('drive_seen', { enabled: allowed, by: { item_id: id } as Partial<DriveSeen> })
  const sources = useTable<DriveSource>('drive_sources', { enabled: allowed, by: { item_id: id } as Partial<DriveSource> })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t) }, [])

  if (!allowed) return <PreviewFrame tabs={false}><span /></PreviewFrame>
  if (loading) return <PreviewFrame tabs={false}><Skeleton className="h-96 w-full" /></PreviewFrame>
  if (!item) return <PreviewFrame tabs={false}><p className="text-muted-foreground">This card isn’t there any more.</p></PreviewFrame>

  const holder = team.rows.find(u => u.id === item.owner_id) ?? null
  const kindSlug = (kind as { slug?: string } | null)?.slug ?? null
  const portalLink = client?.share_token && typeof window !== 'undefined'
    ? `${window.location.origin}${(client as { portal_one?: unknown }).portal_one === true ? onePortalPath(client.share_token, workTab(kindSlug), id) : portalHasWork(item as never) ? editingPortalPath(client.share_token, id) : `/portal/${client.share_token}?card=${encodeURIComponent(id)}`}`
    : null

  return (
    <PreviewFrame tabs={false} title={item.title} summary={
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>{client?.name ?? 'No client'}</span>
        <span aria-hidden>·</span>
        {holder
          ? <span className="inline-flex items-center gap-1.5"><Initials name={holder.name || holder.email} /> {holder.name || holder.email}</span>
          : <span className="text-muted-foreground">Nobody holds it</span>}
        <span aria-hidden>·</span>
        <Link className="underline" href={`/dashboard/editor/${item.id}`}>open on the live Editor</Link>
      </span>
    }>
      <Link href="/dashboard/editor/preview" className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Board</Link>
      <Stepper status={item.status} />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-6">
          <VideoList item={item} rows={seen.rows} needsGrade={needsColourGrade(kindSlug)} />
          <details className="rounded-card border border-border bg-surface p-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-muted-foreground">Scan details — every file the AI looked at</summary>
            <div className="mt-4"><Inbox item={item} rows={seen.rows} /></div>
          </details>
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          {me && (
            <div className="overflow-hidden rounded-card border border-border bg-card">
              <ColourGradePanel item={item as never} mayGrade={me.role === 'account_manager' || me.role === 'super_admin' || (me as { colourist?: boolean }).colourist === true} />
              <ManagerActions item={item} client={client ?? null} kindSlug={kindSlug} portalLink={portalLink}
                viewer={{ id: me.id, role: me.role, quality_reviewer: (me as { quality_reviewer?: boolean }).quality_reviewer === true, colourist: (me as { colourist?: boolean }).colourist === true }} />
            </div>
          )}
          <Sources item={item} rows={sources.rows} now={now} />
          <div className="overflow-hidden rounded-card border border-border bg-card">
            <EditorCardDrawer key={id} id={id} onClose={() => router.push('/dashboard/editor/preview')} hideFolderFiles />
          </div>
        </aside>
      </div>
    </PreviewFrame>
  )
}

/** a person on a card: their initials in a circle, their name on hover */
function Initials({ name }: { name: string | null | undefined }) {
  return (
    <span title={name ?? undefined} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
      {initialsOfName(name)}
    </span>
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

const TONES: Record<NextTone, string> = {
  muted: 'bg-muted text-muted-foreground', amber: 'bg-tint-amber text-foreground', blue: 'bg-tint-blue text-foreground', green: 'bg-tint-green text-foreground',
}

/**
 * THE VIDEOS — under the subfolders they came from, first on the page (the owner, 22 Oct 2026: "the subfolder part
 * make sure its at the top"). One row per video: its picture, its name, V1 · V2 · V3 (the current one dark), Graded,
 * and its next step. A new cut in Drive is one line on the row: Confirm or Not this.
 */
function VideoList({ item, rows, needsGrade }: { item: ContentItem; rows: DriveSeen[]; needsGrade: boolean }) {
  const stacks = useMemo(() => stackVersions(stackFilesOf(item, rows)), [item, rows])
  const rowById = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows])
  const round = roundOf(item)
  const gradedThisRound = gradedRoundOf(item) === round
  const approvedFiles = new Set(clipApprovalsOf(item).map(a => a.file_id))
  const current = currentFiles(item)
  // the folder a video lives in: where its first file came from (later versions join it there)
  const folderOf = (s: Stack): string => {
    for (const e of s.entries) {
      if (e.source === 'drive') { const r = rowById.get(e.key.slice(2)); if (r) return folderName(r.path) }
      if (e.source === 'card') {
        for (const v of assetHistory(item, e.key.slice(2))) {
          const r = v.drive_file_id ? rows.find(x => x.drive_file_id === v.drive_file_id) : null
          if (r) return folderName(r.path)
          const kept = (v as { drive_path?: string | null }).drive_path
          if (kept) return folderName(kept)
        }
        return 'Handed in'
      }
    }
    return 'Top of the link'
  }
  const groups = new Map<string, Stack[]>()
  for (const s of stacks) { const k = folderOf(s); groups.set(k, [...(groups.get(k) ?? []), s]) }
  // subfolders first — they are the videos an editor grouped on purpose — then the loose ones at the top of the link
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === 'Top of the link' ? 1 : b[0] === 'Top of the link' ? -1 : a[0].localeCompare(b[0])))
  const [folder, setFolder] = useState<string | null>(null)
  const shown = folder ? ordered.filter(([f]) => f === folder) : ordered

  if (!stacks.length) {
    return (
      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Film className="h-4 w-4" aria-hidden /> Videos</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">No videos yet — they show here as soon as the editor puts them in the card’s Drive link.</p>
      </section>
    )
  }
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Film className="h-4 w-4" aria-hidden /> Videos <span className="text-muted-foreground">({stacks.length})</span></h2>
        <AiScanning n={rows.filter(r => r.state === 'new' || r.state === 'scanning').length} />
      </header>
      {/* THE FOLDERS, AT THE TOP (the owner, 22 Oct 2026: "the subfolder part make sure its at the top"): every
          subfolder the editor used, with its count — press one to see only its videos */}
      {ordered.length > 1 && (
        <nav aria-label="Folders" className="mb-4 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFolder(null)} aria-pressed={folder === null}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${folder === null ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All ({stacks.length})</button>
          {ordered.map(([f, list]) => (
            <button key={f} type="button" onClick={() => setFolder(f)} aria-pressed={folder === f}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${folder === f ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />{f} ({list.length})
            </button>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-5">
        {shown.map(([folder, list]) => (
          <div key={folder}>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground"><FolderOpen className="h-3.5 w-3.5" aria-hidden />{folder} <span>({list.length})</span></h3>
            <ul className="flex flex-col gap-2">
              {list.map(s => {
                const asset = s.entries.find(e => e.source === 'card')?.key.slice(2) ?? null
                const file = asset ? current.find(f => assetIdOf(f) === asset) : null
                const pending = s.entries.filter(e => e.source === 'drive' && rowById.get(e.key.slice(2))?.state === 'scanned' && e.kind !== 'copy')
                const gone = s.entries.every(e => e.source !== 'drive' || rowById.get(e.key.slice(2))?.state === 'gone') && s.entries.some(e => e.source === 'drive')
                const next = videoNext({ status: item.status, needsGrade, gradedThisRound: gradedThisRound && !!file, approved: !!file && approvedFiles.has(file.id), newInDrive: pending.length > 0, gone, onCard: !!asset })
                return <VideoRow key={s.key} item={item} s={s} next={next} pending={pending.map(e => rowById.get(e.key.slice(2))!).filter(Boolean)} rowById={rowById} />
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

const folderName = (path: string) => { const i = path.lastIndexOf('/'); return i < 0 ? 'Top of the link' : path.slice(0, i) }

function VideoRow({ item, s, next, pending, rowById }: { item: ContentItem; s: Stack; next: { words: string; tone: NextTone }; pending: DriveSeen[]; rowById: Map<string, DriveSeen> }) {
  const l = s.latest
  const [busy, setBusy] = useState<string | null>(null)
  const test = isTestClient(String(item.client_id))
  // the newest new cut is the one confirmed; "Not this" sets every waiting one aside
  const offer = [...pending].sort((a, b) => String(b.created_time ?? b.first_seen_at).localeCompare(String(a.created_time ?? a.first_seen_at)))[0] ?? null
  const offerEntry = offer ? s.entries.find(e => e.key === `s:${offer.id}`) : null
  const answer = async (action: 'confirm' | 'ignore') => {
    setBusy(action)
    try {
      const res = await fetch(`/api/editor-preview/${item.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, seen_ids: action === 'confirm' && offer ? [offer.id] : pending.map(p => p.id) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not do that')
      toast.success(action === 'confirm' ? 'Handed in — it copies onto the card now' : 'Set aside — it won’t be offered again')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not do that') } finally { setBusy(null) }
  }
  return (
    <li className={`rounded-inner border bg-background ${pending.length ? 'border-accent-amber' : 'border-border'}`}>
      <div className="flex items-center gap-3 p-3">
        {l.thumb
          ? <img src={l.thumb} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
          : <span className="flex h-16 w-11 shrink-0 items-center justify-center rounded bg-muted"><Film className="h-4 w-4 text-muted-foreground" aria-hidden /></span>}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-[15px] font-semibold">{s.title}</span>
          <span className="flex flex-wrap items-center gap-1">
            {s.versions.map(v => (
              <span key={v} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${v === l.label ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>{v}</span>
            ))}
            {l.graded && <span className="rounded-full bg-tint-green px-2 py-0.5 text-[11px] font-bold">Graded</span>}
            {s.otherCard && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold">Belongs to “{s.otherCard}”?</span>}
          </span>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONES[next.tone]}`}>{next.words}</span>
      </div>
      {offer && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-tint-amber/40 px-3 py-2">
          <span className="min-w-0 flex-1 text-[13px]">
            <b>{offerEntry?.label ?? 'New'} in Drive:</b> {offer.path.slice(offer.path.lastIndexOf('/') + 1)}
          </span>
          <Button size="sm" disabled={!!busy || !test} title={test ? undefined : 'Preview — confirming works on the test clients first; hand it in on the live Editor for now'}
            onClick={() => void answer('confirm')} className="h-9 rounded-full px-4 text-[13px] font-semibold">
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden />{busy === 'confirm' ? 'Handing in…' : 'Confirm'}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void answer('ignore')} className="h-9 rounded-full px-4 text-[13px] font-semibold">Not this</Button>
        </div>
      )}
      <details className="border-t border-border px-3 py-1.5">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-muted-foreground"><ChevronDown className="h-3 w-3" aria-hidden /> Versions and why</summary>
        <ol className="flex flex-col gap-1.5 py-2">
          {[...s.entries].reverse().map(e => {
            const r = e.source === 'drive' ? rowById.get(e.key.slice(2)) : null
            const why = ((r?.scan as { reasons?: string[] } | null)?.reasons ?? []).slice(0, 2)
            return (
              <li key={e.key} className="flex flex-col gap-0.5 text-[13px]">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="w-7">{e.label}</b>
                  {e.graded && <span className="rounded-full bg-tint-green px-1.5 text-[11px] font-semibold">graded</span>}
                  {e.sameAsEarlier && <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">same file again</span>}
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="text-[12px] text-muted-foreground">{e.source === 'card' ? 'on the card' : e.source === 'other' ? `on “${e.otherCard}”` : r ? STATE_WORDS[r.state as SeenState] ?? r.state : 'in Drive'}</span>
                </span>
                {why.length > 0 && <span className="pl-9 text-[12px] text-muted-foreground">{why.join(' · ')}</span>}
              </li>
            )
          })}
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
          {scan.frames.map((u, i) => u ? <img key={i} src={u} alt={`Frame ${i + 1}`} className="h-16 w-auto rounded-md border border-border object-cover" /> : null)}
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
