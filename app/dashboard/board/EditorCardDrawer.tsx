'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, ExternalLink, Pencil, Upload, X } from 'lucide-react'
import { canReadClientComments, visibleComments } from '../../lib/comment-access-core'
import CardSaid from './CardSaid'
import { managesClients, type Role } from '../../lib/identity-core'
import { Button } from '@/components/ui/button'
import { useRow, useTable } from '@/lib/db-client'
import type { Batch, Client, ClientContact, ContentItem, ItemComment, TeamUser, TeamUserClient, WorkKind, WorkflowActivity } from '@/lib/db-types'
import Chip from '../ui/Chip'
import { PRIORITIES, PRIORITY_LABELS, priorityChip, priorityOf, type Priority } from '../../lib/priority-core'
import { useRole } from '../useRole'
import BrandCard from '../production/BrandCard'
import CardTabs, { tabPanel, useCardTab } from './CardTabs'
import FilesToWorkFrom from './FilesToWorkFrom'
import DriveFolderFiles from './DriveFolderFiles'
import Link from 'next/link'
import { reviewPath } from '../../lib/video-review-core'
import { driveTargetOf, finishedEditOf, linkKindOf } from '../../lib/card-link-core'
import { assetHistory, assetIdOf, currentFiles, finalFilesForRound, finalFilesOf, handsInFiles, hasFinishedWork, mayReplaceAsset, needsAdoption, stillToReplace, withFinalFiles, withReplacement, withRetired, withoutFinalFile } from '../../lib/final-files-core'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { clipApprovalsOf } from '../../lib/clip-approvals-core'
import { handInRound, roundLabel, roundOf } from '../../lib/edit-round-core'
import { uploadFiles } from '../uploadQueue'
import { kindOf } from '../../lib/files-core'
import { pullId, pullInFlight, pullProgress } from '../../lib/drive-pull-core'
import type { DrivePull } from '@/lib/db-types'
import { shootCardId } from '../../lib/deliverable-group-core'
import { cardUsesPlan } from '../../lib/editor-sop-core'
import { cardPeople } from '../../lib/card-people-core'
import { channelSpecs, PLATFORM_MEDIA } from '../../lib/media-fit-core'
import type { Platform } from '../../lib/publish-core'
import { historyLines, type HistoryJob, HISTORY_PREVIEW, NO_HISTORY } from '../../lib/card-history-core'
import { DEFAULT_TZ, formatInZone } from '../../lib/timezone-core'
import { flagsOf } from '../../lib/card-flag-core'
import {
  EDITOR_LANES, NOT_GIVEN, QC_CHECKLIST,
  briefRowsFor, handoverState, planMissingWords, planReadState, qcComplete, qcDoneFor, reviewWords, reviewerNameOf, showsHandover, workFrom,
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
 *   3. Your finished edit §1  the Drive or Dropbox link to the final —
 *                             nothing else (the owner, 14 Sep 2026)
 *   4. Quality check      §4  the seven checks, then submit
 *   5. Handover           §5  three ticks once approved
 *   7. What happened          the card's own history
 *
 * Every section is drawn always; an empty one says so in a line rather than
 * vanishing (the render lesson of 11 Sep 2026). Nothing the SOP does not
 * give an editor is here: handing on, the kind of work, the client's own
 * settings and links are the manager's.
 */

/** the only folder URL form Drive publishes (gdrive-core.folderUrl, kept out
 *  of the browser bundle) */
const folderUrl = (folderId: string) => `https://drive.google.com/drive/folders/${folderId}`

const H2 = 'text-[12px] font-semibold uppercase tracking-wide text-muted-foreground'
const primaryBtn = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50'
const outlineBtn = 'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50'
const ghostBtn = 'h-11 rounded-full px-4 text-[14px] font-semibold'
const field = 'min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px] font-normal'

const ED_TABS = ['brief', 'work', 'comments', 'brand', 'history'] as const

export default function EditorCardDrawer({ id, onClose, hideFolderFiles = false }: {
  id: string
  onClose: () => void
  /** the card's own page draws the folder's files itself, wide (15 Sep 2026) */
  hideFolderFiles?: boolean
}) {
  const { me } = useRole()
  const { row: item } = useRow<ContentItem>('content_items', id)
  // the card's kind of work — the raw row carries only the id, and the
  // Designer's upload hangs off the graphics kind (17 Sep 2026)
  const { row: kind, loading: kindLoading } = useRow<WorkKind>('work_kinds', item?.work_kind_id ?? null)
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const byEntity = useMemo(() => ({ entity_id: id }), [id])
  const { rows: activity } = useTable<WorkflowActivity>('workflow_activity', { by: byEntity })
  const { rows: team } = useTable<TeamUser>('team_users')
  // the card's comments, and who runs the client — the one box below writes
  // to the account manager (the owner, 13 Sep 2026: "currently there is no
  // same tab chat for editor")
  const { rows: comments } = useTable<ItemComment>('item_comments', { by: byItem })
  const byClient = useMemo(() => ({ client_id: item?.client_id ?? '' }), [item?.client_id])
  const { rows: clientLinks } = useTable<TeamUserClient>('team_user_clients', { by: byClient })
  // whom the work is for — one of the client's people, or the business (15 Sep 2026)
  const { rows: clientPeople } = useTable<ClientContact>('client_contacts', { by: byClient })
  const managers = useMemo(() => {
    const ids = new Set(clientLinks.map(l => l.team_user_id))
    return team.filter(u => ids.has(u.id) && managesClients(u.role) && u.active_status !== false)
  }, [clientLinks, team])
  const thread = useMemo(() => {
    if (!me) return [] as ItemComment[]
    return visibleComments(me.role as Role, me.id, comments.map(c => ({
      ...c, visibility: String(c.visibility ?? 'internal'), assigned_to: c.assigned_to ?? null, parent_id: c.parent_id ?? null,
    })) as unknown as (ItemComment & { visibility: string; assigned_to: string | null; parent_id: string | null })[])
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  }, [comments, me])
  // COMMENTS ON A CLIP LIVE ON THE CLIP (the owner, 16 Sep 2026: "the main
  // card's comments are confusing — we might have multiple comments per
  // version and it gets clunky and full; make sure it links to them
  // instead"): the card's thread keeps only what was said about the card;
  // each clip that has comments is one line with a count and the link to
  // its page, where the comments sit on the timeline
  const clipThreads = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number; last: string }>()
    for (const c of thread) {
      const fid = (c as { video_file_id?: string | null }).video_file_id
      if (!fid) continue
      const e = m.get(fid) ?? { id: fid, name: (c as { video_file_name?: string | null }).video_file_name || 'A clip', count: 0, last: String(c.created_at ?? '') }
      e.count += 1
      e.last = String(c.created_at ?? e.last)
      m.set(fid, e)
    }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last))
  }, [thread])
  const cardThread = useMemo(() => thread.filter(c => !(c as { video_file_id?: string | null }).video_file_id), [thread])
  const [note, setNote] = useState('')
  // THE CARD IN TABS (21 Sep 2026) — CardTabs.tsx says why; the sections below are where they were
  const [tab, setTab] = useCardTab('editor', ED_TABS, 'brief')
  const [sendingNote, setSendingNote] = useState(false)
  const [toClient, setToClient] = useState(false)
  const isManager = me?.role === 'account_manager' || me?.role === 'super_admin'
  const sendNote = async () => {
    const text = note.trim()
    if (!text || !item) return
    setSendingNote(true)
    try {
      // tagged to the first account manager; the rest are named in the text
      // so the same tag rule reaches them
      // a manager writes a note for the team, or a reply the client sees;
      // the maker's note is tagged to the first account manager and names
      // the rest (the owner, 13 Sep 2026: "I'm the account manager, why am
      // I seeing write to me")
      const [first, ...rest] = isManager ? [] : managers
      const mentions = rest.map(m => `@${m.name || m.email}`).join(' ')
      const res = await fetch(`/api/production/items/${item.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: mentions ? `${text} ${mentions}` : text,
          visibility: isManager && toClient ? 'client' : 'internal',
          ...(first ? { assigned_to: first.id } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not send')
      setNote('')
      toast.success(isManager
        ? (toClient ? `Replied — ${client?.name ?? 'the client'} sees it on their portal` : 'Note added')
        : managers.length > 0 ? `Sent — ${managers.map(m => m.name || m.email).join(', ')} will be told` : 'Sent to the team')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send')
    } finally {
      setSendingNote(false)
    }
  }
  const { row: shoot } = useRow<Batch>('batches', item?.batch_id ?? null)
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)
  const zone = client?.timezone || DEFAULT_TZ
  const nameOf = (uid: string | null | undefined) => team.find(u => u.id === uid)?.name ?? null
  const when = (iso: string) => formatInZone(iso, zone, 'full') ?? iso

  const [working, setWorking] = useState<string | null>(null)

  // no "N of M finals in" (the owner, 14 Sep 2026): editors hand in a Drive or
  // Dropbox link, not a count of files

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
  // EDIT THE CARD (the owner, 16 Sep 2026: "my editor just added his cards and
  // he wants to change the info on the card"): the title, the due date and
  // what needs doing, for whoever holds the card or a manager — the PATCH
  // route already lets exactly those people in
  const [editing, setEditing] = useState(false)
  const [eTitle, setETitle] = useState('')
  const [eDue, setEDue] = useState('')
  const [eBrief, setEBrief] = useState('')
  const [ePriority, setEPriority] = useState<Priority>('normal')
  const openEdit = () => {
    if (!item) return
    setEPriority(priorityOf(item))
    setETitle(String(item.title ?? ''))
    setEDue(item.due_date ? String(item.due_date).slice(0, 10) : '')
    setEBrief(String((item as { brief?: string | null }).brief ?? ''))
    setEditing(true)
  }
  const saveEdit = async () => {
    const title = eTitle.trim()
    if (!title) { toast.error('Give the card a name'); return }
    const ok = await post(`/api/production/items/${id}`, { title, due_date: eDue || null, brief: eBrief.trim() || null, priority: ePriority }, 'Card updated', 'Saving the card', 'PATCH')
    if (ok) setEditing(false)
  }

  /* ── NO FILES ON THE EDITOR'S CARD (the owner, 14 Sep 2026: "the editor
     card should not have the files — only a Drive or Dropbox link"): the
     work is the link; files a card carries from before are not drawn here ── */

  // NO DRIVE PICKER (the owner, 14 Sep 2026: "they have to upload their own
  // Drive from review, not pick from the existing Drive"): the editor hands
  // in a file, or their own Dropbox / Drive link — the Source files box below

  /* ── source files ── */
  // the box holds the finished edit only — never the folder to work from, which
  // would read as version 1 the moment somebody pressed Save (16 Sep 2026)
  const finishedUrl = item ? (finishedEditOf(item as never)?.url ?? '') : ''
  // FINISHED FILES (the Designer page, 17 Sep 2026): a graphics card hands in
  // files, not a link — uploaded onto the card, stamped with the round
  const filesCard = item ? handsInFiles({ ...item, work_kinds: (item as { work_kinds?: { slug?: string } | null }).work_kinds ?? kind } as never) : false
  const uploadInput = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const addFinalFiles = async (picked: File[]) => {
    if (!item || picked.length === 0) return
    setUploading(`Uploading ${picked.length} ${picked.length === 1 ? 'file' : 'files'}`)
    try {
      const landed = await uploadFiles(picked, { purpose: 'social' }).done
      const next = withFinalFiles(finalFilesOf(item as never), landed.map(({ file, url }) => ({ name: file.name, url, mime: file.type, size: file.size })), handInRound(item as never), me?.id ?? null, new Date().toISOString())
      const ok = await post(`/api/production/items/${id}`, { final_files: next }, `${landed.length} ${landed.length === 1 ? 'file' : 'files'} handed in as ${roundLabel(handInRound(item as never))}`, 'Saving the files', 'PATCH')
      if (!ok) throw new Error('Could not save the files')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(null)
      if (uploadInput.current) uploadInput.current.value = ''
    }
  }
  // THE UPLOAD POPUP (the owner, 22 Sep 2026: "when uploading version 1, a popup — upload the file instead of
  // a Drive link"): pick, see what was picked, upload. The files land on the card, each one its own asset.
  const [uploadOpen, setUploadOpen] = useState(false)
  // A LINK CARD SENT BACK: its copied clips become its files, once, so one can be replaced (final-files-core.ts)
  const adoptTried = useRef<string | null>(null)
  useEffect(() => {
    if (!item || !(me?.id === item.owner_id || me?.role === 'super_admin' || me?.role === 'account_manager') || adoptTried.current === item.id) return
    if (!needsAdoption(item as never) || handInRound(item as never) === roundOf(item as never)) return
    adoptTried.current = item.id
    void fetch(`/api/production/items/${item.id}/adopt-clips`, { method: 'POST' }).catch(() => {})
  }, [item, me?.id, me?.role])
  const [queued, setQueued] = useState<File[]>([])
  const [linkMode, setLinkMode] = useState(false)
  // ONE ASSET REPLACED IN PLACE: the new file takes the asset's slot as the next version; the rest are untouched
  const replaceInput = useRef<HTMLInputElement | null>(null)
  const [replacing, setReplacing] = useState<string | null>(null)
  const replaceAsset = async (assetId: string, file: File | undefined) => {
    if (!item || !file) return
    setUploading(`Uploading the new ${file.name}`)
    try {
      const [landed] = await uploadFiles([file], { purpose: 'social' }).done
      if (!landed) throw new Error('The upload did not finish')
      const next = withReplacement(finalFilesOf(item as never), assetId, { name: file.name, url: landed.url, mime: file.type, size: file.size }, handInRound(item as never), me?.id ?? null, new Date().toISOString())
      const ok = await post(`/api/production/items/${id}`, { final_files: next }, `Replaced — ${roundLabel(handInRound(item as never))} of ${file.name}`, 'Saving the new version', 'PATCH')
      if (!ok) throw new Error('Could not save the new version')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(null); setReplacing(null)
      if (replaceInput.current) replaceInput.current.value = ''
    }
  }
  // DROPPED FROM THIS VERSION ON (final-files-core.ts): out of the card from the next hand-in; the earlier
  // file and its comments stay; reversible until it is handed in
  const dropAsset = async (assetId: string, back: boolean) => {
    if (!item) return
    await post(`/api/production/items/${id}`, { final_files: withRetired(finalFilesOf(item as never), assetId, back ? null : handInRound(item as never)) }, back ? 'Brought back' : `Dropped from ${roundLabel(handInRound(item as never))} on`, back ? 'Bringing it back' : 'Dropping it', 'PATCH')
  }
  // A CLIP APPROVED ON THE CLIENT'S BEHALF, or taken back — a manager's press (clip-approval route)
  const teamApprove = async (fileId: string, undo: boolean) => {
    if (!item) return
    await post(`/api/production/items/${id}/clip-approval`, { file_id: fileId, decision: undo ? 'undo' : 'approve' }, undo ? 'Approval taken back' : 'Marked approved for the client', undo ? 'Taking it back' : 'Marking it approved')
  }
  const removeFinalFile = async (fid: string) => {
    if (!item) return
    await post(`/api/production/items/${id}`, { final_files: withoutFinalFile(finalFilesOf(item as never), fid) }, 'Taken off', 'Removing the file', 'PATCH')
  }
  // STILL COPYING IN AT SUBMIT TIME (the owner, 16 Sep 2026: "what happens if
  // you submit for quality check before it finished uploading?"): the submit
  // goes through — the link is the hand-in — and the line under the button
  // says the reviewer sees the files as they land
  const finishedFolderId = driveTargetOf(finishedUrl)?.id ?? null
  const { row: finishedPull } = useRow<DrivePull>('drive_pulls', finishedFolderId && item ? pullId(finishedFolderId, item.id) : null)
  const copyingWords = finishedPull && pullInFlight(finishedPull as never) ? pullProgress(finishedPull as never, Date.now())?.words ?? null : null
  const [source, setSource] = useState(finishedUrl)
  useEffect(() => { setSource(finishedUrl) }, [finishedUrl])
  const sourceCheck = linkKindOf(source)
  const saveSource = async () => {
    const url = source.trim()
    setWorking('Saving the link')
    try {
      const res = url
        ? await fetch(`/api/production/items/${id}/link`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, final: true }) })
        : await fetch(`/api/production/items/${id}/link`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save the link')
      toast.success(url ? `Saved as ${roundLabel(handInRound(item as never))}` : 'Finished edit link removed')
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
  // ABBY'S RULE: the maker's submit goes straight to the quality reviewer
  const submitting = item?.status === 'draft_uploaded' || item?.status === 'revision_required'
  const submit = async () => {
    if (!submitting) return
    // a designer hands in files, an editor a link — either counts as finished work
    if (!item || !hasFinishedWork(item as never)) { toast.error(filesCard ? 'Upload the finished files first' : 'Add the link to your finished edit first'); return }
    const ok = await flag({ kind: 'qc_done', ticks }, 'Quality check recorded')
    if (!ok) return
    const moved = await post(`/api/production/items/${id}/transition`, { to: 'quality_check' }, item?.status === 'revision_required' ? 'Revisions done — the quality reviewer has it' : 'Sent for the quality check', 'Sending')
    if (moved) setTicks([])
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
  // WHO MAY PUT FILES ON THE CARD (the owner, 22 Sep 2026: "can super admins just replace it when it's in
  // progress — I wanna do it"): the holder, or a manager. The server has always allowed a manager
  // (item-edit-core canEditItemFields); only the buttons were the holder's.
  const mayFile = holder || me?.role === 'super_admin' || me?.role === 'account_manager'
  const frozen = ['scheduled', 'published'].includes(status)
  const review = reviewWords(status, reviewerNameOf(team as never))
  const platforms = (Array.isArray(item.platform_targets) ? item.platform_targets.map(String) : []).filter((p): p is Platform => p in PLATFORM_MEDIA)
  const specs = channelSpecs({ platforms, types: ['video'] })
    .map(s => ({ platform: s.label, lines: s.groups.flatMap(g => g.lines) }))
  // the plan's rows on the card the shoot made — and on a hand-made card whose
  // maker asked for them (editor-sop-core.cardUsesPlan, 16 Sep 2026); the
  // shoot's own presses (Got the footage, I've read the plan) only on the former
  const shootsOwn = !!item.batch_id && item.id === shootCardId(String(item.batch_id))
  const fromPlan = cardUsesPlan(item as never, shootCardId)
  const brief = briefRowsFor({
    card: item as never, shoot: shoot as never, specs,
    driveFolderUrl: client?.drive_folder_id ? folderUrl(String(client.drive_folder_id)) : null,
  }, fromPlan)
  // the plan was asked for and the shoot has none: say so, once the shoot row is here
  const planMissing = fromPlan && shoot ? planMissingWords(shoot as never) : null
  const from = workFrom({ card: item as never, shoot: shoot as never, driveFolderUrl: client?.drive_folder_id ? folderUrl(String(client.drive_folder_id)) : null }, fromPlan)
  const handover = handoverState(item as never)
  const planRead = planReadState(shoot, me?.id)
  const qcDone = qcDoneFor(item as never)
  const history = historyLines({
    activity: activity.map(r => ({ ...r, actor_name: nameOf(r.actor_id) })),
    jobs: [] as HistoryJob[],
    postedSlides: (item as { posted_slides?: unknown }).posted_slides,
    // a clip's tick names the version and links to the clip (22 Sep 2026)
    itemId: id, files: finalFilesOf(item as never), approvals: clipApprovalsOf(item as never),
    fmt: when,
  })
  const busy = working !== null
  const dueWords = item.due_date ? `Due ${formatInZone(String(item.due_date), zone, 'short') ?? String(item.due_date).slice(0, 10)}` : 'No due date'

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* ── the header: what, for whom, where it is ── */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-5">
        <div className="min-w-0">
          <p className={H2}>{client?.name ?? ''}{(() => { const who = (item as { for_contact_id?: string | null }).for_contact_id; const p = who ? clientPeople.find(c => c.id === who) : null; return p ? ` · for ${p.name}` : '' })()}{shoot ? ` · From the shoot: ${shoot.title}` : ''}</p>
          <h2 className="text-section-title">{item.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip tone="surface">{lane.label}{review ? ` · ${review}` : ''}</Chip>
            <Chip tone="muted">{dueWords}</Chip>
            {priorityChip(item) && <Chip tone={priorityChip(item)!.tone}>{priorityChip(item)!.label}</Chip>}
            {flags.risk && <Chip tone="red">At risk: {flags.risk}</Chip>}
            {(holder || isManager) && !frozen && !editing && (
              <button type="button" onClick={openEdit} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted">
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit the card
              </button>
            )}
          </div>
          {/* THE NEXT STEP, at the top where it is seen (17 Sep 2026): the hand-in
              sits low in the card, so the one thing to do next is also here */}
          {holder && submitting && !frozen && !kindLoading && (
            <div className="mt-3" data-next-step>
              {!hasFinishedWork(item as never) ? (
                <Button className={primaryBtn} disabled={busy}
                  onClick={() => {
                    if (filesCard) { setUploadOpen(true); return }
                    const box = document.getElementById('ed-source')
                    box?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    box?.focus()
                  }}>
                  <Upload className="h-4 w-4" aria-hidden /> {filesCard ? `Upload ${roundLabel(handInRound(item as never))}` : `Add the ${roundLabel(handInRound(item as never))} link`}
                </Button>
              ) : (
                <Button className={primaryBtn} disabled={busy}
                  onClick={() => document.getElementById('ed-qc')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  <Check className="h-4 w-4" aria-hidden /> {roundLabel(handInRound(item as never))} is on the card — tick the checks and submit
                </Button>
              )}
            </div>
          )}
          {editing && (
            <div className="mt-3 flex flex-col gap-2 rounded-inner border border-border bg-surface p-3" data-edit-card>
              <label className="flex flex-col gap-1 text-[12px] font-semibold">Name
                <input value={eTitle} onChange={e => setETitle(e.target.value)} className={field} aria-label="The card’s name" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold">Due
                <input type="date" value={eDue} onChange={e => setEDue(e.target.value)} className={`${field} max-w-[200px]`} aria-label="Due date" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold">Priority
                <select value={ePriority} onChange={e => setEPriority(e.target.value as Priority)} className={`${field} max-w-[200px]`} aria-label="Priority">
                  {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold">What needs doing
                <textarea rows={3} value={eBrief} onChange={e => setEBrief(e.target.value)} className={`${field} resize-none p-2.5`} aria-label="What needs doing" />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button className={primaryBtn} disabled={busy} onClick={() => void saveEdit()}>Save</Button>
                <Button variant="outline" className={outlineBtn} disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          )}
          <p className="mt-2 text-[13px] text-muted-foreground">
            {ackRow
              ? `Acknowledged ${formatInZone(String(ackRow.created_at), zone, 'short') ?? ''}`
              : item.owner_id ? 'Not acknowledged yet.' : isManager ? 'Nobody is on this card yet — press Assign an editor.' : 'Nobody is on this card yet.'}
          </p>
          {/* GOT THE FOOTAGE (the owner, 14 Sep 2026): once the footage is
              handed over, the editor says they have it — one press, one line */}
          {/* …only on the card the shoot made (16 Sep 2026: a card made by hand
              that names a shoot is not the shoot's editor's card — no footage
              or plan press on it; the plan link stays) */}
          {shootsOwn && shoot?.footage_handed_at && holder && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {shoot.footage_received_at
                ? <p className="text-[13px] text-muted-foreground">Footage received {formatInZone(String(shoot.footage_received_at), zone, 'short') ?? ''}</p>
                : (
                  <Button className={primaryBtn} disabled={busy}
                    onClick={() => void post(`/api/production/batches/${shoot.id}/footage-received`, {}, 'Thanks — the team knows you have the footage', 'Confirming the footage')}>
                    <Check className="h-4 w-4" aria-hidden /> Got the footage
                  </Button>
                )}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* ONE BUTTON (the owner, 13 Sep 2026: "why are there two buttons?").
                On a shoot's card, "I've read the plan" is the acknowledgement
                — of the plan AND of the card. A card with no shoot behind it
                keeps the plain "I am on it". */}
            {shootsOwn && planRead.on && shoot ? (planRead.read
              ? <p className="text-[13px] text-muted-foreground">You read the plan {formatInZone(planRead.at, zone, 'short') ?? ''}</p>
              : (
                <Button className={primaryBtn} disabled={busy}
                  onClick={async () => {
                    await post(`/api/production/batches/${shoot.id}/acknowledge`, {}, 'Thanks — you have read the plan', 'Reading the plan')
                    if (!ackRow && holder) await flag({ kind: 'acknowledged' }, 'Acknowledged — the team knows you are on it')
                  }}>
                  <Check className="h-4 w-4" aria-hidden /> I’ve read the plan
                </Button>
              ))
            : !ackRow && holder && (
              <Button variant="outline" className={outlineBtn} disabled={busy} onClick={() => void flag({ kind: 'acknowledged' }, 'Acknowledged — the team knows you are on it')}>
                <Check className="h-4 w-4" aria-hidden /> I am on it
              </Button>
            )}
            {/* the plan and its board, read only for the editor — no comments,
                nothing to move (the owner, 14 Sep 2026: "the editor card gets
                the read-only view of the canvas board — they can click it") */}
            {/* …and the plan's board when the card carries the plan (16 Sep 2026) */}
            {fromPlan && shoot && (
              <Link href={`/dashboard/production/shoots/${shoot.id}`} data-plan-link
                className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold underline underline-offset-4">
                Open the plan and board <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
          <X className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>

      <CardTabs label="The card" value={tab} onChange={setTab} tabs={[
        { key: 'brief', label: 'Brief' },
        { key: 'work', label: 'Your work' },
        { key: 'comments', label: 'Comments', count: cardThread.length + clipThreads.reduce((n, t) => n + t.count, 0) },
        { key: 'brand', label: 'Brand' },
        { key: 'history', label: 'What happened', count: history.length },
      ]} />

      <div role="tabpanel" className={tabPanel(tab === 'brief')}>
      {/* ── 1. before you start (§2) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-before">
        <p id="ed-before" className={H2}>Before you start</p>
        {planMissing && <p role="status" className="text-[13px] font-semibold text-accent-red-deep">{planMissing}</p>}
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
      </section>
      </div>

      {/* the brand has its own tab, open and whole — it was a folded box at the foot of the brief. Drawn when
          opened, so a card that never looks at it never fetches it */}
      {tab === 'brand' && (
        <div role="tabpanel" className="flex flex-col gap-2 px-5 py-4">
          <p className={H2}>Brand guidelines</p>
          {item.client_id
            ? <BrandCard clientId={item.client_id} />
            : <p className="text-[13px] text-muted-foreground">This card has no client, so there is no brand to show.</p>}
        </div>
      )}

      <div role="tabpanel" className={tabPanel(tab === 'work')}>
      {/* ── 2. work from (§1) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-from">
        <p id="ed-from" className={H2}>Work from</p>
        {/* on the card's page the files box stands on the left, said once (15 Sep 2026) */}
        {hideFolderFiles ? (
          <p className="text-[13px] text-muted-foreground">The footage folder and its files are on the left.</p>
        ) : (
        <p className="text-[13px]">
          <span className="font-semibold">Footage folder: </span>
          {from.footage
            ? <a href={from.footage} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4">Open the Dropbox or Drive folder <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">, opens in a new tab</span></a>
            : <span className="text-muted-foreground">Not given yet — ask Production.</span>}
        </p>
        )}
        {/* THE FILES BEHIND THE LINK (the owner, 15 Sep 2026: "display files as
            their thumbnail and play it from there — the Drive link"): Drive's
            thumbnails, and Drive's player on a press. Read only. */}
        {!hideFolderFiles && <DriveFolderFiles url={from.footage} />}
        {/* a manager holding their own card may add the FOLDER LINK here — not
            files (the owner, 15 Sep 2026: "why can't I add the folder link then?
            I assigned it to myself"; "not files"); an editor sees, opens and plays */}
        {!hideFolderFiles && <FilesToWorkFrom item={item as never} isManager={isManager} holder={holder} frozen={frozen} linkOnly showFolderFiles={false} />}
        {/* "Finals go to: this month's Drive folder" stood here until 22 Sep 2026 — the finals are uploaded onto the card now, so it said nothing (the owner: "it's redundant") */}
      </section>

      {/* ── 3. YOUR FINISHED EDIT (the owner, 14 Sep 2026: "make it simple —
          a Drive link and comments, that's it for the editor"; "only a Drive
          or Dropbox link"): one box for the link, nothing else ── */}
      <section className="flex flex-col gap-3 border-b border-border px-5 py-4" aria-labelledby="ed-versions">
        <div className="flex items-center justify-between">
          <p id="ed-versions" className={H2}>Your finished edit — {roundLabel(handInRound(item as never))}</p>
          {working && <p role="status" className="text-[12px] text-muted-foreground">{working}…</p>}
        </div>
        {filesCard && !linkMode ? (
          <div className="flex flex-col gap-2" data-final-files>
            {mayFile && !frozen && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" className={outlineBtn} disabled={busy || uploading !== null} onClick={() => setUploadOpen(true)}>
                  <Upload className="h-4 w-4" aria-hidden /> {uploading ?? (currentFiles(item as never).length === 0 ? `Upload the finished files — ${roundLabel(handInRound(item as never))}` : 'Add another file')}
                </Button>
                {currentFiles(item as never).length === 0 && !finishedUrl && (
                  <button type="button" onClick={() => setLinkMode(true)} className="min-h-11 text-[12px] text-muted-foreground underline underline-offset-4">A file over 5GB? Hand in a Drive link instead</button>
                )}
              </div>
            )}
            {stillToReplace(item as never).length > 0 && (
              <p role="status" className="rounded-inner bg-tint-amber p-2.5 text-[13px] font-semibold">
                {stillToReplace(item as never).length} {stillToReplace(item as never).length === 1 ? 'file needs' : 'files need'} a new version before this can go back. The others stay as they are.
              </p>
            )}
            {currentFiles(item as never).length === 0
              ? <p className="text-[13px] text-muted-foreground">{frozen ? 'Booked in or posted — the files are the channel’s now.' : `Nothing handed in for ${roundLabel(handInRound(item as never))} yet.`}</p>
              : (
                <ul className="flex flex-col divide-y divide-border" aria-label="The finished files">
                  {currentFiles(item as never).map(f => {
                    const a = assetIdOf(f)
                    const waiting = stillToReplace(item as never).includes(a)
                    const tick = clipApprovalsOf(item as never).find(x => x.file_id === f.id) ?? null
                    const okByClient = !!tick
                    const isManager = me?.role === 'super_admin' || me?.role === 'account_manager'
                    const dropped = typeof f.retired_round === 'number'
                    const earlier = assetHistory(item as never, a).filter(x => x.id !== f.id)
                    return (
                      <li key={a} className="flex flex-col gap-1 py-2 text-[13px]" data-asset={a}>
                        <div className="flex min-h-11 flex-wrap items-center gap-2">
                          <span className="inline-flex h-6 items-center rounded-full bg-foreground/[0.06] px-2 text-[11px] font-semibold uppercase">{kindOf(f.mime, f.name)}</span>
                          <a href={f.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate underline-offset-4 hover:underline" title={f.name}>{f.name}</a>
                          <span className="shrink-0 text-[12px] text-muted-foreground">{roundLabel(f.version)}</span>
                          {dropped && <span className="rounded-full bg-foreground/[0.08] px-2 py-0.5 text-[11px] font-semibold">Dropped from {roundLabel(f.retired_round as number)} on</span>}
                          {waiting && !dropped && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold">Needs changing</span>}
                          {tick && <span className="rounded-full bg-tint-green px-2 py-0.5 text-[11px] font-semibold" title={`${tick.by}, ${new Date(tick.at).toLocaleString('en-AU')}`}>{/\(MD Media\)$/.test(tick.by) ? `Approved by ${tick.by.replace(/ \(MD Media\)$/, '')} for the client` : 'Approved by the client'}</span>}
                          {isManager && !frozen && !dropped && (
                            <Button variant="outline" disabled={busy} onClick={() => void teamApprove(f.id, okByClient)} className="h-9 rounded-full px-3 text-[12px] font-semibold">{okByClient ? 'Take approval back' : 'Approve for the client'}</Button>
                          )}
                          {mayFile && !frozen && mayReplaceAsset(item as never, a, me?.role === 'super_admin' || me?.role === 'account_manager') && !okByClient && dropped && f.retired_round === handInRound(item as never) && (
                            <Button variant="outline" disabled={busy} onClick={() => void dropAsset(a, true)} className="h-9 rounded-full px-3 text-[12px] font-semibold">Bring back</Button>
                          )}
                          {mayFile && !frozen && mayReplaceAsset(item as never, a, me?.role === 'super_admin' || me?.role === 'account_manager') && !okByClient && !dropped && (
                            <Button variant="ghost" disabled={busy} onClick={() => void dropAsset(a, false)} className="h-9 rounded-full px-3 text-[12px] font-semibold text-muted-foreground hover:text-accent-red-deep">Drop from {roundLabel(handInRound(item as never))}</Button>
                          )}
                          {mayFile && !frozen && mayReplaceAsset(item as never, a, me?.role === 'super_admin' || me?.role === 'account_manager') && !okByClient && !dropped && (
                            <Button variant="outline" disabled={busy || uploading !== null} onClick={() => { setReplacing(a); replaceInput.current?.click() }} className="h-9 rounded-full px-3 text-[12px] font-semibold">
                              {f.version === handInRound(item as never) ? 'Replace again' : `Replace — ${roundLabel(handInRound(item as never))}`}
                            </Button>
                          )}
                          {mayFile && !frozen && earlier.length === 0 && f.version === handInRound(item as never) && <button type="button" disabled={busy} onClick={() => void removeFinalFile(f.id)} aria-label={`Take ${f.name} off`} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>}
                        </div>
                        {earlier.length > 0 && (
                          <p className="pl-1 text-[12px] text-muted-foreground">Earlier: {earlier.map(x => <a key={x.id} href={x.url} target="_blank" rel="noreferrer noopener" className="mr-2 underline underline-offset-4">{roundLabel(x.version)} — {x.name}</a>)}</p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            <input ref={replaceInput} type="file" accept="image/*,video/*,application/pdf" className="hidden" aria-label="The new version of this file"
              onChange={e => { if (replacing) void replaceAsset(replacing, e.target.files?.[0]) }} />
          </div>
        ) : holder && !frozen ? (
          <div className="flex flex-wrap items-center gap-2">
            <input id="ed-source" value={source} onChange={e => setSource(e.target.value)} placeholder="https://drive.google.com/… or https://www.dropbox.com/…" aria-label="Drive or Dropbox link to the finished edit" className={`${field} min-w-0 flex-1`} />
            <Button variant="outline" className={outlineBtn} disabled={busy || (source.trim() !== '' && !sourceCheck.ok) || source.trim() === (item.link_url ?? '')} onClick={() => void saveSource()}>Save</Button>
          </div>
        ) : item.link_url ? (
          <a href={item.link_url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-[14px] underline underline-offset-4">Open the finished edit<span className="sr-only">, opens in a new tab</span></a>
        ) : (
          <p className="text-[13px] text-muted-foreground">{frozen ? 'Booked in or posted — the files are the channel’s now.' : 'Nothing handed in yet.'}</p>
        )}
        {!filesCard && holder && !frozen && item.link_url && (
          <a href={item.link_url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground underline underline-offset-4">Open the finished edit<span className="sr-only">, opens in a new tab</span></a>
        )}
        {source.trim() !== '' && !sourceCheck.ok && <p role="alert" className="text-[12px] font-medium text-accent-red-deep">{sourceCheck.reason}</p>}
      </section>

      {/* ── 4. quality check, then submit (§4) ── */}
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-qc">
        {/* the editor's OWN list from the SOP — not Joy's quality check, which is the next column (the owner, 13 Sep 2026: "how come editor can see the quality check checkbox") */}
        <p id="ed-qc" className={H2}>Your checks before you submit</p>
        {/* the holder submits; so does a manager who put the files on (22 Sep 2026: a super admin replaced two clips and had no submit) */}
        {submitting && mayFile ? (
          <>
            <p className="text-[12px] text-muted-foreground">Tick each one, then submit.</p>
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
            <div className="flex flex-wrap items-center gap-2">
              <Button className={primaryBtn} disabled={busy || !qcComplete(ticks) || !hasFinishedWork(item as never)} onClick={() => void submit()}
                title={!hasFinishedWork(item as never) ? (filesCard ? 'Upload the finished files first' : 'Add the link to your finished edit first') : !qcComplete(ticks) ? 'Tick every check first' : undefined}>
                {status === 'revision_required' ? 'Revisions done — submit for quality check' : 'Submit for quality check'}
              </Button>
              {!riskOpen && (
                <Button variant="ghost" className={ghostBtn} disabled={busy} onClick={() => setRiskOpen(true)}>
                  <AlertTriangle className="h-4 w-4" aria-hidden /> Something looks wrong — flag it
                </Button>
              )}
              {copyingWords && (
                <p className="basis-full text-[12px] text-muted-foreground" role="status">Your finished edit is still copying in ({copyingWords}). You can submit now — the reviewer sees the files as they land.</p>
              )}
            </div>
            {!hasFinishedWork(item as never) && <p className="text-[12px] text-muted-foreground">{filesCard ? 'Upload the finished files first.' : 'Add the link to your finished edit first.'}</p>}
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {qcDone ? 'Quality check done on this version.' : submitting ? 'The person holding this card does the quality check.' : 'Done for this stage.'}
          </p>
        )}
        {riskOpen && (
          <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
            <label htmlFor="ed-risk" className="text-[13px] font-semibold">What looks wrong? One line.</label>
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

      {/* ── 5. handover (§5) — drawn only once there is one (the owner, 13
          Sep 2026: "your UI has so many texts in the card") ── */}
      {showsHandover(status) && (
      <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-hand">
        <p id="ed-hand" className={H2}>Handover</p>
        {(
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
        )}
      </section>
      )}

      </div>

      <div role="tabpanel" className={tabPanel(tab === 'comments')}>
      {/* ── 7a. what was said on each clip: one line per clip, the comments on the clip's page ── */}
      {clipThreads.length > 0 ? (
        <section className="flex flex-col gap-2 border-b border-border px-5 py-4" aria-labelledby="ed-clip-threads">
          <p id="ed-clip-threads" className={H2}>Comments on the clips</p>
          <ul className="flex flex-col gap-1">
            {clipThreads.map(t => (
              <li key={t.id}>
                <Link href={reviewPath(item.id, t.id, t.name)} className="flex min-h-11 items-center gap-2 rounded-inner border border-border px-3 text-[13px] hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate font-semibold" title={t.name}>{t.name}</span>
                  <span className="shrink-0 text-muted-foreground">{t.count} {t.count === 1 ? 'comment' : 'comments'} · last {formatInZone(t.last, zone, 'short') ?? ''}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── 7. what was said — the same section the Post approval drawer draws ── */}
      <section className="border-b border-border" aria-label="What was said">
        <CardSaid
          rows={cardThread as never}
          nameOf={nameOf} roleOf={uid => team.find(u => u.id === uid)?.role ?? null} meId={me?.id}
          when={iso => formatInZone(iso, zone, 'short') ?? ''}
          isManager={isManager} clientName={client?.name} readsClient={canReadClientComments(me?.role ?? null)}
          draft={note} setDraft={setNote} sending={sendingNote} onSend={() => void sendNote()}
          toClient={toClient} setToClient={setToClient}
          mentionable={cardPeople(item, team as never, clientLinks as never, me?.id)}
          placeholder={managers.length > 0 ? `Write to ${managers.map(m => m.name || m.email).join(', ')}…` : 'Write to the account manager…'}
        />
      </section>

      </div>

      <div role="tabpanel" className={tabPanel(tab === 'history')}>
      {/* ── 8. what happened ── */}
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
                {l.href && (
                  <a href={l.href} className="inline-flex min-h-11 items-center text-[12px] underline underline-offset-4">{l.hrefWord ?? 'Live post'}</a>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      </div>

      <Dialog open={uploadOpen} onOpenChange={o => { if (!o && uploading === null) { setUploadOpen(false); setQueued([]) } }}>
        <DialogContent className="bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload the finished files — {item ? roundLabel(handInRound(item as never)) : ''}</DialogTitle>
            <DialogDescription>
              The clips, pictures or PDFs themselves, not a link. Each file is its own piece: if one needs changing later, only that one is replaced and the rest stay as they are. Up to 5GB a file.
            </DialogDescription>
          </DialogHeader>
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-inner border border-dashed border-border bg-surface p-4 text-center text-[14px] hover:bg-muted"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); setQueued(q => [...q, ...Array.from(e.dataTransfer.files ?? [])]) }}>
            <Upload className="h-5 w-5" aria-hidden />
            <span className="font-semibold">Choose files, or drop them here</span>
            <input ref={uploadInput} type="file" multiple accept="image/*,video/*,application/pdf" className="sr-only" aria-label="The finished files"
              onChange={e => { const picked = Array.from(e.target.files ?? []); setQueued(q => [...q, ...picked]) }} />
          </label>
          {queued.length > 0 && (
            <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto text-[13px]" aria-label="Files to upload">
              {queued.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex min-h-11 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{(f.size / 1_048_576).toFixed(f.size > 104_857_600 ? 0 : 1)} MB</span>
                  <button type="button" disabled={uploading !== null} onClick={() => setQueued(q => q.filter((_, k) => k !== i))} aria-label={`Take ${f.name} out`} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={uploading !== null} onClick={() => { setUploadOpen(false); setQueued([]) }} className={outlineBtn}>Cancel</Button>
            <Button disabled={queued.length === 0 || uploading !== null} className={primaryBtn}
              onClick={async () => { await addFinalFiles(queued); setQueued([]); setUploadOpen(false) }}>
              {uploading ?? `Upload ${queued.length || ''} ${queued.length === 1 ? 'file' : 'files'}`.replace('  ', ' ')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
