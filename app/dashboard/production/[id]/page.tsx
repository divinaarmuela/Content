'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
  availableTransitions, CLIENT_LABELS, type ItemStatus,
} from '../../../lib/workflow-core'
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
  content_type: string; status: ItemStatus; status_label?: string
  priority: string; due_date: string | null; caption: string | null
  client_approval_required: boolean; current_version_number: number
  owner_name?: string | null; managers?: { name: string; email: string }[]
  raw_assets_url?: string | null; brief?: string | null
  raw_assets?: { url: string; name: string }[] | null
  versions: Version[]; comments: Comment[]; schedule: ScheduleEntry[]
  viewer_role: Role
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

function Media({ src, className }: { src: string; className?: string }) {
  if (!src) return null
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    return <video src={src} controls playsInline className={className} />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} />
}

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [verDraft, setVerDraft] = useState({ file_url: '', dropbox_url: '', drive_url: '', notes: '' })
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [commentDraft, setCommentDraft] = useState('')

  // "Submit for review" reviewer picker — the editor chooses who is asked
  const [reviewPick, setReviewPick] = useState<{ to: ItemStatus; label: string } | null>(null)
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null)
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
      const list: Reviewer[] = (json.eligible ?? []).map((u: { id: string; name: string; email: string; role: string }) => ({
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

  // editors for owner assignment + comment tasks (managers only)
  const [editors, setEditors] = useState<{ id: string; name: string; email: string; role?: string }[]>([])
  // "who schedules this?" — for the approve edge and the post-client-approval handoff
  const [schedulers, setSchedulers] = useState<{ id: string; name: string; email: string; role: string }[]>([])
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
      router.push('/dashboard/production')
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
        setSchedulers(active
          .filter((m: { role: string }) => ['scheduler', 'super_admin'].includes(m.role))
          .map((m: { id: string; name: string; email: string; role: string }) =>
            ({ id: m.id, name: m.name, email: m.email, role: m.role })))
      })
      .catch(() => { setEditors([]); setSchedulers([]) })
  }, [viewerRole])

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
  const canAddVersion = ['editor', 'account_manager', 'super_admin'].includes(role)
  const canComment = role !== 'scheduler'
  const canSchedule = ['scheduler', 'super_admin'].includes(role)
  const transitions = availableTransitions(role, detail.status)
  const latest = detail.versions[0]

  const doTransition = async (to: ItemStatus, label: string, notifyIds?: string[], schedulerIds?: string[]) => {
    setBusy(to)
    try {
      const res = await fetch(`/api/production/items/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          ...(notifyIds?.length ? { notify_ids: notifyIds } : {}),
          ...(schedulerIds?.length ? { scheduler_ids: schedulerIds } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${label} failed`)
      toast.success(label)
      setReviewPick(null)
      setSchedPick(null)
      load()
    } catch (e) {
      // a dropped RESPONSE is not a failed request — check before alarming
      if (e instanceof TypeError) {
        toast.message('Network hiccup — checking whether it went through…')
        await load()
        setReviewPick(null)
        toast.message('Refreshed. If the status moved, it worked — don’t click again.')
      } else {
        toast.error(e instanceof Error ? e.message : `${label} failed`)
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
      toast.success(`Notified ${json.notified} scheduler${json.notified === 1 ? '' : 's'}`)
      setSchedPick(null)
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
    try {
      const res = await fetch(`/api/clients/${detail!.client_id}/managers`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load reviewers')
      const assignedIds = new Set<string>((json.managers ?? []).map((m: { team_user_id: string }) => m.team_user_id))
      const list: Reviewer[] = (json.eligible ?? []).map((u: { id: string; name: string; email: string; role: string }) => ({
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
      // picker unavailable → submit still works, routed to assigned managers
      toast.error(e instanceof Error ? e.message : 'Could not load reviewers')
      setReviewers([])
    }
  }

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      // Straight to R2 rather than through our API: this is where shoot
      // deliverables land, and a serverless request body caps at ~4.5MB on
      // Vercel — every real cut would have been rejected.
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
    if (!verDraft.file_url && !verDraft.drive_url) return toast.error('Upload a file or add a Drive link')
    if (!verDraft.dropbox_url) return toast.error('The Dropbox master link is required')
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
      toast.success(ownerId === 'none' ? 'Editor unassigned' : 'Editor assigned')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign')
    } finally {
      setBusy(null)
    }
  }

  const saveSchedule = async (withLive: boolean) => {
    setBusy('schedule')
    try {
      const res = await fetch(`/api/production/items/${id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: schedDraft.platform,
          ...(schedDraft.scheduled_at ? { scheduled_at: new Date(schedDraft.scheduled_at).toISOString() } : {}),
          ...(withLive && schedDraft.live_url ? { live_url: schedDraft.live_url } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      toast.success(withLive ? 'Live link saved' : 'Schedule saved')
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
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/production')}>
          <ArrowLeft className="h-4 w-4" /> Board
        </Button>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{detail.title}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {detail.client_name ?? '—'} · <span className="capitalize">{detail.content_type}</span>
            {detail.current_version_number > 0 && <> · <span className="font-mono text-xs">v{detail.current_version_number}</span></>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* spec §3: the AM assigns the job — the owner is who "Request
              revisions" notifies and whose board queue this item sits in */}
          {(role === 'account_manager' || role === 'super_admin') && (
            <Select
              value={detail.owner_id ?? 'none'}
              onValueChange={v => v && v !== (detail.owner_id ?? 'none') && saveOwner(v)}
            >
              <SelectTrigger className="h-8 w-44 bg-white text-xs dark:bg-zinc-900" disabled={busy === 'owner'}>
                <SelectValue placeholder="Assign editor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No editor assigned</SelectItem>
                {editors.map(e => (
                  <SelectItem key={e.id} value={e.id}>
                    {(e.name || e.email) + (e.role && e.role !== 'editor' ? ` · ${e.role.replace('_', ' ')}` : '')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge variant="outline" className={STATUS_TINT[detail.status] ?? ''}>
            {role === 'client' ? (detail.status_label ?? CLIENT_LABELS[detail.status]) : detail.status.replace(/_/g, ' ')}
          </Badge>
          {['account_manager', 'super_admin'].includes(role) && (
            <AlertDialog onOpenChange={o => !o && setDeleteConfirm('')}>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-red-600" aria-label="Delete item">
                  <Trash2 className="h-3.5 w-3.5" />
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
                      router.push('/dashboard/production')
                    }}
                  >
                    Delete item
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Who's who + when — the job's vital signs, for every team role */}
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
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Editor</span>
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

      {/* Actions */}
      {transitions.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            {transitions.map(t => (
              <Button
                key={t.to}
                size="sm"
                variant={t.to === 'revision_required' || t.to === 'client_changes_requested' ? 'outline' : 'default'}
                disabled={busy !== null}
                onClick={() =>
                  (t.to === 'internal_review' || t.to === 'revision_complete')
                    ? openReviewerPick(t)
                    : (t.to === 'approved_for_scheduling' && schedulers.length > 0)
                      ? (setSchedPick(t), setSchedChosen(new Set(schedulers.filter(s => s.role === 'scheduler').map(s => s.id))))
                      : doTransition(t.to, t.label)
                }
              >
                {busy === t.to ? 'Working…' : t.label}
              </Button>
            ))}
            {isTeam && detail.status === 'internal_review' && detail.client_approval_required && (
              <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                client approval required
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* the client approved → every scheduler heard; the manager narrows it
          to the person who actually takes it */}
      {['account_manager', 'super_admin'].includes(role)
        && detail.status === 'approved_for_scheduling' && schedulers.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Approved and waiting to be scheduled.
            </p>
            <Button size="sm" variant="outline" className="ml-auto" disabled={busy !== null}
              onClick={() => {
                setSchedPick('handoff')
                setSchedChosen(new Set(schedulers.filter(s => s.role === 'scheduler').map(s => s.id)))
              }}>
              Hand to a scheduler
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Latest preview */}
      {latest && (latest.file_url || latest.drive_url) && (
        <Card className="overflow-hidden py-0">
          {latest.file_url && <Media src={latest.file_url} className="max-h-[420px] w-full bg-zinc-950 object-contain" />}
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">v{latest.version_number} · latest</span>
            {latest.drive_url && (
              <a href={latest.drive_url} target="_blank" rel="noreferrer noopener" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                Open in Drive
              </a>
            )}
            {isTeam && role !== 'scheduler' && latest.dropbox_url && (
              <a href={latest.dropbox_url} target="_blank" rel="noreferrer noopener" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
                Dropbox master
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job pack — internal only (never in the client or scheduler payload):
          the brief and raw footage the editor works from */}
      {isTeam && role !== 'scheduler' && (detail.brief || detail.raw_assets_url || (detail.raw_assets?.length ?? 0) > 0 || ['account_manager', 'super_admin'].includes(role)) && (
        <Card>
          <CardHeader className="flex-row items-center">
            <CardTitle className="text-sm font-semibold">Job pack</CardTitle>
            {detail.raw_assets_url && (
              <Button variant="outline" size="sm" className="ml-auto" asChild>
                <a href={detail.raw_assets_url} target="_blank" rel="noreferrer noopener">
                  <Upload className="h-3.5 w-3.5 rotate-180" /> Open raw assets
                </a>
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {['account_manager', 'super_admin'].includes(role) ? (
              <>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Raw assets link</Label>
                  <Input
                    key={detail.raw_assets_url ?? ''}
                    defaultValue={detail.raw_assets_url ?? ''}
                    onFocus={e => { focusVal.current.raw_assets_url = e.target.value }}
                    placeholder="https://www.dropbox.com/… (folder the editor works from)"
                    className="font-mono text-xs"
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v === (focusVal.current.raw_assets_url ?? '').trim()) return // nothing typed — never save
                      if (v !== (detail.raw_assets_url ?? '')) {
                        void fetch(`/api/production/items/${id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ raw_assets_url: v || null }),
                        }).then(r => { if (r.ok) { toast.success('Assets link saved'); load() } else toast.error('Save failed') })
                      }
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Brief</Label>
                  <Textarea
                    rows={3}
                    key={detail.brief ?? ''}
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
                <Label className="text-xs">Source files</Label>
                <div className="flex flex-col gap-1">
                  {detail.raw_assets!.map(a => (
                    <div key={a.url} className="flex items-center gap-2">
                      <a href={a.url} target="_blank" rel="noreferrer noopener"
                        className="truncate text-sm text-blue-600 hover:underline dark:text-blue-400">
                        {a.name || a.url}
                      </a>
                      {['account_manager', 'super_admin'].includes(role) && (
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
            {['account_manager', 'super_admin'].includes(role) && (
              <div>
                <input ref={jobFileRef} type="file" multiple className="hidden"
                  onChange={e => onJobFiles(e.target.files)} />
                <Button type="button" variant="outline" size="sm"
                  onClick={() => jobFileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Upload source files
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* the client's brand guide travels with the job — editors cut to it,
          schedulers caption in it; clients see their own portal instead */}
      {isTeam && <BrandCard clientId={detail.client_id} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Versions */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Versions</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {detail.versions.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">No versions yet — add the first below.</p>
            )}
            {detail.versions.map(v => (
              <div key={v.id} className="flex items-baseline gap-3 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <span className="font-mono text-xs font-semibold">v{v.version_number}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(v.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                </span>
                {v.notes && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{v.notes}</span>}
                <span className="ml-auto flex gap-2 text-xs">
                  {v.file_url && <a className="text-blue-600 hover:underline dark:text-blue-400" href={v.file_url} target="_blank" rel="noreferrer noopener">file</a>}
                  {v.drive_url && <a className="text-blue-600 hover:underline dark:text-blue-400" href={v.drive_url} target="_blank" rel="noreferrer noopener">drive</a>}
                  {isTeam && role !== 'scheduler' && v.dropbox_url && <a className="text-zinc-500 hover:underline dark:text-zinc-400" href={v.dropbox_url} target="_blank" rel="noreferrer noopener">dropbox</a>}
                </span>
              </div>
            ))}

            {canAddVersion && (
              <>
                <Separator />
                <div className="flex flex-col gap-2.5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">New version</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : verDraft.file_url ? 'Replace file' : 'Upload file'}
                    </Button>
                    {verDraft.file_url && <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">file ready ✓</span>}
                    <input ref={fileRef} type="file" accept="image/*,video/*" hidden
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Dropbox master link *</Label>
                    <Input value={verDraft.dropbox_url} placeholder="https://www.dropbox.com/…"
                      onChange={e => setVerDraft(d => ({ ...d, dropbox_url: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Drive review link {verDraft.file_url ? '(optional)' : '(or upload a file)'}</Label>
                    <Input value={verDraft.drive_url} placeholder="https://drive.google.com/…"
                      onChange={e => setVerDraft(d => ({ ...d, drive_url: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Input value={verDraft.notes} placeholder="What changed in this version?"
                      onChange={e => setVerDraft(d => ({ ...d, notes: e.target.value }))} />
                  </div>
                  <Button size="sm" className="self-start" disabled={busy === 'version'} onClick={saveVersion}>
                    {busy === 'version' ? 'Saving…' : `Save v${detail.current_version_number + 1}`}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Comments / Schedule */}
        <div className="flex flex-col gap-4">
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
                    placeholder={role === 'client' ? 'Ask a question or request a change…' : 'Add a comment…'}
                    onChange={e => setCommentDraft(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    {(role === 'account_manager' || role === 'super_admin') && (
                      <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <Switch
                          checked={commentVisibility === 'client'}
                          onCheckedChange={v => setCommentVisibility(v ? 'client' : 'internal')}
                        />
                        Visible to client
                      </label>
                    )}
                    {/* spec: "AM assigns editor task" — an internal comment
                        with an assignee emails that editor as a task */}
                    {(role === 'account_manager' || role === 'super_admin') && commentVisibility === 'internal' && (
                      <Select value={commentAssignee || 'none'} onValueChange={v => setCommentAssignee(v === 'none' ? '' : v ?? '')}>
                        <SelectTrigger className="h-8 w-40 bg-white text-xs dark:bg-zinc-900">
                          <SelectValue placeholder="Assign as task" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No assignee</SelectItem>
                          {editors.map(e => (
                            <SelectItem key={e.id} value={e.id}>{e.name || e.email}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button size="sm" className="ml-auto" disabled={busy === 'comment' || !commentDraft.trim()} onClick={postComment}>
                      <Send className="h-3.5 w-3.5" /> {busy === 'comment' ? 'Posting…' : 'Post'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* the caption IS the post: what the scheduler publishes and the
              auto-publisher sends as the post text. Managers write it,
              schedulers may polish it. */}
          {isTeam && (
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Caption</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {['account_manager', 'super_admin', 'scheduler'].includes(role) ? (
                  <Textarea
                    rows={3}
                    key={detail.caption ?? ''}
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

          {(canSchedule || detail.schedule.length > 0) && (
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
                        : <span className="font-mono text-[11px] uppercase text-zinc-400 dark:text-zinc-500">{s.publish_status}</span>}
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
                      <Button size="sm" variant="outline" disabled={busy === 'schedule'} onClick={() => saveSchedule(false)}>Set date</Button>
                      <Button size="sm" disabled={busy === 'schedule' || !schedDraft.live_url} onClick={() => saveSchedule(true)}>Save live</Button>
                    </div>

                    {/* connected publishing: post through the client's linked
                        social accounts instead of copying files by hand */}
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
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

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
            {reviewers?.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                No managers found — it will go to this client&rsquo;s assigned managers.
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
              disabled={busy !== null || reviewers === null}
              onClick={() => reviewPick && doTransition(reviewPick.to, reviewPick.label, [...chosen])}
            >
              {busy !== null ? 'Working…' : chosen.size > 0 ? `Send to ${chosen.size} reviewer${chosen.size > 1 ? 's' : ''}` : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* who schedules this? */}
      <Dialog open={schedPick !== null} onOpenChange={o => !o && busy === null && setSchedPick(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{schedPick === 'handoff' ? 'Hand to a scheduler' : 'Who schedules this?'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              They&rsquo;ll be emailed to schedule and publish it. Untick anyone who
              shouldn&rsquo;t hear about it.
            </p>
            {schedulers.map(s => (
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
                    {s.role === 'super_admin' ? 'Super admin' : 'Scheduler'}
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
                : schedPick === 'handoff' ? `Notify ${schedChosen.size || ''}`.trim()
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
