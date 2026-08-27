'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft, CalendarClock, ExternalLink, EyeOff, Loader2, MessageSquare,
  Reply, Send, Trash2,
} from 'lucide-react'
import PlatformIcon from '../PlatformIcon'

type PostRow = {
  id: string
  accountId: string
  accountUsername: string
  platform: string
  content: string
  createdTime: string
  permalink?: string
  picture?: string
  commentCount?: number
}

type Comment = {
  id: string
  text?: string
  message?: string
  username?: string
  from?: { username?: string }
  createdTime?: string
  timestamp?: string
  hidden?: boolean
}

function text(c: Comment): string {
  return c.text ?? c.message ?? ''
}
function author(c: Comment): string {
  return c.username ?? c.from?.username ?? 'someone'
}
function ago(iso?: string): string {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * Inbox.
 *
 * Comments are where a client's audience actually talks to them, so this is a
 * working surface rather than a report: pick a post, read the thread, reply
 * publicly or send the author a DM without leaving the dashboard.
 */
type Conversation = {
  id: string
  accountId?: string
  platform?: string
  participantName?: string
  participantUsername?: string
  participant?: { name?: string; username?: string }
  lastMessage?: { text?: string; createdTime?: string } | string
  updatedTime?: string
  accountUsername?: string
  unreadCount?: number
}
type Message = {
  id: string
  text?: string
  message?: string
  direction?: string
  isFromMe?: boolean
  from?: { username?: string; name?: string }
  senderName?: string
  createdTime?: string
  createdAt?: string
  timestamp?: string
}

const convName = (c: Conversation) =>
  c.participantName ?? c.participant?.name ?? c.participantUsername ?? c.participant?.username ?? 'someone'
const convPreview = (c: Conversation) =>
  typeof c.lastMessage === 'string' ? c.lastMessage : c.lastMessage?.text ?? ''
const msgText = (m: Message) => m.text ?? m.message ?? ''
const msgMine = (m: Message) =>
  m.isFromMe === true || m.direction === 'outgoing' || m.direction === 'sent' || m.direction === 'outbound'

type SocialAccount = {
  id: string
  provider_account_id: string
  platform: string
  username: string | null
  name: string | null
}

export default function InboxPage() {
  const [posts, setPosts] = useState<PostRow[] | null>(null)
  // comments | messages — comments are post threads, messages are DMs
  const [tab, setTab] = useState<'comments' | 'messages'>('comments')
  // one account, or every account — an account page links here pre-scoped
  const [acct, setAcct] = useState<string>('all')
  const [accounts, setAccounts] = useState<SocialAccount[]>([])

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('account')
    if (wanted) { setAcct(wanted); setTab('messages') }
    void (async () => {
      try {
        const res = await fetch('/api/social/accounts')
        const json = await res.json()
        if (res.ok) setAccounts(json.accounts ?? json.data ?? [])
      } catch { /* the filter simply stays at "all accounts" */ }
    })()
  }, [])
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [msgDraft, setMsgDraft] = useState('')

  const loadConvos = useCallback(async () => {
    try {
      const res = await fetch('/api/social/messages')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load messages')
      const raw = json.conversations
      const list: Conversation[] = raw?.data ?? raw?.conversations ?? (Array.isArray(raw) ? raw : [])
      setConvos(list)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load messages')
      setConvos([])
    }
  }, [])
  useEffect(() => { if (tab === 'messages' && convos === null) void loadConvos() }, [tab, convos, loadConvos])

  const openConvo = async (c: Conversation) => {
    setActiveConvo(c); setMessages(null)
    // opening = seeing: clear the badge here and tell the provider, so the
    // list agrees no matter which page it is loaded from next
    if (typeof c.unreadCount === 'number' && c.unreadCount > 0 && c.accountId) {
      setConvos(prev => prev?.map(x => x.id === c.id ? { ...x, unreadCount: 0 } : x) ?? prev)
      void fetch('/api/social/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', conversationId: c.id, accountId: c.accountId }),
      }).catch(() => { /* cosmetic — the next full load reconciles */ })
    }
    try {
      const res = await fetch(
        `/api/social/messages?conversationId=${encodeURIComponent(c.id)}&accountId=${encodeURIComponent(c.accountId ?? '')}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the conversation')
      const raw = json.messages
      const list: Message[] = raw?.data ?? raw?.messages ?? (Array.isArray(raw) ? raw : [])
      // a slow response for a conversation you already left must not clobber
      // the one now open
      setActiveConvo(cur => { if (cur?.id === c.id) setMessages(list); return cur })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the conversation')
      setMessages([])
    }
  }

  const sendMessage = async () => {
    if (!activeConvo || !msgDraft.trim()) return
    setBusy('send-dm')
    try {
      const res = await fetch('/api/social/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConvo.id,
          accountId: activeConvo.accountId,
          message: msgDraft.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send')
      toast.success('Sent')
      setMsgDraft('')
      void openConvo(activeConvo)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send')
    } finally {
      setBusy(null)
    }
  }
  const [active, setActive] = useState<PostRow | null>(null)
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dmDraft, setDmDraft] = useState('')
  const [dmLink, setDmLink] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [dmTo, setDmTo] = useState<Comment | null>(null)

  const loadPosts = useCallback(async () => {
    try {
      const res = await fetch('/api/social/inbox')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load inbox')
      setPosts(json.data ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load inbox')
      setPosts([])
    }
  }, [])

  useEffect(() => { loadPosts() }, [loadPosts])

  /**
   * Instant updates, without polling the provider.
   *
   * This page reads its conversations and comments LIVE from Zernio, so a new
   * DM changes nothing locally — and asking Zernio for the whole conversation
   * list every thirty seconds, from every open tab, would spend their rate
   * limit to discover that nothing happened.
   *
   * The webhook's delivery log is local and indexed, so THAT is what gets asked
   * on the timer. Only when its timestamp moves is a real round trip spent. The
   * page still loads normally on arrival, so an unmigrated log table or a
   * webhook that has not been enabled degrades to exactly the old behaviour.
   */
  const seenAt = useRef<string | null>(null)
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const since = seenAt.current
        const res = await fetch(
          `/api/social/activity${since ? `?since=${encodeURIComponent(since)}` : ''}`)
        if (!res.ok || stopped) return
        const { last_at: latest } = await res.json() as { last_at: string | null }
        if (stopped || !latest) return
        // the first answer only establishes the baseline — the page has just
        // loaded, so everything up to now is already on screen
        const advanced = since !== null && latest !== since
        seenAt.current = latest
        if (advanced) void (tab === 'messages' ? loadConvos() : loadPosts())
      } catch { /* offline, or the log table is not migrated — stay quiet */ }
    }
    void tick()
    const timer = setInterval(tick, 30_000)
    return () => { stopped = true; clearInterval(timer) }
  }, [tab, loadConvos, loadPosts])

  const openPost = async (p: PostRow) => {
    setActive(p); setComments(null); setReplyTo(null); setDmTo(null)
    try {
      const res = await fetch(`/api/social/comments?postId=${encodeURIComponent(p.id)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load comments')
      const raw = json.comments
      const list: Comment[] = raw?.data ?? raw?.comments ?? (Array.isArray(raw) ? raw : [])
      setActive(cur => { if (cur?.id === p.id) setComments(list); return cur })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load comments')
      setComments([])
    }
  }

  const act = async (action: string, comment: Comment, message?: string, url?: string) => {
    if (!active) return
    setBusy(comment.id + action)
    try {
      const res = await fetch('/api/social/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action, postId: active.id, commentId: comment.id, message,
          ...(url ? { buttons: [{ type: 'web_url', title: 'Open link', url }] } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That action was refused')

      toast.success(
        action === 'reply' ? 'Reply posted'
          : action === 'private_reply' ? 'Message sent'
          : action === 'hide' ? 'Comment hidden'
          : action === 'delete' ? 'Comment deleted'
          : 'Done'
      )
      setDraft(''); setDmDraft(''); setDmLink(''); setReplyTo(null); setDmTo(null)
      if (action === 'delete') setComments(cs => (cs ?? []).filter(c => c.id !== comment.id))
      else openPost(active)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That action was refused')
    } finally {
      setBusy(null)
    }
  }

  const visibleConvos = convos === null ? null
    : acct === 'all' ? convos : convos.filter(c => c.accountId === acct)
  const visiblePosts = posts === null ? null
    : acct === 'all' ? posts : posts.filter(p => p.accountId === acct)
  const acctLabel = (a: SocialAccount) => a.username ? `@${a.username}` : a.name ?? a.platform

  const changeAccount = (v: string) => {
    setAcct(v)
    // whatever was open may belong to another account — don't show it scoped wrong
    if (v !== 'all' && activeConvo && activeConvo.accountId !== v) { setActiveConvo(null); setMessages(null) }
    if (v !== 'all' && active && active.accountId !== v) { setActive(null); setComments(null) }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/social"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Social channels
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Inbox</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Comments and direct messages across every connected account, answered
            from one place.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" asChild>
          <Link href="/dashboard/social"><CalendarClock className="h-4 w-4" /> Schedule a post</Link>
        </Button>
        {accounts.length > 0 && (
          <Select value={acct} onValueChange={changeAccount}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.provider_account_id}>{acctLabel(a)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60">
          {(['comments', 'messages'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                tab === t
                  ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        </div>
      </div>

      {tab === 'messages' ? (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* ── conversations ── */}
        <Card className="h-fit">
          <CardContent className="p-2">
            {visibleConvos === null ? (
              <div className="flex flex-col gap-2 p-2">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : visibleConvos.length === 0 ? (
              <p className="p-4 text-xs text-zinc-500 dark:text-zinc-400">
                No conversations yet — Instagram and Telegram DMs land here once people message the connected accounts.
              </p>
            ) : (
              <ul className="flex flex-col">
                {visibleConvos.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void openConvo(c)}
                      className={`flex w-full flex-col gap-0.5 rounded-lg p-2.5 text-left transition-colors ${
                        activeConvo?.id === c.id ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {c.platform && <PlatformIcon platform={c.platform} size={14} />}
                        <span className="truncate text-sm font-medium">{convName(c)}</span>
                        {typeof c.unreadCount === 'number' && c.unreadCount > 0 && (
                          <span className="ml-auto rounded-full bg-blue-600 px-1.5 py-0.5 font-mono text-[10px] text-white">{c.unreadCount}</span>
                        )}
                      </span>
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{convPreview(c)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── thread ── */}
        <Card>
          <CardContent className="p-4">
            {!activeConvo ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <MessageSquare className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose a conversation to read and reply.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="border-b border-zinc-200 pb-2 text-sm font-medium dark:border-zinc-800">{convName(activeConvo)}</p>
                {messages === null ? (
                  <div className="flex flex-col gap-2">{[0, 1].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : messages.length === 0 ? (
                  <p className="py-6 text-xs text-zinc-500 dark:text-zinc-400">No messages loaded for this conversation.</p>
                ) : (
                  <div className="flex max-h-[480px] flex-col gap-2 overflow-y-auto">
                    {messages.map(m => (
                      <div key={m.id} className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                        msgMine(m)
                          ? 'self-end bg-blue-600 text-white'
                          : 'self-start bg-zinc-100 dark:bg-zinc-800'
                      }`}>
                        {msgText(m)}
                        <span className={`mt-0.5 block text-[10px] ${msgMine(m) ? 'text-blue-100' : 'text-zinc-400 dark:text-zinc-500'}`}>
                          {ago(m.createdTime ?? m.createdAt ?? m.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <Textarea rows={1} value={msgDraft} placeholder={`Message ${convName(activeConvo)}…`}
                    onChange={e => setMsgDraft(e.target.value)} className="min-h-9" />
                  <Button size="sm" onClick={() => void sendMessage()} disabled={!msgDraft.trim() || busy === 'send-dm'}>
                    {busy === 'send-dm' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      ) : (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* ── posts ─────────────────────────────────────────────────── */}
        <Card className="h-fit">
          <CardContent className="p-2">
            {visiblePosts === null ? (
              <div className="flex flex-col gap-2 p-2">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : visiblePosts.length === 0 ? (
              <p className="p-4 text-xs text-zinc-500 dark:text-zinc-400">
                No posts with comments yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {visiblePosts.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openPost(p)}
                      className={`flex w-full gap-3 rounded-lg p-2 text-left transition-colors ${
                        active?.id === p.id
                          ? 'bg-zinc-100 dark:bg-zinc-800'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {p.picture
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.picture} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                        : <div className="h-12 w-12 shrink-0 rounded bg-zinc-100 dark:bg-zinc-800" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <PlatformIcon platform={p.platform} size={14} />
                          <span className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            @{p.accountUsername}
                          </span>
                        </div>
                        <p className="truncate text-sm">{p.content || '(no caption)'}</p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          {ago(p.createdTime)}
                          {typeof p.commentCount === 'number' && ` · ${p.commentCount} comment${p.commentCount === 1 ? '' : 's'}`}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── thread ────────────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-4">
            {!active ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <MessageSquare className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Choose a post to read and reply to its comments.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{active.content || '(no caption)'}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      @{active.accountUsername} · {ago(active.createdTime)}
                    </p>
                  </div>
                  {active.permalink && (
                    <a href={active.permalink} target="_blank" rel="noopener noreferrer"
                       className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                {comments === null ? (
                  <div className="flex flex-col gap-2">
                    {[0, 1].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : comments.length === 0 ? (
                  <p className="py-6 text-xs text-zinc-500 dark:text-zinc-400">
                    No comments on this post.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {comments.map(c => (
                      <li key={c.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xs font-medium">@{author(c)}</span>
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {ago(c.createdTime ?? c.timestamp)}
                          </span>
                          {c.hidden && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800">
                              hidden
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm">{text(c)}</p>

                        <div className="mt-2 flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost"
                            onClick={() => { setReplyTo(replyTo?.id === c.id ? null : c); setDmTo(null) }}>
                            <Reply className="h-3.5 w-3.5" /> Reply
                          </Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => { setDmTo(dmTo?.id === c.id ? null : c); setReplyTo(null) }}>
                            <Send className="h-3.5 w-3.5" /> DM
                          </Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => act(c.hidden ? 'unhide' : 'hide', c)}
                            disabled={busy === c.id + 'hide'}>
                            <EyeOff className="h-3.5 w-3.5" /> {c.hidden ? 'Unhide' : 'Hide'}
                          </Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => act('delete', c)}
                            disabled={busy === c.id + 'delete'}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        {replyTo?.id === c.id && (
                          <div className="mt-2 flex flex-col gap-2">
                            <Textarea rows={2} value={draft} placeholder={`Reply to @${author(c)}…`}
                              onChange={e => setDraft(e.target.value)} />
                            <Button size="sm" className="w-fit"
                              onClick={() => act('reply', c, draft)}
                              disabled={!draft.trim() || busy === c.id + 'reply'}>
                              {busy === c.id + 'reply'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Reply className="h-3.5 w-3.5" />} Post reply
                            </Button>
                          </div>
                        )}

                        {dmTo?.id === c.id && (
                          <div className="mt-2 flex flex-col gap-2">
                            <Textarea rows={2} value={dmDraft} placeholder={`Message @${author(c)} privately…`}
                              onChange={e => setDmDraft(e.target.value)} />
                            <Input value={dmLink} placeholder="Optional link for a button — https://…"
                              onChange={e => setDmLink(e.target.value)} />
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                              One private reply is allowed per comment, and only for a
                              limited period after it was posted.
                            </p>
                            <Button size="sm" className="w-fit"
                              onClick={() => act('private_reply', c, dmDraft, dmLink.trim() || undefined)}
                              disabled={!dmDraft.trim() || busy === c.id + 'private_reply'}>
                              {busy === c.id + 'private_reply'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Send className="h-3.5 w-3.5" />} Send DM
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      )}
    </div>
  )
}
