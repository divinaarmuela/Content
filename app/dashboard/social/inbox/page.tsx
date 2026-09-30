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
  ArrowLeft, ExternalLink, EyeOff, Loader2, MessageSquare,
  Reply, Send, Trash2,
} from 'lucide-react'
import PlatformIcon from '../PlatformIcon'
import ConfirmAction from '../../ConfirmAction'
import EmptyState from '../../EmptyState'
import PageTitle from '../../ui/PageTitle'
import {
  attachmentView, byAutomation, clockWords, dayLabel, deliveryWords, filterConversations, isMine, messageAt, messageButtons, previewWords, type InboxConversation, type InboxFilter, type InboxMessage,
} from '@/app/lib/inbox-core'
import { AUTO_PREFIX, PEOPLE_CRM_CLIENTS } from '@/app/lib/people-crm-core'

/**
 * Master/detail on a phone.
 *
 * Below `lg` the two columns stack, so tapping a conversation used to load
 * the thread somewhere below the fold with nothing to say so and nothing to
 * come back with. Now the list and the thread take turns: the list until
 * something is picked, then the thread with a back arrow. On a wide screen
 * both classes are inert and the two sit side by side as before.
 */
const listPane = (picked: boolean) => (picked ? 'hidden lg:block' : '')
const threadPane = (picked: boolean) => (picked ? '' : 'hidden lg:block')

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
 * INBOX (rebuilt 30 Sep 2026: "the social inbox is too slow and the layout is outdated"; Jordan showed 1 of his 5
 * conversations). One client at a time, remembered — only that client's accounts load, every page of them — in three
 * columns: the conversations (who, to which account, when, unread), the chat with Meta's reply window above the box,
 * and who the person is (the People page's row: follows, their automation trip). Comments keep their own tab.
 */
type ClientChoice = { id: string; name: string; accounts: { id: string; platform: string; username: string | null }[] }
type Window = { state: 'open' | 'human' | 'closed'; words: string }
type PersonRow = {
  username: string; status: string; following: boolean; md_lead: string | null; auto_dms: number; auto_clicks: number
  timeline: { what: string; detail: string | null; day: string }[]
}

const convName = (c: InboxConversation) => c.participantName ?? c.participantUsername ?? 'someone'
const convPreview = (c: InboxConversation) => previewWords(typeof c.lastMessage === 'string' ? c.lastMessage : c.lastMessage?.text ?? '')
const msgText = (m: InboxMessage) => m.text ?? m.message ?? ''
const whenWords = (iso?: string | null): string => {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  if ((Date.now() - t) / 1000 < 86400) return ago(iso)
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })
}
const CLIENT_KEY = 'inbox.client'
const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, { key: 'automation', label: 'From automations' },
]

export default function InboxPage() {
  const [posts, setPosts] = useState<PostRow[] | null>(null)
  // comments | messages — comments are post threads, messages are DMs
  const [tab, setTab] = useState<'comments' | 'messages'>('messages')
  const [clients, setClients] = useState<ClientChoice[] | null>(null)
  const [clientId, setClientId] = useState<string>('')
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [search, setSearch] = useState('')
  // the commenter whose name was clicked, for the About panel on the Comments tab
  const [aboutHandle, setAboutHandle] = useState<string | null>(null)

  // where the page opens: `?who=` (the People page), `?account=` (an account page), `?post=`, else the remembered client
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const person = params.get('who')
    if (person) { setSearch(person.replace(/^@/, '')); setTab('messages') }
    if (params.get('post')) setTab('comments')
    void (async () => {
      try {
        const res = await fetch('/api/social/messages?clients=1')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Could not load your clients')
        const list: ClientChoice[] = json.clients ?? []
        setClients(list)
        const wantedAccount = params.get('account')
        let remembered = ''
        try { remembered = window.localStorage.getItem(CLIENT_KEY) ?? '' } catch { /* private window */ }
        const pick = (wantedAccount && list.find(c => c.accounts.some(a => a.id === wantedAccount))?.id)
          || params.get('client') || (list.some(c => c.id === remembered) ? remembered : '') || list[0]?.id || 'all'
        setClientId(pick)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not load your clients')
        setClients([]); setClientId('all')
      }
    })()
  }, [])

  const [convos, setConvos] = useState<InboxConversation[] | null>(null)
  const [activeConvo, setActiveConvo] = useState<InboxConversation | null>(null)
  const [messages, setMessages] = useState<InboxMessage[] | null>(null)
  const [windowState, setWindowState] = useState<Window | null>(null)
  const [msgDraft, setMsgDraft] = useState('')
  const chatEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = chatEnd.current; if (el) el.scrollTop = el.scrollHeight }, [messages])
  const [people, setPeople] = useState<PersonRow[] | null>(null)

  const client = clients?.find(c => c.id === clientId) ?? null
  const accountIds = new Set(client ? client.accounts.map(a => a.id) : (clients ?? []).flatMap(c => c.accounts.map(a => a.id)))

  const loadConvos = useCallback(async () => {
    if (!clientId) return
    try {
      const res = await fetch(`/api/social/messages?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load messages')
      const raw = json.conversations
      setConvos(raw?.data ?? (Array.isArray(raw) ? raw : []))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load messages')
      setConvos([])
    }
  }, [clientId])
  useEffect(() => { if (tab === 'messages' && convos === null && clientId) void loadConvos() }, [tab, convos, clientId, loadConvos])

  // who they are — the People page's row, for the clients it covers
  useEffect(() => {
    if (people !== null || !clientId || !PEOPLE_CRM_CLIENTS.some(c => c.id === clientId)) return
    void (async () => {
      try {
        const res = await fetch(`/api/social/people-crm?clientId=${encodeURIComponent(clientId)}`)
        const json = await res.json()
        setPeople(res.ok ? (json.rows ?? []) : [])
      } catch { setPeople([]) }
    })()
  }, [tab, people, clientId])
  const automated = new Set((people ?? []).filter(p => p.auto_dms > 0 || p.timeline.some(e => e.what.startsWith(AUTO_PREFIX))).map(p => p.username.toLowerCase()))
  // matched by their handle first (Zernio's participantName), never by Instagram's numeric id when a handle exists —
  // the numeric id matched a bare "@2655487891576698" row and missed the person's automation trip (30 Sep 2026)
  const personOf = (c: InboxConversation | null): PersonRow | null => {
    if (!c || !people) return null
    const handles = [c.participantName, c.participantUsername]
      .map(v => String(v ?? '').replace(/^@/, '').toLowerCase())
      .filter(v => v && !/^\d+$/.test(v))
    for (const h of handles) {
      const hit = people.find(p => p.username.toLowerCase() === h)
      if (hit) return hit
    }
    return null
  }

  const chooseClient = (id: string) => {
    setClientId(id)
    try { window.localStorage.setItem(CLIENT_KEY, id) } catch { /* private window */ }
    setConvos(null); setActiveConvo(null); setMessages(null); setWindowState(null); setPeople(null)
    setActive(null); setComments(null); setAboutHandle(null)
  }

  const openConvo = async (c: InboxConversation) => {
    setActiveConvo(c); setMessages(null); setWindowState(null)
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
        `/api/social/messages?conversationId=${encodeURIComponent(c.id)}&accountId=${encodeURIComponent(c.accountId ?? '')}&name=${encodeURIComponent(c.participantName ?? '')}&username=${encodeURIComponent(c.participantUsername ?? '')}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the conversation')
      // a slow response for a conversation you already left must not clobber the one now open
      setActiveConvo(cur => {
        if (cur?.id === c.id) { setMessages(json.messages ?? []); setWindowState(json.window ?? null) }
        return cur
      })
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
        body: JSON.stringify({ conversationId: activeConvo.id, accountId: activeConvo.accountId, message: msgDraft.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send')
      toast.success(json.window === 'human' ? `Sent to ${convName(activeConvo)} as a team reply` : `Message sent to ${convName(activeConvo)}`)
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
    setActive(p); setComments(null); setReplyTo(null); setDmTo(null); setAboutHandle(null)
    try {
      const res = await fetch(
        `/api/social/comments?postId=${encodeURIComponent(p.id)}&accountId=${encodeURIComponent(p.accountId ?? '')}`)
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

  /**
   * `?post=<provider post id>` — a card's "Reply in Inbox" lands on that
   * post's thread. Opened once, when the list first arrives; a post the list
   * does not carry (no comments yet) leaves the page on its plain list.
   */
  const openedFromUrl = useRef(false)
  useEffect(() => {
    if (openedFromUrl.current || !posts) return
    openedFromUrl.current = true
    let wanted: string | null = null
    try { wanted = new URLSearchParams(window.location.search).get('post') } catch { /* no address */ }
    if (!wanted) return
    const hit = posts.find(p => p.id === wanted)
    if (hit) { setTab('comments'); void openPost(hit) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts])

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

      // every toast names the thing and where it went — "Done" told nobody
      // what had happened
      const who = `@${author(comment)}`
      toast.success(
        action === 'reply' ? `Reply to ${who} posted under the comment`
          : action === 'private_reply' ? `Private message sent to ${who}`
          : action === 'hide' ? `${who}'s comment hidden — only they can still see it`
          : action === 'unhide' ? `${who}'s comment is visible again`
          : action === 'delete' ? `${who}'s comment deleted from the post`
          : `${who}'s comment updated`
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

  const visibleConvos = convos === null ? null : filterConversations(convos, filter, search, automated)
  const visiblePosts = posts === null ? null : posts.filter(p => accountIds.has(p.accountId))
  const person = personOf(activeConvo)
  const tracked = PEOPLE_CRM_CLIENTS.some(c => c.id === clientId)
  const lastWhen = (c: InboxConversation) => whenWords(c.updatedTime)

  /** who this person is — the People page's row — for a conversation or a commenter */
  const aboutCard = (who: PersonRow | null, emptyWords: string | null) => {
    const lines = who ? who.timeline.filter(e => e.what.startsWith(AUTO_PREFIX)) : []
    return (
      <Card className="hidden h-fit xl:block">
        <CardContent className="flex flex-col gap-2 p-4 text-[13px]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">About this person</p>
          {emptyWords ? (
            <p className="text-muted-foreground">{emptyWords}</p>
          ) : !tracked ? (
            <p className="text-muted-foreground">The People page covers Justin Engelke, Jordan Wilson and the test client for now.</p>
          ) : people === null ? (
            <Skeleton className="h-20 w-full" />
          ) : !who ? (
            <p className="text-muted-foreground">Not on the People page yet — they have not followed, liked or commented where we can see it.</p>
          ) : (
            <>
              <p className="font-semibold">@{who.username}</p>
              <p>{who.following ? 'Follows this account' : 'Does not follow this account'}</p>
              {who.md_lead && <p><span className="font-semibold">MD Media lead</span> — {who.md_lead}</p>}
              {lines.length > 0 && (
                <div className="flex flex-col gap-1 rounded-inner bg-foreground/[0.04] p-2">
                  <p className="font-semibold">Automation</p>
                  {lines.slice(0, 6).map((e, k) => (
                    <p key={k}>{e.what.slice(AUTO_PREFIX.length)}{e.detail ? <span className="text-muted-foreground"> · {e.detail}</span> : null}</p>
                  ))}
                </div>
              )}
              <Link href="/dashboard/social/people" className="font-semibold underline underline-offset-2">Open the People page</Link>
            </>
          )}
        </CardContent>
      </Card>
    )
  }
  const commenter = aboutHandle && people ? people.find(p => p.username.toLowerCase() === aboutHandle.toLowerCase()) ?? null : null

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/social"
        className="inline-flex w-fit items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Social channels
      </Link>

      <PageTitle
        title="Inbox"
        summary="One client's direct messages and comments, answered from one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={clientId || undefined} onValueChange={chooseClient} disabled={clients === null}>
              <SelectTrigger className="w-60" aria-label="Client"><SelectValue placeholder={clients === null ? 'Loading…' : 'Choose a client'} /></SelectTrigger>
              <SelectContent>
                {(clients ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                <SelectItem value="all">All clients</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 rounded-inner bg-foreground/[0.06] p-1">
              {(['messages', 'comments'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`min-h-11 rounded-tile px-3 py-1.5 text-body-15 transition-colors ${
                    tab === t ? 'bg-surface font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'comments' ? 'Comments' : 'Direct messages'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {tab === 'messages' ? (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_280px]">
        {/* ── conversations ── */}
        <Card className={`h-fit ${listPane(activeConvo !== null)}`}>
          <CardContent className="flex flex-col gap-2 p-2">
            <div className="flex flex-col gap-2 p-1">
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a name…" aria-label="Search conversations" />
              <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
                {FILTERS.filter(f => f.key !== 'automation' || tracked).map(f => (
                  <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                    className={`min-h-9 rounded-full border px-3 text-[13px] font-medium ${filter === f.key ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-foreground/[0.04]'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {visibleConvos === null ? (
              <div className="flex flex-col gap-2 p-2">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : visibleConvos.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title={convos && convos.length > 0 ? 'Nothing matches' : 'No direct messages yet'}
                body={convos && convos.length > 0
                  ? 'No conversation matches this filter or search.'
                  : 'When someone messages this client’s Instagram or Facebook, the conversation lands here.'}
                className="border-0"
              />
            ) : (
              <ul className="flex max-h-[70vh] flex-col overflow-y-auto">
                {visibleConvos.map(c => (
                  <li key={`${c.accountId}:${c.id}`}>
                    <button
                      type="button"
                      onClick={() => void openConvo(c)}
                      className={`flex w-full gap-2.5 rounded-inner p-2.5 text-left transition-colors ${
                        activeConvo?.id === c.id ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'
                      }`}
                    >
                      {c.participantPicture
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={c.participantPicture} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                        : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-[14px] font-semibold uppercase">{convName(c).slice(0, 1)}</span>}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className={`truncate text-body-15 ${(c.unreadCount ?? 0) > 0 ? 'font-semibold' : 'font-medium'}`}>{convName(c)}</span>
                          <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{lastWhen(c)}</span>
                        </span>
                        <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                          {c.platform && <PlatformIcon platform={c.platform} size={12} />}
                          <span className="truncate">to @{c.accountUsername ?? 'account'}</span>
                          {(c.unreadCount ?? 0) > 0 && (
                            <span className="ml-auto shrink-0 rounded-full bg-accent-blue px-2 py-0.5 font-mono text-[11px] text-white">{c.unreadCount}</span>
                          )}
                        </span>
                        <span className="truncate text-secondary-13 text-muted-foreground">{convPreview(c)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── the chat ── */}
        <Card className={threadPane(activeConvo !== null)}>
          <CardContent className="p-4">
            {!activeConvo ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
                <p className="text-body-15 text-muted-foreground">Choose a conversation to read and reply.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <Button variant="ghost" size="sm" className="-ml-2 lg:hidden"
                    onClick={() => { setActiveConvo(null); setMessages(null); setWindowState(null) }}>
                    <ArrowLeft className="h-4 w-4" /> All conversations
                  </Button>
                  <div className="min-w-0">
                    <p className="truncate text-body-15 font-semibold">{convName(activeConvo)}</p>
                    <p className="truncate text-[12px] text-muted-foreground">to @{activeConvo.accountUsername ?? 'account'}</p>
                  </div>
                  {activeConvo.url && (
                    <a href={activeConvo.url} target="_blank" rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-secondary-13 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" /> Open in Instagram
                    </a>
                  )}
                </div>
                {messages === null ? (
                  <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : messages.length === 0 ? (
                  <p className="py-6 text-body-15 text-muted-foreground">No messages in this conversation yet.</p>
                ) : (
                  <div ref={chatEnd} className="flex max-h-[56vh] flex-col gap-1 overflow-y-auto pr-1" data-chat>
                    {messages.map((m, i) => {
                      const mine = isMine(m)
                      const at = messageAt(m)
                      const prev = i > 0 ? messages[i - 1] : null
                      const newDay = !prev || dayLabel(messageAt(prev), Date.now()) !== dayLabel(at, Date.now())
                      const sameSideAsPrev = !!prev && !newDay && isMine(prev) === mine
                      const buttons = messageButtons(m)
                      const auto = byAutomation(m)
                      const lastOfMine = mine && !messages.slice(i + 1).some(isMine)
                      return (
                        <div key={m.id ?? i} className="flex flex-col">
                          {newDay && (
                            <p className="my-2 self-center rounded-full bg-foreground/[0.06] px-3 py-0.5 text-[12px] font-medium text-muted-foreground">{dayLabel(at, Date.now())}</p>
                          )}
                          <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${sameSideAsPrev ? 'mt-0.5' : 'mt-2'}`}>
                            {!mine && (
                              sameSideAsPrev
                                ? <span className="w-7 shrink-0" />
                                : activeConvo.participantPicture
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={activeConvo.participantPicture} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                                  : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-[12px] font-semibold uppercase">{convName(activeConvo).slice(0, 1)}</span>
                            )}
                            <div className={`flex max-w-[78%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                              {auto && !sameSideAsPrev && <span className="mb-0.5 text-[11px] font-medium text-muted-foreground">Sent by automation</span>}
                              <div className={`rounded-[18px] px-3.5 py-2 text-body-15 ${mine ? 'rounded-br-md bg-foreground text-background' : 'rounded-bl-md bg-foreground/[0.07]'}`}>
                                {m.noRenderableContent
                                  ? <span className="italic">Instagram does not show this message to apps — open it in Instagram.</span>
                                  : msgText(m) && <span className="whitespace-pre-wrap break-words">{msgText(m)}</span>}
                                {m.isStoryMention && !(m.attachments ?? []).length && <span className="block italic">Mentioned the account in their story</span>}
                                {(m.attachments ?? []).map((a, k) => {
                                  const v = attachmentView(a)
                                  if (v.url && v.kind === 'image') {
                                    // eslint-disable-next-line @next/next/no-img-element
                                    return <img key={k} src={v.url} alt={v.words} className="mt-1 max-h-72 rounded-xl object-contain" />
                                  }
                                  if (v.url && v.kind === 'video') return <video key={k} src={v.url} controls className="mt-1 max-h-72 rounded-xl" />
                                  if (v.url && v.kind === 'audio') return <audio key={k} src={v.url} controls className="mt-1 w-56" />
                                  return v.url
                                    ? <a key={k} href={v.url} target="_blank" rel="noopener noreferrer" className="mt-1 block font-medium underline underline-offset-2">{v.words} — open</a>
                                    : <span key={k} className="mt-1 block italic">{v.words}</span>
                                })}
                              </div>
                              {buttons.map((b, k) => (
                                <span key={k} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-1.5 text-center text-[13px] font-semibold">{b.title}</span>
                              ))}
                              <span className="mt-0.5 px-1 text-[11px] text-muted-foreground">
                                {clockWords(at)}{lastOfMine && deliveryWords(m) ? ` · ${deliveryWords(m)}` : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {windowState && (
                  <p data-reply-window={windowState.state} className={`rounded-inner px-3 py-2 text-[13px] font-medium ${
                    windowState.state === 'open' ? 'bg-tint-green' : windowState.state === 'human' ? 'bg-tint-amber' : 'bg-tint-red'
                  }`}>{windowState.words}</p>
                )}
                <div className="flex gap-2 border-t border-border pt-3">
                  <Textarea rows={2} value={msgDraft} disabled={windowState?.state === 'closed'}
                    placeholder={windowState?.state === 'closed' ? 'Replies open again when they write' : `Message ${convName(activeConvo)}… (Enter to send)`}
                    onChange={e => setMsgDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }}
                    className="min-h-9 rounded-2xl" />
                  <Button size="sm" aria-label="Send" onClick={() => void sendMessage()}
                    disabled={!msgDraft.trim() || busy === 'send-dm' || windowState?.state === 'closed'}>
                    {busy === 'send-dm' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {aboutCard(person, activeConvo ? null : 'Open a conversation to see who they are.')}
      </div>
      ) : (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_280px]">
        {/* ── posts ─────────────────────────────────────────────────── */}
        <Card className={`h-fit ${listPane(active !== null)}`}>
          <CardContent className="p-2">
            {visiblePosts === null ? (
              <div className="flex flex-col gap-2 p-2">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : visiblePosts.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No comments to answer yet"
                body="Posts on this client's accounts appear here as soon as someone comments on them."
                className="border-0"
              />
            ) : (
              <ul className="flex flex-col">
                {visiblePosts.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openPost(p)}
                      className={`flex w-full gap-3 rounded-inner p-2 text-left transition-colors ${
                        active?.id === p.id
                          ? 'bg-foreground/[0.06]'
                          : 'hover:bg-foreground/[0.04]'
                      }`}
                    >
                      {p.picture
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.picture} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                        : <div className="h-12 w-12 shrink-0 rounded bg-foreground/[0.06]" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <PlatformIcon platform={p.platform} size={14} />
                          <span className="truncate font-mono text-secondary-13 text-muted-foreground">
                            @{p.accountUsername}
                          </span>
                        </div>
                        <p className="truncate text-body-15">{p.content || '(no caption)'}</p>
                        <p className="text-secondary-13 text-muted-foreground">
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
        <Card className={threadPane(active !== null)}>
          <CardContent className="p-4">
            {!active ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
                <p className="text-body-15 text-muted-foreground">
                  {visiblePosts && visiblePosts.length > 0
                    ? 'Choose a post on the left to read and reply to its comments.'
                    : 'Comments open here.'}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-start gap-2 border-b border-border pb-3">
                  <Button variant="ghost" size="sm" className="-ml-2 lg:hidden" aria-label="Back to all posts"
                    onClick={() => { setActive(null); setComments(null) }}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-15 font-medium">{active.content || '(no caption)'}</p>
                    <p className="text-secondary-13 text-muted-foreground">
                      @{active.accountUsername} · {ago(active.createdTime)}
                    </p>
                  </div>
                  {active.permalink && (
                    <a href={active.permalink} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 whitespace-nowrap text-secondary-13 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" /> Open post
                    </a>
                  )}
                </div>

                {comments === null ? (
                  <div className="flex flex-col gap-2">
                    {[0, 1].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : comments.length === 0 ? (
                  <p className="py-6 text-body-15 text-muted-foreground">
                    No comments on this post yet — nothing to answer here. Pick another post.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {comments.map(c => (
                      <li key={c.id} className="rounded-inner border border-border p-3">
                        <div className="flex items-baseline gap-2">
                          <button type="button" onClick={() => setAboutHandle(author(c))} className="font-mono text-secondary-13 font-medium underline-offset-2 hover:underline">@{author(c)}</button>
                          <span className="text-secondary-13 text-muted-foreground">
                            {ago(c.createdTime ?? c.timestamp)}
                          </span>
                          {c.hidden && (
                            <span className="rounded-full bg-foreground/[0.06] px-2.5 py-1.5 text-chip-12 text-muted-foreground">
                              hidden
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-body-15">{text(c)}</p>

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
                          <ConfirmAction
                            title="Delete this comment from the client's post?"
                            body="It disappears for everyone on the client's post and cannot be restored. Hiding it instead keeps it recoverable — only the person who wrote it can still see it."
                            confirmLabel="Delete comment"
                            onConfirm={() => act('delete', c)}
                          >
                            <Button size="sm" variant="ghost"
                              aria-label="Delete this comment"
                              disabled={busy === c.id + 'delete'}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </ConfirmAction>
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
                            <p className="text-secondary-13 text-muted-foreground">
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
        {aboutCard(commenter, aboutHandle ? null : 'Click a commenter’s name to see who they are.')}
      </div>
      )}
    </div>
  )
}
