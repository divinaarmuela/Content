'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { uploadMedia } from '../../uploadMedia'
import { useProductionLive } from '../useProductionLive'
import { enqueueJobAssets } from '../../uploadQueue'
import BrandCard from '../BrandCard'
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
import { ArrowLeft, Upload, Send, CheckCircle2, CircleDashed } from 'lucide-react'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Trash2 } from 'lucide-react'
import {
  actingRoles, availableTransitionsAs, presentTransitions, schedulerIdsOf, whoseTurn,
  CLIENT_LABELS, STATUS_LABELS, STATUS_MEANING, STATUS_TURN, type ItemStatus,
} from '../../../lib/workflow-core'
import {
  availableBriefTaskTransitionsAs, itemStatusLabel, SHOOT_BRIEF_SLUG,
  BRIEF_STATUS_MEANING, BRIEF_STATUS_TURN,
} from '../../../lib/brief-task-core'
import {
  availableTaskTransitionsAs, isInternalKind, taskStatusLabel, TASK_STATUS_MEANING, TASK_STATUS_TURN,
} from '../../../lib/task-kind-core'
import { activityLines, type ActivityRow } from '../../../lib/activity-core'
import { backLinkFor, canClaimEditor, canClaimScheduler } from '../../../lib/work-pages-core'
import { ClaimButton } from '../ClaimButton'
import type { Role } from '../../../lib/identity-core'

type Version = {
  id: string; version_number: number; created_at: string
  file_url: string; drive_url: string; dropbox_url?: string; notes?: string | null
}
type Comment = {
  id: string; created_at: string; author_id: string | null; author_name?: string | null
  visibility: string; body: string; resolved: boolean
}
type ScheduleEntry = {
  id: string; platform: string; scheduled_at: string | null; live_url: string | null; publish_status: string
}
type Reviewer = { id: string; name: string; email: string; role: string; assigned: boolean }

type Detail = {
  id: string; title: string; client_id: string; client_name: string | null
  owner_id: string | null
  assigned_by?: string | null
  scheduler_ids?: string[] | null
  viewer_id?: string
  content_type: string; status: ItemStatus; status_label?: string
  priority: string; due_date: string | null; caption: string | null
  client_approval_required: boolean; current_version_number: number
  owner_name?: string | null; managers?: { name: string; email: string }[]
  brief_url?: string | null
  work_kind?: { name: string; slug: string; color: string } | null
  batch?: { id: string; title: string; status?: string; planned_deliverables?: { type: string; qty: number }[] } | null
  raw_assets_url?: string | null; brief?: string | null
  raw_assets?: { url: string; name: string }[] | null
  versions: Version[]; comments: Comment[]; schedule: ScheduleEntry[]
  /** the named audit trail — internal only, never in the client payload */
  activity?: ActivityRow[]
  viewer_role: Role
  /** the hats this viewer wears ON THIS ITEM — the server's own reading */
  acting_roles?: Role[]
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

function Media({ src, className, onDims }: {
  src: string
  className?: string
  /** reports the media's true pixel size once loaded — 1080 × 1350 etc. */
  onDims?: (d: { w: number; h: number }) => void
}) {
  if (!src) return null
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    return (
      <video src={src} controls playsInline className={className}
        onLoadedMetadata={e => onDims?.({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} />
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img src={src} alt="" className={className}
      onLoad={e => onDims?.({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
  )
}

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [verDraft, setVerDraft] = useState({ file_url: '', dropbox_url: '', drive_url: '', notes: '' })
  const [uploading, setUploading] = useState(false)
  /** measured pixel size of the latest preview / freshly-uploaded file */
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null)
  const [draftDims, setDraftDims] = useState<{ w: number; h: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [commentDraft, setCommentDraft] = useState('')

  // "Submit for review" reviewer picker — the editor chooses who is asked
  const [reviewPick, setReviewPick] = useState<{ to: ItemStatus; label: string } | null>(null)
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null)
  /** the reviewer fetch failed — an empty list here means "unknown", not "none" */
  const [reviewersFailed, setReviewersFailed] = useState(false)
  /** "what needs to change" — asked when requesting revisions */
  const [revisionAsk, setRevisionAsk] = useState<{ to: ItemStatus; label: string } | null>(null)
  const [revisionNote, setRevisionNote] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  // type-to-confirm for deletion — a destructive click must be deliberate
  const [deleteConfirm, setDeleteConfirm] = useState('')

  // connected social publishing (the Zernio integration): what WOULD go out
  type PublishPlan = {
    targets: { platform: string }[]
    missing: string[]
    scheduledFor: string | null
    blocked: string | null
  }
  const [plan, setPlan] = useState<PublishPlan | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const checkPlan = async () => {
    setPlanBusy(true)
    try {
      const res = await fetch(`/api/production/items/${id}/publish`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not check channels')
      setPlan(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not check channels')
    } finally {
      setPlanBusy(false)
    }
  }
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
      toast.success(publishNow ? 'Publishing now via connected accounts' : 'Queued for its scheduled time')
      setPublishPick(null)
      setPlan(null)
      load()
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
  const [commentAssignee, setCommentAssignee] = useState<string>('')

  // job-pack source file uploads — queued in the background so you can keep
  // working; the tray in the layout shows progress and the item live-refreshes
  // when each file attaches
  const jobFileRef = useRef<HTMLInputElement>(null)
  const onJobFiles = (files: FileList | null) => {
    if (!files?.length) return
    enqueueJobAssets(id, Array.from(files))
    toast.success(`Uploading ${files.length} file${files.length > 1 ? 's' : ''} in the background — you can keep working`)
    if (jobFileRef.current) jobFileRef.current.value = ''
  }
  const [commentVisibility, setCommentVisibility] = useState<'internal' | 'client'>('internal')

  const [schedDraft, setSchedDraft] = useState({ platform: 'instagram', scheduled_at: '', live_url: '' })

  // guard against the stale-blur race: these fields are uncontrolled, and a
  // live refetch updates state without touching the DOM — so a plain
  // focus+blur used to see "DOM differs from state" and PATCH old text back,
  // reverting someone else's edit. Only what YOU typed since focus is saved.
  const focusVal = useRef<Record<string, string>>({})

  const load = useCallback(async () => {
    const res = await fetch(`/api/production/items/${id}`)
    if (!res.ok) {
      toast.error((await res.json()).error ?? 'Failed to load item')
      // no detail to ask where this came from — the editor board is where an
      // unreadable content item would have been listed
      router.push('/dashboard/editor')
      return
    }
    setDetail(await res.json())
  }, [id, router])

  useEffect(() => { load() }, [load])

  // live item: a comment, version, or status change from anyone else appears
  // without a reload. Only this item's hints trigger a refetch; the periodic
  // fallback (change === undefined) refreshes regardless.
  useProductionLive(useCallback((change?: { item_id: string }) => {
    if (!change || change.item_id === id) void load()
  }, [id, load]))

  // managers can (re)assign the item's editor and hand out comment tasks —
  // load the editor directory once the role is known
  const viewerRole = detail?.viewer_role
  useEffect(() => {
    if (viewerRole !== 'account_manager' && viewerRole !== 'super_admin') return
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
    sync(rawAssetsRef.current, detail.raw_assets_url ?? '')
    sync(jobBriefRef.current, detail.brief ?? '')
    sync(captionRef.current, detail.caption ?? '')
  }, [detail])

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
  const canAddVersion = isSuper || hats.includes('editor') || hats.includes('account_manager')
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
  const transitions = isBrief
    ? availableBriefTaskTransitionsAs(hats, detail.status)
    : isInternal ? availableTaskTransitionsAs(hats, detail.status)
    : availableTransitionsAs(hats, detail.status)
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
  const meaning = isBrief ? BRIEF_STATUS_MEANING[detail.status] : isInternal ? TASK_STATUS_MEANING[detail.status] : STATUS_MEANING[detail.status]

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
    return 'an account manager'
  }

  // the item as the work pages read it — one vocabulary for "can I take this?"
  const workItem = {
    id: detail.id,
    status: detail.status,
    owner_id: detail.owner_id ?? null,
    scheduler_ids: detail.scheduler_ids,
    work_kinds: detail.work_kind ? { slug: detail.work_kind.slug } : null,
  }
  const back = backLinkFor(workItem)

  /** The manager who is also the only reviewer: submitting to nobody is a dead
   *  end, so the move becomes "submit it and review it myself" — the AM
   *  buttons are waiting on the other side. */
  const soloReviewer = reviewers?.length === 0 && !reviewersFailed && hats.includes('account_manager')

  const latest = detail.versions[0]

  const doTransition = async (to: ItemStatus, label: string, notifyIds?: string[], schedulerIds?: string[], note?: string) => {
    setBusy(to)
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
      toast.success(label)
      setReviewPick(null)
      setSchedPick(null)
      setRevisionAsk(null)
      load()
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
      toast.success(names.length > 0 ? `Handed to ${names.join(', ')}` : 'Handed over')
      setSchedPick(null)
      load()
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

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      // Straight to R2 rather than through our API: this is where shoot
      // deliverables land, and a serverless request body caps at ~4.5MB on
      // Vercel — every real cut would have been rejected.
      // measure locally while it uploads — the "1080 × 1350" badge needs no
      // round-trip to the stored file
      setDraftDims(null)
      void measureFile(file).then(setDraftDims)
      const { url } = await uploadMedia(file, { purpose: 'production' })
      setVerDraft(d => ({ ...d, file_url: url }))
      toast.success('File uploaded — add links, then save the version')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const saveVersion = async () => {
    if (!verDraft.file_url && !verDraft.drive_url) return toast.error(isInternal ? 'Upload a file or add a link to the work' : 'Upload a file or add a Drive link')
    if (!isInternal && !verDraft.dropbox_url) return toast.error('The Dropbox master link is required')
    setBusy('version')
    try {
      const res = await fetch(`/api/production/items/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verDraft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success(`Version v${json.version_number} added`)
      setVerDraft({ file_url: '', dropbox_url: '', drive_url: '', notes: '' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  const postComment = async () => {
    if (!commentDraft.trim()) return
    setBusy('comment')
    try {
      const res = await fetch(`/api/production/items/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: commentDraft,
          visibility: commentVisibility,
          ...(commentVisibility === 'internal' && commentAssignee ? { assigned_to: commentAssignee } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Comment failed')
      setCommentDraft('')
      setCommentAssignee('')
      load()
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
    load()
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
      toast.success(ownerId === 'none' ? 'Unassigned' : 'Assigned')
      load()
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
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  const saveSchedule = async (mode: 'date' | 'live' | 'posted') => {
    setBusy('schedule')
    try {
      const res = await fetch(`/api/production/items/${id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: schedDraft.platform,
          ...(schedDraft.scheduled_at ? { scheduled_at: new Date(schedDraft.scheduled_at).toISOString() } : {}),
          ...(mode === 'live' && schedDraft.live_url ? { live_url: schedDraft.live_url } : {}),
          ...(mode === 'posted' ? { mark_posted: true } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      toast.success(mode === 'live' ? 'Live link saved' : mode === 'posted' ? 'Marked posted in-app' : 'Schedule saved')
      setSchedDraft(d => ({ ...d, live_url: '' }))
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {/* 1 — HEADER. What this is, and whose move it is. Said once. */}
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push(back.href)}>
          <ArrowLeft className="h-4 w-4" /> {back.label}
        </Button>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{detail.title}</h2>
          {/* an asset has a content type; a brief and a task do not — a
              research task is not "Other" and a shoot plan is not a Reel */}
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {detail.client_name ?? '—'} ·{' '}
            {isBrief ? 'Shoot brief'
              : isInternal ? (detail.work_kind?.name ?? 'Task')
              : <span className="capitalize">{detail.content_type}</span>}
            {isAsset && detail.current_version_number > 0 && (
              <> · <span className="font-mono text-xs">v{detail.current_version_number}</span></>
            )}
          </p>
          {isTeam && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {turn.hat === null ? 'Finished — nothing left to do.' : <>Waiting on <span className="font-medium text-zinc-700 dark:text-zinc-200">{turnText()}</span></>}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className={STATUS_TINT[detail.status] ?? ''}>
            {role === 'client'
              ? (detail.status_label ?? CLIENT_LABELS[detail.status])
              : isInternal ? taskStatusLabel(detail.work_kind, detail.status, STATUS_LABELS[detail.status], { hasWork: detail.versions.length > 0 }) : itemStatusLabel(detail.work_kind?.slug, detail.status, STATUS_LABELS[detail.status])}
          </Badge>
        </div>
      </div>

      {/* 2 — WHAT HAPPENS NEXT. The one button that matters, first on the
          page rather than fourth, under three rows of who's-who. */}
      {(transitions.length > 0 || turns[detail.status] !== null || (canManage && !isInternal)) && (() => {
        // the button's own precondition, said before it is pressed rather
        // than as a rejection afterwards
        const shown = [...(primary ? [primary] : []), ...secondary]
        const hint = shown.some(t => t.to === 'scheduled') && isAsset
          ? 'Needs at least one platform with a date.'
          : shown.some(t => t.to === 'published')
            ? 'Needs at least one platform live (a link, or marked posted in-app).'
            : null
        const button = (t: { to: ItemStatus; label: string }, variant: 'default' | 'outline') => (
          <Button
            key={t.to}
            size="sm"
            variant={variant}
            disabled={busy !== null}
            onClick={() =>
              (t.to === 'internal_review' || t.to === 'revision_complete')
                ? openReviewerPick(t)
                // asking for changes deserves a WHY — the note rides the
                // transition into the thread and the assignee's email
                : (t.to === 'revision_required' || t.to === 'client_changes_requested')
                  ? (setRevisionAsk(t), setRevisionNote(''))
                  // approving never auto-picks schedulers anymore — it's a
                  // plain transition; the handoff card below is the one
                  // deliberate place a human chooses who takes it
                  : doTransition(t.to, t.label)
            }
          >
            {busy === t.to ? 'Working…' : t.label}
          </Button>
        )
        return (
          <Card>
            <CardContent className="flex flex-col gap-2.5 p-4">
              {/* one sentence: where it is, what that means, whose move.
                  The badge above says the state; this says the consequence. */}
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
                  {primary && button(primary, 'default')}
                  {secondary.map(t => button(t, 'outline'))}
                </div>
              )}
              {hint && <p className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>}
              {/* the flag that decides whether "approve without the client"
                  exists at all — a real control, not a caption */}
              {canManage && !isInternal && (
                <label className="flex items-center gap-2.5 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <Switch
                    checked={detail.client_approval_required !== false}
                    disabled={busy !== null}
                    onCheckedChange={v => void saveApproval(v)}
                  />
                  Needs client approval
                  <span className="text-zinc-400 dark:text-zinc-500">
                    — off means you can sign it off without sending it out.
                  </span>
                </label>
              )}
              {canManage && isInternal && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  A task is finished in-house — approving it here is the end of it.
                </p>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* 3 — the job's vital signs. Whose turn has moved up into the action;
          this is the paperwork. */}
      {isTeam && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Due</span>
            {detail.due_date ? (
              <span className={`font-medium ${new Date(detail.due_date) < new Date(new Date().toDateString()) && !['scheduled', 'published'].includes(detail.status) ? 'text-red-600 dark:text-red-400' : ''}`}>
                {new Date(detail.due_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            ) : <span className="text-zinc-400">not set</span>}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Priority</span>
            <span className="font-medium capitalize">{detail.priority}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Assigned to</span>
            <span className="font-medium">{detail.owner_name ?? <span className="font-normal text-zinc-400">unassigned</span>}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Account manager{(detail.managers?.length ?? 0) > 1 ? 's' : ''}
            </span>
            <span className="truncate font-medium">
              {(detail.managers?.length ?? 0) > 0
                ? detail.managers!.map(m => m.name).join(', ')
                : <span className="font-normal text-zinc-400">none assigned</span>}
            </span>
          </span>
        </div>
      )}

      {/* a brief's "approved" is a shoot to book, not a post to schedule */}
      {isTeam && isBrief && detail.status === 'approved_for_scheduling' && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              The plan is approved. Lock the shoot date on the brief page, then press Book the shoot.
            </p>
            {detail.batch?.id && (
              <Button size="sm" variant="outline" className="ml-auto" asChild>
                <Link href={`/dashboard/production/shoots/${detail.batch.id}`}>Open the shoot page</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4 — the latest cut, as big as it deserves */}
      {latest && (latest.file_url || latest.drive_url) && (
        <Card className="overflow-hidden py-0">
          {latest.file_url && (
            <Media key={latest.file_url} src={latest.file_url}
              className="max-h-[420px] w-full bg-zinc-950 object-contain" onDims={setPreviewDims} />
          )}
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {isInternal ? `Draft ${latest.version_number}` : `v${latest.version_number}`} · latest
            </span>
            {previewDims && previewDims.w > 0 && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {previewDims.w} × {previewDims.h}
              </span>
            )}
            {latest.drive_url && (
              <a href={latest.drive_url} target="_blank" rel="noreferrer noopener" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                Open in Drive
              </a>
            )}
            {isTeam && latest.dropbox_url && (
              <a href={latest.dropbox_url} target="_blank" rel="noreferrer noopener" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
                Dropbox master
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* 5 — THE WORK. A brief's is its page; everything else has versions. */}
      {isTeam && isBrief && (
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle className="text-sm font-semibold">The brief</CardTitle>
            {detail.batch?.id && detail.status !== 'approved_for_scheduling' && (
              <Button size="sm" className="ml-auto" asChild>
                <Link href={`/dashboard/production/shoots/${detail.batch.id}`}>Open the shoot page</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="grid gap-1.5">
              <Label className="text-xs">Brief link <span className="font-normal text-zinc-400">(Milanote or anywhere — optional)</span></Label>
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
                    if (v !== (detail.brief_url ?? '')) {
                      void fetch(`/api/production/items/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ brief_url: v || null }),
                      }).then(r => { if (r.ok) { toast.success('Brief link saved'); load() } else toast.error('Save failed') })
                    }
                  }}
                />
                {detail.brief_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detail.brief_url} target="_blank" rel="noreferrer noopener">Open brief ↗</a>
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
                  if (v !== (detail.brief ?? '')) {
                    void fetch(`/api/production/items/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ brief: v || null }),
                    }).then(r => { if (r.ok) { toast.success('Note saved'); load() } else toast.error('Save failed') })
                  }
                }}
              />
            </div>
            {detail.status === 'scheduled' && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Shoot booked — when it&rsquo;s shot, mark it shot on the brief page and create the content items there.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isBrief && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">{isInternal ? 'The work' : 'Versions'}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {detail.versions.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                {isInternal ? 'Nothing attached yet — add a file or a link below, then submit it for review.' : 'No versions yet — add the first below.'}
              </p>
            )}
            {detail.versions.map(v => (
              <div key={v.id} className="flex items-baseline gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                {/* a copywriter does not think in versions — a task counts drafts */}
                <span className="font-mono text-xs font-semibold">
                  {isInternal ? `Draft ${v.version_number}` : `v${v.version_number}`}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(v.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                </span>
                {v.notes && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{v.notes}</span>}
                <span className="ml-auto flex gap-2 text-xs">
                  {v.file_url && <a className="text-blue-600 hover:underline dark:text-blue-400" href={v.file_url} target="_blank" rel="noreferrer noopener">file</a>}
                  {v.drive_url && <a className="text-blue-600 hover:underline dark:text-blue-400" href={v.drive_url} target="_blank" rel="noreferrer noopener">drive</a>}
                  {isTeam && v.dropbox_url && <a className="text-zinc-500 hover:underline dark:text-zinc-400" href={v.dropbox_url} target="_blank" rel="noreferrer noopener">dropbox</a>}
                </span>
              </div>
            ))}

            {canAddVersion && (
              <>
                <Separator />
                <div className="flex flex-col gap-2.5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{isInternal ? 'Attach the work' : 'New version'}</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : verDraft.file_url ? 'Replace file' : 'Upload file'}
                    </Button>
                    {verDraft.file_url && (
                      <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                        file ready ✓{draftDims && draftDims.w > 0 ? ` · ${draftDims.w} × ${draftDims.h}` : ''}
                      </span>
                    )}
                    {/* sr-only, not hidden: display:none file inputs can silently
                        refuse a programmatic .click() — same bug as the board's */}
                    <input ref={fileRef} type="file" accept={isInternal ? undefined : 'image/*,video/*'} className="sr-only"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
                  </div>
                  {!isInternal && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Dropbox master link *</Label>
                    <Input value={verDraft.dropbox_url} placeholder="https://www.dropbox.com/…"
                      onChange={e => setVerDraft(d => ({ ...d, dropbox_url: e.target.value }))} />
                  </div>
                  )}
                  <div className="grid gap-1.5">
                    <Label className="text-xs">{isInternal ? `Link to the work ${verDraft.file_url ? '(optional)' : '(Google Doc, Drive, Notion — or upload a file)'}` : `Drive review link ${verDraft.file_url ? '(optional)' : '(or upload a file)'}`}</Label>
                    <Input value={verDraft.drive_url} placeholder={isInternal ? 'https://docs.google.com/…' : 'https://drive.google.com/…'}
                      onChange={e => setVerDraft(d => ({ ...d, drive_url: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Input value={verDraft.notes} placeholder={isInternal ? 'Anything the reviewer should know' : 'What changed in this version?'}
                      onChange={e => setVerDraft(d => ({ ...d, notes: e.target.value }))} />
                  </div>
                  <Button size="sm" className="self-start" disabled={busy === 'version'} onClick={saveVersion}>
                    {busy === 'version' ? 'Saving…' : isInternal ? 'Save this draft' : `Save v${detail.current_version_number + 1}`}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 6 — what the editor works from. ASSETS only: a strategy doc has no
          raw footage, so a research task gets the ask and its files instead. */}
      {isTeam && isAsset && (canManage || detail.brief || detail.raw_assets_url || (detail.raw_assets?.length ?? 0) > 0) && (
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle className="text-sm font-semibold">What the editor works from</CardTitle>
            {detail.raw_assets_url && (
              <Button variant="outline" size="sm" className="ml-auto" asChild>
                <a href={detail.raw_assets_url} target="_blank" rel="noreferrer noopener">
                  <Upload className="h-3.5 w-3.5 rotate-180" /> Open the folder
                </a>
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {canManage ? (
              <>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Folder link <span className="font-normal text-zinc-400">(Dropbox / Drive)</span></Label>
                  <Input
                    ref={rawAssetsRef}
                    defaultValue={detail.raw_assets_url ?? ''}
                    onFocus={e => { focusVal.current.raw_assets_url = e.target.value }}
                    placeholder="https://www.dropbox.com/…"
                    className="font-mono text-xs"
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v === (focusVal.current.raw_assets_url ?? '').trim()) return // nothing typed — never save
                      if (v !== (detail.raw_assets_url ?? '')) {
                        void fetch(`/api/production/items/${id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ raw_assets_url: v || null }),
                        }).then(r => { if (r.ok) { toast.success('Folder link saved'); load() } else toast.error('Save failed') })
                      }
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Brief</Label>
                  <Textarea
                    ref={jobBriefRef}
                    rows={3}
                    defaultValue={detail.brief ?? ''}
                    onFocus={e => { focusVal.current.brief = e.target.value }}
                    placeholder="What the edit should be…"
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v === (focusVal.current.brief ?? '').trim()) return // nothing typed — never save
                      if (v !== (detail.brief ?? '')) {
                        void fetch(`/api/production/items/${id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ brief: v || null }),
                        }).then(r => { if (r.ok) { toast.success('Brief saved'); load() } else toast.error('Save failed') })
                      }
                    }}
                  />
                </div>
              </>
            ) : (
              detail.brief && <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{detail.brief}</p>
            )}
            {(detail.raw_assets?.length ?? 0) > 0 && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Files</Label>
                <div className="flex flex-col gap-1">
                  {detail.raw_assets!.map(a => (
                    <div key={a.url} className="flex items-center gap-2">
                      <a href={a.url} target="_blank" rel="noreferrer noopener"
                        className="truncate text-sm text-blue-600 hover:underline dark:text-blue-400">
                        {a.name || a.url}
                      </a>
                      {canManage && (
                        <button type="button" aria-label={`Remove ${a.name}`}
                          className="text-zinc-400 hover:text-red-500"
                          onClick={() => {
                            void fetch(`/api/production/items/${id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ raw_assets: (detail.raw_assets ?? []).filter(x => x.url !== a.url) }),
                            }).then(r => { if (r.ok) { toast.success('File removed'); load() } else toast.error('Remove failed') })
                          }}>✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {canManage && (
              <div>
                <input ref={jobFileRef} type="file" multiple className="hidden"
                  onChange={e => onJobFiles(e.target.files)} />
                <Button type="button" variant="outline" size="sm"
                  onClick={() => jobFileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Add files
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* a task's inputs are the ask and whatever came with it — no footage */}
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
                  if (v !== (detail.brief ?? '')) {
                    void fetch(`/api/production/items/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ brief: v || null }),
                    }).then(r => { if (r.ok) { toast.success('Saved'); load() } else toast.error('Save failed') })
                  }
                }}
              />
            ) : (
              detail.brief
                ? <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{detail.brief}</p>
                : <p className="text-sm text-zinc-400 dark:text-zinc-500">No brief written for this task.</p>
            )}
            {(detail.raw_assets?.length ?? 0) > 0 && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Files</Label>
                <div className="flex flex-col gap-1">
                  {detail.raw_assets!.map(a => (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener"
                      className="truncate text-sm text-blue-600 hover:underline dark:text-blue-400">
                      {a.name || a.url}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* the client's brand guide travels with the job — editors cut to it,
          schedulers caption in it; clients see their own portal instead */}
      {isTeam && <BrandCard clientId={detail.client_id} />}

      {/* 7 — the conversation. Last of the work, before the plumbing. */}
      {canComment && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Comments</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2.5 pt-0">
            {detail.comments.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">No comments yet.</p>
            )}
            {detail.comments.map(c => (
              <div key={c.id} className="flex items-start gap-2.5 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <button onClick={() => isTeam && toggleResolved(c)} disabled={!isTeam} aria-label={c.resolved ? 'Reopen' : 'Resolve'} className="mt-0.5">
                  {c.resolved
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <CircleDashed className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${c.resolved ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}>{c.body}</p>
                  <p className="mt-0.5 flex items-center gap-2 font-mono text-[11px] uppercase text-zinc-400 dark:text-zinc-500">
                    {c.author_name && <span className="text-zinc-500 dark:text-zinc-400">{c.author_name}</span>}
                    {new Date(c.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                    {isTeam && c.visibility === 'client' && (
                      <Badge variant="outline" className="border-violet-200 bg-violet-50 font-normal normal-case text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400">visible to client</Badge>
                    )}
                  </p>
                </div>
              </div>
            ))}
            <div className="mt-1 flex flex-col gap-2">
              <Textarea
                rows={2}
                value={commentDraft}
                placeholder="Add a comment…"
                onChange={e => setCommentDraft(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                {canManage && (
                  <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <Switch
                      checked={commentVisibility === 'client'}
                      onCheckedChange={v => setCommentVisibility(v ? 'client' : 'internal')}
                    />
                    Visible to client
                  </label>
                )}
                {/* spec: "AM assigns editor task" — an internal comment
                    with an assignee emails that editor as a task. It is
                    also the ONLY way the comment reaches them: untagged
                    internal notes stay between managers. */}
                {canManage && commentVisibility === 'internal' && (
                  <Select value={commentAssignee || 'none'} onValueChange={v => setCommentAssignee(v === 'none' ? '' : v ?? '')}>
                    <SelectTrigger className="h-8 w-44 bg-white text-xs dark:bg-zinc-900">
                      <SelectValue placeholder="Tag someone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Managers only</SelectItem>
                      {/* the people already on the job come first — they're
                          the natural suggestions for "this is for you" */}
                      {(() => {
                        const onJob = new Set([detail.owner_id, ...(detail.scheduler_ids ?? [])].filter(Boolean))
                        return [...editors].sort((a, b) => Number(onJob.has(b.id)) - Number(onJob.has(a.id)))
                          .map(e => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name || e.email}{onJob.has(e.id) ? ' · on this job' : ''}
                            </SelectItem>
                          ))
                      })()}
                    </SelectContent>
                  </Select>
                )}
                <Button size="sm" className="ml-auto" disabled={busy === 'comment' || !commentDraft.trim()} onClick={postComment}>
                  <Send className="h-3.5 w-3.5" /> {busy === 'comment' ? 'Posting…' : 'Post'}
                </Button>
              </div>
              {canManage && commentVisibility === 'internal' && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  {commentAssignee
                    ? 'They’ll be emailed and will see this on the card.'
                    : 'Only managers see this. Tag someone to reach the person doing the work.'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 8 — SCHEDULING. Assets only: a brief books a shoot, a task ends. */}
      {isTeam && isAsset && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Caption</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {canManage || canSchedule ? (
              <Textarea
                ref={captionRef}
                rows={3}
                defaultValue={detail.caption ?? ''}
                onFocus={e => { focusVal.current.caption = e.target.value }}
                placeholder="The post text — published exactly as written here…"
                onBlur={e => {
                  const v = e.target.value.trim()
                  if (v === (focusVal.current.caption ?? '').trim()) return // nothing typed — never save
                  if (v !== (detail.caption ?? '')) {
                    void fetch(`/api/production/items/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ caption: v || null }),
                    }).then(r => { if (r.ok) { toast.success('Caption saved'); load() } else toast.error('Save failed') })
                  }
                }}
              />
            ) : detail.caption ? (
              <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{detail.caption}</p>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">No caption yet — the account manager writes the post text here.</p>
            )}
          </CardContent>
        </Card>
      )}

      {isAsset && (canSchedule || detail.schedule.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Scheduling</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2.5 pt-0">
            {detail.schedule.map(s => (
              <div key={s.id} className="flex items-baseline gap-3 rounded-lg border border-zinc-100 px-3 py-2 text-sm dark:border-zinc-800">
                <span className="capitalize">{s.platform}</span>
                {s.scheduled_at && (
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(s.scheduled_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <span className="ml-auto">
                  {s.live_url
                    ? <a href={s.live_url} target="_blank" rel="noreferrer noopener" className="text-xs text-emerald-600 hover:underline dark:text-emerald-400">live ↗</a>
                    : s.publish_status === 'published'
                      ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">posted in-app</span>
                      : <span className="font-mono text-[11px] uppercase text-zinc-400 dark:text-zinc-500">{publishStatusWord(s.publish_status)}</span>}
                </span>
              </div>
            ))}
            {canSchedule && (
              <div className="mt-1 grid gap-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={schedDraft.platform} onValueChange={v => v && setSchedDraft(d => ({ ...d, platform: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="datetime-local" value={schedDraft.scheduled_at} className="font-mono text-xs"
                    onChange={e => setSchedDraft(d => ({ ...d, scheduled_at: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Input value={schedDraft.live_url} placeholder="Live URL once posted"
                    onChange={e => setSchedDraft(d => ({ ...d, live_url: e.target.value }))} />
                  <Button size="sm" variant="outline" disabled={busy === 'schedule'} onClick={() => saveSchedule('date')}>Set date</Button>
                  <Button size="sm" disabled={busy === 'schedule' || !schedDraft.live_url} onClick={() => saveSchedule('live')}>Save the live link</Button>
                </div>
                <div>
                  <Button size="sm" variant="outline" className="w-fit" disabled={busy === 'schedule'} onClick={() => saveSchedule('posted')}>
                    Mark as posted
                  </Button>
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    For anything that went out without a link — a Story, or files handed over.
                  </p>
                </div>

                {/* connected publishing: post through the client's linked
                    social accounts instead of copying files by hand */}
                {!canAutoPublish ? (
                  <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                    Publishing to the channels is done by the scheduling team; add the live link here once it&rsquo;s up.
                  </p>
                ) : (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                      Connected accounts
                    </span>
                    <Button variant="outline" size="sm" disabled={planBusy} onClick={checkPlan}>
                      {planBusy ? 'Checking…' : plan ? 'Re-check' : 'Check channels'}
                    </Button>
                  </div>
                  {plan && (
                    <>
                      {plan.blocked ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400">{plan.blocked}</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {plan.targets.map(t => (
                              <Badge key={t.platform} variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 font-normal capitalize text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" /> {t.platform}
                              </Badge>
                            ))}
                            {plan.missing.map(p => (
                              <Badge key={p} variant="outline" className="border-amber-200 bg-amber-50 font-normal capitalize text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                                {p} — not connected
                              </Badge>
                            ))}
                            {plan.targets.length === 0 && plan.missing.length === 0 && (
                              <span className="text-xs text-zinc-400">No platform targets on this item.</span>
                            )}
                          </div>
                          {plan.missing.length > 0 && (
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                              Connect accounts on the client&rsquo;s <span className="font-medium">Social</span> tab to publish there automatically.
                            </p>
                          )}
                          {plan.targets.length > 0 && (
                            <>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" disabled={busy !== null} onClick={() => void openPublishPick(true)}>
                                  {busy === 'auto-publish' ? 'Working…' : 'Publish now'}
                                </Button>
                                {plan.scheduledFor && (
                                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void openPublishPick(false)}>
                                    Queue for {new Date(plan.scheduledFor).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                                  </Button>
                                )}
                              </div>
                              {!plan.scheduledFor && (
                                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                                  To post at a specific time: pick a date in the field above, press
                                  <span className="font-medium"> Set date</span>, and a Queue button appears here.
                                </p>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 9 — ASSIGNMENT & HANDOFF. Who carries this, and who takes it next. */}
      {isTeam && (canManage || canClaimEditor(workItem, viewer) || canClaimScheduler(workItem, viewer)) && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Who&rsquo;s on it</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 pt-0">
            {/* the manager says who's carrying this — the owner is who a
                request for changes notifies, and whose page this item sits on */}
            {canManage && (
              <Select
                value={detail.owner_id ?? 'none'}
                onValueChange={v => v && v !== (detail.owner_id ?? 'none') && saveOwner(v)}
              >
                <SelectTrigger className="h-8 w-60 bg-white text-xs dark:bg-zinc-900" disabled={busy === 'owner'}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody yet — anyone can pick it up</SelectItem>
                  {editors.map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {(e.name || e.email) + (e.role && e.role !== 'editor' ? ` · ${ROLE_WORD[e.role] ?? e.role}` : '')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* nobody has it — take it rather than wait to be given it */}
            {canClaimEditor(workItem, viewer) && (
              <ClaimButton itemId={id} hat="editor" label="Take this job" onDone={load} />
            )}
            {canClaimScheduler(workItem, viewer) && (
              <ClaimButton itemId={id} hat="scheduler" label="I'll schedule this" onDone={load} />
            )}
            {!canManage && detail.owner_name && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Assigned to {detail.owner_name}.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* approved and nobody named: the manager picks the person who takes it,
          rather than every scheduler hearing about every item */}
      {isAsset && canManage
        && (detail.status === 'approved_for_scheduling' || detail.status === 'scheduled') && (
        /* a manager who handed it to themselves still gets to change their
           mind — the card is theirs whether or not they hold the item */
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Choose who schedules this</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 pt-0">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {schedulerIds.length === 0
                ? 'Any scheduler can pick this up. Hand it to someone specific if you want one person on it.'
                : `Handed to ${schedulerIds.map(nameOf).filter(Boolean).join(', ') || 'someone on the team'}.`}
            </p>
            <Button size="sm" variant="outline" className="ml-auto" disabled={busy !== null}
              onClick={() => {
                setSchedPick('handoff')
                setSchedChosen(new Set(
                  schedulerIds.length > 0
                    ? schedulerIds
                    : editors.filter(e => e.role === 'scheduler').map(e => e.id),
                ))
              }}>
              {schedulerIds.length === 0 ? 'Hand it to someone' : 'Change'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 10 — HISTORY. Every move the item made, and who made it. The rows
          were always written; nothing ever showed them. */}
      {isTeam && (() => {
        const lines = activityLines(
          detail.activity ?? [],
          isBrief ? 'brief' : isInternal ? 'task' : 'asset',
        )
        return (
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">History</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1 pt-0">
              {lines.length === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">
                  Nothing recorded yet — every move from here is logged with who made it.
                </p>
              ) : lines.map(l => (
                <div key={l.id} className="flex items-baseline gap-3 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-300">{l.text}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                    {new Date(l.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })()}

      {/* 11 — the one thing that cannot be undone, at the bottom where a
          destructive action belongs, never inline beside the title */}
      {canManage && (
        <Card className="border-red-200 dark:border-red-950">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete this item</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Its versions, comments and schedule go with it — for everyone, including the client.
              </p>
            </div>
            <AlertDialog onOpenChange={o => !o && setDeleteConfirm('')}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="ml-auto text-red-600 hover:text-red-700 dark:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" /> Delete item
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{detail.title}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The item and all its versions, comments, and schedule entries are removed
                    for everyone, including the client&rsquo;s portal. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Type <span className="font-mono font-semibold">delete</span> to confirm</Label>
                  <Input
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder="delete"
                    autoComplete="off"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
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
          </CardContent>
        </Card>
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
                <Button variant="outline" size="sm" disabled={busy !== null}
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
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
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
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    {r.role === 'super_admin' ? 'Super admin' : 'Account manager'}
                    {r.assigned && ' · manages this client'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewPick(null)} disabled={busy !== null}>Cancel</Button>
            <Button
              disabled={busy !== null || reviewers === null || reviewersFailed}
              onClick={() => reviewPick && doTransition(reviewPick.to, reviewPick.label, [...chosen])}
            >
              {busy !== null ? 'Working…'
                : soloReviewer ? 'Submit and review it myself'
                : chosen.size > 0 ? `Send to ${chosen.size} reviewer${chosen.size > 1 ? 's' : ''}`
                : 'Send'}
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
              Say what needs to change — it lands in the item&rsquo;s thread and the
              assignee&rsquo;s email.
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionAsk(null)} disabled={busy !== null}>Cancel</Button>
            <Button
              disabled={busy !== null}
              onClick={() => revisionAsk && doTransition(revisionAsk.to, revisionAsk.label, undefined, undefined, revisionNote)}
            >
              {busy !== null ? 'Working…' : revisionAsk?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* who's scheduling this? */}
      <Dialog open={schedPick !== null} onOpenChange={o => !o && busy === null && setSchedPick(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{schedPick === 'handoff' ? 'Choose who schedules this' : 'Who’s scheduling this?'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              They&rsquo;ll be emailed to schedule and publish it. Untick anyone who
              shouldn&rsquo;t hear about it.
            </p>
            {/* anyone active on the team can be handed the scheduling — the
                hat follows the assignment, not the job title */}
            {editors.map(s => (
              <label key={s.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
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
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    {ROLE_WORD[s.role ?? ''] ?? 'Team'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedPick(null)} disabled={busy !== null}>Cancel</Button>
            <Button
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
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
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
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    {r.role === 'super_admin' ? 'Super admin' : 'Account manager'}
                    {r.assigned && ' · manages this client'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishPick(null)} disabled={busy !== null}>Cancel</Button>
            <Button
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
