'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { COMMENT_MAX, INSIGHT_DAYS, MESSAGE_MAX } from '@/app/lib/meta-ig-inbox-core'
import type { IgPost, IgThreadComment, Insight, IgProfile, InboxAction } from '@/app/lib/meta-ig-inbox-core'
import type { ConversationOut } from '@/app/lib/meta-ig-inbox'

/**
 * A DIRECTLY CONNECTED INSTAGRAM ACCOUNT'S COMMENTS, MESSAGES AND NUMBERS
 * (5 Oct 2026), under the "Instagram — our own Meta app" card. Everything is
 * read from Instagram when the tab is opened and nothing is kept; every reply,
 * hide, delete and message is this person pressing this button
 * (/api/meta/instagram/inbox). Only drawn for a client with an active direct
 * connection.
 */

type Tab = 'comments' | 'messages' | 'insights'
const TABS: { id: Tab; label: string }[] = [
  { id: 'comments', label: 'Comments' },
  { id: 'messages', label: 'Messages' },
  { id: 'insights', label: 'Insights' },
]

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
const count = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-AU'))

const H = 'font-mono text-[12px] uppercase tracking-widest text-muted-foreground'
const BTN = 'h-11 rounded-full px-4 text-[13px] font-semibold'

function useInbox(clientId: string) {
  const read = useCallback(async <T,>(params: Record<string, string>): Promise<T | { error: string }> => {
    try {
      const qs = new URLSearchParams({ clientId, ...params }).toString()
      const res = await fetch(`/api/meta/instagram/inbox?${qs}`)
      const json = await res.json().catch(() => ({}))
      return res.ok ? json as T : { error: (json as { error?: string }).error ?? 'Could not load' }
    } catch { return { error: 'Could not reach the server' } }
  }, [clientId])

  const send = useCallback(async (body: { action: InboxAction; commentId?: string; recipientId?: string; text?: string }): Promise<boolean> => {
    try {
      const res = await fetch('/api/meta/instagram/inbox', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, ...body }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { toast.error(json.error ?? 'Instagram refused it'); return false }
      return true
    } catch { toast.error('Could not reach the server'); return false }
  }, [clientId])

  return { read, send }
}

export default function MetaInstagramInbox({ clientId, username }: { clientId: string; username: string | null }) {
  const [tab, setTab] = useState<Tab>('comments')
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3" data-meta-ig="inbox">
      <div className="flex flex-wrap items-center gap-2">
        <p className={H}>@{username ?? 'instagram'} — through our Meta app</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Instagram through our Meta app">
        {TABS.map(t => (
          <button
            key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-full px-4 text-[13px] font-semibold ${tab === t.id ? 'bg-foreground text-background' : 'border border-border text-foreground'}`}
          >{t.label}</button>
        ))}
      </div>
      {tab === 'comments' && <Comments clientId={clientId} />}
      {tab === 'messages' && <Messages clientId={clientId} />}
      {tab === 'insights' && <Insights clientId={clientId} />}
    </div>
  )
}

/* ── comments ─────────────────────────────────────────────────────────── */

function Comments({ clientId }: { clientId: string }) {
  const { read, send } = useInbox(clientId)
  const [posts, setPosts] = useState<IgPost[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<IgPost | null>(null)
  const [thread, setThread] = useState<{ comments: IgThreadComment[]; insights: Insight[] } | null>(null)

  const loadPosts = useCallback(async () => {
    const out = await read<{ posts: IgPost[] }>({ view: 'posts' })
    if ('error' in out) { setError(out.error); setPosts([]) } else { setError(null); setPosts(out.posts) }
  }, [read])
  useEffect(() => { void loadPosts() }, [loadPosts])

  const loadThread = useCallback(async (post: IgPost) => {
    const out = await read<{ comments: IgThreadComment[]; insights: Insight[] }>({ view: 'comments', mediaId: post.id })
    if ('error' in out) { setError(out.error); setThread({ comments: [], insights: [] }) } else { setError(null); setThread(out) }
  }, [read])

  const openPost = (post: IgPost) => { setOpen(post); setThread(null); void loadThread(post) }
  const doThen = async (body: Parameters<typeof send>[0], done: string) => {
    if (!(await send(body))) return false
    toast.success(done)
    if (open) await loadThread(open)
    return true
  }

  if (posts === null) return <p className="text-[13px] text-muted-foreground">Reading the posts from Instagram…</p>

  if (open) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className={BTN} onClick={() => { setOpen(null); setThread(null); void loadPosts() }}>← All posts</Button>
          {open.permalink && <a href={open.permalink} target="_blank" rel="noreferrer" className="text-[13px] font-semibold underline">Open on Instagram</a>}
          <Button variant="outline" className={BTN} onClick={() => void loadThread(open)}>Refresh</Button>
        </div>
        <PostLine post={open} />
        {thread && thread.insights.length > 0 && <Numbers rows={thread.insights} label="This post" />}
        {error && <p className="text-[13px] text-accent-red-deep">{error}</p>}
        {!thread && <p className="text-[13px] text-muted-foreground">Reading the comments from Instagram…</p>}
        {thread && thread.comments.length === 0 && !error && <p className="text-[13px] text-muted-foreground">No comments on this post yet.</p>}
        {thread && thread.comments.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Comments on this post">
            {thread.comments.map(c => <CommentRow key={c.id} c={c} act={doThen} />)}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">Pick a post to read its comments, answer them, hide or delete one, or message the person who wrote it.</p>
      {error && <p className="text-[13px] text-accent-red-deep">{error}</p>}
      {posts.length === 0 && !error && <p className="text-[13px] text-muted-foreground">This account has no posts yet.</p>}
      <ul className="flex flex-col gap-1.5" aria-label="Recent posts">
        {posts.map(p => (
          <li key={p.id}>
            <button type="button" onClick={() => openPost(p)} className="flex min-h-11 w-full items-center gap-3 rounded-inner border border-border px-3 py-2 text-left">
              <PostLine post={p} />
              <span className="ml-auto shrink-0 text-[13px] font-semibold">{count(p.comments)} comment{p.comments === 1 ? '' : 's'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PostLine({ post }: { post: IgPost }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {post.picture
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={post.picture} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-inner object-cover" />
        : <span className="h-12 w-12 shrink-0 rounded-inner bg-muted" />}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-semibold">{post.caption ?? 'No caption'}</span>
        <span className="text-[12px] text-muted-foreground">{when(post.postedAt)}{post.likes !== null ? ` · ${count(post.likes)} like${post.likes === 1 ? '' : 's'}` : ''}</span>
      </span>
    </span>
  )
}

type Act = (body: { action: InboxAction; commentId?: string; text?: string }, done: string) => Promise<boolean>

function CommentRow({ c, act, reply = false }: { c: IgThreadComment; act: Act; reply?: boolean }) {
  const [mode, setMode] = useState<null | 'reply' | 'private_reply' | 'delete'>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (body: Parameters<Act>[0], done: string) => {
    setBusy(true)
    const ok = await act(body, done)
    setBusy(false)
    if (ok) { setMode(null); setText('') }
  }
  const max = mode === 'private_reply' ? MESSAGE_MAX : COMMENT_MAX
  return (
    <li className={`flex flex-col gap-2 rounded-inner border border-border px-3 py-2 ${reply ? 'ml-6' : ''}`} data-comment={c.id}>
      <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
        <span className="font-semibold">@{c.username ?? 'someone'}</span>
        {c.ours && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold">This account</span>}
        {c.hidden && <span className="rounded-full bg-tint-red px-2 py-0.5 text-[11px] font-semibold">Hidden</span>}
        <span className="text-[12px] text-muted-foreground">{when(c.at)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-[14px]">{c.text}</p>

      {mode === null && (
        <div className="flex flex-wrap gap-1.5">
          {!reply && <Button variant="outline" className={BTN} disabled={busy} onClick={() => setMode('reply')}>Reply</Button>}
          {!c.ours && <Button variant="outline" className={BTN} disabled={busy} onClick={() => setMode('private_reply')}>Message them</Button>}
          {!c.ours && (c.hidden
            ? <Button variant="outline" className={BTN} disabled={busy} onClick={() => void run({ action: 'unhide', commentId: c.id }, 'The comment shows again')}>Show again</Button>
            : <Button variant="outline" className={BTN} disabled={busy} onClick={() => void run({ action: 'hide', commentId: c.id }, 'The comment is hidden')}>Hide</Button>)}
          <Button variant="outline" className={BTN} disabled={busy} onClick={() => setMode('delete')}>Delete</Button>
        </div>
      )}

      {(mode === 'reply' || mode === 'private_reply') && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text} onChange={e => setText(e.target.value)} maxLength={max} rows={2} autoFocus
            aria-label={mode === 'reply' ? 'Your reply' : 'Your message'}
            placeholder={mode === 'reply' ? `Reply to @${c.username ?? 'them'} under the post` : `A direct message to @${c.username ?? 'them'}`}
          />
          {mode === 'private_reply' && <p className="text-[12px] text-muted-foreground">Instagram allows one message per comment, within 7 days of it.</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button className={BTN} disabled={busy || !text.trim()} onClick={() => void run({ action: mode, commentId: c.id, text }, mode === 'reply' ? 'Reply posted' : 'Message sent')}>
              {busy ? 'Sending…' : mode === 'reply' ? 'Post reply' : 'Send message'}
            </Button>
            <Button variant="outline" className={BTN} disabled={busy} onClick={() => { setMode(null); setText('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'delete' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px]">Delete this comment from Instagram? It cannot be brought back.</span>
          <Button className={BTN} disabled={busy} onClick={() => void run({ action: 'delete', commentId: c.id }, 'Comment deleted')}>{busy ? 'Deleting…' : 'Delete it'}</Button>
          <Button variant="outline" className={BTN} disabled={busy} onClick={() => setMode(null)}>Keep it</Button>
        </div>
      )}

      {c.replies.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Replies">
          {c.replies.map(r => <CommentRow key={r.id} c={r} act={act} reply />)}
        </ul>
      )}
    </li>
  )
}

/* ── messages ─────────────────────────────────────────────────────────── */

function Messages({ clientId }: { clientId: string }) {
  const { read, send } = useInbox(clientId)
  const [convs, setConvs] = useState<ConversationOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const out = await read<{ conversations: ConversationOut[] }>({ view: 'messages' })
    if ('error' in out) { setError(out.error); setConvs([]) } else { setError(null); setConvs(out.conversations) }
  }, [read])
  useEffect(() => { void load() }, [load])

  if (convs === null) return <p className="text-[13px] text-muted-foreground">Reading the messages from Instagram…</p>
  const open = convs.find(c => c.id === openId) ?? null

  if (open) {
    const sendIt = async () => {
      if (!open.personId) return
      setBusy(true)
      const ok = await send({ action: 'message', recipientId: open.personId, text })
      setBusy(false)
      if (ok) { toast.success('Message sent'); setText(''); await load() }
    }
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className={BTN} onClick={() => { setOpenId(null); setText('') }}>← All conversations</Button>
          <span className="text-[14px] font-semibold">@{open.personName ?? 'someone'}</span>
          <Button variant="outline" className={BTN} onClick={() => void load()}>Refresh</Button>
        </div>
        <ul className="flex flex-col gap-1.5" aria-label="Messages in this conversation">
          {open.messages.map(m => (
            <li key={m.id} className={`max-w-[85%] rounded-inner border border-border px-3 py-2 ${m.ours ? 'self-end bg-muted' : 'self-start'}`}>
              <p className="whitespace-pre-wrap break-words text-[14px]">{m.text || <span className="text-muted-foreground">(a photo, a video or something Instagram does not send as text)</span>}</p>
              <p className="text-[12px] text-muted-foreground">{m.ours ? 'This account' : `@${m.fromName ?? 'them'}`} · {when(m.at)}</p>
            </li>
          ))}
        </ul>
        {open.canReply ? (
          <div className="flex flex-col gap-2">
            <Textarea value={text} onChange={e => setText(e.target.value)} maxLength={MESSAGE_MAX} rows={2} aria-label="Your message" placeholder={`Write to @${open.personName ?? 'them'}`} />
            <div><Button className={BTN} disabled={busy || !text.trim()} onClick={() => void sendIt()}>{busy ? 'Sending…' : 'Send message'}</Button></div>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Instagram lets an account answer for 24 hours after the person’s last message. That time has passed here, so a new message cannot be sent until they write again.</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-muted-foreground">Direct messages people sent this account. Open one to read it and answer.</p>
        <Button variant="outline" className={BTN} onClick={() => void load()}>Refresh</Button>
      </div>
      {error && <p className="text-[13px] text-accent-red-deep">{error}</p>}
      {convs.length === 0 && !error && <p className="text-[13px] text-muted-foreground">No conversations yet.</p>}
      <ul className="flex flex-col gap-1.5" aria-label="Conversations">
        {convs.map(c => {
          const last = c.messages[c.messages.length - 1]
          return (
            <li key={c.id}>
              <button type="button" onClick={() => setOpenId(c.id)} className="flex min-h-11 w-full flex-col gap-0.5 rounded-inner border border-border px-3 py-2 text-left">
                <span className="flex flex-wrap items-baseline gap-2 text-[13px]">
                  <span className="font-semibold">@{c.personName ?? 'someone'}</span>
                  <span className="text-[12px] text-muted-foreground">{when(c.updatedAt)}</span>
                  {c.canReply && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold">Can be answered</span>}
                </span>
                {last && <span className="truncate text-[13px] text-muted-foreground">{last.ours ? 'You: ' : ''}{last.text || '(not text)'}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ── insights ─────────────────────────────────────────────────────────── */

type InsightsState = { profile: IgProfile; days: number; account: Insight[]; accountError: string | null }

function Insights({ clientId }: { clientId: string }) {
  const { read } = useInbox(clientId)
  const [days, setDays] = useState<number>(INSIGHT_DAYS[0])
  const [state, setState] = useState<InsightsState | { error: string } | null>(null)

  useEffect(() => {
    let live = true
    setState(null)
    void read<InsightsState>({ view: 'insights', days: String(days) }).then(out => { if (live) setState(out) })
    return () => { live = false }
  }, [read, days])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" aria-label="Period">
        {INSIGHT_DAYS.map(d => (
          <button
            key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
            className={`min-h-11 rounded-full px-4 text-[13px] font-semibold ${days === d ? 'bg-foreground text-background' : 'border border-border text-foreground'}`}
          >Last {d} days</button>
        ))}
      </div>
      {state === null && <p className="text-[13px] text-muted-foreground">Reading the numbers from Instagram…</p>}
      {state && 'error' in state && <p className="text-[13px] text-accent-red-deep">{state.error}</p>}
      {state && 'profile' in state && (
        <>
          <Numbers label="The account" rows={[
            { metric: 'followers', label: 'Followers', value: state.profile.followers },
            { metric: 'posts', label: 'Posts', value: state.profile.posts },
          ]} />
          {state.account.length > 0 && <Numbers label={`Last ${state.days} days`} rows={state.account} />}
          {state.accountError && <p className="text-[13px] text-muted-foreground">Instagram did not give this period’s numbers: {state.accountError}</p>}
          <p className="text-[12px] text-muted-foreground">Instagram’s numbers can be up to 48 hours behind. A post’s own numbers are on its page under Comments.</p>
        </>
      )}
    </div>
  )
}

function Numbers({ rows, label }: { rows: Insight[]; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className={H}>{label}</p>
      <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {rows.map(r => (
          <div key={r.metric} className="rounded-inner border border-border px-3 py-2">
            <dt className="text-[12px] text-muted-foreground">{r.label}</dt>
            <dd className="text-[18px] font-semibold">{count(r.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
