'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { useOrderedLoad } from '../../useOrderedLoad'
import { useProductionLive } from '../useProductionLive'
import { useRow, useTable } from '@/lib/db-client'
import type {
  AssetVersion, Batch, Client, ContentItem, ItemComment, ScheduleEntry as ScheduleEntryRow,
  TeamUser, TeamUserClient, WorkKind,
} from '@/lib/db-types'
import { useRole } from '../../useRole'
import { itemIsVisible } from '../../../lib/scope-client'
import { useItemScopeContext } from '../../useLiveWork'
import { shapeItemDetail } from '../../../lib/production-access-core'
import { dismissUpload, enqueueJobAssets } from '../../uploadQueue'
import { UploadOverall, UploadRows, useUploadGroup } from '../../UploadRows'
import BrandCard from '../BrandCard'
import { RawFileRow, SlideThumb } from '../../../components/media/ItemMedia'
import ExportWarnings, {
  exportWarningsFor, type ExportWarning,
} from '../../../components/media/ExportWarnings'
import { DEFAULT_TZ, formatInZone } from '../../../lib/timezone-core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft, Upload, Send, CheckCircle2, CircleDashed, ExternalLink, MoreHorizontal, Trash2,
  Link2, Maximize2, ChevronsRight, Pencil,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import GettingStarted from '../../GettingStarted'
import HelpHint from '../../HelpHint'
import CollapsibleCard from '../../CollapsibleCard'
import ItemBoard from '../../boards/ItemBoard'
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
import { slideCountLabel, slidesOf, type Slide } from '../../../lib/version-files-core'
import { lastList } from '../../lastList'
import { activityLines, type ActivityRow } from '../../../lib/activity-core'
import { backLinkFor, canClaimEditor } from '../../../lib/work-pages-core'
import { ClaimButton } from '../ClaimButton'
import { actionFor, initialsOf, moveTargets, type BoardViewCard, type CardAction } from '../../../lib/board-view-core'
import { BOARD_COLUMNS, columnOf } from '../../../lib/board-core'
import { linkLabel, versionWord } from '../../../lib/card-link-core'
import { LinkDialog, SendBackDialog } from '../../board/BoardDialogs'
import { KindDialog } from '../../board/BoardDialogs'
import type { Role } from '../../../lib/identity-core'
import PageTitle from '../../ui/PageTitle'
import Chip, { type ChipTone } from '../../ui/Chip'
import { kindTone } from '../../ui/tone'

/**
 * THE CARD, OPENED — on its own page, or in the panel that slides in
 * beside the board.
 *
 * A card is one deliverable with ONE link and what needs doing. This shows
 * the same things the board shows — the link (with its label and
 * "version 3"), what needs doing, who holds it, when it is due, the stage —
 * and offers the one move the board would, in the board's own words
 * (`actionFor`: "Ready for checking", "Booked in", "Posted", "Send back for
 * changes"). Replacing the link makes a new version; the earlier ones sit
 * behind "Earlier versions".
 *
 * ONE component, two layouts. `layout="page"` is the full page as it has
 * always been. `layout="sheet"` is the same data, the same hooks and the
 * same moves laid out the way a task pane reads: a top bar (stage, the one
 * move, who holds it, copy link, open full page, More, close), the title,
 * a facts grid, what needs doing, the board and the files folded, and the
 * conversation pinned to the bottom with its composer. Nothing in the sheet
 * is a second copy of anything: every section is the page's own JSX, drawn
 * in a different order.
 *
 * EVERYTHING IS LIVE. The row, its versions, its comments and its posting
 * rows come from database listeners (`useRow` / `useTable`), never a
 * one-shot fetch, so a move, a replaced link or a colleague's comment lands
 * in an open sheet by itself. The one fetch left is for the four things only
 * the server can answer (posting context, approval gate, Drive mirror, the
 * named audit trail).
 *
 * NOTHING HERE POSTS. The scheduler takes the link and posts it on the
 * Schedule page; "Open in Schedule" is the one tap that gets them there.
 * Cards made before the reset still carry uploaded files — those are listed
 * under "Files", read only, so nothing already made goes missing.
 */

type Version = {
  id: string; version_number: number; created_at: string
  file_url: string; drive_url: string; dropbox_url?: string; notes?: string | null
  /** the ordered slides of a carousel, on cards made before the reset */
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
  external_match_state?: string | null
}

type Detail = {
  id: string; title: string; client_id: string; client_name: string | null
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
  /** where the work lives — the one link the board shows */
  link_url?: string | null
  link_kind?: string | null
  /** what the manager said needs changing, the last time it was sent back */
  change_note?: string | null
  // uses_media is NOT optional decoration: isInternalKind reads it
  work_kind?: { name: string; slug: string; color: string; uses_media?: boolean } | null
  batch?: {
    id: string; title: string; status?: string
    planned_deliverables?: unknown[]
    concept?: string | null; shot_list?: unknown[] | null
  } | null
  /** the client's portal accounts, so a send-to-client can name who it emails */
  client_users?: { name: string; email: string }[]
  raw_assets_url?: string | null; brief?: string | null
  drive_url?: string | null; drive_folder_id?: string | null
  drive_mirror?: { total: number; done: number; copying: boolean; line: string | null } | null
  raw_assets?: { url: string; name: string }[] | null
  versions: Version[]; comments: Comment[]; schedule: ScheduleEntry[]
  activity?: ActivityRow[]
  viewer_role: Role
  /** the hats this viewer wears ON THIS CARD — the server's own reading */
  acting_roles?: Role[]
  platform_targets?: string[] | null
  /** still loaded with the card, as before — nothing on this page draws them
   *  now that posting lives on the Schedule page */
  posting?: unknown
  posting_approval?: unknown
}

const STATUS_TINT: Record<string, string> = {
  draft_uploaded: 'bg-foreground/[0.06] text-muted-foreground border-border',
  internal_review: 'bg-tint-blue text-foreground border-accent-blue/25',
  revision_required: 'bg-tint-amber text-foreground border-accent-amber/35',
  revision_complete: 'bg-tint-amber text-foreground border-accent-amber/35',
  client_review: 'bg-tint-blue text-accent-blue-deep border-accent-blue/25',
  client_changes_requested: 'bg-tint-red text-foreground border-accent-red/30',
  approved_for_scheduling: 'bg-tint-green text-foreground border-accent-green/30',
  scheduled: 'bg-tint-blue text-foreground border-accent-blue/25',
  published: 'bg-tint-green text-foreground border-accent-green/30',
}

/** The server refused to show us this card — as opposed to the network
 *  hiccuping, which is not a reason to navigate anyone away from their work. */
class UnreadableItem extends Error {}

/** Job titles as people say them, for the pickers. */
const ROLE_WORD: Record<string, string> = {
  super_admin: 'Super admin',
  account_manager: 'Account manager',
  scheduler: 'Scheduler',
  editor: 'Editor',
}

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

/** the moves the page offers, worded the board's way */
type Move = CardAction & { blocked: string | null }

/** the client's chip colour — stable per client, from the palette's tints */
const CLIENT_TONES: ChipTone[] = ['blue', 'green', 'amber', 'muted']
function clientTone(seed: string): ChipTone {
  let n = 0
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return CLIENT_TONES[n % CLIENT_TONES.length]
}

export type CardDetailLayout = 'page' | 'sheet'

export default function CardDetail({ id, layout = 'page', onClose }: {
  id: string
  /** the full page, or the panel beside the board */
  layout?: CardDetailLayout
  /** in the sheet: how to shut it — after a delete, or when the card is
   *  not this person's to read */
  onClose?: () => void
}) {
  const router = useRouter()
  const inSheet = layout === 'sheet'
  /** the sheet's own state: an inline title edit, and which tab of the
   *  conversation is showing */
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [talkTab, setTalkTab] = useState<'comments' | 'activity'>('comments')
  const [kindOpen, setKindOpen] = useState(false)
  /**
   * What the person just typed or clicked, held until the row comes back.
   * These fields save on blur, and blur is the same gesture that clicks the
   * button beside them — this keeps the page agreeing with what the person
   * just did until the database says otherwise.
   */
  const [pending, setPending] = useState<Partial<Detail>>({})
  /** where the READER is, resolved after mount — rendering it on the server
   *  would be a hydration mismatch */
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  useEffect(() => {
    try { setViewerTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null) } catch { /* no zone, no hint */ }
  }, [])
  const [busy, setBusy] = useState<string | null>(null)

  const [commentDraft, setCommentDraft] = useState('')
  const [commentVisibility, setCommentVisibility] = useState<'internal' | 'client'>('internal')

  // the list this person was on before they opened the card. Read once, in
  // an effect: sessionStorage during render is a hydration mismatch.
  const [cameFrom, setCameFrom] = useState<{ href: string; label: string } | null>(null)
  useEffect(() => { setCameFrom(lastList()) }, [])

  /** the confirm before anything reaches the client's own screen */
  const [clientSend, setClientSend] = useState<{ to: ItemStatus; label: string } | null>(null)
  /** a refusal, shown INSIDE the dialog that caused it */
  const [dialogError, setDialogError] = useState<string | null>(null)
  /** the board's own two dialogs — replace the link, send back with words */
  const [linkOpen, setLinkOpen] = useState(false)
  const [sendBackOpen, setSendBackOpen] = useState(false)

  // type-to-confirm for deletion — a destructive click must be deliberate
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  // the people who can carry this job: every active, non-client team member.
  // One list serves the owner picker and the comment tagger.
  const [editors, setEditors] = useState<{ id: string; name: string; email: string; role?: string }[]>([])

  // source-file uploads (the footage the editor works from) — queued in the
  // background; the tray in the layout shows progress and the card
  // live-refreshes when each file attaches. Not the deliverable: that is the
  // link.
  const jobFileRef = useRef<HTMLInputElement>(null)
  const jobUploads = useUploadGroup(`item:${id}`)
  const [jobWarnings, setJobWarnings] = useState<ExportWarning[]>([])
  const onJobFiles = (files: FileList | null) => {
    if (!files?.length) return
    const chosen = Array.from(files)
    void exportWarningsFor(chosen).then(setJobWarnings)
    enqueueJobAssets(id, chosen)
    toast.success(`Uploading ${files.length} file${files.length > 1 ? 's' : ''} in the background — you can keep working`)
    if (jobFileRef.current) jobFileRef.current.value = ''
  }

  // guard against the stale-blur race: these fields are uncontrolled, and a
  // live refetch updates state without touching the DOM. Only what YOU typed
  // since focus is saved.
  const focusVal = useRef<Record<string, string>>({})

  /**
   * THE CARD, LIVE — with the server keeping the parts only it can know.
   *
   * The row, its versions, its conversation and its posting rows come
   * straight from database listeners. WHAT THIS VIEWER MAY SEE IS UNCHANGED:
   * the rows go through `shapeItemDetail`, the very function the API shapes
   * its payload with. Four things stay on the API, because only the server
   * can answer them: the posting context, the approval gate, the Drive
   * mirror progress and the named audit trail.
   */
  const { me } = useRole()
  const { row: itemRow, loading: itemLoading, error: itemError } = useRow<ContentItem>('content_items', id)
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: versionRows } = useTable<AssetVersion>('asset_versions', { by: byItem })
  const { rows: commentRows } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: scheduleRows } = useTable<ScheduleEntryRow>('schedule_entries', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  const { rows: assignments, loading: assignmentsLoading } = useTable<TeamUserClient>('team_user_clients')
  const { rows: workKinds } = useTable<WorkKind>('work_kinds')
  const { row: client } = useRow<Client>('clients', itemRow?.client_id ?? null)
  const { row: batch } = useRow<Batch>('batches', itemRow?.batch_id ?? null)

  /** the signed-in person, with the client_id a client viewer is scoped by */
  const liveViewer = useMemo(
    () => (me ? { id: me.id, role: me.role, client_id: team.find(u => u.id === me.id)?.client_id ?? null } : null),
    [me, team],
  )

  /** the shoot, its other cards and the comment tags — the two grants a
   *  single row cannot carry */
  const { ctx: scopeCtx, loading: scopeLoading } =
    useItemScopeContext(liveViewer, itemRow, commentRows)

  /** the four fields only the server can answer, and the fetch that gets them */
  const [extras, setExtras] = useState<Partial<Detail>>({})
  const loadOrdered = useOrderedLoad<Detail>(
    async () => {
      const res = await fetch(`/api/production/items/${id}`, { cache: 'no-store' })
      if (!res.ok) {
        throw new UnreadableItem(
          (await res.json().catch(() => ({}))).error ?? 'Failed to load card',
        )
      }
      return await res.json() as Detail
    },
    d => setExtras({
      posting: d.posting,
      posting_approval: d.posting_approval,
      drive_mirror: d.drive_mirror,
      activity: d.activity,
    }),
  )
  const load = useCallback(async () => {
    try {
      await loadOrdered()
    } catch (e) {
      // a dropped connection is not a missing card, and the LISTENER is what
      // decides whether this card exists for this viewer now
      if (!(e instanceof UnreadableItem)) return
    }
  }, [loadOrdered])
  useEffect(() => { load() }, [load])

  /** the card, shaped for this viewer, out of the live rows */
  const liveDetail: Detail | null = useMemo(() => {
    if (!liveViewer || !itemRow) return null
    const personName = new Map(team.map(a => [a.id, a.name || a.email]))
    const versions = [...versionRows]
      .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))
    const comments = [...commentRows]
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      .map(c => ({ ...c, author_name: c.author_id ? personName.get(c.author_id) ?? null : null }))
    const shaped = shapeItemDetail(
      liveViewer, itemRow as unknown as Record<string, unknown>, versions as never, comments as never,
    ) as Record<string, unknown>
    const kind = itemRow.work_kind_id
      ? workKinds.find(k => k.id === itemRow.work_kind_id) ?? null
      : null
    const isClient = liveViewer.role === 'client'
    const owner = itemRow.owner_id ? team.find(u => u.id === itemRow.owner_id) ?? null : null
    const clientTeam = new Set(assignments.filter(a => a.client_id === itemRow.client_id).map(a => a.team_user_id))
    return {
      ...shaped,
      work_kind: kind
        ? { name: kind.name, slug: kind.slug, color: kind.color, uses_media: kind.uses_media }
        : null,
      batch: batch
        ? {
            id: batch.id, title: batch.title, status: batch.status ?? undefined,
            planned_deliverables: (batch.planned_deliverables ?? undefined) as unknown[] | undefined,
            concept: (batch as { concept?: string | null }).concept ?? null,
            shot_list: (batch.shot_list ?? null) as unknown[] | null,
          }
        : null,
      client_name: client?.name ?? null,
      client_timezone: (client?.timezone as string | null) || DEFAULT_TZ,
      // a client never sees who inside the agency did what
      owner_name: isClient ? null : (owner?.name || owner?.email || null),
      managers: isClient
        ? []
        : team
            .filter(u => clientTeam.has(u.id) && u.active_status
              && ['account_manager', 'super_admin'].includes(u.role))
            .map(u => ({ name: u.name || u.email, email: u.email })),
      client_users: isClient
        ? []
        : team
            .filter(u => u.role === 'client' && u.client_id === itemRow.client_id && u.active_status === true)
            .map(u => ({ name: u.name || u.email, email: u.email })),
      schedule: isClient ? [] : (scheduleRows as unknown as ScheduleEntry[]),
      viewer_role: liveViewer.role,
      viewer_id: liveViewer.id,
    } as unknown as Detail
  }, [liveViewer, itemRow, team, assignments, versionRows, commentRows, scheduleRows, workKinds, client, batch])

  /** live first, the server's extras over the top, then whatever the person
   *  has just done and the database has not echoed back yet */
  const detail: Detail | null = useMemo(
    () => (liveDetail ? { ...liveDetail, ...extras, ...pending } : null),
    [liveDetail, extras, pending],
  )

  // the database has spoken: whatever was being held for the round trip is
  // either in the row now or was refused
  const rowStamp = itemRow?.updated_at
  useEffect(() => { setPending({}) }, [rowStamp])

  /**
   * The card is not this person's to read — or is gone. Only the LISTENER
   * decides this, never a dropped request (`app/lib/scope-client.ts`).
   */
  useEffect(() => {
    if (!liveViewer || itemLoading || assignmentsLoading || scopeLoading) return
    if (itemError) return
    if (itemRow && itemIsVisible(liveViewer, itemRow, assignments, scopeCtx)) return
    toast.error('Card not found')
    // in the sheet the board is still behind us — shut the panel, stay put
    if (inSheet) onClose?.()
    else router.push('/dashboard/editor')
  }, [liveViewer, itemRow, itemLoading, itemError, assignmentsLoading, scopeLoading, assignments, scopeCtx, router, inSheet, onClose])

  // A shoot plan lives on its SHOOT page — a shoot_brief card with a batch
  // forwards there, keeping old links and notifications working. The sheet
  // offers the link instead of leaving the board.
  useEffect(() => {
    if (!inSheet && detail?.work_kind?.slug === SHOOT_BRIEF_SLUG && detail.batch?.id) {
      router.replace(`/dashboard/production/shoots/${detail.batch.id}`)
    }
  }, [detail?.work_kind?.slug, detail?.batch?.id, router, inSheet])

  /** A write's own answer no longer has to be spliced in: the listener puts
   *  the new row on the page before the toast finishes animating. */
  const applyWrite = useCallback((_row: unknown) => { void _row }, [])

  // the card itself is live; this only re-reads the things the server answers
  useProductionLive(useCallback((change?: { item_id: string }) => {
    if (!change || change.item_id === id) void load()
  }, [id, load]))

  // the team directory: managers (re)assign from it, and everyone tags from it
  const viewerRole = detail?.viewer_role
  useEffect(() => {
    if (!viewerRole || viewerRole === 'client') return
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then(json => {
        const active = (json.members ?? []).filter(
          (m: { active_status?: boolean }) => m.active_status !== false)
        setEditors(active
          .filter((m: { role: string }) => m.role !== 'client')
          .map((m: { id: string; name: string; email: string; role: string }) =>
            ({ id: m.id, name: m.name, email: m.email, role: m.role })))
      })
      .catch(() => { setEditors([]) })
  }, [viewerRole])

  // The uncontrolled fields on this page are `defaultValue` only: the
  // server's value is written into the DOM directly, and only when the field
  // is NOT the one under the cursor.
  const briefUrlRef = useRef<HTMLInputElement>(null)
  const briefNoteRef = useRef<HTMLTextAreaElement>(null)
  const rawAssetsRef = useRef<HTMLInputElement>(null)
  const jobBriefRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!detail) return
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
  }, [detail])

  // the live listener itself failed — say so instead of spinning forever
  if (!detail && itemError) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <p className="text-body-15 font-medium">We could not load this card.</p>
        <p className="text-body-15 text-muted-foreground">
          The live connection to the database failed. Check your connection and try again.
        </p>
        <div>
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  // the redirect above is on its way — don't flash the full page
  if (detail.work_kind?.slug === SHOOT_BRIEF_SLUG && detail.batch?.id) {
    return inSheet ? (
      <div className="flex flex-col gap-3 p-5">
        <p className="text-body-15 font-medium">{detail.title}</p>
        <p className="text-body-15 text-muted-foreground">A shoot plan lives on its shoot page.</p>
        <Button className="w-fit min-h-11" asChild>
          <Link href={`/dashboard/production/shoots/${detail.batch.id}`}>Open the shoot page <ExternalLink className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    ) : (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <p className="text-body-15 text-muted-foreground">Opening the shoot page…</p>
      </div>
    )
  }

  const role = detail.viewer_role
  const isTeam = role !== 'client'
  const viewer = { id: detail.viewer_id ?? '', role }
  const isBrief = detail.work_kind?.slug === SHOOT_BRIEF_SLUG
  // research / strategy / copy: nothing to post
  const isInternal = isInternalKind(detail.work_kind)
  const isAsset = !isBrief && !isInternal

  // What you may do here follows the ASSIGNMENT, not the job title. The
  // server sends the hats it shaped the payload with; actingRoles is only
  // the fallback for a payload from before that field existed.
  const hats = detail.acting_roles ?? actingRoles(viewer, detail)
  const isSuper = role === 'super_admin'
  /** past this point the work is done — nothing left to replace */
  const editingClosed = isInternal
    ? TASK_DONE_STATUSES.has(detail.status)
    : SCHEDULER_STATUSES.includes(detail.status)
  const schedulerIds = schedulerIdsOf(detail)
  /** may this person set or replace the link — the holder, whoever holds its
   *  posting, or a manager: the same rule the link route applies */
  const canEditLink = isTeam && !editingClosed
    && (isSuper || hats.includes('account_manager') || detail.owner_id === viewer.id || schedulerIds.includes(viewer.id))
  // schedulers may comment on what they post; clients talk in their portal
  const canComment = role !== 'client'
    && (isSuper || hats.includes('editor') || hats.includes('account_manager') || hats.includes('scheduler'))
  // reviewing IS the job, and it is not per-card — owner picker, delete,
  // comment visibility, what needs doing
  const canManage = isSuper || hats.includes('account_manager')
  /** the people who post — the path to the Schedule page is theirs */
  const canOpenSchedule = isAsset && (isSuper || role === 'scheduler' || role === 'account_manager' || hats.includes('scheduler'))

  // a shoot plan wears its own words; a task judges by its own rules
  const rawTransitions = isBrief
    ? availableBriefTaskTransitionsAs(hats, detail.status)
    : isInternal ? availableTaskTransitionsAs(hats, detail.status)
    : availableTransitionsAs(hats, detail.status)
  const turns = isBrief ? BRIEF_STATUS_TURN : isInternal ? TASK_STATUS_TURN : STATUS_TURN
  const turn = whoseTurn(detail.status, detail, viewer, turns)
  const { primary, secondary } = presentTransitions(
    hats, detail.status, rawTransitions,
    {
      clientApprovalRequired: detail.client_approval_required !== false,
      viewerHoldsTurn: turn.mine,
    },
    turns,
  )
  const meaning = isBrief ? BRIEF_STATUS_MEANING[detail.status] : isInternal ? TASK_STATUS_MEANING[detail.status] : STATUS_MEANING[detail.status]

  const nameOf = (uid: string) => {
    const m = editors.find(e => e.id === uid)
    return m ? (m.name || m.email) : null
  }
  /** whose move it is, said as a person rather than a role */
  const turnText = (): string => {
    if (turn.hat === null) return 'nobody — this one is finished'
    if (turn.unassigned) {
      return isBrief ? 'Unassigned — an account manager will pick it up'
        : turn.hat === 'scheduler' ? 'Unassigned — any scheduler can take it'
        : 'Unassigned — anyone can take it'
    }
    if (turn.mine) return 'You'
    if (turn.hat === 'editor') return detail.owner_name ?? 'the person on it'
    if (turn.hat === 'scheduler') {
      const names = schedulerIds.map(nameOf).filter(Boolean)
      return names.length > 0 ? names.join(', ') : 'the scheduler'
    }
    if (turn.hat === 'client') return 'the client'
    return 'the account manager'
  }

  // the card as the work pages read it — one vocabulary for "can I take this?"
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

  /** the card as the board's dialogs read it */
  const boardCard: BoardViewCard = {
    id: detail.id,
    title: detail.title,
    status: detail.status,
    client_id: detail.client_id,
    clients: detail.client_name ? { name: detail.client_name } : null,
    work_kinds: detail.work_kind ? { name: detail.work_kind.name, slug: detail.work_kind.slug, color: detail.work_kind.color } : null,
    link_url: detail.link_url ?? null,
    link_kind: detail.link_kind ?? null,
    brief: detail.brief ?? null,
    owner_id: detail.owner_id ?? null,
    scheduler_ids: detail.scheduler_ids,
    due_date: detail.due_date,
    current_version_number: detail.current_version_number,
    change_note: detail.change_note ?? null,
    client_approval_required: detail.client_approval_required !== false,
  }

  const latest = detail.versions[0]
  /** the link's own history — "Link added", "Link updated to version 3" */
  const linkHistory = (detail.activity ?? [])
    .filter(a => a.action === 'link_added' || a.action === 'link_updated')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  /** when the work last changed — a replaced link or an uploaded version */
  const lastWorkAt = [latest?.created_at ?? null, linkHistory[0]?.created_at ?? null]
    .filter((s): s is string => !!s).sort().pop() ?? null
  const hasWork = !!detail.link_url || detail.versions.length > 0

  /** Preconditions the SERVER will enforce, said before the button is pressed. */
  const briefHasContent = Boolean(
    detail.brief_url?.trim()
    || detail.batch?.concept?.trim()
    || (detail.batch?.shot_list?.length ?? 0) > 0,
  )
  const lastRevisionRequest = (detail.activity ?? [])
    .filter(a => a.action === 'status_change' && a.new_value === 'revision_required')
    .map(a => a.created_at).sort().pop() ?? null
  const blockedReason = (to: ItemStatus): string | null => {
    if (to === 'internal_review' && isBrief && !briefHasContent) {
      return 'Add a plan link, or fill in the concept or shot list on the shoot page.'
    }
    if (to === 'internal_review' && !isBrief && !hasWork) {
      return 'Add the link first — where the work lives.'
    }
    if (to === 'revision_complete' && !isBrief && needsNewVersion(lastWorkAt, lastRevisionRequest)) {
      return 'Replace the link with the new version first.'
    }
    if (to === 'scheduled' && isBrief && !['locked', 'shot'].includes(detail.batch?.status ?? '')) {
      return 'Book the shoot on its page first — the date is set there.'
    }
    // a card made before the reset, with files and no link, still posts from
    // the Schedule page — the server records the posting from there
    if (to === 'scheduled' && isAsset && !detail.link_url && detail.schedule.every(s => !s.scheduled_at)) {
      return 'Book this one in from the Schedule page first.'
    }
    if (to === 'published' && isAsset && !detail.link_url && detail.schedule.every(s => s.publish_status !== 'published')) {
      return 'Post this one from the Schedule page first.'
    }
    return null
  }

  /** What just happened, in the past tense, and where it went. */
  const successWord = (to: ItemStatus, label: string): { text: string; href: string } => {
    const client = detail.client_name ?? 'the client'
    const owner = detail.owner_name ?? 'the person on it'
    const board = isAsset ? '/dashboard/editor' : '/dashboard/production'
    switch (to) {
      case 'internal_review': return { text: 'Ready for checking — the account manager has been told', href: board }
      case 'revision_required': return { text: `Sent back to ${owner} for changes — they have been told`, href: board }
      case 'revision_complete': return { text: 'Marked as changed — back with the account manager', href: board }
      case 'client_review': return { text: `Sent to ${client} — it is on their portal now`, href: board }
      case 'client_changes_requested': return { text: "The client's changes are logged", href: board }
      case 'approved_for_scheduling':
        return isBrief ? { text: 'Plan approved — book the date on the shoot page', href: detail.batch?.id ? `/dashboard/production/shoots/${detail.batch.id}` : board }
          : isInternal ? { text: 'Approved — this one is done', href: board }
          : { text: 'Approved — it is under Ready to post on the Scheduler', href: '/dashboard/scheduler' }
      case 'scheduled': return isBrief ? { text: 'Shoot booked', href: board } : { text: 'Booked in', href: '/dashboard/scheduler' }
      case 'published': return { text: 'Posted', href: '/dashboard/scheduler' }
      default: return { text: label, href: board }
    }
  }

  const doTransition = async (to: ItemStatus, label: string) => {
    setBusy(to)
    setDialogError(null)
    try {
      const res = await fetch(`/api/production/items/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${label} failed`)
      const done = successWord(to, label)
      toastOpen(done.text, done.href, router.push)
      setClientSend(null)
      applyWrite(json)
      await load()
    } catch (e) {
      // a dropped RESPONSE is not a failed request — check before alarming
      if (e instanceof TypeError) {
        toast.message('Network hiccup — checking whether it went through…')
        await load()
        toast.message('Refreshed. If the status moved, it worked — don’t click again.')
      } else {
        const msg = e instanceof Error ? e.message : `${label} failed`
        if (/^No transition from /.test(msg)) {
          toast.error('That move isn’t available any more — the card just changed. Reloading.')
          await load()
        } else {
          toast.error(msg)
          setDialogError(msg)
        }
      }
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

  /** Save one field, and make the page agree with itself immediately. */
  const saveField = (patch: Record<string, unknown>, done: string) => {
    setPending(p => ({ ...p, ...patch }))
    return fetch(`/api/production/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(async r => {
        if (!r.ok) {
          toast.error((await r.json().catch(() => ({}))).error ?? 'Save failed')
          setPending({})
          return
        }
        toast.success(done)
        void load()
      })
      .catch(() => { toast.error('Could not save — check your connection'); setPending({}) })
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

  /** Does the client have to sign this off? */
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

  /** The header's second line: the facts — client, kind, version, due. */
  const overdue = detail.due_date
    && new Date(detail.due_date) < new Date(new Date().toDateString())
    && !['scheduled', 'published'].includes(detail.status)
  const kindWord = isBrief ? 'Shoot plan'
    : detail.work_kind?.name
      ?? (detail.content_type && detail.content_type !== 'other' ? detail.content_type : null)
  const facts = [
    detail.client_name ?? '—',
    kindWord,
    !isBrief ? versionWord(detail.current_version_number) : null,
    detail.due_date ? `due ${shortDay(detail.due_date)}` : null,
    detail.priority && detail.priority !== 'normal' ? `${detail.priority} priority` : null,
  ].filter(Boolean)

  const statusWord = role === 'client'
    ? (detail.status_label ?? CLIENT_LABELS[detail.status])
    : isInternal ? taskStatusLabel(detail.work_kind, detail.status, STATUS_LABELS[detail.status], { hasWork })
    : itemStatusLabel(detail.work_kind?.slug, detail.status, STATUS_LABELS[detail.status])

  /** the one folder link — the pasted one wins over the one we made */
  const folderUrl = detail.raw_assets_url || detail.drive_url || null
  /** has anyone tagged the viewer here and not yet marked it done? */
  const openForMe = detail.comments.some(c => !c.resolved && c.assigned_to === detail.viewer_id)

  /**
   * The moves, in the board's words. A shoot plan keeps its own — its page is
   * the shoot page; everything else says what the board says.
   */
  const toMove = (t: { to: ItemStatus; label: string }): Move => {
    const action: CardAction = isBrief ? { kind: 'transition', to: t.to, label: t.label } : actionFor(t.to, t.label, hats)
    return { ...action, blocked: action.kind === 'send_back' ? null : blockedReason(t.to) }
  }
  const primaryMove = primary ? toMove(primary) : null
  const moreMoves = secondary.map(toMove)
    // "Send back for changes" is one move whichever edge it came from
    .filter((m, i, all) => !(m.kind === 'send_back' && (primaryMove?.kind === 'send_back' || all.findIndex(x => x.kind === 'send_back') < i)))
  const hints = [...new Set([primaryMove, ...moreMoves].map(m => m?.blocked).filter(Boolean))] as string[]
  const press = (m: Move) => {
    if (m.kind === 'send_back') { setSendBackOpen(true); return }
    // anything that puts this in front of the CLIENT gets a confirm naming
    // who it reaches — it is the riskiest move in the app
    if (m.to === 'client_review') { setClientSend({ to: m.to, label: m.label }); setDialogError(null); return }
    void doTransition(m.to, m.label)
  }
  const moveButton = (m: Move, variant: 'default' | 'outline', className = '') => (
    <Button key={`${m.kind}-${m.to}`} size="sm" variant={variant} className={`min-h-11 md:min-h-8 ${className}`}
      disabled={busy !== null || m.blocked !== null}
      onClick={() => press(m)}>
      {busy === m.to ? 'Working…' : m.label}
    </Button>
  )

  /** who holds which seat, for the People card */
  const reviewerNames = (detail.managers ?? []).map(m => m.name).filter(Boolean)
  const hasFiles = detail.versions.some(v => slidesOf(v).length > 0 || v.file_url || v.drive_url)
    || (detail.raw_assets?.length ?? 0) > 0

  /** the sheet's own gates — the title and the date follow the same rule the
   *  PATCH route applies: a manager, or the person holding the card */
  const canEditTitle = isTeam && (canManage || detail.owner_id === viewer.id)
  const canEditDue = canEditTitle
  const canEditKind = isTeam && !editingClosed && (canManage || detail.owner_id === viewer.id)
  const kindRows = workKinds.map(k => ({ id: k.id, name: k.name, slug: k.slug, color: k.color, active: k.active }))
  const saveTitle = () => {
    const v = titleDraft.trim()
    setTitleEditing(false)
    if (!v || v === detail.title) return
    void saveField({ title: v }, 'Title saved')
  }
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/dashboard/production/${id}`)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy — open the full page and copy its address')
    }
  }
  /** the stage, as the board names it: the column, then the status where the
   *  column holds more than one */
  const columnLabel = BOARD_COLUMNS.find(c => c.key === columnOf(detail.status))?.label ?? statusWord
  const stageText = columnLabel === statusWord ? columnLabel : `${columnLabel} · ${statusWord}`
  /** the columns the More menu can move this card to — the same list the
   *  board's own menu offers, judged by the same rules */
  const menuMoves: Move[] = isTeam && !isBrief
    ? moveTargets(boardCard, viewer).map(t => ({
        ...t.action,
        blocked: t.action.kind === 'send_back' ? null : blockedReason(t.action.to),
      }))
    : []
  const historyLines = activityLines(detail.activity ?? [], isBrief ? 'brief' : isInternal ? 'task' : 'asset')

  /* ─── THE PIECES both layouts draw — written once ─────────────────── */

  /** 5b — THE BOARD. The canvas behind this piece: notes, images, links,
      boards inside boards. It is a section of the card, not a second
      screen — folded until wanted. The first open makes the board (claimed
      on the item, so two people opening at once share one); the API decides
      who may, the same way it decides who may open the card. */
  const boardSection = (
    <CollapsibleCard id="board" title="Board" summary="plan this piece — notes, images, links, boards inside">
      <p className="text-secondary-13 text-muted-foreground">
        The place to plan this piece. Put down notes, images and links, and make a board inside it for anything bigger.
      </p>
      <ItemBoard itemId={id} backHref={{ href: `/dashboard/production/${id}`, label: detail.title }} />
    </CollapsibleCard>
  )

  /** 6 — FILES. What was uploaded before the reset, and the folder the
      source footage sits in. Read only: nothing new is made here. */
  const filesSection = isTeam && !isBrief && (hasFiles || folderUrl || canManage) ? (
    <CollapsibleCard id="files" title="Files"
      summary={hasFiles ? `${detail.versions.length > 0 ? `${detail.versions.length} uploaded ${detail.versions.length === 1 ? 'version' : 'versions'}` : ''}${detail.versions.length > 0 && (detail.raw_assets?.length ?? 0) > 0 ? ' · ' : ''}${(detail.raw_assets?.length ?? 0) > 0 ? `${detail.raw_assets!.length} source ${detail.raw_assets!.length === 1 ? 'file' : 'files'}` : ''}` : folderUrl ? 'the folder' : 'nothing yet'}>
      {folderUrl && (
        <div>
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-8" asChild>
            <a href={folderUrl} target="_blank" rel="noreferrer noopener">
              Open the folder <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      )}
      {detail.drive_mirror?.line && (
        <p className={`text-secondary-13 ${detail.drive_mirror.copying ? 'text-accent-amber' : 'text-muted-foreground'}`}>
          {detail.drive_mirror.line}
        </p>
      )}
      {canManage && isAsset && (
        <div className="grid gap-1.5">
          <Label className="text-secondary-13">Folder link <span className="font-normal text-muted-foreground">(Google Drive)</span></Label>
          <Input
            ref={rawAssetsRef}
            defaultValue={detail.raw_assets_url ?? detail.drive_url ?? ''}
            onFocus={e => { focusVal.current.raw_assets_url = e.target.value }}
            placeholder="https://drive.google.com/drive/folders/…"
            className="font-mono text-secondary-13"
            onBlur={e => {
              const v = e.target.value.trim()
              if (v === (focusVal.current.raw_assets_url ?? '').trim()) return
              if (v !== (detail.raw_assets_url ?? '')) void saveField({ raw_assets_url: v || null }, 'Folder link saved')
            }}
          />
        </div>
      )}
      {detail.versions.filter(v => slidesOf(v).length > 0 || v.file_url || v.drive_url).map(v => {
        const slides = slidesOf(v)
        return (
          <div key={v.id} className="flex flex-col gap-2 rounded-inner border border-border px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-3 text-secondary-13">
              <span className="font-semibold">{versionWord(v.version_number)}</span>
              <span className="text-muted-foreground">{shortDay(v.created_at)}</span>
              {slides.length > 1 && <span className="text-muted-foreground">{slideCountLabel(slides.length)}</span>}
              {v.notes && <span className="truncate text-muted-foreground">{v.notes}</span>}
              <span className="ml-auto flex gap-3">
                {v.file_url && <a className="min-h-11 py-3 text-accent-blue-deep hover:underline md:min-h-0 md:py-0" href={v.file_url} target="_blank" rel="noreferrer noopener">Open file</a>}
                {v.drive_url && <a className="min-h-11 py-3 text-accent-blue-deep hover:underline md:min-h-0 md:py-0" href={v.drive_url} target="_blank" rel="noreferrer noopener">Open in Drive</a>}
                {v.dropbox_url && <a className="min-h-11 py-3 text-muted-foreground hover:underline md:min-h-0 md:py-0" href={v.dropbox_url} target="_blank" rel="noreferrer noopener">Master file</a>}
              </span>
            </div>
            {slides.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {slides.map((s, i) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener"
                    title={`${i + 1} of ${slides.length} — ${s.name}`}
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-tile border border-border bg-foreground">
                    <SlideThumb slide={s} />
                    {slides.length > 1 && (
                      <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 font-mono text-[12px] text-white">{i + 1}</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        )
      })}
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
        <div className="flex flex-col gap-2 rounded-inner border border-border p-2.5">
          <UploadOverall uploads={jobUploads} />
          <UploadRows uploads={jobUploads} onDismiss={dismissUpload} />
        </div>
      )}
      <ExportWarnings items={jobWarnings} onDismiss={() => setJobWarnings([])} />
      {canManage && isAsset && (
        <div>
          <input ref={jobFileRef} type="file" multiple className="sr-only"
            onChange={e => onJobFiles(e.target.files)} />
          <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8"
            onClick={() => jobFileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Add source files
          </Button>
          <p className="mt-1.5 text-secondary-13 text-muted-foreground">
            Footage and stills for the person making this. The finished work is the link above.
          </p>
        </div>
      )}
    </CollapsibleCard>
  ) : null

  /** 7 — THE CONVERSATION, the thread. Live: `detail.comments` is the
      `item_comments` listener, so a colleague's comment lands as they post it. */
  const commentThread = (
    <>
      {detail.comments.length === 0 && (
        <p className="text-body-15 text-muted-foreground">
          No comments yet. Type @ and a name to ask someone something — they get an email and it stays on their list until it is marked done.
        </p>
      )}
      {detail.comments.map(c => {
        const forMe = c.assigned_to === detail.viewer_id
        const forName = c.assigned_to ? nameOf(c.assigned_to) : null
        return (
          <div key={c.id} className={`flex items-start gap-2.5 rounded-inner border px-3 py-2 ${
            forMe && !c.resolved ? 'border-accent-amber/35 bg-tint-amber' : 'border-border'
          }`}>
            <button onClick={() => isTeam && toggleResolved(c)} disabled={!isTeam}
              aria-label={c.resolved ? 'Reopen' : 'Mark done'} title={c.resolved ? 'Reopen' : 'Mark done'}
              className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center">
              {c.resolved
                ? <CheckCircle2 className="h-4 w-4 text-accent-green" />
                : <CircleDashed className="h-4 w-4 text-muted-foreground" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`whitespace-pre-wrap text-body-15 ${c.resolved ? 'text-muted-foreground line-through' : ''}`}>{c.body}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                {c.author_name && <span className="text-muted-foreground">{c.author_name}</span>}
                <span suppressHydrationWarning>{viewerTz ? formatInZone(c.created_at, viewerTz, 'short') : ''}</span>
                {c.assigned_to && !c.resolved && (
                  <span className="rounded-full bg-tint-amber px-2.5 py-1.5 text-chip-12 font-medium text-foreground">
                    {forMe ? 'Waiting on you' : `Waiting on ${forName ?? 'someone'}`}
                  </span>
                )}
                {isTeam && c.visibility === 'client' && (
                  <Badge variant="outline" className="border-accent-blue/25 bg-tint-blue font-normal text-accent-blue-deep">visible to client</Badge>
                )}
              </p>
            </div>
          </div>
        )
      })}
    </>
  )

  /** the composer — "@Name" reaches somebody; nothing else does */
  const composer = (
    <div className="flex flex-col gap-2">
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
          <label className="flex min-h-11 items-center gap-2 text-secondary-13 text-muted-foreground md:min-h-0">
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
      <p className="text-secondary-13 text-muted-foreground">
        {commentVisibility === 'client'
          ? `${detail.client_name ?? 'The client'} reads this on their portal.`
          : 'Managers see every comment. To reach anyone else, tag them with @ — they are emailed and it waits on them until it is marked done.'}
      </p>
    </div>
  )

  /** 8 — HISTORY. Every move and who made it. */
  const historyList = historyLines.length === 0 ? (
    <p className="text-body-15 text-muted-foreground">
      Nothing recorded yet — every move from here is logged with who made it.
    </p>
  ) : historyLines.map(l => (
    <div key={l.id} className="flex items-baseline gap-3 text-body-15">
      <span className="text-muted-foreground">{l.text}</span>
      <span className="ml-auto shrink-0 font-mono text-[12px] text-muted-foreground" suppressHydrationWarning>
        {viewerTz ? formatInZone(l.at, viewerTz, 'long') : ''}
      </span>
    </div>
  ))

  /** 9 — the one thing that cannot be undone: the confirm, typed */
  const deleteDialog = canManage ? (
    <AlertDialog open={deleteOpen}
      onOpenChange={o => { setDeleteOpen(o); if (!o) setDeleteConfirm('') }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{detail.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The card and everything on it — the link, files, comments and history — is removed
            for everyone, including the client&rsquo;s portal. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label className="text-secondary-13">Type <span className="font-mono font-semibold">delete</span> to confirm</Label>
          <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="delete" autoComplete="off" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">Keep it</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11 bg-accent-red hover:bg-accent-red/90"
            disabled={deleteConfirm.trim().toLowerCase() !== 'delete'}
            onClick={async () => {
              const res = await fetch(`/api/production/items/${id}`, { method: 'DELETE' })
              if (!res.ok) return toast.error((await res.json()).error ?? 'Delete failed')
              toast.success('Card deleted')
              // the listener drops the row from the board behind the sheet
              if (inSheet) onClose?.()
              else router.push(back.href)
            }}
          >
            Delete card
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null

  /** the board's own dialogs — the same ones the card opens on the board —
      and the confirm before anything reaches the client */
  const dialogs = (
    <>
      <LinkDialog card={linkOpen ? boardCard : null} onClose={() => setLinkOpen(false)} onSaved={() => void load()} />
      <SendBackDialog card={sendBackOpen ? boardCard : null} viewer={viewer}
        onClose={() => setSendBackOpen(false)} onSent={() => void load()} />
      <KindDialog card={kindOpen ? boardCard : null} kinds={kindRows} onClose={() => setKindOpen(false)} onSaved={() => void load()} />

      {/* about to reach the client — say who, and what they will see */}
      <Dialog open={clientSend !== null} onOpenChange={o => !o && busy === null && setClientSend(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send to {detail.client_name ?? 'the client'}?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-body-15 text-muted-foreground">
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
            <p className="text-muted-foreground">
              {isBrief
                ? 'The plan becomes visible on their portal, where they can approve it or ask for changes.'
                : 'The card and its link become visible on their portal, where they can approve it or ask for changes.'}
            </p>
          </div>
          {dialogError && (
            <p className="rounded-tile border border-accent-amber/35 bg-tint-amber px-3 py-2 text-body-15 text-foreground">
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
    </>
  )

  /* ─── THE SHEET: a task pane, top to bottom ───────────────────────── */

  if (inSheet) {
    const ownerName = detail.owner_id === detail.viewer_id ? 'You' : detail.owner_name ?? null
    const factRow = (label: string, value: React.ReactNode) => (
      <div className="flex min-h-11 items-center gap-3 py-1">
        <span className="w-24 shrink-0 text-secondary-13 text-muted-foreground">{label}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-body-15">{value}</div>
      </div>
    )
    const iconBtn = 'h-11 w-11 shrink-0 rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
    const hasMore = moreMoves.length > 0 || menuMoves.length > 0 || canEditLink || canEditKind || canManage

    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* 1 — TOP BAR. The stage, the one move, who holds it, and the
            controls that are about the pane rather than the work. */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
          <Chip tone={detail.status === 'client_changes_requested' || detail.status === 'revision_required' ? 'amber'
            : detail.status === 'published' ? 'ink'
            : detail.status === 'approved_for_scheduling' ? 'green'
            : detail.status === 'scheduled' || detail.status === 'client_review' || detail.status === 'internal_review' ? 'blue' : 'muted'}>
            {stageText}
          </Chip>
          {isTeam && primaryMove && (
            <Button size="sm" className="min-h-11 rounded-full px-4 text-[13px] font-semibold md:min-h-9"
              disabled={busy !== null || primaryMove.blocked !== null}
              onClick={() => press(primaryMove)}>
              {busy === primaryMove.to ? 'Working…' : primaryMove.label}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {ownerName && (
              <span title={ownerName} aria-label={`Held by ${ownerName}`}
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-full bg-accent-blue text-[11px] font-bold text-cream">
                {initialsOf(ownerName)}
              </span>
            )}
            <Button variant="ghost" size="icon" className={iconBtn} aria-label="Copy link to this card" title="Copy link"
              onClick={() => void copyLink()}>
              <Link2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className={iconBtn} aria-label="Open full page" title="Open full page" asChild>
              <Link href={`/dashboard/production/${id}`}><Maximize2 className="h-4 w-4" /></Link>
            </Button>
            {hasMore && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className={iconBtn} aria-label="More for this card" disabled={busy !== null}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {moreMoves.map(m => (
                    <DropdownMenuItem key={`${m.kind}-${m.to}`} className="min-h-11" disabled={m.blocked !== null}
                      onClick={() => press(m)}>
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                  {menuMoves.length > 0 && (
                    <>
                      {moreMoves.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
                        Move
                      </DropdownMenuLabel>
                      {menuMoves.map(m => (
                        <DropdownMenuItem key={`move-${m.to}`} className="min-h-11" disabled={m.blocked !== null}
                          onClick={() => press(m)}>
                          {m.label}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                  {(canEditLink || canEditKind) && (
                    <>
                      <DropdownMenuSeparator />
                      {canEditLink && (
                        <DropdownMenuItem className="min-h-11" onClick={() => setLinkOpen(true)}>
                          {detail.link_url ? 'Replace the link' : 'Add a link'}
                        </DropdownMenuItem>
                      )}
                      {canEditKind && (
                        <DropdownMenuItem className="min-h-11" onClick={() => setKindOpen(true)}>
                          Change the kind of work
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {canManage && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-11 text-accent-red focus:text-accent-red"
                        onClick={() => { setDeleteConfirm(''); setDeleteOpen(true) }}>
                        <Trash2 className="h-4 w-4" /> Delete this card
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="ghost" size="icon" className={iconBtn} aria-label="Close" title="Close" onClick={() => onClose?.()}>
              <ChevronsRight className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* the body scrolls; the composer below it does not */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {/* 2 — THE TITLE, large; a press edits it for whoever may */}
          {titleEditing ? (
            <Input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); saveTitle() }
                if (e.key === 'Escape') { e.preventDefault(); setTitleEditing(false) }
              }}
              aria-label="Card title"
              className="h-12 text-[22px] font-semibold"
            />
          ) : canEditTitle ? (
            <button type="button"
              onClick={() => { setTitleDraft(detail.title); setTitleEditing(true) }}
              className="group -mx-2 flex min-h-11 items-start gap-2 rounded-inner px-2 text-left hover:bg-foreground/[0.04]"
              title="Edit the title">
              <span className="text-[22px] font-semibold leading-[1.25]">{detail.title}</span>
              <Pencil className="mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          ) : (
            <h2 className="text-[22px] font-semibold leading-[1.25]">{detail.title}</h2>
          )}

          {/* whose move it is, in one line; what came back, if anything */}
          {isTeam && (
            <div className="flex flex-col gap-2">
              <p className="text-secondary-13 text-muted-foreground">
                <span className="font-medium text-foreground">{meaning}</span>{' '}
                {turn.hat !== null && (turn.mine ? 'That’s you.' : `Waiting on ${turnText()}.`)}
              </p>
              {openForMe && (
                <p className="rounded-tile bg-tint-amber px-3 py-2 text-body-15 text-foreground">
                  Someone tagged you in the comments below — it stays on your list until you mark it done.
                </p>
              )}
              {detail.change_note && (detail.status === 'revision_required' || detail.status === 'client_changes_requested') && (
                <p className="rounded-tile bg-tint-amber px-3 py-2 text-body-15 text-foreground">
                  <span className="font-medium">Change:</span> {detail.change_note}
                </p>
              )}
              {hints.map(h => (
                <p key={h} className="text-secondary-13 text-accent-amber">{h}</p>
              ))}
            </div>
          )}

          {/* 3 — THE FACTS. One line each, label left, value right. */}
          <div className="flex flex-col divide-y divide-border rounded-inner border border-border px-3">
            {factRow('Assignee', <>
              {isTeam && canManage ? (
                <Select
                  value={detail.owner_id ?? 'none'}
                  onValueChange={v => v && v !== (detail.owner_id ?? 'none') && saveOwner(v)}
                >
                  <SelectTrigger className="h-11 w-full max-w-[260px] bg-surface text-body-15 md:h-9 md:text-secondary-13" disabled={busy === 'owner'}>
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
                <span className="flex items-center gap-2">
                  {ownerName && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-blue text-[10px] font-bold text-cream">
                      {initialsOf(ownerName)}
                    </span>
                  )}
                  {ownerName ?? <span className="text-muted-foreground">nobody yet</span>}
                </span>
              )}
              {isTeam && canClaimEditor(workItem, viewer) && <ClaimButton itemId={id} hat="editor" onDone={load} />}
            </>)}
            {factRow('Due date', canEditDue ? (
              <Input
                type="date"
                value={detail.due_date ? detail.due_date.slice(0, 10) : ''}
                onChange={e => void saveField({ due_date: e.target.value || null }, e.target.value ? 'Due date saved' : 'Due date cleared')}
                aria-label="Due date"
                className={`h-11 w-full max-w-[200px] bg-surface md:h-9 ${overdue ? 'text-accent-red' : ''}`}
              />
            ) : (
              <span className={overdue ? 'font-medium text-accent-red' : ''}>
                {detail.due_date ? shortDay(detail.due_date) : <span className="text-muted-foreground">no date</span>}
              </span>
            ))}
            {factRow('Client', <Chip tone={clientTone(detail.client_id)}>{detail.client_name ?? '—'}</Chip>)}
            {factRow('Kind', <>
              {kindWord ? <Chip tone={kindTone(detail.work_kind?.color)}>{kindWord}</Chip> : <span className="text-muted-foreground">not set</span>}
              {canEditKind && (
                <Button variant="ghost" size="sm" className="min-h-11 px-2 text-secondary-13 text-muted-foreground md:min-h-8"
                  onClick={() => setKindOpen(true)}>Change</Button>
              )}
            </>)}
            {!isBrief && factRow('Version', <span>{versionWord(detail.current_version_number)}</span>)}
            {!isBrief && factRow('Link', detail.link_url ? (
              <>
                <Chip tone="surface">{linkLabel(detail.link_kind)}</Chip>
                <Button size="sm" className="min-h-11 md:min-h-8" asChild>
                  <a href={detail.link_url} target="_blank" rel="noreferrer noopener">
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
                {canEditLink && (
                  <Button variant="ghost" size="sm" className="min-h-11 px-2 text-secondary-13 text-muted-foreground md:min-h-8"
                    disabled={busy !== null} onClick={() => setLinkOpen(true)}>Replace</Button>
                )}
              </>
            ) : canEditLink ? (
              <Button variant="outline" size="sm" className="min-h-11 rounded-full border-dashed md:min-h-8"
                disabled={busy !== null} onClick={() => setLinkOpen(true)}>Add link</Button>
            ) : (
              <span className="text-muted-foreground">No link yet</span>
            ))}
            {isBrief && factRow('Plan', detail.batch?.id ? (
              <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" asChild>
                <Link href={`/dashboard/production/shoots/${detail.batch.id}`}>Open the shoot page <ExternalLink className="h-3.5 w-3.5" /></Link>
              </Button>
            ) : (
              <span className="text-muted-foreground">on the shoot page</span>
            ))}
            {canManage && !isInternal && factRow('Client answer', (
              <label className="flex min-h-11 items-center gap-2.5 text-secondary-13 text-muted-foreground md:min-h-0">
                <Switch
                  checked={detail.client_approval_required !== false}
                  disabled={busy !== null}
                  onCheckedChange={v => void saveApproval(v)}
                />
                Send this to the client for their answer
              </label>
            ))}
            {canOpenSchedule && factRow('Posting', (
              <Button size="sm" variant="ghost" className="-ml-2 min-h-11 md:min-h-8" asChild>
                <Link href="/dashboard/social/schedule">Open in Schedule <ExternalLink className="h-3.5 w-3.5" /></Link>
              </Button>
            ))}
          </div>

          {/* 4 — WHAT NEEDS DOING. The requirement, in the manager's words. */}
          {isTeam && !isBrief && (canManage || detail.brief) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-secondary-13 font-semibold">What needs doing</span>
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
                <p className="whitespace-pre-wrap text-body-15 text-muted-foreground">{detail.brief}</p>
              )}
            </div>
          )}

          {/* 5 — THE BOARD, folded. 6 — FILES, folded. */}
          {boardSection}
          {filesSection}

          {/* 7 — THE CONVERSATION, with the record beside it */}
          {canComment && (
            <div id="comments" className="flex flex-col gap-2.5 scroll-mt-4">
              <div role="tablist" aria-label="Comments or activity" className="flex gap-1">
                {([['comments', 'Comments'], ['activity', 'All activity']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={talkTab === key}
                    onClick={() => setTalkTab(key)}
                    className={`min-h-11 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                      talkTab === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              {talkTab === 'comments' ? commentThread : (isTeam ? historyList : null)}
            </div>
          )}
        </div>

        {/* the composer, pinned — the last thing on the pane, always in reach */}
        {canComment && (
          <div className="border-t border-border bg-popover px-4 py-3">
            {composer}
          </div>
        )}

        {deleteDialog}
        {dialogs}
      </div>
    )
  }

  /* ─── THE PAGE ────────────────────────────────────────────────────── */

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 pb-24 md:pb-0">
      {/* 1 — HEADER. What this is. The stage once, as a badge. */}
      <Button variant="outline" size="sm" className="w-fit min-h-11 md:min-h-8" onClick={() => router.push(back.href)}>
        <ArrowLeft className="h-4 w-4" /> {back.label}
      </Button>
      <PageTitle
        title={detail.title}
        summary={<>
          {facts.map((f, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              <span className={overdue && String(f).startsWith('due') ? 'font-medium text-accent-red' : ''}>{f}</span>
            </span>
          ))}
          {isBrief && <> <HelpHint term="shoot_plan" /></>}
        </>}
        actions={<>
          <Badge variant="outline" className={STATUS_TINT[detail.status] ?? ''}>
            {statusWord}
            {detail.status === 'approved_for_scheduling' && isAsset && <HelpHint term="approved_for_scheduling" className="-my-2" />}
            {detail.status === 'draft_uploaded' && isAsset && <HelpHint term="drafting" className="-my-2" />}
          </Badge>
        </>}
      />

      {isTeam && <GettingStarted role={role} page="item" />}

      {/* 2 — WHAT TO DO NOW. One sentence, one button in the board's words,
          the reason it is grey if it is grey. */}
      {isTeam && (primaryMove || moreMoves.length > 0 || turns[detail.status] !== null || openForMe) && (
        <Card id="next" className="scroll-mt-4 border-border">
          <CardContent className="flex flex-col gap-2.5 p-4">
            {openForMe && (
              <p className="rounded-tile bg-tint-amber px-3 py-2 text-body-15 text-foreground">
                Someone tagged you in the comments below — it stays on your list until you mark it done.{' '}
                <a href="#comments" className="font-medium underline">Read it</a>
              </p>
            )}
            <p className="text-body-15">
              <span className="font-medium">{meaning}</span>{' '}
              {turn.hat !== null && (
                turn.mine
                  ? <span className="text-foreground">That&rsquo;s you.</span>
                  : <span className="text-muted-foreground">Waiting on {turnText()}.</span>
              )}
            </p>
            {detail.change_note && (detail.status === 'revision_required' || detail.status === 'client_changes_requested') && (
              <p className="rounded-tile bg-tint-amber px-3 py-2 text-body-15 text-foreground">
                <span className="font-medium">Change:</span> {detail.change_note}
              </p>
            )}
            {(primaryMove || moreMoves.length > 0) && (
              <div className="flex flex-wrap items-center gap-2">
                {primaryMove && moveButton(primaryMove, 'default')}
                {moreMoves.length === 1 && moveButton(moreMoves[0], 'outline')}
                {moreMoves.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" aria-label="Other moves" disabled={busy !== null}>
                        <MoreHorizontal className="h-4 w-4" /> More
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {moreMoves.map(m => (
                        <DropdownMenuItem key={`${m.kind}-${m.to}`} className="min-h-11" disabled={m.blocked !== null}
                          onClick={() => press(m)}>
                          {m.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* posting is the Schedule page's job — one tap to get there */}
                {canOpenSchedule && (
                  <Button size="sm" variant="ghost" className="ml-auto min-h-11 md:min-h-8" asChild>
                    <Link href="/dashboard/social/schedule">Open in Schedule <ExternalLink className="h-3.5 w-3.5" /></Link>
                  </Button>
                )}
              </div>
            )}
            {hints.map(h => (
              <p key={h} className="text-secondary-13 text-accent-amber">{h}</p>
            ))}
            {/* WHAT THIS SWITCH ACTUALLY DOES: the route the work takes — on,
                and the piece goes to the client for their answer; off, and
                this page offers the manager the sign-off instead. Whether
                this client sees every post before it goes out is the
                CLIENT's own setting, on their page — the one the server
                enforces. */}
            {canManage && !isInternal && (
              <label className="flex min-h-11 items-start gap-2.5 text-secondary-13 text-muted-foreground md:min-h-0">
                <Switch
                  checked={detail.client_approval_required !== false}
                  disabled={busy !== null}
                  onCheckedChange={v => void saveApproval(v)}
                />
                <span>
                  Send this to the client for their answer
                  <span className="block text-muted-foreground/80">
                    Turn it off and an account manager signs it off here instead. Whether
                    this client sees every post before it goes out is set on their own page.
                  </span>
                </span>
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3 — THE WORK. A plan's is its page; everything else is ONE link. */}
      {isTeam && isBrief && (
        <Card id="work" className="scroll-mt-4">
          <CardHeader className="flex-row items-center">
            <CardTitle>The plan</CardTitle>
            {detail.batch?.id && (
              <Button size="sm" variant="outline" className="ml-auto min-h-11 md:min-h-8" asChild>
                <Link href={`/dashboard/production/shoots/${detail.batch.id}`}>Open the shoot page <ExternalLink className="h-3.5 w-3.5" /></Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <p className="text-secondary-13 text-muted-foreground">
              The concept and shot list live on the shoot page. A link to a plan written elsewhere goes here.
            </p>
            <div className="grid gap-1.5">
              <Label className="text-secondary-13">Plan link{briefHasContent ? '' : ' *'}</Label>
              <div className="flex gap-2">
                <Input
                  ref={briefUrlRef}
                  defaultValue={detail.brief_url ?? ''}
                  placeholder="https://app.milanote.com/…"
                  className="font-mono text-secondary-13"
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
              <Label className="text-secondary-13">Note to reviewer</Label>
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
              <p className="text-secondary-13 text-muted-foreground">
                Shoot booked — after the shoot, mark it shot on the shoot page and create the cards there.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isBrief && (
        <Card id="work" className="scroll-mt-4">
          <CardHeader className="flex-row items-center gap-2">
            <CardTitle>The link</CardTitle>
            <span className="text-secondary-13 text-muted-foreground">{versionWord(detail.current_version_number)}</span>
            {canEditLink && (
              <Button size="sm" variant="outline" className="ml-auto min-h-11 md:min-h-8" disabled={busy !== null}
                onClick={() => setLinkOpen(true)}>
                {detail.link_url ? 'Replace the link' : 'Add the link'}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {detail.link_url ? (
              <div className="flex flex-wrap items-center gap-2 rounded-inner border border-border px-3 py-2.5">
                <Chip tone="surface">{linkLabel(detail.link_kind)}</Chip>
                {detail.work_kind?.name && <Chip tone={kindTone(detail.work_kind.color)}>{detail.work_kind.name}</Chip>}
                <span className="min-w-0 flex-1 truncate font-mono text-secondary-13 text-muted-foreground" title={detail.link_url}>
                  {detail.link_url}
                </span>
                <Button size="sm" className="min-h-11 md:min-h-8" asChild>
                  <a href={detail.link_url} target="_blank" rel="noreferrer noopener">
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            ) : (
              <p className="text-body-15 text-muted-foreground">
                {canEditLink
                  ? 'No link yet. Paste the Google Drive or Dropbox link to where the work lives.'
                  : 'No link yet.'}
              </p>
            )}
            {canEditLink && detail.link_url && (
              <p className="text-secondary-13 text-muted-foreground">
                Replacing the link makes a new version — {versionWord(detail.current_version_number + 1)}.
              </p>
            )}
            {/* earlier versions, folded — the current one is above */}
            {(linkHistory.length > 1 || (detail.link_url && detail.versions.length > 0)) && (
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground md:min-h-6">
                  <CircleDashed className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  Earlier versions
                </summary>
                <div className="mt-2 flex flex-col gap-1.5">
                  {linkHistory.slice(1).map(a => (
                    <div key={a.id} className="flex items-baseline gap-3 rounded-inner border border-border px-3 py-2 text-secondary-13">
                      <span className="font-semibold">{versionWord(Number(String(a.new_value ?? '').replace(/^v/, '')) || null)}</span>
                      <span className="text-muted-foreground">{shortDay(a.created_at)}</span>
                      <span className="truncate text-muted-foreground">{a.detail ?? 'Link replaced'}</span>
                    </div>
                  ))}
                  {detail.link_url && detail.versions.length > 0 && (
                    <p className="text-secondary-13 text-muted-foreground">
                      The files uploaded before this card had a link are under Files below.
                    </p>
                  )}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4 — WHAT NEEDS DOING. The requirement, in the manager's words. */}
      {isTeam && !isBrief && (canManage || detail.brief) && (
        <Card id="brief" className="scroll-mt-4">
          <CardHeader><CardTitle>What needs doing</CardTitle></CardHeader>
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
              <p className="whitespace-pre-wrap text-body-15 text-muted-foreground">{detail.brief}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 5 — PEOPLE. Who holds it, who checks it — each seat once. */}
      {isTeam && (
        <Card>
          <CardHeader><CardTitle>People</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="w-24 shrink-0 text-secondary-13 text-muted-foreground">{isBrief ? 'Writing it' : 'Holding it'}</span>
              {canManage ? (
                <Select
                  value={detail.owner_id ?? 'none'}
                  onValueChange={v => v && v !== (detail.owner_id ?? 'none') && saveOwner(v)}
                >
                  <SelectTrigger className="h-11 w-60 bg-surface text-body-15 md:h-8 md:text-secondary-13" disabled={busy === 'owner'}>
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
                <span className="text-body-15">
                  {detail.owner_id === detail.viewer_id ? 'You' : detail.owner_name ?? <span className="text-muted-foreground">nobody yet</span>}
                </span>
              )}
              {canClaimEditor(workItem, viewer) && <ClaimButton itemId={id} hat="editor" onDone={load} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="w-24 shrink-0 text-secondary-13 text-muted-foreground">Checking it</span>
              <span className="text-body-15">
                {reviewerNames.length > 0 ? reviewerNames.join(', ') : <span className="text-muted-foreground">no account manager on this client</span>}
              </span>
              {detail.client_approval_required !== false && !isInternal && (
                <span className="text-secondary-13 text-muted-foreground">then it goes to {detail.client_name ?? 'the client'} for their answer</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6 — FILES, read only. 5b — THE BOARD, folded. */}
      {filesSection}
      {boardSection}

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
          <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2.5 pt-0">
            {commentThread}
            <div className="mt-1">{composer}</div>
          </CardContent>
        </Card>
      )}

      {/* 8 — HISTORY. Every move and who made it — folded, it is the record */}
      {isTeam && (
        <CollapsibleCard title="History" summary={historyLines.length === 0 ? 'nothing yet' : `${historyLines.length} ${historyLines.length === 1 ? 'entry' : 'entries'}`}>
          {historyList}
        </CollapsibleCard>
      )}

      {/* 9 — the one thing that cannot be undone, last and folded */}
      {canManage && (
        <CollapsibleCard title="Delete this card" summary="cannot be undone" className="border-accent-red/30">
          <p className="text-secondary-13 text-muted-foreground">
            Its link, files, comments and history go with it — for everyone, including the client.
          </p>
          <Button variant="outline" size="sm" className="min-h-11 w-fit text-accent-red hover:text-foreground md:min-h-8"
            onClick={() => { setDeleteConfirm(''); setDeleteOpen(true) }}>
            <Trash2 className="h-3.5 w-3.5" /> Delete card
          </Button>
        </CollapsibleCard>
      )}

      {/* PHONE: the one button, always within thumb reach */}
      {isTeam && primaryMove && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 p-3 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-4xl items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-secondary-13 text-muted-foreground">
              {turn.mine ? 'Your move' : `Waiting on ${turnText()}`}
            </span>
            {moveButton(primaryMove, 'default', 'shrink-0')}
          </div>
        </div>
      )}

      {deleteDialog}
      {dialogs}
    </div>
  )
}
