'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, ExternalLink, HardDriveDownload, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRow, useTable } from '@/lib/db-client'
import type { AssetVersion, Batch, Client, ContentItem, TeamUser, WorkflowActivity } from '@/lib/db-types'
import Chip from '../ui/Chip'
import { useRole } from '../useRole'
import BrandCard from '../production/BrandCard'
import CollapsibleCard from '../CollapsibleCard'
import FilesToWorkFrom from './FilesToWorkFrom'
import { Thumb } from '../social/schedule/tiles'
import { uploadFiles } from '../uploadQueue'
import { slidesOf, type Slide } from '../../lib/version-files-core'
import { linkKindOf } from '../../lib/card-link-core'
import { channelSpecs, PLATFORM_MEDIA } from '../../lib/media-fit-core'
import type { Platform } from '../../lib/publish-core'
import { historyLines, type HistoryJob, HISTORY_PREVIEW, NO_HISTORY } from '../../lib/card-history-core'
import { DEFAULT_TZ, formatInZone } from '../../lib/timezone-core'
import { flagsOf } from '../../lib/card-flag-core'
import { plannedCount, finalsInWords } from '../../lib/deliverable-group-core'
import {
  BLOCKER_LADDER, BLOCKER_NEEDS, EDITOR_LANES, NOT_GIVEN, QC_CHECKLIST,
  beforeYouStart, blockerWords, handoverState, qcComplete, qcDoneFor, reviewWords, reviewerNameOf, showsHandover, workFrom,
} from '../../lib/editor-sop-core'
import { columnOf } from '../../lib/board-core'

/**
 * THE EDITOR'S CARD, IN THE ORDER THE VIDEO EDITORS SOP READS (11 Sep 2026,
 * the owner: "do what's from that doc" — nothing else):
 *
 *   1. Before you start   §2  confirm the brief: objective, deliverables,
 *                             platform specs, deadline; shot list, notes,
 *                             brand guidelines, previous edits
 *   2. Work from          §1  the Dropbox folder in; finals to Drive
 *   3. Your versions      §1  the final export — upload, or a copy from
 *                             Drive; where the source files were handed off
 *   4. Quality check      §4  the seven checks, then submit
 *   5. Handover           §5  three ticks once approved
 *   6. I'm blocked        §7  the 24-hour rule, with the SOP's who-to-ask
 *   7. What happened          the card's own history
 *
 * Every section is drawn always; an empty one says so in a line rather than
 * vanishing (the render lesson of 11 Sep 2026). Nothing the SOP does not
 * give an editor is here: handing on, the kind of work, the client's own
 * settings and links are the manager's.
 */
type DriveRow = { id: string; name: string; type: 'image' | 'video'; bytes: number | null }

/** the only folder URL form Drive publishes (gdrive-core.folderUrl, kept out
 *  of the browser bundle) */
const folderUrl = (folderId: string) => `https://drive.google.com/drive/folders/${folderId}`

const H2 = 'text-[12px] font-semibold uppercase tracking-wide text-muted-foreground'
const primaryBtn = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50'
const outlineBtn = 'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50'
const ghostBtn = 'h-11 rounded-full px-4 text-[14px] font-semibold'
const field = 'min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px] font-normal'

export default function EditorCardDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { me } = useRole()
  const { row: item } = useRow<ContentItem>('content_items', id)
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: versions } = useTable<AssetVersion>('asset_versions', { by: byItem })
  const byEntity = useMemo(() => ({ entity_id: id }), [id])
  const { rows: activity } = useTable<WorkflowActivity>('workflow_activity', { by: byEntity })
  const { rows: team } = useTable<TeamUser>('team_users')
  const { row: shoot } = useRow<Batch>('batches', item?.batch_id ?? null)
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)
  const zone = client?.timezone || DEFAULT_TZ
  const nameOf = (uid: string | null | undefined) => team.find(u => u.id === uid)?.name ?? null
  const when = (iso: string) => formatInZone(iso, zone, 'full') ?? iso

  const [working, setWorking] = useState<string | null>(null)

  /* ── the latest files ── */
  const latest = useMemo(() => [...versions].sort((a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0))[0] ?? null, [versions])
  const slides = useMemo(() => slidesOf(latest), [latest])
  const planned = plannedCount(shoot?.planned_deliverables)
  const finals = finalsInWords(slides.length, planned)

  /* ── flags off the history ── */
  const flags = useMemo(() => flagsOf(activity as never, me?.id ?? ''), [activity, me?.id])
  const ackRow = useMemo(() => activity.find(a => a.action === 'acknowledged' && a.actor_id === item?.owner_id) ?? null, [activity, item?.owner_id])

  const post = async (path: string, body: Record<string, unknown>, said: string, what = said, method: 'POST' | 'PATCH' = 'POST') => {
    setWorking(what)
    try {
      const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? json?.problems?.[0] ?? 'That did not work'))
      toast.success(said)
      return json
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work')
      return null
    } finally {
      setWorking(null)
    }
  }
  const flag = (body: Record<string, unknown>, said: string) => post(`/api/production/items/${id}/flag`, body, said)

  /* ── your versions: upload, Drive pick ── */
  const fileInput = useRef<HTMLInputElement>(null)
  const writeVersion = async (next: Slide[], what: string) => {
    await post(`/api/production/items/${id}/versions`, { files: next, file_url: next[0]?.url ?? '' }, what, 'Saving the files')
  }
  const onFiles = async (files: File[]) => {
    if (files.length === 0) return
    setWorking('Uploading')
    try {
      const { done } = uploadFiles(files, { purpose: 'social' })
      const up = await done
      const added: Slide[] = up.map(u => ({ url: u.url, name: u.file.name, type: u.file.type.startsWith('video/') ? 'video' : 'image' }))
      await writeVersion([...slides, ...added], `Added ${added.length} — saved as a new version`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The upload did not finish')
      setWorking(null)
    }
  }
  const removeFile = (i: number) => void writeVersion(slides.filter((_, j) => j !== i), 'File removed — saved as a new version')

  const [driveOpen, setDriveOpen] = useState(false)
  const [drive, setDrive] = useState<DriveRow[] | null>(null)
  const [driveNote, setDriveNote] = useState<string | null>(null)
  useEffect(() => {
    if (!driveOpen || drive !== null) return
    let cancelled = false
    fetch(`/api/social/schedule/drive?itemId=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json?.error) { setDriveNote(String(json.error)); setDrive([]) }
        else { setDrive((json?.files ?? []) as DriveRow[]); setDriveNote(null) }
      })
      .catch(() => { if (!cancelled) { setDriveNote('Google Drive did not answer. Try again in a moment.'); setDrive([]) } })
    return () => { cancelled = true }
  }, [driveOpen, drive, id])
  const bringAcross = async (row: DriveRow) => {
    const json = await post('/api/social/schedule/drive', { item_id: id, file_ids: [row.id] }, 'Copied in from Drive', 'Copying from Drive')
    const files = (json?.files ?? []) as Slide[]
    if (files.length > 0) { await writeVersion([...slides, ...files], `Added ${files.length} from Drive — saved as a new version`); setDriveOpen(false) }
  }

  /* ── source files ── */
  const [source, setSource] = useState(item?.link_url ?? '')
  useEffect(() => { setSource(item?.link_url ?? '') }, [item?.link_url])
  const sourceCheck = linkKindOf(source)
  const saveSource = async () => {
    const url = source.trim()
    setWorking('Saving the link')
    try {
      const res = url
        ? await fetch(`/api/production/items/${id}/link`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
        : await fetch(`/api/production/items/${id}/link`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save the link')
      toast.success(url ? 'Source files link saved' : 'Source files link removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the link')
    } finally {
      setWorking(null)
    }
  }

  /* ── quality check and submit ── */
  const [ticks, setTicks] = useState<string[]>([])
  const [riskOpen, setRiskOpen] = useState(false)
  const [riskNote, setRiskNote] = useState('')
  /** WHERE JOY SHOULD LOOK (Abby, 11 Sep 2026: "the task must have the link
   *  … Canva link and page number for her to go through") — optional when
   *  the final is on the card itself */
  const [reviewLink, setReviewLink] = useState(item?.review_link ?? '')
  const [reviewNote, setReviewNote] = useState(item?.review_note ?? '')
  useEffect(() => { setReviewLink(item?.review_link ?? ''); setReviewNote(item?.review_note ?? '') }, [item?.review_link, item?.review_note])
  const reviewLinkOk = reviewLink.trim() === '' || /^https:\/\/\S+$/i.test(reviewLink.trim())
  // ABBY'S RULE: the maker's submit goes straight to the quality reviewer
  const submitting = item?.status === 'draft_uploaded' || item?.status === 'revision_required'
  const submit = async () => {
    if (!submitting) return
    if (slides.length === 0) { toast.error('Upload the final first'); return }
    if (!reviewLinkOk) { toast.error('The review link must start with https://'); return }
    const ok = await flag({ kind: 'qc_done', ticks }, 'Quality check recorded')
    if (!ok) return
    // the card's own fields take a PATCH (the items route has no POST)
    const where = await post(`/api/production/items/${id}`, { review_link: reviewLink.trim() || null, review_note: reviewNote.trim() || null }, 'Saved where to look', 'Saving', 'PATCH')
    if (where === null) return
    const moved = await post(`/api/production/items/${id}/transition`, { to: 'quality_check' }, item?.status === 'revision_required' ? 'Revisions done — the quality reviewer has it' : 'Sent for the quality check', 'Sending')
    if (moved) setTicks([])
  }

  /* ── blocked ── */
  const [blockOpen, setBlockOpen] = useState(false)
  const [need, setNeed] = useState<string>('')
  const [fromId, setFromId] = useState<string>('')
  const [blockNote, setBlockNote] = useState('')
  const sendBlocked = async () => {
    const json = await flag({ kind: 'blocked', need, from_id: fromId || undefined, note: blockNote }, 'They have been told')
    if (json) { setBlockOpen(false); setNeed(''); setFromId(''); setBlockNote('') }
  }

  if (!item) {
    return (
      <div role="status" aria-busy="true" className="flex h-full min-h-[320px] items-center justify-center p-5 text-[14px] text-muted-foreground">Loading…</div>
    )
  }

  const status = String(item.status)
  const column = columnOf(item.status as never)
  const lane = EDITOR_LANES.find(l => l.columns.includes(column)) ?? EDITOR_LANES[0]
  const holder = me?.id === item.owner_id
  const frozen = ['scheduled', 'published'].includes(status)
  const editing = holder && ['draft_uploaded', 'revision_required', 'revision_complete'].includes(status)
  const review = reviewWords(status, reviewerNameOf(team as never))
  const platforms = (Array.isArray(item.platform_targets) ? item.platform_targets.map(String) : []).filter((p): p is Platform => p in PLATFORM_MEDIA)
  const specs = channelSpecs({ platforms, types: slides.some(s => s.type === 'video') || slides.length === 0 ? ['video'] : ['image'] })
    .map(s => ({ platform: s.label, lines: s.groups.flatMap(g => g.lines) }))
  const brief = beforeYouStart({
    card: item as never, shoot: shoot as never, specs,
    driveFolderUrl: client?.drive_folder_id ? folderUrl(String(client.drive_folder_id)) : null,
  })
  const from = workFrom({ card: item as never, shoot: shoot as never, driveFolderUrl: client?.drive_folder_id ? folderUrl(String(client.drive_folder_id)) : null })
  const handover = handoverState(item as never)
  const qcDone = qcDoneFor(item as never)
  const blocked = blockerWords(item as never, nameOf, when)
  const history = historyLines({
    activity: activity.map(r => ({ ...r, actor_name: nameOf(r.actor_id) })),
    jobs: [] as HistoryJob[],
    postedSlides: (item as { posted_slides?: unknown }).posted_slides,
    fmt: when,
  })
  const busy = working !== null
  const dueWords = item.due_date ? `Due ${formatInZone(String(item.due_date), zone, 'short') ?? String(item.due_date).slice(0, 10)}` : 'No due date'

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* ── the header: what, for whom, where it is ── */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-5">
        <div className="min-w-0">
          <p className={H2}>{client?.name ?? ''}{shoot ? ` · From the shoot: ${shoot.title}` : ''}</p>
          <h2 className="text-section-title">{item.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip tone="surface">{lane.label}{review ? ` · ${review}` : ''}</Chip>
            <Chip tone="muted">{dueWords}</Chip>
            {finals && <Chip tone="green">{finals}</Chip>}
            {flags.risk && <Chip tone="red">At risk: {flags.risk}</Chip>}
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {ackRow
              ? `Acknowledged ${formatInZone(String(ackRow.created_at), zone, 'short') ?? ''}`
              : item.owner_id ? 'Not acknowledged yet — the playbook asks for the same day it lands.' : 'Nobody holds this card yet.'}
          </p>
          {!ackRow && holder && (
            <Button variant="outline" className={`${outlineBtn} mt-2`} disabled={busy} onClick={() => void flag({ kind: 'acknowledged' }, 'Acknowledged — the team knows you are on it')}>
              <Check className="h-4 w-4" aria-hidden /> Acknowledge — I am on it
            </Button>
          )}
          {blocked && <p role="status" className="mt-2 text-[13px] font-semibold text-accent-red-deep">{blocked}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
          <X className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>

      {/* ── 1. before you start (§2) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-before">
        <p id="ed-before" className={H2}>Before you start</p>
        <p className="text-[12px] text-muted-foreground">Confirm the brief. If it does not say what the video is meant to achieve, ask before cutting — do not guess.</p>
        <dl className="flex flex-col gap-2">
          {brief.map(row => (
            <div key={row.key} className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-semibold">{row.label}</dt>
              <dd className={`whitespace-pre-line text-[14px] ${row.value ? '' : 'text-muted-foreground'}`}>
                {row.href && row.value
                  ? <a href={row.href} className="inline-flex min-h-11 items-center underline underline-offset-4">{row.value}</a>
                  : (row.value ?? NOT_GIVEN)}
              </dd>
            </div>
          ))}
        </dl>
        {item.client_id && (
          <CollapsibleCard title="Brand guidelines" summary={`${client?.name ?? 'The client'}’s colours, fonts, voice and logo files`}>
            <BrandCard clientId={item.client_id} />
          </CollapsibleCard>
        )}
      </section>

      {/* ── 2. work from (§1) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-from">
        <p id="ed-from" className={H2}>Work from</p>
        <p className="text-[13px]">
          <span className="font-semibold">Footage folder: </span>
          {from.footage
            ? <a href={from.footage} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4">Open the Dropbox or Drive folder <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">, opens in a new tab</span></a>
            : <span className="text-muted-foreground">Not given yet — edit from the Dropbox working folder; ask Production where it is.</span>}
        </p>
        <FilesToWorkFrom item={item as never} isManager={false} frozen={frozen} />
        <p className="text-[13px]">
          <span className="font-semibold">Finals go to: </span>
          {from.finalsFolder
            ? <a href={from.finalsFolder} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4">the client’s Google Drive folder, in this month’s Scheduled folder <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">, opens in a new tab</span></a>
            : <span className="text-muted-foreground">the client’s Google Drive monthly folder (no folder is linked here yet).</span>}
        </p>
      </section>

      {/* ── 3. your versions (§1, finals only) ── */}
      <section className="flex flex-col gap-3 border-b border-border px-5 py-4" aria-labelledby="ed-versions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="ed-versions" className={H2}>Your versions{latest ? ` · version ${latest.version_number}` : ''}</p>
          {working && <p role="status" className="text-[12px] text-muted-foreground">{working}…</p>}
        </div>
        {slides.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No final yet. Export the finished cut in the platform’s spec, watch it start to finish, then add it here. Pictures and videos only — never raw footage.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slides.map((s, i) => (
              <li key={`${s.url}-${i}`} className="relative">
                <Thumb slide={s} className="aspect-[4/5] w-full rounded-tile" label={s.name} />
                {editing && !frozen && (
                  <button type="button" aria-label={`Remove ${s.name}`} disabled={busy} onClick={() => removeFile(i)}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground hover:bg-background">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {editing && !frozen ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className={outlineBtn} disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" aria-hidden /> Upload the final
            </Button>
            <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden"
              onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void onFiles(f) }} />
            <Button variant="outline" className={outlineBtn} disabled={busy} onClick={() => setDriveOpen(o => !o)}>
              <HardDriveDownload className="h-4 w-4" aria-hidden /> Pick the final from Google Drive
            </Button>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">{frozen ? 'Booked in or posted — the files are the channel’s now.' : holder ? 'Out for review — a new version can go on once it comes back.' : 'Only the person holding this card adds files.'}</p>
        )}
        {driveOpen && (
          <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold">The client’s Drive folder</p>
              <Button variant="ghost" className={ghostBtn} onClick={() => setDriveOpen(false)}>Close</Button>
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
                    <Button variant="outline" className="h-11 shrink-0 rounded-full px-3 text-[13px] font-semibold" disabled={busy} onClick={() => void bringAcross(row)}>Use this</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor="ed-source" className="text-[13px] font-semibold">Source files (Dropbox)<span className="ml-1 font-normal text-muted-foreground">— where the project and raw files were handed over</span></label>
          {holder && !frozen ? (
            <div className="flex flex-wrap items-center gap-2">
              <input id="ed-source" value={source} onChange={e => setSource(e.target.value)} placeholder="https://www.dropbox.com/…" className={`${field} min-w-0 flex-1`} />
              <Button variant="outline" className={outlineBtn} disabled={busy || (source.trim() !== '' && !sourceCheck.ok) || source.trim() === (item.link_url ?? '')} onClick={() => void saveSource()}>Save</Button>
            </div>
          ) : item.link_url ? (
            <a href={item.link_url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-[14px] underline underline-offset-4">Open the source files<span className="sr-only">, opens in a new tab</span></a>
          ) : (
            <p className="text-[13px] text-muted-foreground">Not handed over yet.</p>
          )}
          {source.trim() !== '' && !sourceCheck.ok && <p role="alert" className="text-[12px] font-medium text-accent-red-deep">{sourceCheck.reason}</p>}
        </div>
      </section>

      {/* ── 4. quality check, then submit (§4) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-qc">
        <p id="ed-qc" className={H2}>Quality check before submitting</p>
        {submitting && holder ? (
          <>
            <p className="text-[12px] text-muted-foreground">Never submit a cut you have not reviewed. Tick each one, then submit — it goes straight to the quality reviewer.</p>
            <ul className="flex flex-col gap-1">
              {QC_CHECKLIST.map(c => (
                <li key={c.key}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                    <input type="checkbox" className="h-5 w-5" checked={ticks.includes(c.key)}
                      onChange={e => setTicks(t => e.target.checked ? [...t, c.key] : t.filter(k => k !== c.key))} />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
            {qcComplete(ticks) && (
              <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
                <label htmlFor="ed-review-link" className="text-[13px] font-semibold">Where should the reviewer look? <span className="font-normal text-muted-foreground">(a Canva link and the page — optional when the final is uploaded here)</span></label>
                <input id="ed-review-link" value={reviewLink} onChange={e => setReviewLink(e.target.value)} placeholder="https://www.canva.com/design/…" className={`${field} min-w-0`} />
                <input id="ed-review-note" aria-label="Which page or frame" value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="page 3" className={`${field} min-w-0`} />
                {!reviewLinkOk && <p role="alert" className="text-[12px] font-medium text-accent-red-deep">The review link must start with https://</p>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button className={primaryBtn} disabled={busy || !qcComplete(ticks) || slides.length === 0 || !reviewLinkOk} onClick={() => void submit()}
                title={slides.length === 0 ? 'Upload the final first' : !qcComplete(ticks) ? 'Tick every check first' : undefined}>
                {status === 'revision_required' ? 'Revisions done — submit for quality check' : 'Submit for quality check'}
              </Button>
              {!riskOpen && (
                <Button variant="ghost" className={ghostBtn} disabled={busy} onClick={() => setRiskOpen(true)}>
                  <AlertTriangle className="h-4 w-4" aria-hidden /> Something looks wrong — flag it
                </Button>
              )}
            </div>
            {slides.length === 0 && <p className="text-[12px] text-muted-foreground">Upload the final first.</p>}
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {qcDone ? 'Quality check done on this version.' : submitting ? 'The person holding this card does the quality check.' : 'Done for this stage — the check happens before each submit.'}
          </p>
        )}
        {riskOpen && (
          <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
            <label htmlFor="ed-risk" className="text-[13px] font-semibold">What looks wrong, or why the date is at risk? One line — the account managers are told.</label>
            <textarea id="ed-risk" rows={2} autoFocus value={riskNote} onChange={e => setRiskNote(e.target.value)} className={`${field} resize-none p-2.5`} />
            <div className="flex items-center gap-2">
              <Button className={primaryBtn} disabled={busy || !riskNote.trim()} onClick={async () => { const ok = await flag({ kind: 'deadline_risk', note: riskNote }, 'Flagged — the account managers have been told'); if (ok) { setRiskOpen(false); setRiskNote('') } }}>Flag it</Button>
              <Button variant="ghost" className={ghostBtn} onClick={() => { setRiskOpen(false); setRiskNote('') }}>Cancel</Button>
            </div>
          </div>
        )}
        {(item as { change_note?: string | null }).change_note && (
          <div className="rounded-inner border border-border bg-tint-amber p-3 text-[13px]">
            <p className="font-semibold">What to change</p>
            <p className="whitespace-pre-line">{(item as { change_note?: string | null }).change_note}</p>
          </div>
        )}
      </section>

      {/* ── 5. handover (§5) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-hand">
        <p id="ed-hand" className={H2}>Handover</p>
        {showsHandover(status) ? (
          <ul className="flex flex-col gap-1">
            {handover.map(h => (
              <li key={h.key} className="flex min-h-11 items-center gap-3 text-[14px]">
                {h.done
                  ? <Chip tone="green">Done</Chip>
                  : h.auto
                    ? <Chip tone="muted">Not yet</Chip>
                    : holder
                      ? <Button variant="outline" className="h-11 rounded-full px-3 text-[13px] font-semibold" disabled={busy || (h.key === 'source' && !item.link_url)}
                          title={h.key === 'source' && !item.link_url ? 'Save the source files link first' : undefined}
                          onClick={() => void flag({ kind: h.key === 'drive' ? 'handover_drive' : 'handover_source' }, 'Ticked')}>Tick</Button>
                      : <Chip tone="muted">Not yet</Chip>}
                <span>{h.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Once the card is approved: the final in the Drive monthly folder, the source files handed off, and the next owner tagged.</p>
        )}
      </section>

      {/* ── 6. blocked (§7) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-blocked">
        <p id="ed-blocked" className={H2}>Blocked?</p>
        <p className="text-[12px] text-muted-foreground">Nothing stays blocked for more than 24 hours. Ever.</p>
        {blocked ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px]">{blocked}</p>
            {holder && <Button variant="outline" className={outlineBtn} disabled={busy} onClick={() => void flag({ kind: 'unblocked' }, 'Unblocked')}>Unblocked</Button>}
          </div>
        ) : !blockOpen ? (
          holder && !frozen
            ? <Button variant="outline" className={`${outlineBtn} w-fit`} disabled={busy} onClick={() => setBlockOpen(true)}>I’m blocked</Button>
            : <p className="text-[13px] text-muted-foreground">Not blocked.</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
            <ol className="list-decimal pl-5 text-[12px] text-muted-foreground">
              {BLOCKER_LADDER.map(l => <li key={l}>{l}</li>)}
            </ol>
            <label htmlFor="ed-need" className="text-[13px] font-semibold">What do you need?</label>
            <select id="ed-need" value={need} onChange={e => setNeed(e.target.value)} className={`${field} h-11`}>
              <option value="">Pick one</option>
              {BLOCKER_NEEDS.map(n => <option key={n.key} value={n.key}>{n.label} — go to {n.who.toLowerCase()}</option>)}
            </select>
            <label htmlFor="ed-from" className="text-[13px] font-semibold">Who are you asking? <span className="font-normal text-muted-foreground">(optional — the right people are told either way)</span></label>
            <select id="ed-from" value={fromId} onChange={e => setFromId(e.target.value)} className={`${field} h-11`}>
              <option value="">Whoever the playbook names</option>
              {team.filter(u => u.active_status !== false && u.role !== 'client' && u.id !== me?.id).map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
            <label htmlFor="ed-block-note" className="text-[13px] font-semibold">What is blocked? One line.</label>
            <textarea id="ed-block-note" rows={2} value={blockNote} onChange={e => setBlockNote(e.target.value)} className={`${field} resize-none p-2.5`} placeholder="Scene 3 footage is missing from the folder" />
            <div className="flex items-center gap-2">
              <Button className={primaryBtn} disabled={busy || !need || !blockNote.trim()} onClick={() => void sendBlocked()}>Tell them</Button>
              <Button variant="ghost" className={ghostBtn} onClick={() => setBlockOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </section>

      {/* ── 7. what happened ── */}
      <section className="flex flex-col gap-2 px-5 py-4" aria-labelledby="ed-history">
        <p id="ed-history" className={H2}>What happened</p>
        {history.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{NO_HISTORY}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {history.slice(0, HISTORY_PREVIEW).map(l => (
              <li key={l.key} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span>{l.text}</span>
                <span className="text-[12px] text-muted-foreground">{when(l.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
