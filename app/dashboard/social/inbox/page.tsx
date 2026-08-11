'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  ArrowLeft, ExternalLink, EyeOff, Loader2, MessageSquare,
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
export default function InboxPage() {
  const [posts, setPosts] = useState<PostRow[] | null>(null)
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

  const openPost = async (p: PostRow) => {
    setActive(p); setComments(null); setReplyTo(null); setDmTo(null)
    try {
      const res = await fetch(`/api/social/comments?postId=${encodeURIComponent(p.id)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load comments')
      const raw = json.comments
      const list: Comment[] = raw?.data ?? raw?.comments ?? (Array.isArray(raw) ? raw : [])
      setComments(list)
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

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/social"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Social channels
      </Link>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Inbox</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Comments across every connected account. Reply publicly, or send the
          commenter a direct message — the standard way to hand out a link,
          since Instagram does not allow link stickers via any API.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* ── posts ─────────────────────────────────────────────────── */}
        <Card className="h-fit">
          <CardContent className="p-2">
            {posts === null ? (
              <div className="flex flex-col gap-2 p-2">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : posts.length === 0 ? (
              <p className="p-4 text-xs text-zinc-500 dark:text-zinc-400">
                No posts with comments yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {posts.map(p => (
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
    </div>
  )
}
