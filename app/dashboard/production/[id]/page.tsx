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
  availableTransitions, CLIENT_LABELS, type ItemStatus,
} from '../../../lib/workflow-core'
import type { Role } from '../../../lib/identity-core'

type Version = {
  id: string; version_number: number; created_at: string
  file_url: string; drive_url: string; dropbox_url?: string; notes?: string | null
}
type Comment = {
  id: string; created_at: string; author_id: string | null; visibility: string
  body: string; resolved: boolean
}
type ScheduleEntry = {
  id: string; platform: string; scheduled_at: string | null; live_url: string | null; publish_status: string
}
type Reviewer = { id: string; name: string; email: string; role: string; assigned: boolean }

type Detail = {
  id: string; title: string; client_id: string; client_name: string | null
  owner_id: string | null
  content_type: string; status: ItemStatus; status_label?: string
  priority: string; due_date: string | null; caption: string | null
  client_approval_required: boolean; current_version_number: number
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

  // editors for owner assignment + comment tasks (managers only)
  const [editors, setEditors] = useState<{ id: string; name: string; email: string }[]>([])
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
      .then(json => setEditors(
        (json.members ?? [])
          .filter((m: { role: string; active_status?: boolean }) => m.role === 'editor' && m.active_status !== false)
          .map((m: { id: string; name: string; email: string }) => ({ id: m.id, name: m.name, email: m.email })),
      ))
      .catch(() => setEditors([]))
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

  const doTransition = async (to: ItemStatus, label: string, notifyIds?: string[]) => {
    setBusy(to)
    try {
      const res = await fetch(`/api/production/items/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, ...(notifyIds?.length ? { notify_ids: notifyIds } : {}) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${label} failed`)
      toast.success(label)
      setReviewPick(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`)
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
      setChosen(new Set(list.filter(r => r.assigned).map(r => r.id)))
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
                  <SelectItem key={e.id} value={e.id}>{e.name || e.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge variant="outline" className={STATUS_TINT[detail.status] ?? ''}>
            {role === 'client' ? (detail.status_label ?? CLIENT_LABELS[detail.status]) : detail.status.replace(/_/g, ' ')}
          </Badge>
        </div>
      </div>

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
                    defaultValue={detail.raw_assets_url ?? ''}
                    placeholder="https://www.dropbox.com/… (folder the editor works from)"
                    className="font-mono text-xs"
                    onBlur={e => {
                      const v = e.target.value.trim()
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
                    defaultValue={detail.brief ?? ''}
                    placeholder="What the edit should be…"
                    onBlur={e => {
                      const v = e.target.value.trim()
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
                        {new Date(c.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        {isTeam && c.visibility === 'client' && (
                          <Badge variant="outline" className="border-violet-200 bg-violet-50 font-normal text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400">client</Badge>
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
    </div>
  )
}
