'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ArrowLeft, Pause, Play, Plus, Trash2, Zap } from 'lucide-react'
import PlatformIcon from '../PlatformIcon'
import { BUTTON_MESSAGE_LIMIT, MESSAGE_LIMIT, parseAutomationDraft } from '@/app/lib/automation-core'

type SocialAccount = {
  id: string; provider_account_id: string; platform: string
  username: string | null; name: string | null; active: boolean
}

type PostRow = { id: string; accountId: string; content: string }

type TriggerLog = {
  id: string
  commenterName?: string
  commentText?: string
  status?: string
  error?: string | null
  commentReplyStatus?: string
  clickedAt?: string | null
  clickCount?: number
  createdAt?: string
}

type Automation = {
  id: string
  name?: string
  platform?: string
  trigger?: string
  keywords?: string[]
  dmMessage?: string
  commentReply?: string
  isActive?: boolean
  platformPostId?: string
  alsoMatchInDms?: boolean
  stats?: Record<string, number>
  createdAt?: string
}

const STAT_LABELS: [string, string][] = [
  ['triggered', 'Triggered'], ['dmsSent', 'DMs sent'],
  ['delivered', 'Delivered'], ['read', 'Read'], ['linkClicks', 'Link clicks'],
]

/**
 * Comment→DM automations — the "comment LINK and I'll send it to you" loop.
 * One page: what is running, how it is performing, and a form to add more.
 */
export default function AutomationsPage() {
  const [autos, setAutos] = useState<Automation[] | null>(null)
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null)
  const [posts, setPosts] = useState<PostRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Automation | null>(null)
  // per-person history, loaded on demand per automation
  const [openLogs, setOpenLogs] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, TriggerLog[] | null>>({})

  const [draft, setDraft] = useState({
    accountRowId: '', name: '', trigger: 'comment',
    keywords: '', dmMessage: '', buttonTitle: '', buttonUrl: '',
    alsoMatchInDms: false, linkTracking: true, commentReply: '', platformPostId: '',
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/automations')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load automations')
      const raw = json.automations
      setAutos(raw?.automations ?? raw?.data ?? (Array.isArray(raw) ? raw : []))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load automations')
      setAutos([])
    }
  }, [])

  useEffect(() => {
    void load()
    void (async () => {
      try {
        const res = await fetch('/api/social/accounts')
        const json = await res.json()
        const list: SocialAccount[] = (json.accounts ?? []).filter((a: SocialAccount) => a.active)
        setAccounts(list)
        if (list.length === 1) setDraft(d => ({ ...d, accountRowId: list[0].id }))
      } catch { setAccounts([]) }
      try {
        const res = await fetch('/api/social/inbox')
        const json = await res.json()
        if (res.ok) setPosts(json.data ?? [])
      } catch { /* post scoping simply unavailable */ }
    })()
  }, [load])

  const account = useMemo(
    () => (accounts ?? []).find(a => a.id === draft.accountRowId) ?? null,
    [accounts, draft.accountRowId],
  )
  const accountPosts = useMemo(
    () => posts.filter(p => p.accountId === account?.provider_account_id),
    [posts, account],
  )
  const msgLimit = draft.buttonUrl.trim() ? BUTTON_MESSAGE_LIMIT : MESSAGE_LIMIT
  const parsed = parseAutomationDraft(draft)
  const problem = !draft.accountRowId ? 'Pick an account' : parsed.ok ? null : parsed.error

  const create = async () => {
    setBusy('create')
    try {
      const res = await fetch('/api/social/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not create the automation')
      toast.success(`"${draft.name.trim()}" is live — it starts answering straight away`)
      setCreating(false)
      setDraft(d => ({
        ...d, name: '', keywords: '', dmMessage: '',
        buttonTitle: '', buttonUrl: '', platformPostId: '', alsoMatchInDms: false,
      }))
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the automation')
    } finally {
      setBusy(null)
    }
  }

  const toggleActive = async (a: Automation) => {
    setBusy(a.id)
    try {
      const res = await fetch(`/api/social/automations/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !(a.isActive ?? true) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not update')
      toast.success(a.isActive ? 'Paused — it stops answering' : 'Running again')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update')
    } finally {
      setBusy(null)
    }
  }

  const toggleLogs = async (a: Automation) => {
    if (openLogs === a.id) { setOpenLogs(null); return }
    setOpenLogs(a.id)
    if (logs[a.id]) return
    setLogs(prev => ({ ...prev, [a.id]: null }))
    try {
      const res = await fetch(`/api/social/automations/${a.id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load activity')
      const raw = json.logs
      setLogs(prev => ({ ...prev, [a.id]: raw?.logs ?? raw?.data ?? (Array.isArray(raw) ? raw : []) }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load activity')
      setLogs(prev => ({ ...prev, [a.id]: [] }))
    }
  }

  const doDelete = async (a: Automation) => {
    setBusy(a.id)
    try {
      const res = await fetch(`/api/social/automations/${a.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not delete')
      toast.success(`"${a.name ?? 'Automation'}" deleted`)
      setConfirmDelete(null)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/social"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
        <ArrowLeft className="h-3.5 w-3.5" /> Social channels
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Comment → DM automations</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            When someone comments a keyword, the account DMs them automatically —
            the &ldquo;comment LINK and I&rsquo;ll send it to you&rdquo; loop.
          </p>
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(v => !v)}>
          <Plus className="h-4 w-4" /> New automation
        </Button>
      </div>

      {creating && (
        <Card>
          <CardContent className="grid gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Account</label>
                <Select value={draft.accountRowId} onValueChange={v => setDraft(d => ({ ...d, accountRowId: v, platformPostId: '' }))}>
                  <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                  <SelectContent>
                    {(accounts ?? []).map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.username ? `@${a.username}` : a.name ?? a.platform}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Name</label>
                <Input value={draft.name} placeholder="e.g. Launch link drop"
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Listens to</label>
                <Select value={draft.trigger} onValueChange={v => setDraft(d => ({ ...d, trigger: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comment">Comments on posts</SelectItem>
                    <SelectItem value="story_reply">Story replies</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Keywords <span className="font-normal text-zinc-400">comma separated</span>
                </label>
                <Input value={draft.keywords} placeholder="LINK, price, info"
                  onChange={e => setDraft(d => ({ ...d, keywords: e.target.value }))} />
              </div>
            </div>

            {draft.trigger === 'comment' && accountPosts.length > 0 && (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Which posts</label>
                <Select value={draft.platformPostId || 'all'}
                  onValueChange={v => setDraft(d => ({ ...d, platformPostId: v === 'all' ? '' : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every post on the account</SelectItem>
                    {accountPosts.slice(0, 25).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {(p.content || '(no caption)').slice(0, 60)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">The DM it sends</label>
                <span className={`font-mono text-[11px] tabular-nums ${draft.dmMessage.length > msgLimit ? 'text-red-500' : 'text-zinc-400'}`}>
                  {draft.dmMessage.length}/{msgLimit}
                </span>
              </div>
              <Textarea rows={3} value={draft.dmMessage}
                placeholder="Hey! Here's the link you asked for 👇"
                onChange={e => setDraft(d => ({ ...d, dmMessage: e.target.value }))} />
            </div>

            {draft.trigger === 'comment' && (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Public reply under their comment <span className="font-normal text-zinc-400">optional</span>
                </label>
                <Input value={draft.commentReply} maxLength={300}
                  placeholder="Check your DMs! 📩"
                  onChange={e => setDraft(d => ({ ...d, commentReply: e.target.value }))} />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Button label <span className="font-normal text-zinc-400">optional</span>
                </label>
                <Input value={draft.buttonTitle} placeholder="Shop now" maxLength={20}
                  onChange={e => setDraft(d => ({ ...d, buttonTitle: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Button link</label>
                <Input value={draft.buttonUrl} placeholder="https://…"
                  onChange={e => setDraft(d => ({ ...d, buttonUrl: e.target.value }))} />
              </div>
            </div>

            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.alsoMatchInDms}
                onChange={e => setDraft(d => ({ ...d, alsoMatchInDms: e.target.checked }))}
                className="h-4 w-4 accent-blue-600" />
              Also answer when the keyword arrives as a DM
            </label>

            {draft.buttonUrl.trim() !== '' && (
              <label className="flex w-fit cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={draft.linkTracking}
                  onChange={e => setDraft(d => ({ ...d, linkTracking: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-blue-600" />
                <span>
                  Count link clicks
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    Wraps the link in a short redirect — the tapper briefly sees the
                    tracking domain. Turn off for a clean direct link (no click stats).
                  </span>
                </span>
              </label>
            )}

            <div className="flex items-center gap-3">
              <Button size="sm" disabled={busy !== null || problem !== null} onClick={create}>
                {busy === 'create' ? 'Creating…' : 'Create automation'}
              </Button>
              {problem && <span className="text-xs text-zinc-400 dark:text-zinc-500">{problem}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {autos === null ? (
        <div className="grid gap-3">{[0, 1].map(i => <Skeleton key={i} className="h-28" />)}</div>
      ) : autos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Zap className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No automations yet. Create one and the account starts replying to
              keyword comments with a DM — even while everyone is asleep.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {autos.map(a => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {a.platform && <PlatformIcon platform={a.platform} size={18} />}
                  <span className="text-sm font-semibold">{a.name ?? 'Automation'}</span>
                  <Badge variant="outline" className={a.isActive === false
                    ? 'border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400'}>
                    {a.isActive === false ? 'Paused' : 'Running'}
                  </Badge>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {a.trigger === 'story_reply' ? 'story replies' : a.platformPostId ? 'one post' : 'all posts'}
                    {a.alsoMatchInDms && ' · DMs too'}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggleActive(a)}>
                      {a.isActive === false ? <><Play className="h-3.5 w-3.5" /> Resume</> : <><Pause className="h-3.5 w-3.5" /> Pause</>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null}
                      className="text-red-600 hover:text-red-700 dark:text-red-400"
                      onClick={() => setConfirmDelete(a)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(a.keywords ?? []).map(k => (
                    <span key={k} className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] dark:bg-zinc-800">{k}</span>
                  ))}
                </div>

                {a.dmMessage && (
                  <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {a.dmMessage}
                  </p>
                )}
                {a.commentReply && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Public reply: <span className="text-zinc-700 dark:text-zinc-300">{a.commentReply}</span>
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  {STAT_LABELS.map(([k, label]) => (
                    <span key={k} className="text-xs text-zinc-500 dark:text-zinc-400">
                      {label}{' '}
                      <span className="font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                        {(a.stats?.[k] ?? 0).toLocaleString()}
                      </span>
                    </span>
                  ))}
                  {(a.stats?.triggered ?? 0) > 0 && (
                    <button type="button" onClick={() => void toggleLogs(a)}
                      className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                      {openLogs === a.id ? 'Hide activity' : 'Who triggered it'}
                    </button>
                  )}
                </div>

                {openLogs === a.id && (
                  logs[a.id] === null ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (logs[a.id] ?? []).length === 0 ? (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">No activity recorded yet.</p>
                  ) : (
                    <div className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                      {(logs[a.id] ?? []).map(l => (
                        <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-xs">
                          <span className="font-medium">{l.commenterName ?? 'someone'}</span>
                          {l.commentText && (
                            <span className="text-zinc-500 dark:text-zinc-400">&ldquo;{l.commentText.slice(0, 60)}&rdquo;</span>
                          )}
                          <span className="ml-auto flex items-center gap-2">
                            <span className={l.status === 'sent'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-zinc-400 dark:text-zinc-500'}>
                              {l.status === 'sent' ? 'DM sent' : l.status ?? '—'}
                            </span>
                            {l.clickedAt ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                Clicked{(l.clickCount ?? 0) > 1 ? ` ×${l.clickCount}` : ''}
                              </span>
                            ) : (
                              <span className="text-zinc-300 dark:text-zinc-600">no click</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={confirmDelete !== null} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{confirmDelete?.name ?? 'this automation'}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops answering immediately and its history is deleted with it.
              This cannot be undone — pausing keeps the history if you might want it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={e => { e.preventDefault(); if (confirmDelete) void doDelete(confirmDelete) }}
            >
              {busy !== null ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
