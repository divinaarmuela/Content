'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { useOrderedLoad } from '../../useOrderedLoad'
import { useProductionLive } from '../useProductionLive'
import {
  clearGroup, completedIn, dismissUpload, enqueueJobAssets,
  uploadFiles as runUploads,
} from '../../uploadQueue'
import { UploadOverall, UploadRows, useUploadGroup } from '../../UploadRows'
import { overallProgress } from '../../../lib/upload-progress-core'
import BrandCard from '../BrandCard'
import { Media, RawFileRow, SlideThumb } from '../../../components/media/ItemMedia'
import { looksLikeVideo } from '../../../lib/video-probe'
import ExportWarnings, {
  exportWarningsFor, type ExportWarning,
} from '../../../components/media/ExportWarnings'
import {
  DEFAULT_TZ, formatInZone, formatWithZone, viewerHint,
} from '../../../lib/timezone-core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft, ArrowDown, ArrowUp, Upload, Send, CheckCircle2, CircleDashed, ExternalLink, MoreHorizontal,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import GettingStarted from '../../GettingStarted'
import HelpHint from '../../HelpHint'
import CollapsibleCard from '../../CollapsibleCard'
import MentionBox from '../../MentionBox'
import { toastOpen } from '../../toastLink'
import { extractMentions } from '../../../lib/mention-core'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Trash2 } from 'lucide-react'
import {
  actingRoles, availableTransitionsAs, presentTransitions, schedulerIdsOf, whoseTurn,
  CLIENT_LABELS, SCHEDULER_STATUSES, STATUS_LABELS, STATUS_MEANING, STATUS_TURN, type ItemStatus,
} from '../../../lib/workflow-core'
import {
  availableBriefTaskTransitionsAs, itemStatusLabel, SHOOT_BRIEF_SLUG,
  BRIEF_STATUS_MEANING, BRIEF_STATUS_TURN,
} from '../../../lib/brief-task-core'
import {
  availableTaskTransitionsAs, isInternalKind, taskStatusLabel,
  TASK_DONE_STATUSES, TASK_STATUS_MEANING, TASK_STATUS_TURN,
} from '../../../lib/task-kind-core'
import { needsNewVersion } from '../../../lib/claim-core'
import {
  MAX_SLIDES, isCarouselType, reorder, slideCountLabel, slidesOf, slidesSatisfyType,
  type Slide,
} from '../../../lib/version-files-core'
import { lastList } from '../../lastList'
import { activityLines, type ActivityRow } from '../../../lib/activity-core'
import { backLinkFor, canClaimEditor, canClaimScheduler } from '../../../lib/work-pages-core'
import { ClaimButton } from '../ClaimButton'
import PostingCard, { type PostingApproval, type PostingContext } from './PostingCard'
import { choosePlatform, platformLabel } from '../../../lib/posting-card-core'
import { approvalChip } from '../../../lib/posting-approval-core'
import type { Role } from '../../../lib/identity-core'

type Version = {
  id: string; version_number: number; created_at: string
  file_url: string; drive_url: string; dropbox_url?: string; notes?: string | null
  /** the ordered slides of a carousel. Empty on every version saved before
   *  carousels existed — `slidesOf` reads file_url for those. */
  files?: Slide[]
}
type Comment = {
  id: string; created_at: string; author_id: string | null; author_name?: string | null
  visibility: string; body: string; resolved: boolean
  /** the person this note is for — tagged with "@Name" */
  assigned_to?: string | null
}
type ScheduleEntry = {
  id: string; platform: string; scheduled_at: string | null; live_url: string | null; publish_status: string
  /** did the hunt for this hand-posted link's numbers find the post? */
  external_match_state?: string | null
}
type Reviewer = { id: string; name: string; email: string; role: string; assigned: boolean }

type Detail = {
  id: string; title: string; client_id: string; client_name: string | null
  /** the audience's zone — every posting time on this page is in it */
  client_timezone?: string | null
  owner_id: string | null
  assigned_by?: string | null
  scheduler_ids?: string[] | null
  viewer_id?: string
  content_type: string; status: ItemStatus; status_label?: string
  priority: string; due_date: string | null; caption: string | null
  client_approval_required: boolean; current_version_number: number
  owner_name?: string | null; managers?: { name: string; email: string }[]
  brief_url?: string | null
  // uses_media is NOT optional decoration: isInternalKind reads it, and
  // leaving it off the type meant every task on this page was treated as an
  // asset — "· Other" in the header, a Scheduling card, "I'll schedule this"
  // on a finished research task, and a back link to a page it never reaches.
  work_kind?: { name: string; slug: string; color: string; uses_media?: boolean } | null
  batch?: {
    id: string; title: string; status?: string
    planned_deliverables?: { type: string; qty: number }[]
    /** the brief page's own content — either of these satisfies submission */
    concept?: string | null; shot_list?: unknown[] | null
  } | null
  /** the client's portal accounts, so a send-to-client can name who it emails */
  client_users?: { name: string; email: string }[]
  raw_assets_url?: string | null; brief?: string | null
  /** this deliverable's own folder — internal, so it never reaches a client */
  drive_url?: string | null; drive_folder_id?: string | null
  /** how much of this item's material is actually IN Drive yet */
  drive_mirror?: { total: number; done: number; copying: boolean; line: string | null } | null
  raw_assets?: { url: string; name: string }[] | null
  versions: Version[]; comments: Comment[]; schedule: ScheduleEntry[]
  /** the named audit trail — internal only, never in the client payload */
  activity?: ActivityRow[]
  viewer_role: Role
  /** the hats this viewer wears ON THIS ITEM — the server's own reading */
  acting_roles?: Role[]
  /** which platforms this item is aimed at, when somebody set them */
  platform_targets?: string[] | null
  /** connected accounts + the live publish job, loaded WITH the item so the
   *  posting card knows its own state before anyone clicks anything */
  posting?: PostingContext | null
  /** the final-post gate — supported=false until the migration has run,
   *  and the page then draws nothing new at all */
  posting_approval?: PostingApproval | null
}

const STATUS_TINT: Record<string, string> = {
  draft_uploaded: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
  internal_review: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  revision_required: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  revision_complete: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  client_review: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900',
  client_changes_requested: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900',
  approved_for_scheduling: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
  scheduled: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-900',
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
}

const PLATFORMS = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube']

/** The server refused to show us this item — as opposed to the network
 *  hiccuping, which is not a reason to navigate anyone away from their work. */
class UnreadableItem extends Error {}

/** A schedule row's state, said in words rather than in database. */
function publishStatusWord(status: string): string {
  if (status === 'scheduled') return 'Scheduled'
  if (status === 'published') return 'Live'
  const words = status.replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : '—'
}

/** Job titles as people say them, for the pickers. */
const ROLE_WORD: Record<string, string> = {
  super_admin: 'Super admin',
  account_manager: 'Account manager',
  scheduler: 'Scheduler',
  editor: 'Editor',
}

/** Pixel size of a local image/video file, measured before it ever leaves
 *  the browser. Resolves null for anything unmeasurable — never throws. */
function measureFile(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const done = (d: { w: number; h: number } | null) => { URL.revokeObjectURL(url); resolve(d) }
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight })
      v.onerror = () => done(null)
      v.src = url
    } else if (file.type.startsWith('image/')) {
      const img = new Image()
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => done(null)
      img.src = url
    } else done(null)
  })
}


export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [detail, setDetail] = useState<Detail | null>(null)
  /** where the READER is, resolved after mount — the server has no opinion
   *  about that, and rendering one would be a hydration mismatch */
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  useEffect(() => {
    try { setViewerTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null) } catch { /* no zone, no hint */ }
  }, [])
  const [busy, setBusy] = useState<string | null>(null)

  const [verDraft, setVerDraft] = useState({ dropbox_url: '', drive_url: '', notes: '' })
  /** the slides of the version being built, in the order they will post */
  const [slides, setSlides] = useState<Slide[]>([])
  /**
   * The files travelling into this version, live from the shared queue.
   *
   * Keyed on the item so a second drop joins the first batch rather than
   * replacing it on screen. The strip fills in as each one lands, and the
   * rows underneath say which file, how far, how fast and how long — the
   * whole of what `Uploading 3 files…` used to stand in for.
   */
  const versionGroup = `version:${id}`
  const versionUploads = useUploadGroup(versionGroup)
  const uploading = versionUploads.some(u => u.status !== 'done' && u.status !== 'failed')
  /** the slide being dragged, for the reorder strip */
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  /** the drop zone is the primary path; the two link fields are the exception,
   *  so they stay folded away until someone actually wants one */
  const [linksOpen, setLinksOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** measured pixel size of the latest preview / freshly-uploaded file */
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null)
  const [draftDims, setDraftDims] = useState<{ w: number; h: number } | null>(null)
  /** exports that will not preview in a browser — said next to the drop zone
   *  they came from, and never in the way of the upload itself */
  const [versionWarnings, setVersionWarnings] = useState<ExportWarning[]>([])
  const [jobWarnings, setJobWarnings] = useState<ExportWarning[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const [commentDraft, setCommentDraft] = useState('')

  // the list this person was on before they opened the item. Read once, in an
  // effect: sessionStorage during render is a hydration mismatch.
  const [cameFrom, setCameFrom] = useState<{ href: string; label: string } | null>(null)
  useEffect(() => { setCameFrom(lastList()) }, [])

  // "Submit for review" reviewer picker — the editor chooses who is asked
  const [reviewPick, setReviewPick] = useState<{ to: ItemStatus; label: string } | null>(null)
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null)
  /** the reviewer fetch failed — an empty list here means "unknown", not "none" */
  const [reviewersFailed, setReviewersFailed] = useState(false)
  /** "what needs to change" — asked when requesting revisions */
  const [revisionAsk, setRevisionAsk] = useState<{ to: ItemStatus; label: string } | null>(null)
  /** the confirm before anything reaches the client's own screen */
  const [clientSend, setClientSend] = useState<{ to: ItemStatus; label: string } | null>(null)
  /** a refusal, shown INSIDE the dialog that caused it. A toast in the far
   *  bottom-right corner, behind a modal, is a message nobody reads — they
   *  press the blue button again instead. */
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [revisionNote, setRevisionNote] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  // type-to-confirm for deletion — a destructive click must be deliberate
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  /** "Publish/queue → who should hear about it?" — the client's assigned
   *  account managers come pre-ticked; anyone managing can be added. */
  const [publishPick, setPublishPick] = useState<{ publishNow: boolean } | null>(null)
  const [pubPeople, setPubPeople] = useState<Reviewer[] | null>(null)
  const [pubChosen, setPubChosen] = useState<Set<string>>(new Set())

  const openPublishPick = async (publishNow: boolean) => {
    setPublishPick({ publishNow })
    setPubPeople(null)
    try {
      const res = await fetch(`/api/clients/${detail!.client_id}/managers`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load people')
      const assignedIds = new Set<string>((json.managers ?? []).map((m: { team_user_id: string }) => m.team_user_id))
      // this client's own managers + super admins only — an AM who doesn't
      // manage this client never appears in its pickers, and neither do you
      const list: Reviewer[] = (json.eligible ?? [])
        .filter((u: { id: string; role: string }) =>
          u.id !== detail!.viewer_id && (u.role === 'super_admin' || assignedIds.has(u.id)))
        .map((u: { id: string; name: string; email: string; role: string }) => ({
          ...u, assigned: assignedIds.has(u.id),
        }))
      list.sort((a, b) => Number(b.assigned) - Number(a.assigned) || (a.name || a.email).localeCompare(b.name || b.email))
      setPubPeople(list)
      setPubChosen(new Set(list.filter(r => r.assigned).map(r => r.id)))
    } catch {
      // picker unavailable → publishing still works, notifications go to the
      // client's assigned managers server-side
      setPubPeople([])
      setPubChosen(new Set())
    }
  }

  const queuePublish = async (publishNow: boolean, notifyIds?: string[]) => {
    setBusy('auto-publish')
    try {
      const res = await fetch(`/api/production/items/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishNow, notifyIds: notifyIds ?? [] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Publish failed')
      // the same request moved the item to Scheduled — say so, because that is
      // the click the owner used to have to make afterwards
      toastOpen(publishNow
        ? 'Publishing now — this moves to Published when the channel confirms'
        : 'Scheduled — it will post itself; it is on the posting calendar',
        '/dashboard/scheduler/calendar', router.push)
      setPublishPick(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setBusy(null)
    }
  }

  // the people who can carry this job: every active, non-client team member.
  // One list serves the owner picker, the comment tagger, AND "who's
  // scheduling this?" — scheduling is a hat you are handed, not a job title.
  const [editors, setEditors] = useState<{ id: string; name: string; email: string; role?: string }[]>([])
  const [schedPick, setSchedPick] = useState<{ to: ItemStatus; label: string } | 'handoff' | null>(null)
  const [schedChosen, setSchedChosen] = useState<Set<string>>(new Set())

  // job-pack source file uploads — queued in the background so you can keep
  // working; the tray in the layout shows progress and the item live-refreshes
  // when each file attaches
  const jobFileRef = useRef<HTMLInputElement>(null)
  /** the same rows the tray shows, for the box that started them */
  const jobUploads = useUploadGroup(`item:${id}`)
  const onJobFiles = (files: FileList | null) => {
    if (!files?.length) return
    const chosen = Array.from(files)
    // the probe runs beside the upload, not in front of it
    void exportWarningsFor(chosen).then(setJobWarnings)
    enqueueJobAssets(id, chosen)
    toast.success(`Uploading ${files.length} file${files.length > 1 ? 's' : ''} in the background — you can keep working`)
    if (jobFileRef.current) jobFileRef.current.value = ''
  }
  const [commentVisibility, setCommentVisibility] = useState<'internal' | 'client'>('internal')


  // guard against the stale-blur race: these fields are uncontrolled, and a
  // live refetch updates state without touching the DOM — so a plain
  // focus+blur used to see "DOM differs from state" and PATCH old text back,
  // reverting someone else's edit. Only what YOU typed since focus is saved.
  const focusVal = useRef<Record<string, string>>({})

  /**
   * Refetch, with the answers kept in order — and never dropped.
   *
   * Three things reload this page: a mutation finishing, the realtime hint,
   * and the 60s poll. They overlap constantly and HTTP gives no ordering
   * guarantee, so the order has to be decided here rather than by whichever
   * response happens to arrive first. `useOrderedLoad` does that, and — the
   * part that matters — it never discards a fresh answer merely because a
   * newer request was issued: every mutation's own write announces itself,
   * which immediately issues that newer request, and the old rule threw the
   * post-mutation answer away every single time. See lib/load-order.ts.
   */
  const loadOrdered = useOrderedLoad<Detail>(
    async () => {
      // no-store: this is live workflow state, and a revalidation-free hit
      // from the browser cache is the same stale-state bug by another route
      const res = await fetch(`/api/production/items/${id}`, { cache: 'no-store' })
      if (!res.ok) {
        throw new UnreadableItem(
          (await res.json().catch(() => ({}))).error ?? 'Failed to load item',
        )
      }
      return await res.json() as Detail
    },
    setDetail,
  )
  const load = useCallback(async () => {
    try {
      await loadOrdered()
    } catch (e) {
      // a dropped connection is not a missing item — only the server saying
      // "you cannot read this" is grounds for leaving the page
      if (!(e instanceof UnreadableItem)) return
      toast.error(e.message)
      // no detail to ask where this came from — the editor board is where an
      // unreadable content item would have been listed
      router.push('/dashboard/editor')
    }
  }, [loadOrdered, router])

  useEffect(() => { load() }, [load])

  /**
   * Put a write's OWN answer on the page, now.
   *
   * The workflow routes return the row they just wrote. Merging the handful of
   * fields the screen is keyed on — never the whole row, which carries fields
   * this viewer's shaped payload deliberately omits — means the buttons agree
   * with the toast in the same tick, whatever the refetch does afterwards.
   */
  const applyWrite = useCallback((row: unknown) => {
    const r = row as Partial<Detail> | null
    if (!r || typeof r !== 'object' || !r.status) return
    setDetail(d => (d ? {
      ...d,
      status: r.status as ItemStatus,
      owner_id: 'owner_id' in r ? r.owner_id ?? null : d.owner_id,
      scheduler_ids: 'scheduler_ids' in r ? r.scheduler_ids ?? null : d.scheduler_ids,
    } : d))
  }, [])

  // live item: a comment, version, or status change from anyone else appears
  // without a reload. Only this item's hints trigger a refetch; the periodic
  // fallback (change === undefined) refreshes regardless.
  useProductionLive(useCallback((change?: { item_id: string }) => {
    if (!change || change.item_id === id) void load()
  }, [id, load]))

  // the team directory: managers (re)assign from it, and EVERYONE on the
  // team tags from it — "@Name" in a comment has to be able to name anybody,
  // not just the client's roster. /api/team answers any team role.
  const viewerRole = detail?.viewer_role
  useEffect(() => {
    if (!viewerRole || viewerRole === 'client') return
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then(json => {
        const active = (json.members ?? []).filter(
          (m: { active_status?: boolean }) => m.active_status !== false)
        // open assignment: any active team member can carry a task
        setEditors(active
          .filter((m: { role: string }) => m.role !== 'client')
          .map((m: { id: string; name: string; email: string; role: string }) =>
            ({ id: m.id, name: m.name, email: m.email, role: m.role })))
      })
      .catch(() => { setEditors([]) })
  }, [viewerRole])

  // The five uncontrolled fields on this page are `defaultValue` only: a live
  // refetch used to remount them via `key={…}` and wipe whatever was being
  // typed. Now the server's value is written into the DOM directly, and only
  // when the field is NOT the one under the cursor.
  const briefUrlRef = useRef<HTMLInputElement>(null)
  const briefNoteRef = useRef<HTMLTextAreaElement>(null)
  const rawAssetsRef = useRef<HTMLInputElement>(null)
  const jobBriefRef = useRef<HTMLTextAreaElement>(null)
  const captionRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!detail) return
    // a field the cursor is in is left alone — it self-corrects on the next
    // poll, once you have moved on. Writing an identical value would still
    // reset the caret and the scroll position, so don't.
    const sync = (
      el: HTMLInputElement | HTMLTextAreaElement | null, value: string,
    ) => {
      if (!el || document.activeElement === el || el.value === value) return
      el.value = value
    }
    sync(briefUrlRef.current, detail.brief_url ?? '')
    sync(briefNoteRef.current, detail.brief ?? '')
    sync(rawAssetsRef.current, detail.raw_assets_url ?? detail.drive_url ?? '')
    sync(jobBriefRef.current, detail.brief ?? '')
    sync(captionRef.current, detail.caption ?? '')
  }, [detail])

  /**
   * Files that landed join the slide strip, in the order they were dropped.
   *
   * Driven by the queue rather than by the upload call, so a file that failed
   * and was then RETRIED still makes it into the version. Without this, Retry
   * would show a green tick on a slide the version was saved without.
   *
   * It lives ABOVE the `!detail` skeleton return below, as every hook must:
   * a hook after that return is called on the second render and not the first,
   * which is React error #310 and a blank "This page couldn't load" for every
   * item. tests/hooks-order.test.ts fails if one is put back there.
   */
  useEffect(() => {
    const landed = completedIn(versionGroup)
    if (landed.length === 0) return
    setSlides(s => {
      const have = new Set(s.map(x => x.url))
      const add = landed.filter(l => !have.has(l.url)).slice(0, MAX_SLIDES - s.length)
      if (add.length === 0) return s
      return [...s, ...add.map(l => ({
        url: l.url,
        name: l.name,
        type: (looksLikeVideo(l.url) ? 'video' : 'image') as 'video' | 'image',
        ...(l.bytes > 0 ? { bytes: l.bytes } : {}),
      }))]
    })
  }, [versionUploads, versionGroup])

  if (!detail) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const role = detail.viewer_role
  const isTeam = role !== 'client'
  /** Two different zones live on this page and they answer two different
   *  questions. A POSTING time belongs to the client's — it is when the
   *  audience sees it. A timestamp on something a person did belongs to the
   *  reader's, because "when did that happen" means on their own clock. */
  const clientTz = detail.client_timezone || DEFAULT_TZ
  const viewer = { id: detail.viewer_id ?? '', role }
  const isBrief = detail.work_kind?.slug === SHOOT_BRIEF_SLUG
  // research / strategy / copy: nothing to upload, schedule or post
  const isInternal = isInternalKind(detail.work_kind)
  const isAsset = !isBrief && !isInternal

  // What you may do here follows the ASSIGNMENT, not the job title: an editor
  // looking at somebody else's item wears no hat on it and sees it read-only.
  // The server sends the hats it shaped the payload with; actingRoles is only
  // the fallback for a payload from before that field existed.
  const hats = detail.acting_roles ?? actingRoles(viewer, detail)
  const isSuper = role === 'super_admin'
  /** past this point there is nothing left to attach — a finished task still
   *  offering "Attach the work · Save this draft" invites work nobody wants */
  const editingClosed = isInternal
    ? TASK_DONE_STATUSES.has(detail.status)
    : SCHEDULER_STATUSES.includes(detail.status)
  const canAddVersion = !editingClosed
    && (isSuper || hats.includes('editor') || hats.includes('account_manager'))
  // schedulers may comment on what they schedule; clients talk in their portal
  const canComment = role !== 'client'
    && (isSuper || hats.includes('editor') || hats.includes('account_manager') || hats.includes('scheduler'))
  const canSchedule = isSuper || hats.includes('scheduler')
  // …but auto-publishing to a client's LIVE accounts is the scheduling team's
  // job by title, not a hat anyone can be handed: /publish is role-gated, so
  // showing these buttons to a handed editor would only ever produce a 403.
  const canAutoPublish = isSuper || role === 'scheduler'
  // reviewing IS the job, and it is not per-item — owner picker, delete,
  // handoff, comment visibility, job-pack editing
  const canManage = isSuper || hats.includes('account_manager')

  // a brief task wears its own words, drops edges that make no sense for it
  // (a booked shoot never "publishes"), and judges roles by its OWN rules —
  // filtering through the base pipeline's roles first hid brief-legal buttons
  const rawTransitions = isBrief
    ? availableBriefTaskTransitionsAs(hats, detail.status)
    : isInternal ? availableTaskTransitionsAs(hats, detail.status)
    : availableTransitionsAs(hats, detail.status)

  /**
   * Does this item post from the app?
   *
   * If the client's channel is connected, the posting card IS the action for
   * "scheduled" and "published" — the app queues the post, the provider posts
   * it, and both status changes happen on their own. Leaving the workflow
   * buttons up beside that is what made the owner press "Mark scheduled" by
   * hand after queueing: two buttons for one move, and only one of them real.
   *
   * When nothing is connected the buttons stay, saying plainly what they are:
   * a human posting by hand, recording it afterwards.
   */
  const postingAccounts = detail.posting?.accounts ?? []
  const postingPlatform = choosePlatform(
    detail.platform_targets ?? [], postingAccounts.map(a => a.platform),
  )
  const postsFromApp = isAsset
    && Boolean(detail.posting?.configured)
    && postingAccounts.some(a => a.platform === postingPlatform)

  const AUTO_EDGES: ItemStatus[] = ['scheduled', 'published']
  const transitions = rawTransitions
    .filter(t => !(postsFromApp && AUTO_EDGES.includes(t.to)))
    .map(t => (isAsset && !postsFromApp && AUTO_EDGES.includes(t.to))
      ? { ...t, label: `${t.label} (manual)` }
      : t)
  // a brief hands its last stages to an account manager and then to nobody —
  // no scheduler is ever coming for a shoot
  const turns = isBrief ? BRIEF_STATUS_TURN : isInternal ? TASK_STATUS_TURN : STATUS_TURN
  const turn = whoseTurn(detail.status, detail, viewer, turns)
  const { primary, secondary } = presentTransitions(
    hats, detail.status, transitions,
    {
      clientApprovalRequired: detail.client_approval_required !== false,
      // the same answer the header gives: a super admin MAY move anything,
      // but a filled primary button under "Waiting on the editor" is the page
      // arguing with itself
      viewerHoldsTurn: turn.mine,
    },
    turns,
  )
  const baseMeaning = isBrief ? BRIEF_STATUS_MEANING[detail.status] : isInternal ? TASK_STATUS_MEANING[detail.status] : STATUS_MEANING[detail.status]
  // "Needs a posting time" and "waiting to go live" are both true, but neither
  // says the thing that changed: nobody presses a status button any more
  const meaning = !postsFromApp ? baseMeaning
    : detail.status === 'approved_for_scheduling'
      ? `Signed off. Pick a time under Posting — ${platformLabel(postingPlatform)} posts it for you.`
      : detail.status === 'scheduled'
        ? `Queued with ${platformLabel(postingPlatform)}. It posts itself, and this moves to Published when it does.`
        : baseMeaning

  const schedulerIds = schedulerIdsOf(detail)
  const nameOf = (uid: string) => {
    const m = editors.find(e => e.id === uid)
    return m ? (m.name || m.email) : null
  }
  /** whose move it is, said as a person rather than a role */
  const turnText = (): string => {
    if (turn.hat === null) return 'nobody — this one is finished'
    // an unowned draft belongs to the pool, not to you — "You" on an item
    // anyone could pick up reads as an assignment that was never made
    // the scheduling seat is schedulers-only (claim-core refuses everyone
    // else), and a brief is assigned rather than picked up
    if (turn.unassigned) {
      return isBrief ? 'Unassigned — an account manager will pick it up'
        : turn.hat === 'scheduler' ? 'Unassigned — any scheduler can take it'
        : 'Unassigned — anyone can take it'
    }
    if (turn.mine) return 'You'
    if (turn.hat === 'editor') return `${detail.owner_name ?? 'the editor'} (editing)`
    if (turn.hat === 'scheduler') {
      const names = schedulerIds.map(nameOf).filter(Boolean)
      return names.length > 0 ? `${names.join(', ')} (scheduling)` : 'the scheduler (scheduling)'
    }
    if (turn.hat === 'client') return 'the client'
    // "the", not "an": the client has one account manager on this job, and a
    // brief is that person's own document from first draft to booked shoot
    return 'the account manager'
  }

  // the item as the work pages read it — one vocabulary for "can I take this?"
  const workItem = {
    id: detail.id,
    status: detail.status,
    owner_id: detail.owner_id ?? null,
    scheduler_ids: detail.scheduler_ids,
    work_kinds: detail.work_kind
      ? { slug: detail.work_kind.slug, uses_media: detail.work_kind.uses_media }
      : null,
  }
  // where you actually came from wins over where the status files it
  const back = cameFrom ?? backLinkFor(workItem)

  /** The manager who is also the only reviewer: submitting to nobody is a dead
   *  end, so the move becomes "submit it and review it myself" — the AM
   *  buttons are waiting on the other side. */
  const soloReviewer = reviewers?.length === 0 && !reviewersFailed && hats.includes('account_manager')

  const latest = detail.versions[0]
  /** the slides of the latest version, whichever era it was saved in */
  const latestSlides = slidesOf(latest)
  const isCarousel = isCarouselType(detail.content_type)

  /** What the version form is still missing, or null when it can be saved. */
  const versionMissing: string | null = (() => {
    // one rule, the server's own: something to look at. The master link is
    // not a precondition, and neither field is asterisked any more.
    if (slides.length === 0 && !verDraft.drive_url) {
      return 'Upload the file, or paste a link to it.'
    }
    // …and the server's second rule, said before the click: a carousel is a
    // set, and a set of one is a photo post
    return slidesSatisfyType(detail.content_type, slides)
  })()

  /**
   * Preconditions the SERVER will enforce, worked out here so the button can
   * say so before it is pressed instead of rejecting a filled-in dialog.
   */
  const briefHasContent = Boolean(
    detail.brief_url?.trim()
    || detail.batch?.concept?.trim()
    || (detail.batch?.shot_list?.length ?? 0) > 0,
  )
  /** "Revisions done" has to mean a revision happened — same rule as the
   *  server's, read off the history it already sends us. */
  const lastRevisionRequest = (detail.activity ?? [])
    .filter(a => a.action === 'status_change' && a.new_value === 'revision_required')
    .map(a => a.created_at).sort().pop() ?? null
  const blockedReason = (to: ItemStatus): string | null => {
    if (to === 'internal_review' && isBrief && !briefHasContent) {
      return 'Add a plan link, or fill in the concept or shot list on the shoot page.'
    }
    if (to === 'internal_review' && !isBrief && detail.versions.length === 0) {
      return isInternal
        ? 'Attach the work first — upload a file or add a link.'
        : 'Add a version with its links first.'
    }
    if (to === 'revision_complete' && !isBrief
      && needsNewVersion(latest?.created_at ?? null, lastRevisionRequest)) {
      return 'Add a new version with the revisions first.'
    }
    if (to === 'scheduled' && isAsset && detail.schedule.every(s => !s.scheduled_at)) {
      return 'Add a platform with a date below first.'
    }
    if (to === 'scheduled' && isBrief && !['locked', 'shot'].includes(detail.batch?.status ?? '')) {
      return 'Book the shoot on its page first — the date is set there.'
    }
    if (to === 'published' && isAsset && detail.schedule.every(s => s.publish_status !== 'published')) {
      return 'Add a live link, or mark a platform posted, below first.'
    }
    return null
  }

  /** What just happened, in the past tense, with who now has it — and where
   *  it went, so the toast can carry an Open button to that place. */
  const successWord = (to: ItemStatus, label: string, notifyIds?: string[]): { text: string; href: string } => {
    const client = detail.client_name ?? 'the client'
    const named = (notifyIds ?? []).map(nameOf).filter(Boolean)
    const reviewer = named.length > 0 ? named.join(', ') : 'an account manager'
    const owner = detail.owner_name ?? 'the person on it'
    const board = isAsset ? '/dashboard/editor' : '/dashboard/production'
    switch (to) {
      case 'internal_review': return { text: `Sent to ${reviewer} for review`, href: board }
      case 'revision_required': return { text: `Sent back to ${owner} for changes — they have been told`, href: board }
      case 'revision_complete': return { text: `Marked as revised — back with ${reviewer}`, href: board }
      case 'client_review': return { text: `Sent to ${client} — it is on their portal now`, href: board }
      case 'client_changes_requested': return { text: "The client's changes are logged", href: board }
      case 'approved_for_scheduling':
        return isBrief ? { text: 'Plan approved — lock the date, then book the shoot', href: detail.batch?.id ? `/dashboard/production/shoots/${detail.batch.id}` : board }
          : isInternal ? { text: 'Approved — this one is done', href: board }
          : { text: 'Approved — it is in the Scheduler queue, under Needs a posting date', href: '/dashboard/scheduler' }
      case 'scheduled': return isBrief ? { text: 'Shoot booked', href: board } : { text: 'Marked scheduled — it is on the posting calendar', href: '/dashboard/scheduler/calendar' }
      case 'published': return { text: 'Marked published — it is under Published on the Scheduler', href: '/dashboard/scheduler' }
      default: return { text: label, href: board }
    }
  }

  const doTransition = async (to: ItemStatus, label: string, notifyIds?: string[], schedulerIds?: string[], note?: string) => {
    setBusy(to)
    setDialogError(null)
    try {
      const res = await fetch(`/api/production/items/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          ...(notifyIds?.length ? { notify_ids: notifyIds } : {}),
          ...(schedulerIds?.length ? { scheduler_ids: schedulerIds } : {}),
          ...(note?.trim() ? { note: note.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${label} failed`)
      // …in the past tense, with the consequence and a way to follow it: a
      // toast that just repeats the button reads like a prompt to do it again
      const done = successWord(to, label, notifyIds)
      toastOpen(done.text, done.href, router.push)
      setReviewPick(null)
      setSchedPick(null)
      setRevisionAsk(null)
      setClientSend(null)
      // the route answers with the item it just wrote — put THAT on the page
      // before the refetch, exactly as a version save does. Everything the
      // header and the buttons read comes off `detail`, so a toast above an
      // unchanged screen is how the team learns to distrust the button.
      applyWrite(json)
      await load()
    } catch (e) {
      // a dropped RESPONSE is not a failed request — check before alarming
      if (e instanceof TypeError) {
        toast.message('Network hiccup — checking whether it went through…')
        await load()
        setReviewPick(null)
        toast.message('Refreshed. If the status moved, it worked — don’t click again.')
      } else {
        const msg = e instanceof Error ? e.message : `${label} failed`
        // "No transition from X to Y" means somebody else moved it while this
        // page was open — that is a stale screen, not a machine fault
        if (/^No transition from /.test(msg)) {
          toast.error('That move isn’t available any more — the item just changed. Reloading.')
          setReviewPick(null)
          setSchedPick(null)
          setRevisionAsk(null)
          await load()
        } else {
          toast.error(msg)
          // …and again where the person is actually looking
          setDialogError(msg)
        }
      }
    } finally {
      setBusy(null)
    }
  }

  const sendHandoff = async () => {
    setBusy('handoff')
    try {
      const res = await fetch(`/api/production/items/${id}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduler_ids: [...schedChosen] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not notify')
      const names = [...schedChosen].map(nameOf).filter(Boolean)
      toastOpen(names.length > 0 ? `Handed to ${names.join(', ')} to schedule — they have been emailed` : 'Handed over — they have been emailed',
        '/dashboard/scheduler', router.push)
      setSchedPick(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not notify')
    } finally {
      setBusy(null)
    }
  }

  /** The editor's submit edges prompt "who should review this?" — any
   *  managing person (account manager or super admin) can be picked; the
   *  client's assigned managers come pre-ticked. */
  const openReviewerPick = async (t: { to: ItemStatus; label: string }) => {
    setReviewPick(t)
    setDialogError(null)
    setReviewers(null)
    setReviewersFailed(false)
    try {
      const res = await fetch(`/api/clients/${detail!.client_id}/managers`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load reviewers')
      const assignedIds = new Set<string>((json.managers ?? []).map((m: { team_user_id: string }) => m.team_user_id))
      // reviewers are THIS client's assigned account managers + super admins,
      // never the whole managing roster — and never YOU: nobody is emailed
      // about their own action, so picking yourself sends nothing at all
      const list: Reviewer[] = (json.eligible ?? [])
        .filter((u: { id: string; role: string }) =>
          u.id !== detail!.viewer_id && (u.role === 'super_admin' || assignedIds.has(u.id)))
        .map((u: { id: string; name: string; email: string; role: string }) => ({
          ...u, assigned: assignedIds.has(u.id),
        }))
      // assigned managers first, then the rest alphabetically
      list.sort((a, b) => Number(b.assigned) - Number(a.assigned) || (a.name || a.email).localeCompare(b.name || b.email))
      setReviewers(list)
      // default reviewers: whoever handed out the job PLUS the client's
      // current managers — reassigning a client's AM must change who hears
      const defaults = new Set(list.filter(r => r.assigned).map(r => r.id))
      if (detail?.assigned_by && list.some(r => r.id === detail.assigned_by)) defaults.add(detail.assigned_by)
      setChosen(defaults)
    } catch (e) {
      // an empty list and a list we could not fetch are different facts: one
      // means "nobody else works on this client", the other means "we don't
      // know". Never let the second read as the first.
      toast.error(e instanceof Error ? e.message : 'Could not load reviewers')
      setReviewers([])
      setReviewersFailed(true)
    }
  }

  /**
   * Drop many, get slides.
   *
   * A carousel is one post made of several files, so the drop zone takes
   * several — four at a time, the same width the job-pack queue uses, because
   * one-at-a-time turned a six-card drop into six waits. Each file appends to
   * the strip as it lands: order is the order they were dropped, and the strip
   * is where it gets changed.
   */
  const uploadFiles = async (files: File[]) => {
    const room = MAX_SLIDES - slides.length
    if (room <= 0) return toast.error(`That is already ${MAX_SLIDES} slides — the most a carousel takes`)
    const wanted = files.slice(0, room)
    if (files.length > wanted.length) {
      toast.warning(`Only the first ${room} were added — a carousel takes ${MAX_SLIDES} slides`)
    }
    // read 256 KB of each one's header locally: an export whose index is at
    // the end, or that is HEVC/ProRes, uploads and posts fine but will not
    // play in anybody's browser, and this is the only moment the person who
    // made it is still in the room
    void exportWarningsFor(wanted).then(setVersionWarnings)
    // measure the first one locally while it uploads — the "1080 × 1350"
    // badge needs no round-trip to the stored file
    if (slides.length === 0) {
      setDraftDims(null)
      void measureFile(wanted[0]).then(setDraftDims)
    }
    // Straight to R2 rather than through our API: this is where shoot
    // deliverables land, and a serverless request body caps at ~4.5MB on
    // Vercel — every real cut would have been rejected.
    //
    // Through the shared queue, which keeps the same four-abreast width this
    // loop had and adds the part that was missing: per-file bytes, so a
    // gigabyte master shows a bar moving instead of a word that looks exactly
    // like a frozen tab. The slides themselves are picked up by the effect
    // below, which watches the queue rather than this call's return value.
    const { done } = runUploads(wanted, { group: versionGroup })
    await done.catch(() => {
      // the failed row carries the file name, the reason and a Retry — a
      // toast would only repeat the half of it nobody can act on
    })
  }

  const saveVersion = async () => {
    if (slides.length === 0 && !verDraft.drive_url) {
      return toast.error('Upload the file, or paste a link to it')
    }
    setBusy('version')
    try {
      const res = await fetch(`/api/production/items/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...verDraft, files: slides }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success(isInternal ? `Draft ${json.version_number} saved` : `Version v${json.version_number} added`)
      setVerDraft({ dropbox_url: '', drive_url: '', notes: '' })
      setSlides([])
      // the version now owns these files; their upload rows have said all
      // they have to say and would otherwise sit above an empty drop zone
      clearGroup(versionGroup)
      setVersionWarnings([])
      setLinksOpen(false)
      // put it on the page NOW: "The work" and the Submit button both read
      // detail.versions, and a toast above an unchanged screen is how the
      // team learns to distrust the save
      setDetail(d => (d ? {
        ...d,
        versions: [json as Version, ...d.versions],
        current_version_number: json.version_number ?? d.current_version_number,
      } : d))
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  /** the people "@Name" can reach — everyone active on the team but you */
  const mentionable = editors
    .filter(e => e.id !== detail?.viewer_id)
    .map(e => ({ id: e.id, name: e.name || e.email }))

  const postComment = async () => {
    if (!commentDraft.trim()) return
    setBusy('comment')
    try {
      // the words are the truth: whoever is "@"-named in the text is tagged.
      // The server reads the same text with the same parser; the ids ride
      // along so a name the server cannot resolve still reaches the person.
      const tagged = commentVisibility === 'internal' ? extractMentions(commentDraft, mentionable) : []
      const res = await fetch(`/api/production/items/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: commentDraft,
          visibility: commentVisibility,
          ...(tagged.length ? { assigned_to: tagged[0].id, mention_ids: tagged.map(t => t.id) } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Comment failed')
      setCommentDraft('')
      if (tagged.length > 0) {
        const names = tagged.map(t => t.name).join(', ')
        toast.success(`Posted — ${names} ${tagged.length === 1 ? 'has' : 'have'} been emailed and will see "Waiting on you"`)
      } else if (commentVisibility === 'client') {
        toast.success(`Posted — ${detail?.client_name ?? 'the client'} can read it on their portal`)
      } else {
        toast.success('Posted — managers can see it. Tag someone with @ to reach them.')
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Comment failed')
    } finally {
      setBusy(null)
    }
  }

  const toggleResolved = async (c: Comment) => {
    const res = await fetch(`/api/production/items/${id}/comments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: c.id, resolved: !c.resolved }),
    })
    if (!res.ok) return toast.error('Update failed')
    toast.success(c.resolved ? 'Reopened — it is back on their list' : 'Marked done — it is off their list')
    await load()
  }

  /**
   * Save one field, and make the page agree with itself immediately.
   *
   * These used to fire-and-forget a PATCH and then call load(). Between the
   * two, every flag derived from `detail` — "is a brief link present", "is
   * Submit enabled" — still described the state before the save, so the page
   * carried on telling you to do the thing you had just done. Applying the
   * value locally closes that window; the refetch that follows is the source
   * of truth, and the sequence guard keeps a slow answer from undoing it.
   */
  const saveField = (patch: Record<string, unknown>, done: string) => {
    // applied BEFORE the round trip, not after. These fields save on blur, and
    // blur is the same gesture that clicks the button next to them: typing a
    // brief link and pressing "Submit brief for review" ran the click while
    // the PATCH was still in the air, so the button was still disabled by the
    // old value and the click died in silence. Optimistic here means the page
    // agrees with what the person just typed; a failure snaps it back.
    setDetail(d => (d ? { ...d, ...patch } as Detail : d))
    return fetch(`/api/production/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(async r => {
        if (!r.ok) {
          toast.error((await r.json().catch(() => ({}))).error ?? 'Save failed')
          void load() // put the truth back
          return
        }
        toast.success(done)
        void load()
      })
      .catch(() => { toast.error('Could not save — check your connection'); void load() })
  }

  const saveOwner = async (ownerId: string) => {
    setBusy('owner')
    try {
      const res = await fetch(`/api/production/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: ownerId === 'none' ? null : ownerId }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not assign')
      toast.success(ownerId === 'none'
        ? 'Nobody on it now — anyone can take it from the board'
        : `Assigned to ${nameOf(ownerId) ?? 'them'} — they have been emailed the job details`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign')
    } finally {
      setBusy(null)
    }
  }

  /** Does the client have to sign this off? The flag decides whether the
   *  "approve without the client" edges are offered at all. */
  const saveApproval = async (required: boolean) => {
    setBusy('approval')
    try {
      const res = await fetch(`/api/production/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_approval_required: required }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not save')
      toast.success(required ? 'The client will be asked to approve this' : 'This can be approved without the client')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  /** The manual path — a platform, a time, a link, or "it went out". */
  const saveManualSchedule = async (input: {
    platform: string; whenIso?: string | null; liveUrl?: string; markPosted?: boolean
  }) => {
    setBusy('schedule')
    try {
      const res = await fetch(`/api/production/items/${id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: input.platform,
          ...(input.whenIso ? { scheduled_at: input.whenIso } : {}),
          ...(input.liveUrl ? { live_url: input.liveUrl } : {}),
          ...(input.markPosted ? { mark_posted: true } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      toast.success(input.liveUrl ? 'Live link saved'
        : input.markPosted ? 'Marked posted — no link'
        : 'Date set')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  /** One final-post approval action → the route → refresh. The card decides
   *  WHICH action this viewer may take; the server checks it again. */
  const actOnApproval = async (
    action: 'send' | 'approve' | 'request_changes',
    opts?: { note?: string; client_too?: boolean },
  ) => {
    try {
      const res = await fetch(`/api/production/items/${id}/posting-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...opts }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      toast.success(action === 'send'
        ? opts?.client_too
          ? `Sent for approval — the account manager has been emailed, and it is on ${detail?.client_name ?? 'the client'}’s portal too`
          : 'Sent for approval — the account manager has been emailed'
        : action === 'approve'
          ? 'Post approved — it can be queued now'
          : 'Sent back — whoever is scheduling it has been told what to change')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  /**
   * The app-posting path: record the time, then open "who should hear about
   * it". Two steps because the provider needs the time from the schedule row,
   * and one press because the operator is making one decision.
   */
  const postFromApp = async (platform: string, whenIso: string | null, publishNow: boolean) => {
    setBusy('schedule')
    try {
      if (whenIso) {
        const res = await fetch(`/api/production/items/${id}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, scheduled_at: whenIso }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Could not save the time')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the time')
      setBusy(null)
      return
    }
    setBusy(null)
    await openPublishPick(publishNow)
  }

  /** The header's second line: everything about the item that is a fact,
   *  not a control — client, format, version, due date, priority. */
  const overdue = detail.due_date
    && new Date(detail.due_date) < new Date(new Date().toDateString())
    && !['scheduled', 'published'].includes(detail.status)
  const facts = [
    detail.client_name ?? '—',
    isBrief ? 'Shoot plan' : isInternal ? (detail.work_kind?.name ?? 'Task') : detail.content_type,
    isAsset && detail.current_version_number > 0 ? `v${detail.current_version_number}` : null,
    detail.due_date
      ? `due ${new Date(detail.due_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
      : null,
    detail.priority && detail.priority !== 'normal' ? `${detail.priority} priority` : null,
  ].filter(Boolean)

  const statusWord = role === 'client'
    ? (detail.status_label ?? CLIENT_LABELS[detail.status])
    : isInternal ? taskStatusLabel(detail.work_kind, detail.status, STATUS_LABELS[detail.status], { hasWork: detail.versions.length > 0 })
    : itemStatusLabel(detail.work_kind?.slug, detail.status, STATUS_LABELS[detail.status])

  /** the one folder link — the pasted one wins over the one we made, because
   *  a pasted one is a deliberate override */
  const folderUrl = detail.raw_assets_url || detail.drive_url || null
  /** has anyone tagged the viewer here and not yet marked it done? */
  const openForMe = detail.comments.some(c => !c.resolved && c.assigned_to === detail.viewer_id)

  /** The action buttons — drawn once in the card, once in the phone bar. */
  const shown = [...(primary ? [primary] : []), ...secondary]
  const hints = [...new Set(shown.map(t => blockedReason(t.to)).filter(Boolean))] as string[]
  const press = (t: { to: ItemStatus; label: string }) =>
    (t.to === 'internal_review' || t.to === 'revision_complete')
      ? openReviewerPick(t)
      // asking for changes deserves a WHY — the note rides the transition
      // into the thread and the assignee's email
      : (t.to === 'revision_required' || t.to === 'client_changes_requested')
        ? (setRevisionAsk(t), setRevisionNote(''), setDialogError(null))
        // anything that puts this in front of the CLIENT gets a confirm
        // naming who it reaches — it is the riskiest move in the app
        : t.to === 'client_review'
          ? (setClientSend(t), setDialogError(null))
          : doTransition(t.to, t.label)
  const actionButton = (t: { to: ItemStatus; label: string }, variant: 'default' | 'outline', className = '') => (
    <Button key={t.to} size="sm" variant={variant} className={`min-h-11 md:min-h-8 ${className}`}
      // the biggest, bluest button on the page must not be a trapdoor into
      // a corner toast telling you to go and do something else
      disabled={busy !== null || blockedReason(t.to) !== null}
      onClick={() => press(t)}>
      {busy === t.to ? 'Working…' : t.label}
    </Button>
  )

  /** the state of the version list, for the folded summary */
  const versionSummary = detail.versions.length === 0
    ? 'nothing yet'
    : `${detail.versions.length} ${isInternal ? 'draft' : 'version'}${detail.versions.length === 1 ? '' : 's'}`

  /** who holds which seat, for the People card */
  const reviewerNames = (detail.managers ?? []).map(m => m.name).filter(Boolean)
  const schedulerNames = schedulerIds.map(nameOf).filter((n): n is string => !!n)
  const postingOpen = isAsset && (SCHEDULER_STATUSES.includes(detail.status) || detail.schedule.length > 0)

  /** the version drop zone + form — inside "The work" */
  const versionForm = canAddVersion && (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {isInternal ? 'Attach the work' : detail.versions.length === 0 ? 'Add the first version' : `Add v${detail.current_version_number + 1}`}
      </p>
      {/* THE path, not one of three: the export goes straight from the
          editor's machine into our storage. The links below are for the
          cases the upload cannot cover. */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          const f = Array.from(e.dataTransfer.files ?? [])
          if (f.length) void uploadFiles(f)
        }}
        onClick={() => fileRef.current?.click()}
        className={`flex min-h-11 cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
          dragging
            ? 'border-blue-400 bg-blue-50/60 dark:border-blue-600 dark:bg-blue-950/30'
            : slides.length > 0
              ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20'
              : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
        }`}
      >
        <Upload className={`h-5 w-5 ${slides.length > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'}`} />
        {uploading ? (
          <p className="text-sm font-medium">{overallProgress(versionUploads).label}</p>
        ) : slides.length > 0 ? (
          <>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {slideCountLabel(slides.length)} ready ✓
              {slides.length === 1 && draftDims && draftDims.w > 0 ? ` · ${draftDims.w} × ${draftDims.h}` : ''}
            </p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {slides.length >= MAX_SLIDES ? `That is the most a carousel takes (${MAX_SLIDES})` : 'Tap to add more'}
            </p>
          </>
        ) : (
          <>
            {/* the working half first: "choose" works everywhere, "drag" on a desk */}
            <p className="text-sm font-medium">
              {isCarousel ? 'Choose the cards, or drag them here' : 'Choose a file, or drag the export here'}
            </p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {isCarousel
                ? `Any size, several at once — a carousel takes 2 to ${MAX_SLIDES} slides.`
                : 'Any size — it goes straight to our storage.'}
            </p>
          </>
        )}
        {/* sr-only, not hidden: display:none file inputs can silently
            refuse a programmatic .click() */}
        <input ref={fileRef} type="file" multiple accept={isInternal ? undefined : 'image/*,video/*'} className="sr-only"
          onChange={e => {
            const f = Array.from(e.target.files ?? [])
            if (f.length) void uploadFiles(f)
            e.target.value = ''
          }} />
      </div>

      {versionUploads.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
          <UploadOverall uploads={versionUploads} />
          <UploadRows uploads={versionUploads} />
        </div>
      )}
      <ExportWarnings items={versionWarnings} onDismiss={() => setVersionWarnings([])} />

      {/* THE ORDER IS THE POST. Arrows always, drag as the desk extra:
          HTML5 drag never fires on a phone, and the remove button used to
          be hover-only. */}
      {slides.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            {slides.map((s, i) => (
              <div key={s.url} className="flex flex-col items-center gap-1">
                <div
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    if (dragIndex === null) return
                    setSlides(list => reorder(list, dragIndex, i))
                    setDragIndex(null)
                  }}
                  className={`relative h-24 w-24 shrink-0 cursor-grab overflow-hidden rounded-lg border-2 bg-zinc-950 active:cursor-grabbing ${
                    dragIndex === i ? 'border-blue-400 opacity-50' : 'border-zinc-200 dark:border-zinc-700'
                  }`}
                  title={`Slide ${i + 1} of ${slides.length} — ${s.name}`}
                >
                  <SlideThumb slide={s} />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5 text-center font-mono text-[10px] text-white">
                    {i + 1} of {slides.length}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button type="button" aria-label={`Move slide ${i + 1} earlier`} disabled={i === 0}
                    onClick={() => setSlides(list => reorder(list, i, i - 1))}
                    className="flex h-11 w-7 items-center justify-center text-zinc-500 disabled:opacity-30 md:h-8">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label={`Move slide ${i + 1} later`} disabled={i === slides.length - 1}
                    onClick={() => setSlides(list => reorder(list, i, i + 1))}
                    className="flex h-11 w-7 items-center justify-center text-zinc-500 disabled:opacity-30 md:h-8">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label={`Remove slide ${i + 1}`}
                    onClick={() => setSlides(list => list.filter((_, n) => n !== i))}
                    className="flex h-11 w-7 items-center justify-center text-zinc-500 hover:text-red-600 md:h-8">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          {slides.length > 1 && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              This is the posting order. Use the arrows to change it before you save — after that, a new order means a new version.
            </p>
          )}
        </div>
      )}

      {/* secondary, and closed until asked for */}
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setLinksOpen(v => !v)}
          className="flex min-h-11 w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 md:min-h-6">
          <CircleDashed className={`h-3.5 w-3.5 transition-transform ${linksOpen ? 'rotate-90' : ''}`} />
          Or paste a link instead
        </button>
        {linksOpen && (
          <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="grid gap-1.5">
              <Label className="text-xs">{isInternal ? 'Link to the work' : 'Review link'}</Label>
              <Input value={verDraft.drive_url}
                placeholder={isInternal ? 'https://docs.google.com/…' : 'https://drive.google.com/… or a YouTube link'}
                onChange={e => setVerDraft(d => ({ ...d, drive_url: e.target.value }))} />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Where it can be watched, if it is not the file above.</p>
            </div>
            {!isInternal && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Master file link</Label>
                <Input value={verDraft.dropbox_url} placeholder="https://drive.google.com/…"
                  onChange={e => setVerDraft(d => ({ ...d, dropbox_url: e.target.value }))} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  Optional — where the full-quality original is filed, if that is somewhere other than here.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Notes</Label>
        <Input value={verDraft.notes} placeholder={isInternal ? 'Anything the reviewer should know' : 'What changed in this version?'}
          onChange={e => setVerDraft(d => ({ ...d, notes: e.target.value }))} />
      </div>
      <div className="flex flex-col gap-1">
        <Button size="sm" className="min-h-11 self-start md:min-h-8"
          disabled={busy === 'version' || uploading || versionMissing !== null}
          onClick={saveVersion}>
          {busy === 'version' ? 'Saving…'
            : uploading ? 'Waiting for the files…'
            : isInternal ? 'Save this draft' : `Save v${detail.current_version_number + 1}`}
        </Button>
        {versionMissing && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{versionMissing}</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 pb-24 md:pb-0">
      {/* 1 — HEADER. What this is. The status once, as a badge; whose move
          it is lives in the card below, once. */}
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={() => router.push(back.href)}>
          <ArrowLeft className="h-4 w-4" /> {back.label}
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{detail.title}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {facts.map((f, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <span className={f === facts[1] ? 'capitalize' : overdue && String(f).startsWith('due') ? 'font-medium text-red-600 dark:text-red-400' : ''}>{f}</span>
              </span>
            ))}
            {isBrief && <> <HelpHint term="shoot_plan" /></>}
            {isAsset && <> <HelpHint term="item" /></>}
          </p>
        </div>
        <Badge variant="outline" className={`self-center ${STATUS_TINT[detail.status] ?? ''}`}>
          {statusWord}
          {detail.status === 'approved_for_scheduling' && isAsset && <HelpHint term="approved_for_scheduling" className="-my-2" />}
          {detail.status === 'draft_uploaded' && isAsset && <HelpHint term="drafting" className="-my-2" />}
        </Badge>
      </div>

      {isTeam && <GettingStarted role={role} page="item" />}

      {/* 2 — WHAT TO DO NOW. One sentence, one blue button, the reason it is
          grey if it is grey. First on the page. */}
      {isTeam && (transitions.length > 0 || turns[detail.status] !== null || openForMe) && (
        <Card id="next" className="scroll-mt-4 border-zinc-300 dark:border-zinc-700">
          <CardContent className="flex flex-col gap-2.5 p-4">
            {openForMe && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Someone tagged you in the comments below — it stays on your list until you mark it done.{' '}
                <a href="#comments" className="font-medium underline">Read it</a>
              </p>
            )}
            <p className="text-sm">
              <span className="font-medium">{meaning}</span>{' '}
              {turn.hat !== null && (
                turn.mine
                  ? <span className="text-emerald-700 dark:text-emerald-400">That&rsquo;s you.</span>
                  : <span className="text-zinc-500 dark:text-zinc-400">Waiting on {turnText()}.</span>
              )}
            </p>
            {transitions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {primary && actionButton(primary, 'default')}
                {/* the rest go behind one ⋯ — one primary per card, and a
                    row of four outline buttons was four primaries */}
                {secondary.length === 1 && actionButton(secondary[0], 'outline')}
                {secondary.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" aria-label="Other moves" disabled={busy !== null}>
                        <MoreHorizontal className="h-4 w-4" /> More
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {secondary.map(t => (
                        <DropdownMenuItem key={t.to} className="min-h-11" disabled={blockedReason(t.to) !== null}
                          onClick={() => press(t)}>
                          {t.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {!primary && secondary.length === 0 && null}
              </div>
            )}
            {hints.map(h => (
              <p key={h} className="text-xs text-amber-600 dark:text-amber-400">{h}</p>
            ))}
            {/* the flag that decides whether "approve without the client"
                exists at all — the one place it is explained */}
            {canManage && !isInternal && (
              <label className="flex min-h-11 items-center gap-2.5 text-xs text-zinc-500 dark:text-zinc-400 md:min-h-0">
                <Switch
                  checked={detail.client_approval_required !== false}
                  disabled={busy !== null}
                  onCheckedChange={v => void saveApproval(v)}
                />
                The client signs this off before it goes out
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3 — THE WORK. A plan's is its page; everything else has versions. */}
      {isTeam && isBrief && (
        <Card id="work" className="scroll-mt-4">
          <CardHeader className="flex-row items-center">
            <CardTitle className="text-sm font-semibold">The plan</CardTitle>
            {detail.batch?.id && (
              <Button size="sm" variant="outline" className="ml-auto min-h-11 md:min-h-8" asChild>
                <Link href={`/dashboard/production/shoots/${detail.batch.id}`}>Open the shoot page <ExternalLink className="h-3.5 w-3.5" /></Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              The concept and shot list live on the shoot page. A link to a plan written elsewhere goes here.
            </p>
            <div className="grid gap-1.5">
              <Label className="text-xs">Plan link{briefHasContent ? '' : ' *'}</Label>
              <div className="flex gap-2">
                <Input
                  ref={briefUrlRef}
                  defaultValue={detail.brief_url ?? ''}
                  placeholder="https://app.milanote.com/…"
                  className="font-mono text-xs"
                  onFocus={e => { focusVal.current.brief_url = e.target.value }}
                  onBlur={e => {
                    const v = e.target.value.trim()
                    if (v === (focusVal.current.brief_url ?? '').trim()) return
                    if (v !== (detail.brief_url ?? '')) void saveField({ brief_url: v || null }, 'Plan link saved')
                  }}
                />
                {detail.brief_url && (
                  <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" asChild>
                    <a href={detail.brief_url} target="_blank" rel="noreferrer noopener">Open ↗</a>
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Note to reviewer</Label>
              <Textarea
                ref={briefNoteRef}
                rows={3}
                defaultValue={detail.brief ?? ''}
                placeholder="What the reviewer should look at first…"
                onFocus={e => { focusVal.current.brief = e.target.value }}
                onBlur={e => {
                  const v = e.target.value.trim()
                  if (v === (focusVal.current.brief ?? '').trim()) return
                  if (v !== (detail.brief ?? '')) void saveField({ brief: v || null }, 'Note saved')
                }}
              />
            </div>
            {detail.status === 'scheduled' && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Shoot booked — after the shoot, mark it shot on the shoot page and create the items there.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isBrief && (
        <Card id="work" className="scroll-mt-4">
          <CardHeader className="flex-row items-center gap-2">
            <CardTitle className="text-sm font-semibold">{isInternal ? 'The work' : 'Versions'}</CardTitle>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{versionSummary}</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {/* the latest cut, as big as it deserves — and its facts on one
                line: this IS the newest version, so the list below starts
                from the one before it */}
            {latest && (latest.file_url || latest.drive_url) && (
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                {latestSlides[0] && (
                  <Media key={latestSlides[0].url} src={latestSlides[0].url}
                    driveUrl={latest.drive_url}
                    className="max-h-[420px] w-full bg-zinc-950 object-contain" onDims={setPreviewDims} />
                )}
                {latestSlides.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto border-t border-zinc-100 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                    {latestSlides.map((s, i) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener"
                        title={`Slide ${i + 1} of ${latestSlides.length} — ${s.name}`}
                        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-950 dark:border-zinc-700">
                        <SlideThumb slide={s} />
                        <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 font-mono text-[10px] text-white">{i + 1}</span>
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs">
                  <span className="font-medium">{isInternal ? `Draft ${latest.version_number}` : `v${latest.version_number}`} · latest</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {new Date(latest.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </span>
                  {latestSlides.length > 1 && <span className="text-zinc-500 dark:text-zinc-400">{slideCountLabel(latestSlides.length)}</span>}
                  {previewDims && previewDims.w > 0 && (
                    <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">{previewDims.w} × {previewDims.h}</span>
                  )}
                  {latest.notes && <span className="truncate text-zinc-500 dark:text-zinc-400">{latest.notes}</span>}
                  <span className="ml-auto flex gap-3">
                    {latest.file_url && <a className="min-h-11 py-3 text-blue-600 hover:underline md:min-h-0 md:py-0 dark:text-blue-400" href={latest.file_url} target="_blank" rel="noreferrer noopener">Open file</a>}
                    {latest.drive_url && <a className="min-h-11 py-3 text-blue-600 hover:underline md:min-h-0 md:py-0 dark:text-blue-400" href={latest.drive_url} target="_blank" rel="noreferrer noopener">Open in Drive</a>}
                    {isTeam && latest.dropbox_url && <a className="min-h-11 py-3 text-zinc-500 hover:underline md:min-h-0 md:py-0 dark:text-zinc-400" href={latest.dropbox_url} target="_blank" rel="noreferrer noopener">Master file</a>}
                  </span>
                </div>
              </div>
            )}
            {detail.versions.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                {isInternal
                  ? 'Nothing attached yet. Add a file or a link below, then send it for review.'
                  : canAddVersion ? 'No versions yet. Drop the first cut below.' : 'No versions yet.'}
              </p>
            )}
            {/* earlier versions, folded — the latest is above */}
            {detail.versions.length > 1 && (
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 md:min-h-6">
                  <CircleDashed className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  {detail.versions.length - 1} earlier {isInternal ? 'draft' : 'version'}{detail.versions.length - 1 === 1 ? '' : 's'}
                </summary>
                <div className="mt-2 flex flex-col gap-1.5">
                  {detail.versions.slice(1).map(v => (
                    <div key={v.id} className="flex items-baseline gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      <span className="font-mono text-xs font-semibold">{isInternal ? `Draft ${v.version_number}` : `v${v.version_number}`}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(v.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </span>
                      {slidesOf(v).length > 1 && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{slideCountLabel(slidesOf(v).length)}</span>
                      )}
                      {v.notes && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{v.notes}</span>}
                      <span className="ml-auto flex gap-2 text-xs">
                        {v.file_url && <a className="text-blue-600 hover:underline dark:text-blue-400" href={v.file_url} target="_blank" rel="noreferrer noopener">file</a>}
                        {v.drive_url && <a className="text-blue-600 hover:underline dark:text-blue-400" href={v.drive_url} target="_blank" rel="noreferrer noopener">drive</a>}
                        {isTeam && v.dropbox_url && <a className="text-zinc-500 hover:underline dark:text-zinc-400" href={v.dropbox_url} target="_blank" rel="noreferrer noopener">master</a>}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {canAddVersion && detail.versions.length > 0 && <Separator />}
            {versionForm}
          </CardContent>
        </Card>
      )}

      {/* 4 — PEOPLE. Who owns it, who reviews it, who posts it — each seat
          once, each with its one control. Three cards and a meta row used
          to say this in four places. */}
      {isTeam && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">People</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {/* the owner — who carries the work */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="w-24 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{isBrief ? 'Writing it' : isInternal ? 'Doing it' : 'Editing'}</span>
              {canManage ? (
                <Select
                  value={detail.owner_id ?? 'none'}
                  onValueChange={v => v && v !== (detail.owner_id ?? 'none') && saveOwner(v)}
                >
                  <SelectTrigger className="h-11 w-60 bg-white text-sm md:h-8 md:text-xs dark:bg-zinc-900" disabled={busy === 'owner'}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nobody yet — anyone can take it</SelectItem>
                    {editors.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {(e.name || e.email) + (e.role && e.role !== 'editor' ? ` · ${ROLE_WORD[e.role] ?? e.role}` : '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm">
                  {detail.owner_id === detail.viewer_id ? 'You' : detail.owner_name ?? <span className="text-zinc-400">nobody yet</span>}
                </span>
              )}
              {canClaimEditor(workItem, viewer) && <ClaimButton itemId={id} hat="editor" onDone={load} />}
            </div>
            {/* the reviewer — the client's account manager(s) */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="w-24 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Reviewing</span>
              <span className="text-sm">
                {reviewerNames.length > 0 ? reviewerNames.join(', ') : <span className="text-zinc-400">no account manager on this client</span>}
              </span>
              {detail.client_approval_required !== false && !isInternal && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">then {detail.client_name ?? 'the client'} signs off</span>
              )}
            </div>
            {/* the scheduling seat — assets only */}
            {isAsset && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="w-24 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Posting</span>
                <span className="text-sm">
                  {schedulerIds.includes(detail.viewer_id ?? '') ? 'You'
                    : schedulerNames.length > 0 ? schedulerNames.join(', ')
                    : schedulerIds.length > 0 ? 'someone on the team'
                    : <span className="text-zinc-400">{SCHEDULER_STATUSES.includes(detail.status) ? 'nobody yet — any scheduler can take it' : 'decided after approval'}</span>}
                </span>
                {canClaimScheduler(workItem, viewer) && <ClaimButton itemId={id} hat="scheduler" onDone={load} />}
                {canManage && (detail.status === 'approved_for_scheduling' || detail.status === 'scheduled') && (
                  <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={busy !== null}
                    onClick={() => {
                      setSchedPick('handoff')
                      setSchedChosen(new Set(
                        schedulerIds.length > 0 ? schedulerIds : editors.filter(e => e.role === 'scheduler').map(e => e.id),
                      ))
                    }}>
                    {schedulerIds.length === 0 ? 'Hand it to someone' : 'Change'}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 5 — FILES & FOLDER. What the editor works from: the brief, the one
          folder link, the source files. A task gets the ask instead. */}
      {isTeam && isAsset && (canManage || detail.brief || folderUrl || (detail.raw_assets?.length ?? 0) > 0) && (
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle className="text-sm font-semibold">Files &amp; folder</CardTitle>
            {folderUrl && (
              <Button variant="outline" size="sm" className="ml-auto min-h-11 md:min-h-8" asChild>
                <a href={folderUrl} target="_blank" rel="noreferrer noopener">
                  Open the folder <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {detail.drive_mirror?.line && (
              <p className={`-mt-1 text-xs ${detail.drive_mirror.copying ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {detail.drive_mirror.line}
              </p>
            )}
            {canManage ? (
              <>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Editing notes</Label>
                  <Textarea
                    ref={jobBriefRef}
                    rows={3}
                    defaultValue={detail.brief ?? ''}
                    onFocus={e => { focusVal.current.brief = e.target.value }}
                    placeholder="What the edit should be…"
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v === (focusVal.current.brief ?? '').trim()) return
                      if (v !== (detail.brief ?? '')) void saveField({ brief: v || null }, 'Notes saved')
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Folder link <span className="font-normal text-zinc-400">(Google Drive)</span></Label>
                  <Input
                    ref={rawAssetsRef}
                    defaultValue={detail.raw_assets_url ?? detail.drive_url ?? ''}
                    onFocus={e => { focusVal.current.raw_assets_url = e.target.value }}
                    placeholder="https://drive.google.com/drive/folders/…"
                    className="font-mono text-xs"
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v === (focusVal.current.raw_assets_url ?? '').trim()) return
                      if (v !== (detail.raw_assets_url ?? '')) void saveField({ raw_assets_url: v || null }, 'Folder link saved')
                    }}
                  />
                </div>
              </>
            ) : (
              detail.brief && <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{detail.brief}</p>
            )}
            {(detail.raw_assets?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                {detail.raw_assets!.map(a => (
                  <RawFileRow key={a.url} file={a} canManage={canManage}
                    onRemove={() => {
                      void saveField({ raw_assets: (detail.raw_assets ?? []).filter(x => x.url !== a.url) }, 'File removed')
                    }} />
                ))}
              </div>
            )}
            {jobUploads.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
                <UploadOverall uploads={jobUploads} />
                <UploadRows uploads={jobUploads} onDismiss={dismissUpload} />
              </div>
            )}
            <ExportWarnings items={jobWarnings} onDismiss={() => setJobWarnings([])} />
            {canManage && (
              <div>
                <input ref={jobFileRef} type="file" multiple className="sr-only"
                  onChange={e => onJobFiles(e.target.files)} />
                <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8"
                  onClick={() => jobFileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Add files
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isTeam && isInternal && (canManage || detail.brief || (detail.raw_assets?.length ?? 0) > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">The ask</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {canManage ? (
              <Textarea
                ref={jobBriefRef}
                rows={3}
                defaultValue={detail.brief ?? ''}
                onFocus={e => { focusVal.current.brief = e.target.value }}
                placeholder="What needs doing…"
                onBlur={e => {
                  const v = e.target.value.trim()
                  if (v === (focusVal.current.brief ?? '').trim()) return
                  if (v !== (detail.brief ?? '')) void saveField({ brief: v || null }, 'Saved')
                }}
              />
            ) : (
              detail.brief
                ? <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{detail.brief}</p>
                : <p className="text-sm text-zinc-400 dark:text-zinc-500">No notes written for this task.</p>
            )}
            {(detail.raw_assets?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                {detail.raw_assets!.map(a => <RawFileRow key={a.url} file={a} canManage={false} />)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 6 — POSTING. Only once the item is signed off: before that a
          caption box and a platform picker are questions nobody can answer. */}
      {isAsset && postingOpen && (canSchedule || canManage || detail.schedule.length > 0) && (
        <Card id="posting" className="scroll-mt-4">
          <CardHeader className="flex-row items-center gap-2">
            <CardTitle className="text-sm font-semibold">Posting</CardTitle>
            {/* where the final post stands — drawn only once the gate has
                actually been used on this item */}
            {(() => {
              const chip = approvalChip(detail.posting_approval?.state)
              if (!chip) return null
              const tint = chip.tone === 'approved'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400'
                : chip.tone === 'changes'
                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400'
                  : 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400'
              return <Badge variant="outline" className={`font-normal ${tint}`}>{chip.label}</Badge>
            })()}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="grid gap-1.5">
              <Label className="text-xs">Caption</Label>
              {canManage || canSchedule ? (
                <Textarea
                  ref={captionRef}
                  rows={3}
                  defaultValue={detail.caption ?? ''}
                  onFocus={e => { focusVal.current.caption = e.target.value }}
                  placeholder="The post text — published exactly as written here…"
                  onBlur={e => {
                    const v = e.target.value.trim()
                    if (v === (focusVal.current.caption ?? '').trim()) return
                    if (v !== (detail.caption ?? '')) void saveField({ caption: v || null }, 'Caption saved')
                  }}
                />
              ) : detail.caption ? (
                <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{detail.caption}</p>
              ) : (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">No caption yet.</p>
              )}
            </div>
            {detail.schedule.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {detail.schedule.map(s => (
                  <div key={s.id} className="flex items-baseline gap-3 rounded-lg border border-zinc-100 px-3 py-2 text-sm dark:border-zinc-800">
                    <span className="capitalize">{s.platform}</span>
                    {s.scheduled_at && (
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {formatWithZone(s.scheduled_at, clientTz, 'short')}
                        {/* the reader's own clock, in words — a tooltip is
                            dead on a phone, and this is the one line that
                            tells a Manila scheduler the AU offset */}
                        {viewerHint(s.scheduled_at, clientTz, viewerTz) && (
                          <span className="ml-1 text-zinc-400">({viewerHint(s.scheduled_at, clientTz, viewerTz)})</span>
                        )}
                      </span>
                    )}
                    <span className="ml-auto">
                      {s.live_url
                        ? <a href={s.live_url} target="_blank" rel="noreferrer noopener" className="text-xs text-emerald-600 hover:underline dark:text-emerald-400">live ↗</a>
                        : s.publish_status === 'published'
                          ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">posted — no link</span>
                          : <span className="text-[11px] uppercase text-zinc-400 dark:text-zinc-500">{publishStatusWord(s.publish_status)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {canSchedule && (
              <PostingCard
                itemId={id}
                clientId={detail.client_id}
                clientName={detail.client_name ?? 'This client'}
                clientTz={detail.client_timezone || DEFAULT_TZ}
                clientUsers={detail.client_users ?? []}
                platformTargets={detail.platform_targets ?? []}
                caption={detail.caption}
                posting={detail.posting ?? null}
                entries={detail.schedule}
                canAutoPublish={canAutoPublish}
                approval={detail.posting_approval ?? null}
                hats={hats}
                previewSlides={latestSlides.map(s => ({ url: s.url, type: s.type, name: s.name }))}
                onApproval={actOnApproval}
                platforms={PLATFORMS}
                onPost={postFromApp}
                onManual={saveManualSchedule}
                onChanged={load}
                busy={busy !== null}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* a manager can draft the caption before approval — folded, so it is
          not a second Posting card */}
      {isAsset && !postingOpen && canManage && (
        <CollapsibleCard title="Caption" summary={detail.caption ? 'written' : 'not written yet'}>
          <Textarea
            ref={captionRef}
            rows={3}
            defaultValue={detail.caption ?? ''}
            onFocus={e => { focusVal.current.caption = e.target.value }}
            placeholder="The post text — published exactly as written here…"
            onBlur={e => {
              const v = e.target.value.trim()
              if (v === (focusVal.current.caption ?? '').trim()) return
              if (v !== (detail.caption ?? '')) void saveField({ caption: v || null }, 'Caption saved')
            }}
          />
        </CollapsibleCard>
      )}

      {/* the client's brand guide travels with the job — folded: a
          reference, not a step */}
      {isTeam && (
        <CollapsibleCard title="Brand" summary={`${detail.client_name ?? 'the client'}’s colours, fonts and voice`}>
          <BrandCard clientId={detail.client_id} />
        </CollapsibleCard>
      )}

      {/* 7 — THE CONVERSATION. "@Name" reaches somebody; nothing else does. */}
      {canComment && (
        <Card id="comments" className="scroll-mt-4">
          <CardHeader><CardTitle className="text-sm font-semibold">Comments</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2.5 pt-0">
            {detail.comments.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                No comments yet. Type @ and a name to ask someone something — they get an email and it stays on their list until it is marked done.
              </p>
            )}
            {detail.comments.map(c => {
              const forMe = c.assigned_to === detail.viewer_id
              const forName = c.assigned_to ? nameOf(c.assigned_to) : null
              return (
                <div key={c.id} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                  forMe && !c.resolved ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20' : 'border-zinc-100 dark:border-zinc-800'
                }`}>
                  <button onClick={() => isTeam && toggleResolved(c)} disabled={!isTeam}
                    aria-label={c.resolved ? 'Reopen' : 'Mark done'} title={c.resolved ? 'Reopen' : 'Mark done'}
                    className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center">
                    {c.resolved
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      : <CircleDashed className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`whitespace-pre-wrap text-sm ${c.resolved ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}>{c.body}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                      {c.author_name && <span className="text-zinc-500 dark:text-zinc-400">{c.author_name}</span>}
                      <span suppressHydrationWarning>{viewerTz ? formatInZone(c.created_at, viewerTz, 'short') : ''}</span>
                      {c.assigned_to && !c.resolved && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                          {forMe ? 'Waiting on you' : `Waiting on ${forName ?? 'someone'}`}
                        </span>
                      )}
                      {isTeam && c.visibility === 'client' && (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 font-normal text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400">visible to client</Badge>
                      )}
                    </p>
                  </div>
                </div>
              )
            })}
            <div className="mt-1 flex flex-col gap-2">
              <MentionBox
                value={commentDraft}
                onChange={setCommentDraft}
                members={commentVisibility === 'internal' ? mentionable : []}
                placeholder={commentVisibility === 'client' ? 'Write to the client…' : 'Add a comment — type @ to tag someone…'}
                onSubmit={() => void postComment()}
                disabled={busy === 'comment'}
              />
              <div className="flex flex-wrap items-center gap-3">
                {canManage && (
                  <label className="flex min-h-11 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 md:min-h-0">
                    <Switch
                      checked={commentVisibility === 'client'}
                      onCheckedChange={v => setCommentVisibility(v ? 'client' : 'internal')}
                    />
                    Visible to client
                  </label>
                )}
                <Button size="sm" className="ml-auto min-h-11 md:min-h-8" disabled={busy === 'comment' || !commentDraft.trim()} onClick={postComment}>
                  <Send className="h-3.5 w-3.5" /> {busy === 'comment' ? 'Posting…' : 'Post'}
                </Button>
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {commentVisibility === 'client'
                  ? `${detail.client_name ?? 'The client'} reads this on their portal.`
                  : 'Managers see every comment. To reach anyone else, tag them with @ — they are emailed and it waits on them until it is marked done.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 8 — HISTORY. Every move and who made it — folded, it is the record */}
      {isTeam && (() => {
        const lines = activityLines(detail.activity ?? [], isBrief ? 'brief' : isInternal ? 'task' : 'asset')
        return (
          <CollapsibleCard title="History" summary={lines.length === 0 ? 'nothing yet' : `${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}`}>
            {lines.length === 0 ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                Nothing recorded yet — every move from here is logged with who made it.
              </p>
            ) : lines.map(l => (
              <div key={l.id} className="flex items-baseline gap-3 text-sm">
                <span className="text-zinc-600 dark:text-zinc-300">{l.text}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-400 dark:text-zinc-500" suppressHydrationWarning>
                  {viewerTz ? formatInZone(l.at, viewerTz, 'long') : ''}
                </span>
              </div>
            ))}
          </CollapsibleCard>
        )
      })()}

      {/* 9 — the one thing that cannot be undone, last and folded */}
      {canManage && (
        <CollapsibleCard title="Delete this item" summary="cannot be undone" className="border-red-200 dark:border-red-950">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Its versions, comments and posting times go with it — for everyone, including the client.
          </p>
          <AlertDialog open={deleteOpen}
            onOpenChange={o => { setDeleteOpen(o); if (!o) setDeleteConfirm('') }}>
            <Button variant="outline" size="sm" className="min-h-11 w-fit text-red-600 hover:text-red-700 md:min-h-8 dark:text-red-400"
              onClick={() => { setDeleteConfirm(''); setDeleteOpen(true) }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete item
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{detail.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  The item and all its versions, comments, and posting times are removed
                  for everyone, including the client&rsquo;s portal. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-1.5">
                <Label className="text-xs">Type <span className="font-mono font-semibold">delete</span> to confirm</Label>
                <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="delete" autoComplete="off" />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">Keep it</AlertDialogCancel>
                <AlertDialogAction
                  className="min-h-11 bg-red-600 hover:bg-red-700"
                  disabled={deleteConfirm.trim().toLowerCase() !== 'delete'}
                  onClick={async () => {
                    const res = await fetch(`/api/production/items/${id}`, { method: 'DELETE' })
                    if (!res.ok) return toast.error((await res.json()).error ?? 'Delete failed')
                    toast.success('Item deleted')
                    router.push(back.href)
                  }}
                >
                  Delete item
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CollapsibleCard>
      )}

      {/* PHONE: the one button, always within thumb reach */}
      {isTeam && primary && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
          <div className="mx-auto flex max-w-4xl items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {turn.mine ? 'Your move' : `Waiting on ${turnText()}`}
            </span>
            {actionButton(primary, 'default', 'shrink-0')}
          </div>
        </div>
      )}

      {/* who should review this? */}
      <Dialog open={reviewPick !== null} onOpenChange={o => !o && busy === null && setReviewPick(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{reviewPick?.label}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Who should review this? They&rsquo;ll be emailed as your reviewer.
            </p>
            {reviewers === null && (
              <div className="flex flex-col gap-2 py-2">
                <Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" />
              </div>
            )}
            {reviewersFailed ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <p className="text-sm text-zinc-400 dark:text-zinc-500">Couldn&rsquo;t load reviewers — try again</p>
                <Button variant="outline" size="sm" className="min-h-11" disabled={busy !== null}
                  onClick={() => reviewPick && void openReviewerPick(reviewPick)}>
                  Try again
                </Button>
              </div>
            ) : reviewers?.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                {soloReviewer
                  ? 'You’re the only reviewer on this client.'
                  : 'Nobody else to notify on this client — the move is still recorded.'}
              </p>
            )}
            {(reviewers ?? []).map(r => (
              <label key={r.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={chosen.has(r.id)}
                  onChange={() => setChosen(prev => {
                    const next = new Set(prev)
                    if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                    return next
                  })}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name || r.email}</span>
                  <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">{r.email}</span>
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    {r.role === 'super_admin' ? 'Super admin' : 'Account manager'}
                    {r.assigned && ' · manages this client'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {dialogError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {dialogError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setReviewPick(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11"
              disabled={busy !== null || reviewers === null || reviewersFailed}
              onClick={() => reviewPick && doTransition(reviewPick.to, reviewPick.label, [...chosen])}
            >
              {busy !== null ? 'Working…'
                : soloReviewer ? 'Send it and review it myself'
                : chosen.size > 0 ? `Send to ${chosen.size} reviewer${chosen.size > 1 ? 's' : ''}`
                : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* about to reach the client — say who, and what they will see */}
      <Dialog open={clientSend !== null} onOpenChange={o => !o && busy === null && setClientSend(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send to {detail.client_name ?? 'the client'}?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            {(detail.client_users?.length ?? 0) > 0 ? (
              <p>
                {detail.client_users!.length} portal {detail.client_users!.length === 1 ? 'user' : 'users'} will be
                emailed: {detail.client_users!.map(u => u.name || u.email).join(', ')}.
              </p>
            ) : (
              <p>
                This client has no portal account yet, so no email goes out — but the
                work still moves to their side and appears the moment one is created.
              </p>
            )}
            <p className="text-zinc-500 dark:text-zinc-400">
              {isBrief
                ? 'The plan becomes visible on their portal, where they can approve it or ask for changes.'
                : 'The item becomes visible on their portal, where they can approve it or ask for changes.'}
            </p>
          </div>
          {dialogError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {dialogError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setClientSend(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11" disabled={busy !== null}
              onClick={() => clientSend && doTransition(clientSend.to, clientSend.label)}>
              {busy !== null ? 'Working…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* what needs to change? — the note rides the revision request */}
      <Dialog open={revisionAsk !== null} onOpenChange={o => !o && busy === null && setRevisionAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{revisionAsk?.label}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Say what needs to change — it lands in the comments and in {detail.owner_name ? `${detail.owner_name}’s` : 'the assignee’s'} email.
            </p>
            <textarea
              value={revisionNote}
              onChange={e => setRevisionNote(e.target.value)}
              rows={4}
              autoFocus
              placeholder="What should be different in the next version?"
              className="w-full resize-y rounded-md border border-zinc-200 bg-transparent p-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
            />
          </div>
          {dialogError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {dialogError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setRevisionAsk(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11"
              disabled={busy !== null}
              onClick={() => revisionAsk && doTransition(revisionAsk.to, revisionAsk.label, undefined, undefined, revisionNote)}
            >
              {busy !== null ? 'Working…' : revisionAsk?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* who posts this? */}
      <Dialog open={schedPick !== null} onOpenChange={o => !o && busy === null && setSchedPick(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Who posts this?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              They&rsquo;ll be emailed to set the posting time and put it out. Untick anyone who
              shouldn&rsquo;t hear about it.
            </p>
            {editors.map(s => (
              <label key={s.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={schedChosen.has(s.id)}
                  onChange={() => setSchedChosen(prev => {
                    const next = new Set(prev)
                    if (next.has(s.id)) next.delete(s.id); else next.add(s.id)
                    return next
                  })}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.name || s.email}</span>
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">{ROLE_WORD[s.role ?? ''] ?? 'Team'}</span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setSchedPick(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11"
              disabled={busy !== null || schedChosen.size === 0}
              onClick={() => {
                if (schedPick === 'handoff') void sendHandoff()
                else if (schedPick) void doTransition(schedPick.to, schedPick.label, undefined, [...schedChosen])
              }}
            >
              {busy !== null ? 'Working…'
                : schedPick === 'handoff' ? `Hand to ${schedChosen.size} ${schedChosen.size === 1 ? 'person' : 'people'}`
                : 'Approve & notify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* publish → who should hear about it? */}
      <Dialog open={publishPick !== null} onOpenChange={o => !o && busy === null && setPublishPick(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{publishPick?.publishNow ? 'Publish now' : 'Queue for the scheduled time'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Who should be told this went out? The client&rsquo;s account manager is picked for you.
            </p>
            {pubPeople === null && (
              <div className="flex flex-col gap-2 py-2">
                <Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" />
              </div>
            )}
            {pubPeople?.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                No managers found — this client&rsquo;s assigned managers will be notified.
              </p>
            )}
            {(pubPeople ?? []).map(r => (
              <label key={r.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={pubChosen.has(r.id)}
                  onChange={() => setPubChosen(prev => {
                    const next = new Set(prev)
                    if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                    return next
                  })}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name || r.email}</span>
                  <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">{r.email}</span>
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    {r.role === 'super_admin' ? 'Super admin' : 'Account manager'}
                    {r.assigned && ' · manages this client'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setPublishPick(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11"
              disabled={busy !== null || pubPeople === null}
              onClick={() => publishPick && queuePublish(publishPick.publishNow, [...pubChosen])}
            >
              {busy !== null ? 'Working…' : publishPick?.publishNow ? 'Publish now' : 'Queue it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
