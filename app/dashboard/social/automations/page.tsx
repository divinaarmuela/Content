'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AlertTriangle, ImageOff, Plus, Trash2, X, Zap } from 'lucide-react'
import PlatformIcon from '../PlatformIcon'
import EmptyState from '../../EmptyState'
import PageTitle from '../../ui/PageTitle'
import {
  BUTTON_DM_LIMIT, BUTTON_TITLE_LIMIT, DEFAULT_KEYWORD, DM_LIMIT, MAX_VARIATIONS, dmText, normaliseKeywords, readVariations, withUtm,
  type AutomationLogRow, type AutomationStats, type PostChoice,
} from '@/app/lib/comment-automation-core'

type SetupAccount = { id: string; platform: string; username: string | null; name: string | null }
type SetupClient = { id: string; name: string; slug: string; problem: string | null; accounts: SetupAccount[] }

type Row = {
  id: string
  client_id: string
  client_name: string
  account: { id: string; platform: string; username: string | null }
  post: { title: string | null; thumb: string | null; date: string | null; social_post_id: string | null; bound: 'live' | 'pending' }
  runner: 'zernio' | 'app'
  name: string
  keywords: string[]
  match_mode: string
  dm_message: string
  button_title: string | null
  link: string | null
  comment_reply: string | null
  dm_variations: string[]
  reply_variations: string[]
  active: boolean
  paused_reason: string | null
  created_at: string
  stats: AutomationStats | null
  logs: AutomationLogRow[]
  warning: string | null
}

type Outside = {
  id: string; name: string; client_name: string | null; account_username: string | null; platform: string
  keywords: string[]; active: boolean; account_wide: boolean; stats: AutomationStats
}

const STATS: [keyof AutomationStats, string][] = [
  ['triggered', 'Triggered'], ['dmsSent', 'DMs sent'], ['delivered', 'Delivered'],
  ['read', 'Read'], ['failed', 'Failed'], ['linkClicks', 'Link clicks'],
]

/** what our app cannot know about its own sends: Zernio counts delivery, reads and clicks, our private reply does not */
const APP_UNKNOWN: readonly (keyof AutomationStats)[] = ['delivered', 'read', 'linkClicks']

const RUNNER_WORDS: Record<'zernio' | 'app', string> = {
  zernio: 'Zernio sends it',
  app: 'Our app sends it',
}

const MATCH_WORDS: Record<string, string> = {
  word: 'The keyword as a whole word',
  contains: 'The keyword anywhere, even inside a word',
  exact: 'The comment is exactly the keyword',
}

const day = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
const when = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

const EMPTY_DRAFT = {
  client_id: '', social_account_id: '', post_key: '',
  keywords: DEFAULT_KEYWORD, match_mode: 'word', dm_message: '',
  button_title: '', link: '', comment_reply: '', name: '',
  // who sends: Zernio's automation, or our app off the comment webhook (30 Sep 2026)
  runner: 'zernio' as 'zernio' | 'app',
  // one per line; sent as arrays (Zernio's dmMessageVariations / commentReplyVariations)
  dm_variations: '', reply_variations: '',
}

/**
 * COMMENT-TO-DM AUTOMATIONS, ONE POST EACH (the owner, 29 Sep 2026: "select
 * account and the post name and then do that"). Pick the client, its account,
 * then the post; write the keyword and the DM; the link gets its UTM tags.
 * Nothing here ever answers every comment on an account — an automation is
 * always one post's (app/lib/comment-automation-core.ts).
 */
export default function AutomationsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [outside, setOutside] = useState<Outside[]>([])
  const [canManage, setCanManage] = useState(false)
  const [zernioRead, setZernioRead] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)

  const [creating, setCreating] = useState(false)
  const [clients, setClients] = useState<SetupClient[] | null>(null)
  const [posts, setPosts] = useState<PostChoice[] | null>(null)
  const [postsNote, setPostsNote] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/automations')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load automations')
      setRows(json.rows ?? [])
      setOutside(json.outside ?? [])
      setCanManage(json.can_manage === true)
      setZernioRead(json.zernioRead !== false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load automations')
      setRows([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // the form's lists, only once someone opens it
  useEffect(() => {
    if (!creating || clients) return
    void (async () => {
      try {
        const res = await fetch('/api/social/automations/setup')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not load clients')
        setClients(json.clients ?? [])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not load clients')
        setClients([])
      }
    })()
  }, [creating, clients])

  useEffect(() => {
    setPosts(null)
    setPostsNote(null)
    if (!draft.client_id || !draft.social_account_id) return
    let live = true
    void (async () => {
      try {
        const qs = new URLSearchParams({ client_id: draft.client_id, account_id: draft.social_account_id })
        const res = await fetch(`/api/social/automations/setup?${qs}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not load the posts')
        if (!live) return
        setPosts(json.posts ?? [])
        if (json.account_posts_read === false) setPostsNote('Zernio did not answer for this account\'s own posts, so only posts made here are listed.')
      } catch (e) {
        if (!live) return
        setPosts([])
        setPostsNote(e instanceof Error ? e.message : 'Could not load the posts')
      }
    })()
    return () => { live = false }
  }, [draft.client_id, draft.social_account_id])

  const client = useMemo(() => (clients ?? []).find(c => c.id === draft.client_id) ?? null, [clients, draft.client_id])
  const chosenPost = useMemo(() => (posts ?? []).find(p => p.key === draft.post_key) ?? null, [posts, draft.post_key])
  const keywords = normaliseKeywords(draft.keywords)
  const hasButton = draft.button_title.trim() !== '' && draft.link.trim() !== ''
  const tagged = draft.link.trim() && client ? withUtm(draft.link, { clientSlug: client.slug, keyword: keywords[0] }) : null
  const finalDm = dmText(draft.dm_message, tagged?.ok ? tagged.url : null, hasButton)
  const dmLimit = hasButton ? BUTTON_DM_LIMIT : DM_LIMIT
  const dmVar = readVariations(draft.dm_variations, { what: 'DM texts', max: dmLimit, main: draft.dm_message })
  const replyVar = readVariations(draft.reply_variations, { what: 'public replies', max: 300, main: draft.comment_reply })

  const problem =
    !draft.client_id ? 'Pick the client'
    : client?.problem ? client.problem
    : !draft.social_account_id ? 'Pick the account'
    : !chosenPost ? 'Pick the post it answers on'
    : chosenPost.unavailable ? chosenPost.unavailable
    : !draft.dm_message.trim() ? 'Write the DM it sends'
    : draft.button_title.trim() && !draft.link.trim() ? 'The button needs a link'
    : tagged && !tagged.ok ? tagged.error
    : (hasButton ? draft.dm_message.trim().length : finalDm.length) > dmLimit ? `The DM must be ${dmLimit} characters or fewer`
    : !dmVar.ok ? dmVar.error
    : !replyVar.ok ? replyVar.error
    : replyVar.list.length > 0 && !draft.comment_reply.trim() ? 'Write the public reply first — the other replies are picked at random with it'
    : null

  const create = async () => {
    setBusy('create')
    try {
      const res = await fetch('/api/social/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          dm_variations: draft.dm_variations.split(/\r?\n/),
          reply_variations: draft.reply_variations.split(/\r?\n/),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not switch it on')
      toast.success(chosenPost?.state === 'booked'
        ? 'Set — it starts answering the moment the post goes out'
        : 'Switched on — it answers comments on that post from now')
      setCreating(false)
      setDraft(EMPTY_DRAFT)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not switch it on')
    } finally {
      setBusy(null)
    }
  }

  const patch = async (id: string, body: Record<string, unknown>, done: string) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/social/automations/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not change it')
      toast.success(done)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change it')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/social/automations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not delete it')
      toast.success('Deleted')
      setConfirmDelete(null)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete it')
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of rows ?? []) m.set(r.client_name, [...(m.get(r.client_name) ?? []), r])
    return [...m.entries()]
  }, [rows])

  const label = (text: string, hint?: string) => (
    <span className="text-secondary-13 font-medium text-muted-foreground">
      {text}{hint && <span className="font-normal"> · {hint}</span>}
    </span>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Automations"
        summary="Someone comments a keyword on one post, and the account DMs them the link. Each automation belongs to one post — never the whole account."
        actions={canManage && !creating ? (
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New automation</Button>
        ) : undefined}
      />

      {!zernioRead && (
        <p className="rounded-inner border border-border bg-tint-amber px-3 py-2 text-secondary-13">
          Zernio did not answer, so the on/off state and numbers below may be out of date.
        </p>
      )}

      {creating && (
        <Card>
          <CardContent className="grid gap-5 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-body-15 font-semibold">New automation</h2>
              <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT) }}>
                <X className="h-4 w-4" /> Close
              </Button>
            </div>

            {/* 1 + 2: client and account */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                {label('1. Client')}
                <Select value={draft.client_id}
                  onValueChange={v => {
                    const c = (clients ?? []).find(x => x.id === v)
                    setDraft(d => ({ ...d, client_id: v, social_account_id: c?.accounts.length === 1 ? c.accounts[0].id : '', post_key: '' }))
                  }}>
                  <SelectTrigger><SelectValue placeholder={clients === null ? 'Loading…' : 'Pick the client'} /></SelectTrigger>
                  <SelectContent>
                    {(clients ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5">
                {label('2. Account')}
                <Select value={draft.social_account_id} disabled={!client || !!client.problem}
                  onValueChange={v => setDraft(d => ({ ...d, social_account_id: v, post_key: '' }))}>
                  <SelectTrigger><SelectValue placeholder="Pick the Instagram or Facebook account" /></SelectTrigger>
                  <SelectContent>
                    {(client?.accounts ?? []).map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.platform === 'facebook' ? 'Facebook' : 'Instagram'} · {a.username ? `@${a.username}` : a.name ?? a.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            {client?.problem && <p className="text-secondary-13 text-accent-red">{client.problem}</p>}

            {/* 3: the post */}
            {draft.social_account_id && (
              <div className="grid gap-2">
                {label('3. Post', 'the automation answers comments on this post only')}
                {posts === null ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20" />)}</div>
                ) : posts.length === 0 ? (
                  <p className="text-secondary-13 text-muted-foreground">
                    No posts on this account yet — book one on the Schedule, or post it, and it shows up here.
                  </p>
                ) : (
                  <div className="grid max-h-[420px] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                    {posts.map(p => {
                      const picked = p.key === draft.post_key
                      return (
                        <button key={p.key} type="button" disabled={!!p.unavailable}
                          onClick={() => setDraft(d => ({ ...d, post_key: p.key }))}
                          className={`flex min-w-0 gap-3 rounded-inner border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${picked ? 'border-accent-blue-deep bg-tint-blue' : 'border-border hover:bg-foreground/[0.04]'}`}>
                          {p.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.thumb} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                          ) : (
                            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-foreground/[0.06]">
                              <ImageOff className="h-4 w-4 text-muted-foreground" />
                            </span>
                          )}
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="line-clamp-2 text-secondary-13 font-medium">{p.title}</span>
                            <span className="text-[12px] text-muted-foreground">
                              {p.state === 'booked' ? `Booked · ${day(p.date)}` : `Live · ${day(p.date)}`}
                              {p.source === 'account' ? ' · not made here' : ''}
                            </span>
                            {p.unavailable && <span className="text-[12px] text-accent-red">{p.unavailable}</span>}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {postsNote && <p className="text-secondary-13 text-muted-foreground">{postsNote}</p>}
                {chosenPost?.state === 'booked' && (
                  <p className="text-secondary-13 text-muted-foreground">
                    This post is booked, not live yet — the automation waits and starts by itself when it goes out.
                  </p>
                )}
              </div>
            )}

            {/* 4: what it listens for and what it sends */}
            {chosenPost && (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    {label('4. Keyword', 'comma separated for more than one')}
                    <Input value={draft.keywords} placeholder={DEFAULT_KEYWORD}
                      onChange={e => setDraft(d => ({ ...d, keywords: e.target.value }))} />
                  </label>
                  <label className="grid gap-1.5">
                    {label('It fires on')}
                    <Select value={draft.match_mode} onValueChange={v => setDraft(d => ({ ...d, match_mode: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(MATCH_WORDS).map(([k, w]) => <SelectItem key={k} value={k}>{w}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <label className="grid gap-1.5">
                  {label('Who sends it')}
                  <Select value={draft.runner} onValueChange={v => setDraft(d => ({ ...d, runner: v === 'app' ? 'app' : 'zernio' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zernio">{RUNNER_WORDS.zernio}</SelectItem>
                      <SelectItem value="app" disabled={chosenPost.state === 'booked'}>{RUNNER_WORDS.app}</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-secondary-13 text-muted-foreground">
                    {draft.runner === 'app'
                      ? 'Our app hears every comment and sends the DM itself. It counts DMs sent and failed; Zernio’s delivered, read and click counts are not available this way.'
                      : chosenPost.state === 'booked'
                        ? 'This post is not out yet, so only Zernio can run it — it starts when the post goes out.'
                        : 'Zernio hears the comment and sends the DM, and counts delivered, read and clicks.'}
                  </span>
                </label>

                <label className="grid gap-1.5">
                  <span className="flex items-baseline justify-between">
                    {label('5. The DM it sends')}
                    <span className={`font-mono text-[12px] tabular-nums ${(hasButton ? draft.dm_message.trim().length : finalDm.length) > dmLimit ? 'text-accent-red' : 'text-muted-foreground'}`}>
                      {hasButton ? draft.dm_message.trim().length : finalDm.length}/{dmLimit}
                    </span>
                  </span>
                  <Textarea rows={3} value={draft.dm_message} placeholder="Hi! Thanks for commenting. Here's the link to book a call."
                    onChange={e => setDraft(d => ({ ...d, dm_message: e.target.value }))} />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    {label('Link', 'optional')}
                    <Input value={draft.link} placeholder="https://…"
                      onChange={e => setDraft(d => ({ ...d, link: e.target.value }))} />
                  </label>
                  <label className="grid gap-1.5">
                    {label('Button label', 'optional — without one, the link goes in the text')}
                    <Input value={draft.button_title} placeholder="Book a call" maxLength={BUTTON_TITLE_LIMIT}
                      onChange={e => setDraft(d => ({ ...d, button_title: e.target.value }))} />
                  </label>
                </div>

                {tagged && (
                  <div className="rounded-inner border border-border bg-foreground/[0.03] px-3 py-2 text-secondary-13">
                    {tagged.ok ? (
                      <>
                        <span className="font-medium">The link people get</span>
                        <span className="text-muted-foreground"> · {hasButton ? 'on the button, clicks counted' : 'at the end of the DM'}</span>
                        <code className="mt-1 block break-all font-mono text-[12px]">{tagged.url}</code>
                      </>
                    ) : <span className="text-accent-red">{tagged.error}</span>}
                  </div>
                )}

                <label className="grid gap-1.5">
                  {label('Other DM texts', `optional, up to ${MAX_VARIATIONS}, one per line — one is picked at random each time`)}
                  <Textarea rows={2} value={draft.dm_variations}
                    onChange={e => setDraft(d => ({ ...d, dm_variations: e.target.value }))} />
                </label>

                <label className="grid gap-1.5">
                  {label('Public reply under their comment', 'optional')}
                  <Input value={draft.comment_reply} maxLength={300} placeholder="Just sent it to your DMs."
                    onChange={e => setDraft(d => ({ ...d, comment_reply: e.target.value }))} />
                </label>

                <label className="grid gap-1.5">
                  {label('Other replies', `optional, up to ${MAX_VARIATIONS}, one per line`)}
                  <Textarea rows={2} value={draft.reply_variations} placeholder="Check your DMs!"
                    onChange={e => setDraft(d => ({ ...d, reply_variations: e.target.value }))} />
                </label>

                <label className="grid gap-1.5">
                  {label('Name', `optional — "${keywords[0]} on ${chosenPost.title.slice(0, 30)}" if left blank`)}
                  <Input value={draft.name} maxLength={80}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                </label>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={busy !== null || problem !== null} onClick={() => void create()}>
                {busy === 'create' ? 'Switching on…' : 'Switch it on for this post'}
              </Button>
              {problem && <span className="text-secondary-13 text-muted-foreground">{problem}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {rows === null ? (
        <div className="grid gap-3">{[0, 1].map(i => <Skeleton key={i} className="h-32" />)}</div>
      ) : rows.length === 0 && !creating ? (
        <EmptyState
          icon={Zap}
          title="No automations yet"
          body="An automation watches ONE post for a keyword and DMs the commenter the link. Set one up by picking the client, its account and the post."
          {...(canManage ? { actionLabel: 'Set up the first one', onAction: () => setCreating(true) } : {})}
        />
      ) : (
        groups.map(([clientName, list]) => (
          <section key={clientName} className="grid gap-3">
            <h2 className="text-body-15 font-semibold">{clientName}</h2>
            {list.map(r => (
              <Card key={r.id}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    {r.post.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.post.thumb} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-foreground/[0.06]">
                        <ImageOff className="h-4 w-4 text-muted-foreground" />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-body-15 font-semibold">{r.post.title ?? r.name}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-secondary-13 text-muted-foreground">
                        <PlatformIcon platform={r.account.platform} size={14} />
                        {r.account.username ? `@${r.account.username}` : r.account.platform}
                        {r.post.date && <> · {day(r.post.date)}</>}
                        {r.post.bound === 'pending' && <Badge variant="outline">Starts when the post goes out</Badge>}
                        <Badge variant="outline">{RUNNER_WORDS[r.runner]}</Badge>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-secondary-13 text-muted-foreground">{r.active ? 'On' : 'Off'}</span>
                      <Switch checked={r.active} disabled={!canManage || busy !== null}
                        aria-label={r.active ? 'Switch off' : 'Switch on'}
                        onCheckedChange={v => void patch(r.id, { active: v }, v ? 'Switched on' : 'Switched off — it stops answering')} />
                      {canManage && (
                        <Button size="sm" variant="outline" disabled={busy !== null} aria-label="Delete"
                          className="text-accent-red hover:text-foreground"
                          onClick={() => setConfirmDelete({ id: r.id, name: r.post.title ?? r.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {(r.warning || (!r.active && r.paused_reason)) && (
                    <p className="flex items-start gap-2 rounded-inner bg-tint-amber px-3 py-2 text-secondary-13">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {r.warning ?? r.paused_reason}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 text-secondary-13 text-muted-foreground">
                    Comment
                    {r.keywords.map(k => (
                      <span key={k} className="rounded-full bg-foreground/[0.06] px-2.5 py-1 font-mono text-chip-12 text-foreground">{k}</span>
                    ))}
                    <span>· {MATCH_WORDS[r.match_mode]?.toLowerCase() ?? r.match_mode}</span>
                  </div>
                  <p className="whitespace-pre-line rounded-inner bg-foreground/[0.04] px-3 py-2 text-body-15 text-muted-foreground">
                    {r.dm_message}
                    {r.button_title && <span className="mt-1 block text-secondary-13">Button: <span className="font-medium text-foreground">{r.button_title}</span></span>}
                  </p>
                  {r.link && <code className="break-all font-mono text-[12px] text-muted-foreground">{r.link}</code>}
                  {r.dm_variations.length > 0 && (
                    <p className="text-secondary-13 text-muted-foreground">Other DM texts: {r.dm_variations.length}</p>
                  )}
                  {r.comment_reply && (
                    <p className="text-secondary-13 text-muted-foreground">
                      Public reply: {[r.comment_reply, ...r.reply_variations].join(' / ')}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {STATS.filter(([k]) => r.runner !== 'app' || !APP_UNKNOWN.includes(k)).map(([k, w]) => (
                      <span key={k} className="text-secondary-13 text-muted-foreground">
                        {w} <span className="font-mono font-medium tabular-nums text-foreground">{r.stats ? r.stats[k].toLocaleString() : '—'}</span>
                      </span>
                    ))}
                  </div>

                  {r.logs.length > 0 && (
                    <div className="flex flex-col divide-y divide-border rounded-inner border border-border">
                      {r.logs.map(l => (
                        <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-secondary-13">
                          <span className="font-medium">{l.username ? `@${l.username}` : 'someone'}</span>
                          {l.comment && <span className="text-muted-foreground">&ldquo;{l.comment.slice(0, 60)}&rdquo;</span>}
                          <span className="ml-auto flex items-center gap-2">
                            <span className={l.status === 'sent' ? 'text-accent-green' : l.status === 'failed' ? 'text-accent-red' : 'text-muted-foreground'}
                              title={l.error ?? undefined}>
                              {l.status === 'sent' ? 'DM sent' : l.status}
                            </span>
                            {l.status === 'failed' && l.error && <span className="max-w-[28ch] truncate text-muted-foreground" title={l.error}>{l.error}</span>}
                            {l.clicks > 0 && <span className="rounded-full bg-tint-blue px-2 py-0.5">Clicked{l.clicks > 1 ? ` ×${l.clicks}` : ''}</span>}
                            <span className="text-muted-foreground">{when(l.at)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>
        ))
      )}

      {outside.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-body-15 font-semibold">Made outside this page</h2>
          <p className="text-secondary-13 text-muted-foreground">
            These were set up on Zernio directly or before this page. They can be switched off or deleted here; one that
            answers every comment on the account cannot be switched back on from here.
          </p>
          {outside.map(o => (
            <Card key={o.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <PlatformIcon platform={o.platform} size={16} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-15 font-medium">{o.name}</span>
                  <span className="text-secondary-13 text-muted-foreground">
                    {o.client_name ?? 'No client here'}{o.account_username ? ` · @${o.account_username}` : ''} · {o.keywords.join(', ') || 'any comment'}
                    {' · '}{o.stats.triggered} triggered, {o.stats.dmsSent} DMs, {o.stats.linkClicks} clicks
                  </span>
                  {o.account_wide && (
                    <span className="mt-1 flex items-center gap-1.5 text-secondary-13 text-accent-red">
                      <AlertTriangle className="h-3.5 w-3.5" /> Answers every comment on the account, not one post
                    </span>
                  )}
                </div>
                <span className="text-secondary-13 text-muted-foreground">{o.active ? 'On' : 'Off'}</span>
                <Switch checked={o.active} disabled={!canManage || busy !== null || (!o.active && o.account_wide)}
                  aria-label={o.active ? 'Switch off' : 'Switch on'}
                  onCheckedChange={v => void patch(`z:${o.id}`, { active: v }, v ? 'Switched on' : 'Switched off')} />
                {canManage && (
                  <Button size="sm" variant="outline" disabled={busy !== null} aria-label="Delete"
                    className="text-accent-red hover:text-foreground"
                    onClick={() => setConfirmDelete({ id: `z:${o.id}`, name: o.name })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <AlertDialog open={confirmDelete !== null} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent className="bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{confirmDelete?.name ?? 'this automation'}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops answering at once, and Zernio deletes its history with it. Switching it off keeps the history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy !== null}
              className="bg-accent-red text-cream hover:bg-accent-red/90"
              onClick={e => { e.preventDefault(); if (confirmDelete) void remove(confirmDelete.id) }}>
              {busy !== null ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
