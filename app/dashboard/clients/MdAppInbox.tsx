'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EyeOff, Eye, Trash2, Reply, Send, RefreshCw, MessageCircle, MessagesSquare } from 'lucide-react'
import PlatformIcon from '../social/PlatformIcon'
import { Button } from '@/components/ui/button'
import type { InboxComment, InboxPost, InboxThread } from '@/app/lib/md-app-inbox-core'

/**
 * THE META CARD'S INBOX TAB (9 Nov 2026). Comments on the client's Instagram and Facebook posts — reply, hide, show,
 * delete — and Instagram DMs and Messenger conversations, each person shown with their name and picture. Everything
 * runs through the client's own MD App connection (/api/meta/md-app/inbox). This is what Meta's App Review watches
 * for instagram_manage_comments, instagram_manage_messages, pages_read_user_content, pages_manage_engagement,
 * pages_messaging and Business Asset User Profile Access.
 */

type Platform = 'instagram' | 'facebook'
type Mode = 'comments' | 'messages'

/** comments hidden in this browser tab, by comment id — see loadComments */
const HIDDEN_HERE = new Map<string, InboxComment>()
type Posts = { instagram: InboxPost[]; facebook: InboxPost[]; igUsername: string | null; pageName: string | null }

const when = (t: string | null) => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
const initials = (n: string) => n.replace(/^@/, '').split(/[\s._]+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('') || '?'

function Avatar({ name, picture, size = 36 }: { name: string; picture: string | null; size?: number }) {
  return picture
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={picture} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    : <span className="flex shrink-0 items-center justify-center rounded-full bg-tint-blue text-[12px] font-semibold text-foreground" style={{ width: size, height: size }}>{initials(name)}</span>
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon: React.ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-full border border-border bg-surface p-1">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors ${value === o.value ? 'bg-ink text-cream dark:bg-cream dark:text-ink' : 'text-muted-foreground hover:text-foreground'}`}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

export default function MdAppInbox({ clientId }: { clientId: string }) {
  const api = `/api/meta/md-app/inbox?clientId=${encodeURIComponent(clientId)}`
  const [mode, setMode] = useState<Mode>('comments')
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [posts, setPosts] = useState<Posts | null>(null)
  const [postId, setPostId] = useState<string | null>(null)
  const [comments, setComments] = useState<InboxComment[] | null>(null)
  const [threads, setThreads] = useState<InboxThread[] | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  const read = useCallback(async <T,>(qs: string): Promise<T | null> => {
    try {
      const res = await fetch(`${api}&${qs}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError((json as { error?: string }).error ?? 'Could not read from Meta'); return null }
      setError(null); return json as T
    } catch { setError('Could not reach the server'); return null }
  }, [api])

  const loadPosts = useCallback(async () => { const p = await read<Posts>('view=posts'); if (p) setPosts(p) }, [read])
  // Comments hidden here, kept on screen (10 Nov 2026, live): Instagram leaves a hidden comment OUT of the post's
  // comment list, so after Hide it vanished and Show could never be pressed. The ones hidden in this visit stay drawn,
  // marked Hidden, until shown again or deleted.
  // kept OUTSIDE the component: the Meta card redraws its tabs while it re-reads the connection (Live updates), which
  // threw a component-held list away and the hidden comment vanished again (10 Nov 2026, live)
  const hiddenHere = useMemo(() => ({ current: HIDDEN_HERE }), [])
  const loadComments = useCallback(async () => {
    if (!postId) { setComments(null); return }
    const r = await read<{ comments: InboxComment[] }>(`view=comments&platform=${platform}&postId=${encodeURIComponent(postId)}`)
    const got = r?.comments ?? []
    const kept = [...hiddenHere.current.values()].filter(h => (h as InboxComment & { postId?: string }).postId === postId && !got.some(c => c.id === h.id))
    setComments([...got, ...kept])
  }, [read, platform, postId])
  const loadThreads = useCallback(async () => {
    setThreads(null)
    const r = await read<{ threads: InboxThread[] }>(`view=threads&platform=${platform}`)
    setThreads(r?.threads ?? [])
  }, [read, platform])

  useEffect(() => { void loadPosts() }, [loadPosts])
  useEffect(() => { setPostId(null); setThreadId(null); setComments(null) }, [platform, mode])
  useEffect(() => { if (mode === 'comments') void loadComments() }, [mode, loadComments])
  useEffect(() => { if (mode === 'messages') void loadThreads() }, [mode, loadThreads])

  const list = posts ? posts[platform] : null
  const post = list?.find(p => p.id === postId) ?? null
  const thread = threads?.find(t => t.id === threadId) ?? null
  const own = platform === 'instagram' ? (posts?.igUsername ? `@${posts.igUsername}` : 'Instagram') : (posts?.pageName ?? 'Facebook Page')

  const act = async (key: string, body: Record<string, unknown>, ok: string, after: () => Promise<void>) => {
    setBusy(key)
    try {
      const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform, ...body }) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) { toast.success(ok); await after() } else toast.error(json.error ?? 'That did not work')
    } finally { setBusy(null) }
  }

  const lastFromThem = useMemo(() => thread ? [...thread.messages].reverse().find(m => !m.fromMe) : undefined, [thread])
  const windowOpen = !!lastFromThem?.time && Date.now() - Date.parse(lastFromThem.time) < 24 * 3600 * 1000

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={mode} onChange={setMode} options={[
            { value: 'comments', label: 'Comments', icon: <MessageCircle className="h-3.5 w-3.5" /> },
            { value: 'messages', label: 'Messages', icon: <MessagesSquare className="h-3.5 w-3.5" /> },
          ]} />
          <Segmented value={platform} onChange={setPlatform} options={[
            { value: 'instagram', label: 'Instagram', icon: <PlatformIcon platform="instagram" size={14} /> },
            { value: 'facebook', label: 'Facebook', icon: <PlatformIcon platform="facebook" size={14} /> },
          ]} />
        </div>
        <Button size="sm" variant="outline" onClick={() => void (mode === 'comments' ? Promise.all([loadPosts(), loadComments()]) : loadThreads())}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {error && <p className="rounded-inner bg-tint-red px-3 py-2 text-sm">{error}</p>}

      <div className="grid gap-4 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* ── left: posts or conversations ── */}
        <div className="overflow-hidden rounded-inner border border-border bg-surface">
          {mode === 'comments' ? (
            !list ? <p className="p-4 text-sm text-muted-foreground">Loading posts…</p>
              : list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No posts on this {platform === 'instagram' ? 'Instagram account' : 'Page'} yet.</p>
              : <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
                  {list.map(p => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPostId(p.id)}
                        className={`flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${postId === p.id ? 'bg-tint-blue' : 'hover:bg-muted/60'}`}>
                        {p.thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.thumb} alt="" className="h-12 w-12 shrink-0 rounded-tile object-cover" />
                          : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-tile bg-paper text-muted-foreground"><PlatformIcon platform={platform} size={16} /></span>}
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[13px] leading-snug">{p.caption || 'No caption'}</span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{when(p.time)}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.comments ? 'bg-tint-amber' : 'bg-paper text-muted-foreground'}`}>{p.comments}</span>
                      </button>
                    </li>
                  ))}
                </ul>
          ) : (
            !threads ? <p className="p-4 text-sm text-muted-foreground">Loading conversations…</p>
              : threads.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No {platform === 'instagram' ? 'Instagram messages' : 'Messenger conversations'} yet.</p>
              : <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
                  {threads.map(t => {
                    const last = t.messages[t.messages.length - 1]
                    return (
                      <li key={t.id}>
                        <button type="button" onClick={() => setThreadId(t.id)}
                          className={`flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${threadId === t.id ? 'bg-tint-blue' : 'hover:bg-muted/60'}`}>
                          <Avatar name={t.withName} picture={t.picture} size={40} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{t.withName}</span>
                            <span className="block truncate text-[12px] text-muted-foreground">{last ? `${last.fromMe ? 'You: ' : ''}${last.text}` : 'No messages'}</span>
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{when(t.updated)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
          )}
        </div>

        {/* ── right: the comments on a post, or one conversation ── */}
        <div className="min-h-[320px] overflow-hidden rounded-inner border border-border bg-surface">
          {mode === 'comments' ? (
            !post ? <EmptyPane text="Pick a post to see its comments." />
              : (
                <div className="flex h-full flex-col">
                  <div className="border-b border-border px-4 py-3">
                    <p className="line-clamp-2 text-[13px]">{post.caption || 'No caption'}</p>
                    {post.link && <a href={post.link} target="_blank" rel="noreferrer noopener" className="text-[12px] text-muted-foreground underline">Open on {platform === 'instagram' ? 'Instagram' : 'Facebook'}</a>}
                  </div>
                  {!comments ? <p className="p-4 text-sm text-muted-foreground">Loading comments…</p>
                    : comments.length === 0 ? <EmptyPane text="No comments on this post yet." />
                    : <ul className="max-h-[460px] space-y-1 overflow-y-auto p-3">
                        {comments.map(c => (
                          <li key={c.id} className={`rounded-tile p-3 ${c.hidden ? 'bg-paper opacity-70' : ''}`}>
                            <div className="flex gap-3">
                              <Avatar name={c.author} picture={c.picture} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="text-[13px] font-semibold">{c.author}</span>
                                  <span className="text-[11px] text-muted-foreground">{when(c.time)}</span>
                                  {c.hidden && <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Hidden</span>}
                                </div>
                                <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-snug">{c.text}</p>
                                {c.replies.length > 0 && (
                                  <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
                                    {c.replies.map(r => (
                                      <li key={r.id} className="text-[13px]">
                                        <span className="font-semibold">{r.mine ? own : r.author}</span>{' '}
                                        <span className="text-muted-foreground">· {when(r.time)}</span>
                                        <p className="whitespace-pre-wrap leading-snug">{r.text}</p>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {!c.mine && (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}><Reply className="h-3.5 w-3.5" /> Reply</Button>
                                    <Button size="sm" variant="outline" disabled={!!busy}
                                      onClick={() => void act(`h:${c.id}`, { action: c.hidden ? 'unhide' : 'hide', commentId: c.id }, c.hidden ? 'Comment shown again' : 'Comment hidden', async () => {
                                        if (c.hidden) hiddenHere.current.delete(c.id)
                                        else hiddenHere.current.set(c.id, { ...c, hidden: true, postId } as InboxComment)
                                        await loadComments()
                                      })}>
                                      {c.hidden ? <><Eye className="h-3.5 w-3.5" /> Show</> : <><EyeOff className="h-3.5 w-3.5" /> Hide</>}
                                    </Button>
                                    <Button size="sm" variant="outline" disabled={!!busy}
                                      onClick={() => { if (confirm(`Delete ${c.author}'s comment? This cannot be undone.`)) void act(`d:${c.id}`, { action: 'delete', commentId: c.id }, 'Comment deleted', async () => { hiddenHere.current.delete(c.id); await loadComments(); await loadPosts() }) }}>
                                      <Trash2 className="h-3.5 w-3.5" /> Delete
                                    </Button>
                                  </div>
                                )}
                                {replyingTo === c.id && (
                                  <Composer value={draft[c.id] ?? ''} onChange={v => setDraft(d => ({ ...d, [c.id]: v }))} placeholder={`Reply to ${c.author} as ${own}…`}
                                    busy={busy === `r:${c.id}`} onSend={() => void act(`r:${c.id}`, { action: 'reply', commentId: c.id, text: draft[c.id] }, 'Reply posted', async () => {
                                      setDraft(d => ({ ...d, [c.id]: '' })); setReplyingTo(null); await loadComments()
                                    })} />
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>}
                </div>
              )
          ) : (
            !thread ? <EmptyPane text="Pick a conversation." />
              : (
                <div className="flex h-full flex-col">
                  <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                    <Avatar name={thread.withName} picture={thread.picture} size={40} />
                    <div>
                      <p className="text-[14px] font-semibold">{thread.withName}</p>
                      <p className="text-[11px] text-muted-foreground">{platform === 'instagram' ? 'Instagram message' : 'Messenger'} · to {own}</p>
                    </div>
                  </div>
                  <div className="flex max-h-[400px] flex-1 flex-col gap-2 overflow-y-auto p-4">
                    {thread.messages.map(m => (
                      <div key={m.id} className={`max-w-[80%] ${m.fromMe ? 'self-end' : 'self-start'}`}>
                        <p className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[14px] leading-snug ${m.fromMe ? 'bg-ink text-cream dark:bg-cream dark:text-ink' : 'bg-paper'}`}>{m.text || '(attachment)'}</p>
                        <p className={`mt-0.5 text-[10px] text-muted-foreground ${m.fromMe ? 'text-right' : ''}`}>{when(m.time)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border p-3">
                    {windowOpen && thread.withId ? (
                      <Composer value={draft[thread.id] ?? ''} onChange={v => setDraft(d => ({ ...d, [thread.id]: v }))} placeholder={`Message ${thread.withName}…`}
                        busy={busy === `m:${thread.id}`} onSend={() => void act(`m:${thread.id}`, { action: 'message', to: thread.withId, text: draft[thread.id] }, 'Message sent', async () => {
                          setDraft(d => ({ ...d, [thread.id]: '' })); await loadThreads(); setThreadId(thread.id)
                        })} />
                    ) : (
                      <p className="text-[12px] text-muted-foreground">Meta allows a reply within 24 hours of {thread.withName}&apos;s last message. This conversation can be answered again when they write next.</p>
                    )}
                  </div>
                </div>
              )
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyPane({ text }: { text: string }) {
  return <div className="flex h-full min-h-[200px] items-center justify-center p-6 text-sm text-muted-foreground">{text}</div>
}

function Composer({ value, onChange, onSend, placeholder, busy }: { value: string; onChange: (v: string) => void; onSend: () => void; placeholder: string; busy: boolean }) {
  return (
    <div className="mt-2 flex items-end gap-2">
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} maxLength={1000}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && value.trim()) { e.preventDefault(); onSend() } }}
        className="min-h-11 flex-1 resize-none rounded-inner border border-border bg-background px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-ring" />
      <Button size="sm" disabled={busy || !value.trim()} onClick={onSend}><Send className="h-3.5 w-3.5" /> {busy ? 'Sending…' : 'Send'}</Button>
    </div>
  )
}
