'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ExternalLink, Film, FolderOpen, Hourglass, Link2, Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow, useTable } from '@/lib/db-client'
import type { Batch, Client, ContentItem, DriveSeen, DriveSource, TeamUser, VideoFrame, WorkKind } from '@/lib/db-types'
import { STEPS, agoWords, initialsOfName, isEditorCard, stepOf, videoNext, type NextTone } from '../../../lib/editor-preview-core'
import { KIND_WORDS, OPEN_STATES, STATE_WORDS, gradeStanding, isFootage, isVideo, stageRule, type CutKind, type SeenState } from '../../../lib/drive-scan-core'
import { assetHistory, assetIdOf, currentFiles, isRetiredAt } from '../../../lib/final-files-core'
import { roundOf } from '../../../lib/edit-round-core'
import { clipApprovalsOf } from '../../../lib/clip-approvals-core'
import { gradedRoundOf, needsColourGrade } from '../../../lib/colour-grade-core'
import { formatBytes } from '../../../lib/drive-pull-core'
import { stackVersions, type Stack, type StackFile } from '../../../lib/version-stack-core'
import { editingPortalPath, portalHasWork } from '../../../lib/editing-portal-core'
import { onePortalPath, workTab } from '../../../lib/one-portal-core'
import { ColourGradePanel } from '../../board/ColourGradePanel'
import { HolderTransfer, ManagerActions } from '../../board/CardAnswers'
import FilesToWorkFrom from '../../board/FilesToWorkFrom'
import { usesMakerDrawer } from '../../../lib/card-sheet-core'
import { shootCardId } from '../../../lib/deliverable-group-core'
import { cardUsesPlan, workFrom } from '../../../lib/editor-sop-core'
import { reviewPath } from '../../../lib/video-review-core'
import EditorCardClassicPage from './classic/page'
import EditorCardDrawer from '../../board/EditorCardDrawer'
import PreviewFrame, { AiScanning, ScanSteps, usePreviewAccess } from '../preview/PreviewFrame'

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
export default function EditorCard() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { allowed, me } = usePreviewAccess(true)
  const { row: item, loading } = useRow<ContentItem>('content_items', allowed ? id : null)
  const { row: client } = useRow<Client>('clients', item?.client_id ? String(item.client_id) : null)
  const { row: kind, loading: kindLoading } = useRow<WorkKind>('work_kinds', item?.work_kind_id ? String(item.work_kind_id) : null)
  const { row: shoot } = useRow<Batch>('batches', item?.batch_id ? String(item.batch_id) : null)
  const team = useTable<TeamUser>('team_users', { enabled: allowed })
  const seen = useTable<DriveSeen>('drive_seen', { enabled: allowed, by: { item_id: id } as Partial<DriveSeen> })
  const sources = useTable<DriveSource>('drive_sources', { enabled: allowed, by: { item_id: id } as Partial<DriveSource> })
  // when the card went to Colour grade: after that, a new file in its links is a grade; before, it never is
  // the twelve frames the scan kept of every video (scan-measure.ts), keyed by what it measured
  const framesTable = useTable<VideoFrame>('video_frames', { enabled: allowed })
  const framesOf = useMemo(() => {
    const m = new Map<string, { url: string; at_s: number }[]>() as FramesMap
    m.boards = new Map()
    for (const r of framesTable.rows) {
      const b = (r as { storyboard?: Board | null }).storyboard
      if (b?.url) m.boards.set(r.source, b)
      const list = (Array.isArray(r.frames) ? r.frames as { url?: string | null; at_s?: number }[] : []).filter(f => f.url).map(f => ({ url: String(f.url), at_s: Number(f.at_s ?? 0) }))
      if (list.length > (m.get(r.source)?.length ?? 0)) m.set(r.source, list)
    }
    return m
  }, [framesTable.rows])
  const moves = useTable<{ id: string; entity_id?: string; action?: string; new_value?: string; created_at?: string }>('workflow_activity', { enabled: allowed, by: { entity_id: id } as never })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t) }, [])
  // WHEN A PERSON LAST OPENED A CARD: stamped for the board's "Last viewed" order, as the classic card did — fire and forget
  useEffect(() => {
    if (!allowed || !id) return
    void fetch(`/api/production/items/${id}/viewed`, { method: 'POST' }).catch(() => { /* the order is a convenience */ })
  }, [allowed, id])

  if (!allowed) return <PreviewFrame tabs={false} classicHref={`/dashboard/editor/${id}/classic`}><span /></PreviewFrame>
  if (loading || (item?.work_kind_id && kindLoading)) return <PreviewFrame tabs={false} classicHref={`/dashboard/editor/${id}/classic`}><Skeleton className="h-96 w-full" /></PreviewFrame>
  if (!item) return <PreviewFrame tabs={false} classicHref={`/dashboard/editor/${id}/classic`}><p className="text-muted-foreground">This card isn’t there any more.</p></PreviewFrame>
  // a post uploaded on the Schedule page, a shoot plan or a designer's graphics keep their own card (the classic one)
  if (!isEditorCard(item as never, (kind as { slug?: string } | null)?.slug)) return <EditorCardClassicPage />

  const holder = team.rows.find(u => u.id === item.owner_id) ?? null
  const kindSlug = (kind as { slug?: string } | null)?.slug ?? null
  const maker = usesMakerDrawer(me as never, item as never)
  const frozen = ['scheduled', 'published'].includes(String(item.status))
  const from = workFrom({ card: item as never, shoot: shoot as never, driveFolderUrl: client?.drive_folder_id ? `https://drive.google.com/drive/folders/${String(client.drive_folder_id)}` : null }, cardUsesPlan(item as never, shootCardId))
  const portalLink = client?.share_token && typeof window !== 'undefined'
    ? `${window.location.origin}${(client as { portal_one?: unknown }).portal_one === true ? onePortalPath(client.share_token, workTab(kindSlug), id) : portalHasWork(item as never) ? editingPortalPath(client.share_token, id) : `/portal/${client.share_token}?card=${encodeURIComponent(id)}`}`
    : null

  return (
    <PreviewFrame tabs={false} classicHref={`/dashboard/editor/${id}/classic`} title={item.title} summary={
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>{client?.name ?? 'No client'}</span>
        <span aria-hidden>·</span>
        {holder
          ? <span className="inline-flex items-center gap-1.5"><Initials name={holder.name || holder.email} /> {holder.name || holder.email}</span>
          : <span className="text-muted-foreground">Nobody holds it</span>}
      </span>
    }>
      <Link href="/dashboard/editor" className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Editor</Link>
      <Stepper status={item.status} />
      {/* THE CARD'S BUTTONS, AT THE TOP (the owner, 22 Oct 2026: "the actions should be there and not in the bottom") —
          the same ones the classic card had, so the process does not change */}
      <div className="mt-4 overflow-hidden rounded-card border border-border bg-card">
        {me && maker && <HolderTransfer item={item} viewer={{ id: me.id, role: me.role }} />}
        {me && !maker && (
          <>
            <ColourGradePanel item={item as never} mayGrade={me.role === 'account_manager' || me.role === 'super_admin' || (me as { colourist?: boolean }).colourist === true} />
            <ManagerActions item={item} client={client ?? null} kindSlug={kindSlug} portalLink={portalLink}
              viewer={{ id: me.id, role: me.role, quality_reviewer: (me as { quality_reviewer?: boolean }).quality_reviewer === true, colourist: (me as { colourist?: boolean }).colourist === true }} />
          </>
        )}
        {from.footage && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
            <a href={from.footage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[13px] font-semibold hover:bg-muted">
              <FolderOpen className="h-4 w-4" aria-hidden /> Footage to work from <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        )}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Workspace item={item} rows={seen.rows} needsGrade={needsColourGrade(kindSlug)} framesOf={framesOf}
            gradeSince={moves.rows.filter(a => a.action === 'status_change' && a.new_value === 'colour_grade').map(a => String(a.created_at ?? '')).sort().pop() ?? null}
            sourceCreated={new Map(sources.rows.map(s => [s.id, s.created_at]))} />
          <details className="rounded-card border border-border bg-surface p-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-muted-foreground">Scan details — every file the AI looked at</summary>
            <div className="mt-4"><Inbox item={item} rows={seen.rows} /></div>
          </details>
        </div>
        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
          {/* its own scroll, so its sticky tab bar sticks inside it — not over the app's top bar (the owner, 22 Oct
              2026: "the bars are overriden") — and it never runs off the bottom of the screen */}
          <div className="overflow-y-auto overflow-x-hidden rounded-card border border-border bg-card xl:max-h-[calc(100vh-6rem)]">
            <EditorCardDrawer key={id} id={id} onClose={() => router.push('/dashboard/editor')} hideFolderFiles />
          </div>
          <Sources item={item} rows={sources.rows} now={now} />
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
type Board = { url: string; cols: number; rows: number; count: number; every_s: number }
type FramesMap = Map<string, { url: string; at_s: number }[]> & { boards?: Map<string, Board> }
const driveKey = (r: DriveSeen) => `drive:${r.drive_file_id}:${r.md5 ?? r.revision ?? `${r.size}@${r.modified}`}`

function stackFilesOf(item: ContentItem, rows: readonly DriveSeen[], framesOf: FramesMap = new Map()): StackFile[] {
  const round = roundOf(item)
  // EVERY VERSION HANDED IN IS ITS OWN TAB (the owner, 22 Oct 2026: "remember u click between versions of that video and
  // it opens up"): the first keeps the video's key (what the AI matches to), each later one follows the one before
  const card: StackFile[] = currentFiles(item).filter(f => !isRetiredAt(f, round) && isVideo({ mime: f.mime, name: f.name })).flatMap(f => {
    const asset = assetIdOf(f)
    const history = assetHistory(item, asset)
    return history.map((v, i) => {
      // the card's copy until it is measured itself: the frames the scan took of the same file in Drive (live, 22 Oct
      // 2026: a video Ryan confirmed showed no picture)
      const seenAs = v.drive_file_id ? rows.find(r => r.drive_file_id === v.drive_file_id) : null
      const driveFrames = ((seenAs?.scan as { frames?: (string | null)[] } | null)?.frames ?? []).map((u, k) => ({ url: String(u ?? ''), at_s: k })).filter(x => x.url)
      const own = framesOf.get(`r2:${v.url}`) ?? []
      const frames = own.length ? own : driveFrames
      return {
        key: i === 0 ? `a:${asset}` : `a:${asset}@${v.version}`, name: v.name, at: v.uploaded_at, source: 'card' as const,
        kind: i === 0 ? null : 'recut', matchKey: i === 0 ? null : (i === 1 ? `a:${asset}` : `a:${asset}@${history[i - 1].version}`),
        ask: false, busy: false, thumb: frames[0]?.url ?? null, frames, confidence: null, otherCard: null,
        board: framesOf.boards?.get(`r2:${v.url}`) ?? (seenAs ? framesOf.boards?.get(driveKey(seenAs)) ?? null : null),
        file: { id: v.id, url: v.url, name: v.name, version: v.version },
      }
    })
  })
  const drive: StackFile[] = rows
    .filter(r => !['taken', 'ignored', 'footage'].includes(r.state) && isVideo({ mime: r.mime, name: r.path }) && !isFootage({ name: r.path }))
    .map(r => {
      const scan = (r.scan ?? null) as { kind?: string; asset?: string | null; same_as?: string | null; ask?: boolean; confidence?: number; frames?: (string | null)[]; other_card?: { title?: string } | null } | null
      const a = scan?.asset ?? null
      const matchKey = !a ? null : a.startsWith('seen:') ? `s:${a.slice(5)}` : a.startsWith('card:') ? `o:${a.slice(5)}` : `a:${a}`
      return {
        // a "graded" verdict on a file seen before the card was at colour grade is only a cut (verdictOf says so now)
        key: `s:${r.id}`, name: r.path, at: r.created_time ?? r.modified ?? r.first_seen_at, source: 'drive', kind: scan?.kind === 'graded' && r.stage_at_seen !== 'colour_grade' ? 'recut' : scan?.kind ?? null, matchKey,
        ask: !!scan?.ask, busy: r.state === 'new' || r.state === 'scanning', thumb: scan?.frames?.find(Boolean) ?? null,
        frames: (scan?.frames ?? []).map((u, i) => ({ url: String(u ?? ''), at_s: i })).filter(x => x.url),
        board: framesOf.boards?.get(driveKey(r)) ?? null,
        confidence: typeof scan?.confidence === 'number' ? scan.confidence : null, otherCard: scan?.other_card?.title ?? null, otherCardId: (scan?.other_card as { id?: string } | null)?.id ?? null,
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
      ask: false, busy: false, thumb: null, confidence: null, otherCard: scan?.other_card?.title ?? null, otherCardId: (scan?.other_card as { id?: string } | null)?.id ?? null,
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
function Workspace({ item, rows, needsGrade, gradeSince, sourceCreated, framesOf }: { item: ContentItem; rows: DriveSeen[]; needsGrade: boolean; gradeSince: string | null; sourceCreated: Map<string, string>; framesOf: FramesMap }) {
  const all = useMemo(() => stackVersions(stackFilesOf(item, rows, framesOf)), [item, rows, framesOf])
  const rowById = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows])
  // a file that is only a copy of ANOTHER card's video is that card's, not a video here (the owner, 22 Oct 2026: "why
  // are videos getting checked with their own videos?" — the Flinders draft sat in the shoot's folder and on its card)
  // A VIDEO THAT IS ANOTHER CARD'S — a copy of it, or a new cut of it — is never added here: the card says where it is,
  // a press away (the owner, 22 Oct 2026: "if videos are appearing in multiple cards dont add it but prompt the card
  // there and tell it where it is at so when they click it takes them there")
  const elsewhere = all.filter(s => s.otherCard && s.entries.every(e => e.source !== 'card'))
  const stacks = all.filter(s => !elsewhere.includes(s))
  const round = roundOf(item)
  const gradedThisRound = gradedRoundOf(item) === round
  const approvedFiles = new Set(clipApprovalsOf(item).map(a => a.file_id))
  const current = currentFiles(item)
  const atGrade = String(item.status) === 'colour_grade'
  const beforeGrade = new Set(atGrade ? rows.filter(r => r.state === 'scanned' && gradeStanding(r, sourceCreated.get(r.source_id), gradeSince) === 'before').map(r => r.id) : [])
  const offerable = (r: DriveSeen | undefined) => !!r && r.state === 'scanned' && !beforeGrade.has(r.id)
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
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === 'Top of the link' ? 1 : b[0] === 'Top of the link' ? -1 : a[0].localeCompare(b[0])))
  const [folder, setFolder] = useState<string | null>(null)
  const shown = folder ? ordered.filter(([f]) => f === folder) : ordered
  const [pick, setPick] = useState<{ stack: string; entry: string } | null>(null)
  // a press on a tile further down brings the player into view (the owner: "when i click i have to scroll up")
  const playerRef = useRef<HTMLDivElement | null>(null)
  // SIDE BY SIDE (back, the owner, 22 Oct 2026): choose videos on the card, open them side by side with their comments
  const router = useRouter()
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const pickOf = (s: Stack) => { const f = info(s).file; return f ? `${f.id}@${f.version}` : null }
  const openSideBySide = (keys: string[]) => { if (keys.length) router.push(`/dashboard/editor/${item.id}/compare?f=${encodeURIComponent(keys.join(','))}`) }
  const sel = stacks.find(s => s.key === pick?.stack) ?? stacks[0] ?? null
  const entry = sel ? (sel.entries.find(e => e.key === pick?.entry) ?? sel.latest) : null
  const info = (s: Stack) => {
    const asset = s.entries.find(e => e.source === 'card')?.key.slice(2).split('@')[0] ?? null
    const file = asset ? current.find(f => assetIdOf(f) === asset) : null
    const pending = s.entries.filter(e => e.source === 'drive' && offerable(rowById.get(e.key.slice(2))) && e.kind !== 'copy').map(e => rowById.get(e.key.slice(2))!)
    const gone = s.entries.some(e => e.source === 'drive') && s.entries.every(e => e.source !== 'drive' || rowById.get(e.key.slice(2))?.state === 'gone')
    const next = videoNext({ status: item.status, needsGrade, gradedThisRound: gradedThisRound && !!file, approved: !!file && approvedFiles.has(file.id), newInDrive: pending.length > 0, gone, onCard: !!asset })
    return { file, pending, next }
  }

  if (!stacks.length) {
    return (
      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Film className="h-4 w-4" aria-hidden /> Videos</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">No videos yet — they show here as soon as the editor puts them in the card’s Drive link.</p>
        {elsewhere.length > 0 && <Elsewhere list={elsewhere} />}
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-5 rounded-card border border-border bg-surface p-5">
      <div ref={playerRef} className="scroll-mt-4" />
      {sel && entry && <Player item={item} s={sel} entry={entry} info={info(sel)} rowById={rowById} beforeGrade={beforeGrade} onEntry={k => setPick({ stack: sel.key, entry: k })} />}
      <div>
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold"><Film className="h-4 w-4" aria-hidden /> Videos <span className="text-muted-foreground">({stacks.length})</span></h2>
          <span className="flex items-center gap-2">
            <AiScanning n={rows.filter(r => r.state === 'new' || r.state === 'scanning').length} />
            {selecting
              ? <>
                  <Button size="sm" disabled={picked.size === 0} onClick={() => openSideBySide([...picked])} className="h-9 rounded-full px-4 text-[13px] font-semibold">Side by side ({picked.size})</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setSelecting(false); setPicked(new Set()) }} className="h-9 rounded-full px-3 text-[13px]">Cancel</Button>
                </>
              : <Button size="sm" variant="outline" onClick={() => setSelecting(true)} className="h-9 rounded-full px-4 text-[13px] font-semibold">Select to compare</Button>}
          </span>
        </header>
        {ordered.length > 1 && (
          <nav aria-label="Folders" className="mb-3 flex flex-wrap gap-1.5">
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
        <div className="flex flex-col gap-4">
          {shown.map(([f, list]) => (
            <div key={f}>
              {ordered.length > 1 && <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground"><FolderOpen className="h-3.5 w-3.5" aria-hidden />{f}</h3>}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {list.map(s => {
                  const { next, pending } = info(s)
                  const key = pickOf(s)
                  const on = selecting ? !!key && picked.has(key) : sel?.key === s.key
                  return (
                    <li key={s.key}>
                      <button type="button" disabled={selecting && !key} title={selecting && !key ? 'Only videos on the card can be compared — confirm it first' : undefined}
                        onClick={() => selecting
                          ? key && setPicked(m => { const n = new Set(m); if (n.has(key)) n.delete(key); else n.add(key); return n })
                          : (setPick({ stack: s.key, entry: s.latest.key }), playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))} aria-pressed={on}
                        className={`flex w-full flex-col overflow-hidden rounded-inner border bg-background text-left transition hover:shadow-md ${on ? 'border-foreground ring-2 ring-foreground/20' : pending.length ? 'border-accent-amber' : 'border-border'}`}>
                        <span className="relative block aspect-[9/12] w-full bg-muted">
                          <HoverFrames frames={s.latest.frames ?? []} thumb={s.latest.thumb} board={s.latest.board ?? null} />
                          <span className="absolute left-1.5 top-1.5 flex gap-1">
                            {s.versions.map(v => <span key={v} className={`rounded-full px-1.5 text-[10px] font-bold ${v === s.latest.label ? 'bg-foreground text-background' : 'bg-background/80 text-foreground'}`}>{v}</span>)}
                            {s.latest.graded && <span className="rounded-full bg-tint-green px-1.5 text-[10px] font-bold">Graded</span>}
                          </span>
                        </span>
                        <span className="flex flex-col gap-1 p-2">
                          <span className="truncate text-[13px] font-semibold">{s.title}</span>
                          <span className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[next.tone]}`}>{next.words}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        {elsewhere.length > 0 && <Elsewhere list={elsewhere} />}
      </div>
    </section>
  )
}

/** the files in this card's links that are another card's videos — named, not counted as this card's */
function Elsewhere({ list }: { list: Stack[] }) {
  const byCard = new Map<string, { title: string; files: string[] }>()
  for (const s of list) {
    const k = s.otherCardId ?? s.otherCard ?? ''
    const names = s.entries.filter(e => e.source === 'drive').map(e => e.name.slice(e.name.lastIndexOf('/') + 1))
    byCard.set(k, { title: s.otherCard ?? 'another card', files: [...(byCard.get(k)?.files ?? []), ...names] })
  }
  return (
    <div className="mt-4 flex flex-col gap-2">
      {[...byCard.entries()].map(([id, c]) => <ElsewhereCard key={id} id={id} title={c.title} files={c.files} />)}
    </div>
  )
}

/** one card a file here belongs to: its name, where it is, and the way there */
function ElsewhereCard({ id, title, files }: { id: string; title: string; files: string[] }) {
  const { row } = useRow<ContentItem>('content_items', /^[0-9a-f-]{36}$/.test(id) ? id : null)
  const stage = row ? STEPS[stepOf(row.status)] ?? null : null
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <b>{files.length === 1 ? files[0] : `${files.length} files`}</b> {files.length === 1 ? 'is' : 'are'} already on <b>“{row?.title ?? title}”</b>{stage ? ` — ${stage}` : ''}. Not added here.
      </span>
      {row && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background">Open that card <ExternalLink className="h-3 w-3" aria-hidden /></span>}
    </>
  )
  return row
    ? <Link href={`/dashboard/editor/${row.id}`} className="flex flex-wrap items-center gap-2 rounded-inner border border-border bg-background p-3 text-[13px] hover:bg-muted">{body}</Link>
    : <p className="flex flex-wrap items-center gap-2 rounded-inner border border-border bg-background p-3 text-[13px]">{body}</p>
}

/** one frame of a storyboard, by its place in the tiled picture */
function BoardFrame({ board, index, className = '' }: { board: Board; index: number; className?: string }) {
  const i = Math.max(0, Math.min(board.count - 1, index))
  const x = board.cols > 1 ? ((i % board.cols) / (board.cols - 1)) * 100 : 0
  const y = board.rows > 1 ? (Math.floor(i / board.cols) / (board.rows - 1)) * 100 : 0
  return <span className={`block bg-black bg-no-repeat ${className}`} style={{ backgroundImage: `url(${board.url})`, backgroundSize: `${board.cols * 100}% ${board.rows * 100}%`, backgroundPosition: `${x}% ${y}%` }} />
}

/**
 * A TILE'S PICTURE — and, as the cursor moves across it, the picture at THAT point of the video with a line where the
 * cursor is (the owner, 22 Oct 2026: "where is the long vertical line", "it should be wherever we drag it not fixed
 * points"). From the storyboard (a frame a second) once it is made; until then, the nearest of the twelve frames.
 */
function HoverFrames({ frames, thumb, board }: { frames: { url: string; at_s: number }[]; thumb: string | null; board: Board | null }) {
  const [at, setAt] = useState<number | null>(null)   // 0–1 across the tile
  if (!thumb && !board) return <span className="flex h-full items-center justify-center"><Film className="h-5 w-5 text-muted-foreground" aria-hidden /></span>
  const fallback = at !== null && frames.length ? frames[Math.min(frames.length - 1, Math.floor(at * frames.length))].url : thumb
  return (
    <span className="absolute inset-0 block"
      onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setAt(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width))) }}
      onMouseLeave={() => setAt(null)}>
      {board && at !== null
        ? <BoardFrame board={board} index={Math.floor(at * board.count)} className="h-full w-full" />
        : fallback ? <img src={fallback} alt="" className="h-full w-full object-cover" /> : <BoardFrame board={board!} index={0} className="h-full w-full" />}
      {board && <link rel="preload" as="image" href={board.url} />}
      {at !== null && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${at * 100}%` }} />}
    </span>
  )
}

const folderName = (path: string) => { const i = path.lastIndexOf('/'); return i < 0 ? 'Top of the link' : path.slice(0, i) }

/**
 * THE PLAYER — the chosen video, big, with its versions as tabs to click between (the owner, 22 Oct 2026: "why cant
 * i click between versions here to see the video at the top"). A version on the card plays from the card's own copy,
 * with its comments a press away; one in Drive plays from Drive; a new one has Confirm / Not this right under it.
 */
function Player({ item, s, entry, info, rowById, beforeGrade, onEntry }: {
  item: ContentItem; s: Stack; entry: Stack['entries'][number]; info: { file: ReturnType<typeof currentFiles>[number] | null | undefined; pending: DriveSeen[]; next: { words: string; tone: NextTone } }
  rowById: Map<string, DriveSeen>; beforeGrade: Set<string>; onEntry: (key: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const row = entry.source === 'drive' ? rowById.get(entry.key.slice(2)) ?? null : null
  // the version chosen plays its own file; the newest is the card's current one
  const cardFile = entry.source === 'card' ? (entry.file ?? info.file) : null
  const offer = row && info.pending.some(p => p.id === row.id) ? row : null
  const answer = async (action: 'confirm' | 'ignore') => {
    setBusy(action)
    try {
      const res = await fetch(`/api/editor-preview/${item.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, seen_ids: action === 'confirm' && offer ? [offer.id] : info.pending.map(p => p.id) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not do that')
      toast.success(action === 'confirm' ? 'Handed in — it copies onto the card now' : 'Set aside — it won’t be offered again')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not do that') } finally { setBusy(null) }
  }
  const why = ((row?.scan as { reasons?: string[] } | null)?.reasons ?? []).slice(0, 3)
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
      <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-inner bg-black">
        {cardFile?.url
          ? <video ref={videoRef} key={cardFile.url} src={cardFile.url} controls playsInline preload="metadata" className="aspect-[9/16] w-full bg-black object-contain" />
          : row
            ? <iframe key={row.drive_file_id} src={`https://drive.google.com/file/d/${row.drive_file_id}/preview`} title={entry.name} allow="autoplay" className="aspect-[9/16] w-full border-0" />
            : <div className="flex aspect-[9/16] items-center justify-center p-6 text-center text-[13px] text-white/70">{entry.source === 'other' ? `This version is on “${entry.otherCard}”` : 'No preview'}</div>}
      </div>
      {/* THE TIMELINE (the owner, 22 Oct 2026: "it should be wherever we drag it not fixed points") — a card video
          seeks; a Drive one shows its pictures */}
      {/* the standard player only — one set of controls, the same on every video (the owner, 22 Oct 2026: "things are
          inconsistent why is there a custom player action"); the picture under the cursor lives on the tiles */}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-[20px] font-semibold leading-tight">{s.title}</h2>
          <span className={`mt-1.5 inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONES[info.next.tone]}`}>{info.next.words}</span>
        </div>
        {/* the versions, to click between */}
        <div role="tablist" aria-label="Versions" className="flex flex-wrap gap-1.5">
          {[...s.entries].reverse().filter(e => !e.sameAsEarlier).map(e => (
            <button key={e.key} type="button" role="tab" aria-selected={e.key === entry.key} onClick={() => onEntry(e.key)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${e.key === entry.key ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
              {e.label}{e.graded ? ' · Graded' : ''}{e.source === 'card' ? ' · on the card' : e.source === 'other' ? ' · other card' : ''}
            </button>
          ))}
        </div>
        <p className="truncate text-[13px] text-muted-foreground">{entry.name}{row && beforeGrade.has(row.id) ? ' — from before colour grade, not a grade' : ''}</p>
        {/* the same file saved under other names is this version — named, so nothing looks missing (the owner,
            22 Oct 2026: "new menu medley final is not there?") */}
        {(() => {
          const twins = s.entries.filter(e => e.label === entry.label && e.key !== entry.key && !e.graded).map(e => e.name.slice(e.name.lastIndexOf('/') + 1))
          return twins.length ? <p className="text-[12px] text-muted-foreground">Also saved as: {twins.join(', ')} — the same file, byte for byte</p> : null
        })()}
        {offer && (
          <div className="flex flex-wrap items-center gap-2 rounded-inner border border-accent-amber bg-tint-amber/40 p-3">
            <span className="min-w-0 flex-1 text-[13px]">{(offer.scan as { copy_failed?: boolean } | null)?.copy_failed
              ? <><b>The copy from Drive failed</b> (Drive stopped handing the file out for a while) — confirm again to retry.</>
              : <><b>New in Drive.</b> Add it to the card as {entry.label}?</>}</span>
            <Button size="sm" disabled={!!busy} onClick={() => void answer('confirm')} className="h-9 rounded-full px-4 text-[13px] font-semibold">
              <Check className="mr-1 h-3.5 w-3.5" aria-hidden />{busy === 'confirm' ? 'Handing in…' : 'Confirm'}
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void answer('ignore')} className="h-9 rounded-full px-4 text-[13px] font-semibold">Not this</Button>
          </div>
        )}
        {cardFile && assetHistory(item, assetIdOf(cardFile)).length > 1 && (
          <Link href={`/dashboard/editor/${item.id}/compare?f=${encodeURIComponent(assetHistory(item, assetIdOf(cardFile)).map(v => `${v.id}@${v.version}`).join(','))}`}
            className="inline-flex w-fit items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[13px] font-semibold text-background">
            Compare its versions side by side
          </Link>
        )}
        {cardFile && (
          <Link href={reviewPath(item.id, cardFile.id, cardFile.name)} className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[13px] font-semibold hover:bg-muted">
            Comments on this video
          </Link>
        )}
        {why.length > 0 && (
          <details className="text-[12px] text-muted-foreground">
            <summary className="cursor-pointer font-semibold">Why the AI put it here</summary>
            <ul className="mt-1 list-disc pl-5">{why.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
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
