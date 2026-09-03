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
import EmptyState from '../../EmptyState'
import { BUTTON_MESSAGE_LIMIT, MESSAGE_LIMIT, parseAutomationDraft } from '@/app/lib/automation-core'
import PageTitle from '../../ui/PageTitle'

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
        className="inline-flex w-fit items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Social channels
      </Link>

      <PageTitle
        title="Comment → DM automations"
        summary="When someone comments a keyword, the account DMs them automatically — the &ldquo;comment LINK and I&rsquo;ll send it to you&rdquo; loop."
        actions={<>
          <Button size="sm" onClick={() => setCreating(v => !v)}>
            <Plus className="h-4 w-4" /> New automation
          </Button>
        </>}
      />

      {creating && (
        <Card>
          <CardContent className="grid gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-secondary-13 font-medium text-muted-foreground">Account</label>
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
                <label className="text-secondary-13 font-medium text-muted-foreground">Name</label>
                <Input value={draft.name} placeholder="e.g. Launch link drop"
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-secondary-13 font-medium text-muted-foreground">Listens to</label>
                <Select value={draft.trigger} onValueChange={v => setDraft(d => ({ ...d, trigger: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comment">Comments on posts</SelectItem>
                    <SelectItem value="story_reply">Story replies</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-secondary-13 font-medium text-muted-foreground">
                  Keywords <span className="font-normal text-muted-foreground">comma separated</span>
                </label>
                <Input value={draft.keywords} placeholder="LINK, price, info"
                  onChange={e => setDraft(d => ({ ...d, keywords: e.target.value }))} />
              </div>
            </div>

            {draft.trigger === 'comment' && accountPosts.length > 0 && (
              <div className="grid gap-1.5">
                <label className="text-secondary-13 font-medium text-muted-foreground">Which posts</label>
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
                <label className="text-secondary-13 font-medium text-muted-foreground">The DM it sends</label>
                <span className={`font-mono text-[12px] tabular-nums ${draft.dmMessage.length > msgLimit ? 'text-accent-red' : 'text-muted-foreground'}`}>
                  {draft.dmMessage.length}/{msgLimit}
                </span>
              </div>
              <Textarea rows={3} value={draft.dmMessage}
                placeholder="Hey! Here's the link you asked for 👇"
                onChange={e => setDraft(d => ({ ...d, dmMessage: e.target.value }))} />
            </div>

            {draft.trigger === 'comment' && (
              <div className="grid gap-1.5">
                <label className="text-secondary-13 font-medium text-muted-foreground">
                  Public reply under their comment <span className="font-normal text-muted-foreground">optional</span>
                </label>
                <Input value={draft.commentReply} maxLength={300}
                  placeholder="Check your DMs! 📩"
                  onChange={e => setDraft(d => ({ ...d, commentReply: e.target.value }))} />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-secondary-13 font-medium text-muted-foreground">
                  Button label <span className="font-normal text-muted-foreground">optional</span>
                </label>
                <Input value={draft.buttonTitle} placeholder="Shop now" maxLength={20}
                  onChange={e => setDraft(d => ({ ...d, buttonTitle: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <label className="text-secondary-13 font-medium text-muted-foreground">Button link</label>
                <Input value={draft.buttonUrl} placeholder="https://…"
                  onChange={e => setDraft(d => ({ ...d, buttonUrl: e.target.value }))} />
              </div>
            </div>

            <label className="flex w-fit cursor-pointer items-center gap-2 text-body-15">
              <input type="checkbox" checked={draft.alsoMatchInDms}
                onChange={e => setDraft(d => ({ ...d, alsoMatchInDms: e.target.checked }))}
                className="h-4 w-4 accent-blue-600" />
              Also answer when the keyword arrives as a DM
            </label>

            {draft.buttonUrl.trim() !== '' && (
              <label className="flex w-fit cursor-pointer items-start gap-2 text-body-15">
                <input type="checkbox" checked={draft.linkTracking}
                  onChange={e => setDraft(d => ({ ...d, linkTracking: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-blue-600" />
                <span>
                  Count link clicks
                  <span className="block text-secondary-13 text-muted-foreground">
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
              {problem && <span className="text-secondary-13 text-muted-foreground">{problem}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {autos === null ? (
        <div className="grid gap-3">{[0, 1].map(i => <Skeleton key={i} className="h-28" />)}</div>
      ) : autos.length === 0 ? (
        !creating && (
          <EmptyState
            icon={Zap}
            title="No automations yet"
            body="An automation watches a post for a keyword and replies to the commenter with a direct message — even while everyone is asleep. Create the first one and pick which account it runs on."
            actionLabel="Create the first automation"
            onAction={() => setCreating(true)}
          />
        )
      ) : (
        <div className="grid gap-3">
          {autos.map(a => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {a.platform && <PlatformIcon platform={a.platform} size={18} />}
                  <span className="text-body-15 font-semibold">{a.name ?? 'Automation'}</span>
                  <Badge variant="outline" className={a.isActive === false
                    ? 'border-border text-muted-foreground'
                    : 'border-accent-green/30 bg-tint-green text-foreground'}>
                    {a.isActive === false ? 'Paused' : 'Running'}
                  </Badge>
                  <span className="text-secondary-13 text-muted-foreground">
                    {a.trigger === 'story_reply' ? 'story replies' : a.platformPostId ? 'one post' : 'all posts'}
                    {a.alsoMatchInDms && ' · DMs too'}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggleActive(a)}>
                      {a.isActive === false ? <><Play className="h-3.5 w-3.5" /> Resume</> : <><Pause className="h-3.5 w-3.5" /> Pause</>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null}
                      className="text-accent-red hover:text-foreground"
                      onClick={() => setConfirmDelete(a)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(a.keywords ?? []).map(k => (
                    <span key={k} className="rounded-full bg-foreground/[0.06] px-2.5 py-1.5 font-mono text-chip-12">{k}</span>
                  ))}
                </div>

                {a.dmMessage && (
                  <p className="rounded-inner bg-foreground/[0.04] px-3 py-2 text-body-15 text-muted-foreground">
                    {a.dmMessage}
                  </p>
                )}
                {a.commentReply && (
                  <p className="text-secondary-13 text-muted-foreground">
                    Public reply: <span className="text-muted-foreground">{a.commentReply}</span>
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  {STAT_LABELS.map(([k, label]) => (
                    <span key={k} className="text-secondary-13 text-muted-foreground">
                      {label}{' '}
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {(a.stats?.[k] ?? 0).toLocaleString()}
                      </span>
                    </span>
                  ))}
                  {(a.stats?.triggered ?? 0) > 0 && (
                    <button type="button" onClick={() => void toggleLogs(a)}
                      className="text-secondary-13 text-accent-blue-deep hover:underline">
                      {openLogs === a.id ? 'Hide activity' : 'Who triggered it'}
                    </button>
                  )}
                </div>

                {openLogs === a.id && (
                  logs[a.id] === null ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (logs[a.id] ?? []).length === 0 ? (
                    <p className="text-secondary-13 text-muted-foreground">
                      Nothing yet — the first time someone comments the keyword, the reply it sent shows up here.
                    </p>
                  ) : (
                    <div className="flex flex-col divide-y divide-border rounded-inner border border-border">
                      {(logs[a.id] ?? []).map(l => (
                        <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-secondary-13">
                          <span className="font-medium">{l.commenterName ?? 'someone'}</span>
                          {l.commentText && (
                            <span className="text-muted-foreground">&ldquo;{l.commentText.slice(0, 60)}&rdquo;</span>
                          )}
                          <span className="ml-auto flex items-center gap-2">
                            <span className={l.status === 'sent'
                              ? 'text-accent-green'
                              : 'text-muted-foreground'}>
                              {l.status === 'sent' ? 'DM sent' : l.status ?? '—'}
                            </span>
                            {l.clickedAt ? (
                              <span className="rounded-full bg-tint-blue px-2 py-0.5 font-medium text-foreground">
                                Clicked{(l.clickCount ?? 0) > 1 ? ` ×${l.clickCount}` : ''}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">no click</span>
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
              className="bg-accent-red text-white hover:bg-accent-red"
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
