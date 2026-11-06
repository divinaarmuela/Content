'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { ArrowLeft, ExternalLink, Loader2, MessageSquare } from 'lucide-react'
import PlatformIcon from '../PlatformIcon'
import EmptyState from '../../EmptyState'
import PageTitle from '../../ui/PageTitle'
import { filterConversations, type InboxConversation, type InboxFilter, type InboxMessage } from '@/app/lib/inbox-core'
import {
  agoShort, filterByReply, replyCounts, threadLayout, type AnnotatedComment, type ReplyFilter,
} from '@/app/lib/inbox-copy-core'
import { AUTO_PREFIX, PEOPLE_CRM_CLIENTS } from '@/app/lib/people-crm-core'
import { agoLabel, newWords, type RankedClient } from '@/app/lib/inbox-clients-core'
import { useNewest, useSteadyRows } from '@/lib/db-client'
import type { InboxTouch } from '@/lib/db-types'
import {
  Bubble, CommentRow, ConvoRow, DmComposer, Freshness, commentAuthor, convName, type CommentAction,
} from './InboxParts'

/**
 * Master/detail on a phone: the list and the thread take turns below `lg`; side by side above it.
 */
const listPane = (picked: boolean) => (picked ? 'hidden lg:block' : '')
const threadPane = (picked: boolean) => (picked ? '' : 'hidden lg:block')

type PostRow = {
  id: string
  /** the newest comment we were told about, and how many came since you last opened this client (3 Nov 2026) */
  last_comment_at?: string | null
  new_comments?: number
  /** from the post's comments as last read (6 Nov 2026) — absent until it has been opened or re-checked */
  needs_reply?: number
  replied?: number
  accountId: string
  accountUsername: string
  platform: string
  content: string
  createdTime: string
  permalink?: string
  picture?: string
  commentCount?: number
}

type LogRow = { id: string; kind: string; by_name: string | null; at: string; platform: string | null; text: string; target_id: string }

function ago(iso?: string): string {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * INBOX. One client at a time (or everyone's newest), conversations and comments.
 *
 * FAST, NOT STALE (6 Nov 2026): both lists open from our saved copy, which Zernio's webhooks keep current as things
 * happen (an unsent message is removed, never shown with its old words). Then, if the copy is over two minutes old,
 * the newest page is re-read under "Checking…". Opening ONE conversation or ONE post always reads it live. "Load
 * older" fetches the next page; nothing walks ten pages up front any more.
 */
type ClientChoice = RankedClient
type Window = { state: 'open' | 'human' | 'closed'; words: string }
type PersonRow = {
  username: string; status: string; auto_dms: number; auto_clicks: number
  timeline: { what: string; detail: string | null; day: string }[]
}

const CLIENT_KEY = 'inbox.client'
/** Instagram's picture links expire — a dead one shows as a plain grey circle, not a broken-image icon (3 Nov 2026) */
const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>) => { const img = e.currentTarget; img.removeAttribute('src'); img.alt = '' }
const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, { key: 'automation', label: 'From automations' },
]
/** a long list draws this many rows, then "Show more" — hundreds of rows are not all drawn at once */
const PAGE_ROWS = 60
const convKey = (c: InboxConversation) => `${c.accountId ?? ''}:${c.id}`
const withKey = (list: InboxConversation[]) => list.map(c => ({ ...c, key: convKey(c) }))

export default function InboxPage() {
  const [posts, setPosts] = useState<PostRow[] | null>(null)
  const [postsCheckedAt, setPostsCheckedAt] = useState<string | null>(null)
  // the posting service did not finish answering in time — the list may be short (3 Nov 2026)
  const [partial, setPartial] = useState(false)
  const [tab, setTab] = useState<'comments' | 'messages'>('messages')
  const [clients, setClients] = useState<ClientChoice[] | null>(null)
  const [clientId, setClientId] = useState<string>('')
  const [allLabel, setAllLabel] = useState('All clients')
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [search, setSearch] = useState('')
  const [aboutHandle, setAboutHandle] = useState<string | null>(null)

  // where the page opens: `?who=` (a person), `?account=` (an account page), `?post=`, else everyone's newest
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
        if (json.allLabel) setAllLabel(json.allLabel)
        const pick = (wantedAccount && list.find(c => c.accounts.some(a => a.id === wantedAccount))?.id)
          || params.get('client') || 'all'
        setClientId(pick)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not load your clients')
        setClients([]); setClientId('all')
      }
    })()
  }, [])

  // the client row re-reads from our own webhook notes: one cheap database read
  const refreshClients = useRef<null | (() => Promise<void>)>(null)
  useEffect(() => {
    let stopped = false
    const refresh = async () => {
      try {
        const res = await fetch('/api/social/messages?clients=1')
        if (!res.ok || stopped) return
        const json = await res.json() as { clients?: ClientChoice[] }
        if (!stopped && json.clients) setClients(json.clients)
      } catch { /* offline — keep the last list */ }
    }
    refreshClients.current = refresh
    const timer = setInterval(refresh, 120_000)
    return () => { stopped = true; clearInterval(timer); refreshClients.current = null }
  }, [])

  const [rawConvos, setConvos] = useState<(InboxConversation & { key: string })[] | null>(null)
  const steadyConvos = useSteadyRows(useMemo(() => (rawConvos ?? []).map(c => ({ ...c, id: c.key, convoId: c.id })), [rawConvos]))
  const convos = rawConvos === null ? null : steadyConvos
  const [convosCheckedAt, setConvosCheckedAt] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [shownConvos, setShownConvos] = useState(PAGE_ROWS)
  const [activeConvo, setActiveConvo] = useState<InboxConversation | null>(null)
  const [rawMessages, setMessages] = useState<InboxMessage[] | null>(null)
  const [sentBy, setSentBy] = useState<Record<string, string>>({})
  const [windowState, setWindowState] = useState<Window | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)
  const [people, setPeople] = useState<PersonRow[] | null>(null)

  // a message whose contents did not change stays the same object, so its bubble does not redraw on a refresh
  const steadyMessages = useSteadyRows(useMemo(() => (rawMessages ?? []).map((m, i) => ({ ...m, id: m.id ?? `i${i}` })), [rawMessages]))
  const messages = rawMessages === null ? null : steadyMessages
  useEffect(() => { const el = chatEnd.current; if (el) el.scrollTop = el.scrollHeight }, [messages])

  const client = useMemo(() => clients?.find(c => c.id === clientId) ?? null, [clients, clientId])
  const accountIds = useMemo(
    () => new Set(client ? client.accounts.map(a => a.id) : (clients ?? []).flatMap(c => c.accounts.map(a => a.id))),
    [client, clients],
  )

  /** `copy` = our saved copy (instant), `refresh` = re-read the newest page of stale accounts, `older` = Load older */
  const loadConvos = useCallback(async (mode: 'copy' | 'refresh' | 'older' = 'copy') => {
    if (!clientId) return
    if (mode === 'refresh') setChecking(true)
    if (mode === 'older') setLoadingOlder(true)
    try {
      const extra = mode === 'refresh' ? '&refresh=1' : mode === 'older' ? '&older=1' : ''
      const res = await fetch(`/api/social/messages?clientId=${encodeURIComponent(clientId)}${extra}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load messages')
      const raw = json.conversations
      setConvos(withKey(raw?.data ?? (Array.isArray(raw) ? raw : [])))
      setConvosCheckedAt(json.checkedAt ?? null)
      setHasOlder(json.hasOlder === true)
      if (mode === 'older') setShownConvos(n => n + PAGE_ROWS)
      // the copy is over two minutes old: show it now, and check Zernio for anything newer underneath
      if (mode === 'copy' && json.stale) void loadConvos('refresh')
    } catch (e) {
      if (mode === 'copy') { toast.error(e instanceof Error ? e.message : 'Could not load messages'); setConvos([]) }
    } finally {
      if (mode === 'refresh') setChecking(false)
      if (mode === 'older') setLoadingOlder(false)
    }
  }, [clientId])
  useEffect(() => { if (rawConvos === null && clientId) void loadConvos() }, [rawConvos, clientId, loadConvos])

  // who they are — their automation trip, for the clients it covers
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
  const automated = useMemo(
    () => new Set((people ?? []).filter(p => p.auto_dms > 0 || p.timeline.some(e => e.what.startsWith(AUTO_PREFIX))).map(p => p.username.toLowerCase())),
    [people],
  )
  // by handle, never by Instagram's numeric id when a handle exists (30 Sep 2026)
  const peopleByHandle = useMemo(() => new Map((people ?? []).map(p => [p.username.toLowerCase(), p])), [people])
  const personOf = (c: InboxConversation | null): PersonRow | null => {
    if (!c || !people) return null
    for (const h of [c.participantName, c.participantUsername].map(v => String(v ?? '').replace(/^@/, '').toLowerCase())) {
      if (h && !/^\d+$/.test(h) && peopleByHandle.has(h)) return peopleByHandle.get(h)!
    }
    return null
  }

  const [active, setActive] = useState<PostRow | null>(null)
  const [rawComments, setComments] = useState<AnnotatedComment[] | null>(null)
  const steadyComments = useSteadyRows(rawComments ?? [])
  const comments = rawComments === null ? null : steadyComments
  const [commentsChecking, setCommentsChecking] = useState(false)
  const [commentsCheckedAt, setCommentsCheckedAt] = useState<string | null>(null)
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [shownPosts, setShownPosts] = useState(PAGE_ROWS)
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [showLog, setShowLog] = useState(false)

  const chooseClient = (id: string) => {
    setClientId(id)
    if (id !== 'all') {
      setClients(list => list?.map(c => c.id === id ? { ...c, new_count: 0 } : c) ?? list)
      void fetch('/api/social/inbox/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: id }) }).catch(() => {})
    }
    try { window.localStorage.setItem(CLIENT_KEY, id) } catch { /* private window */ }
    setConvos(null); setActiveConvo(null); setMessages(null); setWindowState(null); setPeople(null)
    setActive(null); setComments(null); setAboutHandle(null); setPosts(null); setLog(null)
    setShownConvos(PAGE_ROWS); setShownPosts(PAGE_ROWS)
  }

  // ── actions: the newest functions live in a ref, and the rows get stable wrappers, so a row never redraws because
  //    the page drew (the to-dos fix, 28 Oct 2026)
  const openConvo = async (c: InboxConversation, quiet = false) => {
    if (!quiet) { setActiveConvo(c); setMessages(null); setSentBy({}); setWindowState(null) }
    const opened = !quiet
    if (opened && (c.unreadCount ?? 0) > 0 && c.accountId) {
      setConvos(prev => prev?.map(x => x.id === c.id && x.accountId === c.accountId ? { ...x, unreadCount: 0 } : x) ?? prev)
      void fetch('/api/social/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', conversationId: c.id, accountId: c.accountId }),
      }).catch(() => { /* cosmetic — the next load reconciles */ })
    }
    try {
      const res = await fetch(
        `/api/social/messages?conversationId=${encodeURIComponent(c.id)}&accountId=${encodeURIComponent(c.accountId ?? '')}&name=${encodeURIComponent(c.participantName ?? '')}&username=${encodeURIComponent(c.participantUsername ?? '')}${opened ? '&opened=1' : ''}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the conversation')
      // a slow answer for a conversation you already left must not clobber the one now open
      if (liveConvo.current?.id === c.id) { setMessages(json.messages ?? []); setSentBy(json.sentBy ?? {}); setWindowState(json.window ?? null) }
    } catch (e) {
      if (quiet) return
      toast.error(e instanceof Error ? e.message : 'Could not load the conversation')
      setMessages([])
    }
  }

  const sendMessage = async (text: string): Promise<boolean> => {
    const c = liveConvo.current
    if (!c) return false
    try {
      const res = await fetch('/api/social/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: c.id, accountId: c.accountId, message: text }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send')
      toast.success(json.window === 'human' ? `Sent to ${convName(c)} as a team reply` : `Message sent to ${convName(c)}`)
      void openConvo(c, true)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send')
      return false
    }
  }

  const loadPosts = useCallback(async () => {
    if (!clientId) return
    try {
      const res = await fetch(`/api/social/inbox?clientId=${encodeURIComponent(clientId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load inbox')
      setPosts(json.data ?? [])
      setPartial(json.partial === true)
      setPostsCheckedAt(json.checkedAt ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load inbox')
      setPosts([])
    }
  }, [clientId])
  useEffect(() => { void loadPosts() }, [loadPosts])

  const openPost = async (p: PostRow, quiet = false) => {
    if (!quiet) { setActive(p); setComments(null); setAboutHandle(null); setReplyFilter('all') }
    const q = `postId=${encodeURIComponent(p.id)}&accountId=${encodeURIComponent(p.accountId ?? '')}`
    setCommentsChecking(true)
    // the saved copy first, so the comments are there at once…
    if (!quiet) {
      void fetch(`/api/social/comments?${q}&cached=1`).then(r => r.json()).then(json => {
        if (livePost.current?.id === p.id && Array.isArray(json.comments)) {
          setComments(cur => cur ?? json.comments); setCommentsCheckedAt(json.fetchedAt ?? null)
        }
      }).catch(() => {})
    }
    // …and always the live read from Zernio, which replaces it
    try {
      const res = await fetch(`/api/social/comments?${q}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load comments')
      const list: AnnotatedComment[] = Array.isArray(json.comments) ? json.comments : []
      if (livePost.current?.id === p.id) {
        setComments(list); setCommentsCheckedAt(json.fetchedAt ?? new Date().toISOString())
        const n = replyCounts(list)
        setPosts(ps => ps?.map(x => x.id === p.id && x.accountId === p.accountId ? { ...x, ...n } : x) ?? ps)
      }
    } catch (e) {
      if (!quiet) { toast.error(e instanceof Error ? e.message : 'Could not load comments'); setComments(cs => cs ?? []) }
    } finally {
      if (livePost.current?.id === p.id) setCommentsChecking(false)
    }
  }

  const act = async (action: CommentAction, comment: AnnotatedComment, message?: string, url?: string): Promise<boolean> => {
    const post = livePost.current
    if (!post) return false
    setBusy(comment.id + ':' + action)
    try {
      const res = await fetch('/api/social/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action, postId: post.id, commentId: comment.id, message, accountId: post.accountId,
          ...(url ? { buttons: [{ type: 'web_url', title: 'Open link', url }] } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'That action was refused')
      const who = `@${commentAuthor(comment)}`
      toast.success(
        action === 'reply' ? `Reply to ${who} posted under the comment`
          : action === 'private_reply' ? `Private message sent to ${who}`
          : action === 'hide' ? `${who}'s comment hidden — only they can still see it`
          : action === 'unhide' ? `${who}'s comment is visible again`
          : `${who}'s comment deleted from the post`,
      )
      if (action === 'delete') setComments(cs => (cs ?? []).filter(c => c.id !== comment.id))
      else void openPost(post, true)
      if (action === 'reply' || action === 'private_reply') setLog(null)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That action was refused')
      return false
    } finally {
      setBusy(null)
    }
  }

  const fns = useRef({ openConvo, openPost, act, sendMessage })
  fns.current = { openConvo, openPost, act, sendMessage }
  const onOpenConvo = useCallback((c: InboxConversation & { convoId?: string }) => {
    void fns.current.openConvo({ ...c, id: c.convoId ?? c.id })
  }, [])
  const onAct = useCallback((a: CommentAction, c: AnnotatedComment, m?: string, u?: string) => fns.current.act(a, c, m, u), [])
  const onSend = useCallback((text: string) => fns.current.sendMessage(text), [])
  const onAbout = useCallback((h: string) => setAboutHandle(h), [])

  // the open thread and post, for the live refresh and for "is this answer still for what is on screen?"
  const liveConvo = useRef<InboxConversation | null>(null); liveConvo.current = activeConvo
  const livePost = useRef<PostRow | null>(null); livePost.current = active

  // IMMEDIATE: the moment Zernio's webhook notes a new comment or DM, the client row re-sorts, and the open client's
  // lists reload FROM THE COPY (which the same webhook already updated — no Zernio call), and an open thread re-reads
  const lastTouch = useRef<string | null>(null)
  const openClient = useRef(clientId); openClient.current = clientId
  useNewest<InboxTouch>('inbox_touches', 'last_at', row => {
    const at = row?.last_at ?? null
    const first = lastTouch.current === null
    lastTouch.current = at
    if (first || !at) return
    void refreshClients.current?.()
    if (openClient.current === 'all' || (row?.client_id && row.client_id === openClient.current)) reloadOpen.current?.()
  })
  const reloadOpen = useRef<null | (() => void)>(null)
  reloadOpen.current = () => {
    void loadConvos('copy'); void loadPosts()
    if (liveConvo.current) void fns.current.openConvo(liveConvo.current, true)
    if (livePost.current) void fns.current.openPost(livePost.current, true)
  }

  // the webhook delivery log, asked every 30 s as a safety net (unsends and edits do not write a touch)
  const seenAt = useRef<string | null>(null)
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const since = seenAt.current
        const res = await fetch(`/api/social/activity${since ? `?since=${encodeURIComponent(since)}` : ''}`)
        if (!res.ok || stopped) return
        const { last_at: latest } = await res.json() as { last_at: string | null }
        if (stopped || !latest) return
        const advanced = since !== null && latest !== since
        seenAt.current = latest
        if (advanced) reloadOpen.current?.()
      } catch { /* offline, or the log table is not migrated — stay quiet */ }
    }
    void tick()
    const timer = setInterval(tick, 30_000)
    return () => { stopped = true; clearInterval(timer) }
  }, [])

  /** `?post=<provider post id>` — a card's "Reply in Inbox" lands on that post's thread, once. */
  const openedFromUrl = useRef(false)
  useEffect(() => {
    if (openedFromUrl.current || !posts) return
    openedFromUrl.current = true
    let wanted: string | null = null
    try { wanted = new URLSearchParams(window.location.search).get('post') } catch { /* no address */ }
    if (!wanted) return
    const hit = posts.find(p => p.id === wanted)
    if (hit) { setTab('comments'); void fns.current.openPost(hit) }
  }, [posts])

  // the reply log, when asked for
  useEffect(() => {
    if (!showLog || log !== null || !clientId) return
    void (async () => {
      try {
        const res = await fetch(`/api/social/messages?log=1&clientId=${encodeURIComponent(clientId)}`)
        const json = await res.json()
        setLog(res.ok ? (json.log ?? []) : [])
      } catch { setLog([]) }
    })()
  }, [showLog, log, clientId])

  const visibleConvos = useMemo(
    () => (convos === null ? null : filterConversations(convos, filter, search, automated)),
    [convos, filter, search, automated],
  )
  const visiblePosts = useMemo(() => (posts === null ? null : posts.filter(p => accountIds.has(p.accountId))), [posts, accountIds])
  const layout = useMemo(() => (messages ? threadLayout(messages, sentBy, Date.now()) : []), [messages, sentBy])
  const counts = useMemo(() => replyCounts(comments ?? []), [comments])
  const shownComments = useMemo(() => filterByReply(comments ?? [], replyFilter), [comments, replyFilter])
  const person = personOf(activeConvo)
  const tracked = PEOPLE_CRM_CLIENTS.some(c => c.id === clientId)
  const activeKey = activeConvo ? convKey(activeConvo) : ''

  /** who this person is — their automation trip — for a conversation or a commenter */
  const aboutCard = (who: PersonRow | null, emptyWords: string | null) => {
    const lines = who ? who.timeline.filter(e => e.what.startsWith(AUTO_PREFIX)) : []
    return (
      <Card className="hidden h-fit xl:block">
        <CardContent className="flex flex-col gap-2 p-4 text-[13px]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">About this person</p>
          {emptyWords ? (
            <p className="text-muted-foreground">{emptyWords}</p>
          ) : !tracked ? (
            <p className="text-muted-foreground">This covers Justin Engelke, Jordan Wilson and the test client for now.</p>
          ) : people === null ? (
            <Skeleton className="h-20 w-full" />
          ) : !who ? (
            <p className="text-muted-foreground">Nothing noted about them yet — they have not commented or written where we can see it.</p>
          ) : (
            <>
              <p className="font-semibold">@{who.username}</p>
              {lines.length > 0 && (
                <div className="flex flex-col gap-1 rounded-inner bg-foreground/[0.04] p-2">
                  <p className="font-semibold">Automation</p>
                  {lines.slice(0, 6).map((e, k) => (
                    <p key={k}>{e.what.slice(AUTO_PREFIX.length)}{e.detail ? <span className="text-muted-foreground"> · {e.detail}</span> : null}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    )
  }
  const commenter = aboutHandle ? peopleByHandle.get(aboutHandle.toLowerCase()) ?? null : null

  const unreadConvos = useMemo(() => (convos ?? []).filter(c => (c.unreadCount ?? 0) > 0).length, [convos])
  const newPosts = useMemo(() => (posts ?? []).filter(p => (p.new_comments ?? 0) > 0).length, [posts])

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/social" className="inline-flex w-fit items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Social channels
      </Link>

      <PageTitle
        title="Inbox"
        summary="One client's direct messages and comments, answered from one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-inner bg-foreground/[0.06] p-1">
              {(['messages', 'comments'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`min-h-11 rounded-tile px-3 py-1.5 text-body-15 transition-colors ${
                    tab === t ? 'bg-surface font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}>
                  {t === 'comments' ? 'Comments' : 'Direct messages'}
                  {(t === 'comments' ? newPosts : unreadConvos) > 0 && (
                    <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-secondary-13 font-medium text-primary-foreground">
                      {t === 'comments' ? newPosts : unreadConvos}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button variant={showLog ? 'default' : 'outline'} size="sm" className="min-h-11" onClick={() => setShowLog(v => !v)}>
              Reply log
            </Button>
          </div>
        }
      />

      <ClientRow clients={clients} clientId={clientId} allLabel={allLabel} onChoose={chooseClient} />

      {showLog && <ReplyLog log={log} />}

      {tab === 'messages' ? (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_280px]">
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
            <Freshness checkedAt={convosCheckedAt} checking={checking} />
            {visibleConvos === null ? (
              <div className="flex flex-col gap-2 p-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : visibleConvos.length === 0 && !hasOlder ? (
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
                {visibleConvos.slice(0, shownConvos).map(c => (
                  <ConvoRow key={c.id} c={c} active={c.id === activeKey} onOpen={onOpenConvo} />
                ))}
                {(visibleConvos.length > shownConvos || hasOlder) && (
                  <li className="p-2">
                    <Button variant="outline" size="sm" className="w-full" disabled={loadingOlder}
                      onClick={() => (visibleConvos.length > shownConvos ? setShownConvos(n => n + PAGE_ROWS) : void loadConvos('older'))}>
                      {loadingOlder ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading older…</> : 'Load older conversations'}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

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
                    {messages.map((m, i) => (
                      <Bubble key={m.id} m={m} info={layout[i]} avatarSrc={activeConvo.participantPicture} letter={convName(activeConvo).slice(0, 1)} />
                    ))}
                  </div>
                )}
                {windowState && (
                  <p data-reply-window={windowState.state} className={`rounded-inner px-3 py-2 text-[13px] font-medium ${
                    windowState.state === 'open' ? 'bg-tint-green' : windowState.state === 'human' ? 'bg-tint-amber' : 'bg-tint-red'
                  }`}>{windowState.words}</p>
                )}
                <DmComposer
                  convoKey={activeKey}
                  disabled={windowState?.state === 'closed'}
                  placeholder={windowState?.state === 'closed' ? 'Replies open again when they write' : `Message ${convName(activeConvo)}… (Enter to send)`}
                  onSend={onSend}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {aboutCard(person, activeConvo ? null : 'Open a conversation to see who they are.')}
      </div>
      ) : (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_280px]">
        <Card className={`h-fit ${listPane(active !== null)}`}>
          <CardContent className="p-2">
            <Freshness checkedAt={postsCheckedAt} checking={false} />
            {partial && visiblePosts !== null && (
              <p className="px-2 pb-2 pt-1 text-[12px] text-muted-foreground">
                Not every account answered in time, so some posts may be missing.{clientId === 'all' ? ' Pick one client to see all of theirs.' : ' Reload to try again.'}
              </p>
            )}
            {visiblePosts === null ? (
              <div className="flex flex-col gap-2 p-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : visiblePosts.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No comments to answer yet"
                body="Posts on this client's accounts appear here as soon as someone comments on them." className="border-0" />
            ) : (
              <ul className="flex flex-col">
                {visiblePosts.slice(0, shownPosts).map(p => (
                  <PostItem key={`${p.accountId}:${p.id}`} p={p} active={active?.id === p.id} onOpen={fns} />
                ))}
                {visiblePosts.length > shownPosts && (
                  <li className="p-2">
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setShownPosts(n => n + PAGE_ROWS)}>Show more posts</Button>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={threadPane(active !== null)}>
          <CardContent className="p-4">
            {!active ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
                <p className="text-body-15 text-muted-foreground">
                  {visiblePosts && visiblePosts.length > 0 ? 'Choose a post on the left to read and reply to its comments.' : 'Comments open here.'}
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
                    <p className="text-secondary-13 text-muted-foreground">@{active.accountUsername} · {ago(active.createdTime)}</p>
                  </div>
                  {active.permalink && (
                    <a href={active.permalink} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 whitespace-nowrap text-secondary-13 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" /> Open post
                    </a>
                  )}
                </div>

                {comments !== null && comments.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-1" role="group" aria-label="Show comments">
                    {([['all', `All ${comments.length}`], ['needs', `Needs a reply ${counts.needs_reply}`], ['replied', `Replied ${counts.replied}`]] as const).map(([k, words]) => (
                      <button key={k} type="button" onClick={() => setReplyFilter(k)} aria-pressed={replyFilter === k}
                        className={`min-h-9 rounded-full border px-3 text-[13px] font-medium ${replyFilter === k ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-foreground/[0.04]'}`}>
                        {words}
                      </button>
                    ))}
                    <span className="ml-auto"><Freshness checkedAt={commentsCheckedAt} checking={commentsChecking} /></span>
                  </div>
                )}

                {comments === null ? (
                  <div className="flex flex-col gap-2">{[0, 1].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : comments.length === 0 ? (
                  <p className="py-6 text-body-15 text-muted-foreground">No comments on this post yet — nothing to answer here. Pick another post.</p>
                ) : shownComments.length === 0 ? (
                  <p className="py-6 text-body-15 text-muted-foreground">
                    {replyFilter === 'needs' ? 'Every comment here has a reply.' : 'No comment here has a reply yet.'}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {shownComments.map(c => (
                      <CommentRow key={c.id} c={c} platform={active.platform ?? null}
                        busy={busy?.startsWith(c.id + ':') ? busy.slice(c.id.length + 1) : null}
                        onAct={onAct} onAbout={onAbout} />
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

/** The client row: everyone first, then each client with the newest comment or DM first, saying what is new. */
const ClientRow = memo(function ClientRow({ clients, clientId, allLabel, onChoose }: {
  clients: ClientChoice[] | null; clientId: string; allLabel: string; onChoose: (id: string) => void
}) {
  return (
    <nav aria-label="Clients" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-foreground/20">
      {clients === null
        ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-44 shrink-0 rounded-tile" />)
        : [{ id: 'all', name: allLabel, fresh: '', when: '' }, ...clients.map(c => ({
            id: c.id, name: c.name, fresh: c.id === clientId ? '' : newWords(c), when: c.last_at ? agoLabel(c.last_at) : 'No activity yet',
          }))].map(c => {
            const on = c.id === clientId
            return (
              <button key={c.id} type="button" onClick={() => { if (!on) onChoose(c.id) }} aria-current={on ? 'true' : undefined}
                className={`flex min-h-11 shrink-0 flex-col items-start justify-center rounded-tile border px-3 py-2 text-left transition-colors ${
                  on ? 'border-foreground bg-surface shadow-sm' : 'border-border bg-foreground/[0.03] hover:bg-foreground/[0.06]'
                }`}>
                <span className={`text-body-15 text-foreground ${c.fresh ? 'font-semibold' : 'font-medium'}`}>{c.name}</span>
                {c.fresh
                  ? <span className="flex items-center gap-1.5 text-secondary-13 font-medium text-primary"><span className="h-2 w-2 rounded-full bg-primary" aria-hidden />{c.fresh} · {c.when}</span>
                  : c.when ? <span className="text-secondary-13 text-muted-foreground">{c.when}</span> : null}
              </button>
            )
          })}
    </nav>
  )
})

/** One post in the list, with "N need a reply" once its comments have been read. */
const PostItem = memo(function PostItem({ p, active, onOpen }: {
  p: PostRow; active: boolean; onOpen: React.MutableRefObject<{ openPost: (p: PostRow) => Promise<void> }>
}) {
  return (
    <li>
      <button type="button" onClick={() => void onOpen.current.openPost(p)}
        className={`flex w-full gap-3 rounded-inner p-2 text-left transition-colors ${active ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'}`}>
        {p.picture
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.picture} alt="" loading="lazy" onError={hideBroken} className="h-12 w-12 shrink-0 rounded bg-foreground/[0.08] object-cover" />
          : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-foreground/[0.06]"><PlatformIcon platform={p.platform} size={20} /></div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <PlatformIcon platform={p.platform} size={14} />
            <span className="truncate font-mono text-secondary-13 text-muted-foreground">@{p.accountUsername}</span>
          </div>
          <p className="truncate text-body-15">{p.content || '(no caption)'}</p>
          <p className="text-secondary-13 text-muted-foreground">
            {p.last_comment_at ? `Last comment ${ago(p.last_comment_at)}` : `Posted ${ago(p.createdTime)}`}
            {typeof p.commentCount === 'number' && ` · ${p.commentCount} comment${p.commentCount === 1 ? '' : 's'}`}
          </p>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-secondary-13 font-medium">
            {(p.new_comments ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5 text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />{p.new_comments} new
              </span>
            )}
            {typeof p.needs_reply === 'number' && (p.needs_reply > 0
              ? <span className="text-amber-700 dark:text-amber-400">{p.needs_reply} need{p.needs_reply === 1 ? 's' : ''} a reply</span>
              : <span className="text-muted-foreground">All replied</span>)}
          </span>
        </div>
      </button>
    </li>
  )
})

/** Every reply sent from the app for this client, newest first: who, when, where, and what. */
const ReplyLog = memo(function ReplyLog({ log }: { log: LogRow[] | null }) {
  const now = Date.now()
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Reply log — replies sent from this app</p>
        {log === null ? <Skeleton className="h-16 w-full" /> : log.length === 0 ? (
          <p className="text-body-15 text-muted-foreground">No replies sent from the app yet. Replies made in Instagram itself are not listed here.</p>
        ) : (
          <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
            {log.map(r => (
              <li key={r.id} className="flex flex-col gap-0.5 py-2 text-[13px]">
                <span className="flex flex-wrap items-center gap-1.5">
                  {r.platform && <PlatformIcon platform={r.platform} size={12} />}
                  <span className="font-semibold">{r.by_name ?? 'Someone on the team'}</span>
                  <span className="text-muted-foreground">
                    {r.kind === 'dm' ? 'sent a message' : r.kind === 'private_reply' ? 'sent a private reply to a comment' : 'replied to a comment'} · {agoShort(r.at, now)}
                  </span>
                </span>
                <span className="truncate text-muted-foreground">{r.text}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
})
