'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow, useTable } from '@/lib/db-client'
import type { ContentItem, ItemComment, TeamUser } from '@/lib/db-types'
import PageTitle from '../../../../ui/PageTitle'
import { personLabel } from '../../../../../lib/identity-core'
import {
  activeCommentId, commentsOnClip, formatStamp, markersFor,
} from '../../../../../lib/video-review-core'

/**
 * A CLIP'S OWN REVIEW PAGE (the owner, 15 Sep 2026: "once a video is clicked
 * it opens a new page with the video on the left and the comment section on
 * the right — we should be able to place comments mentioning the timestamp,
 * and on the video there is a highlight circle at that timestamp so we can
 * see it").
 *
 * Left: the clip, played through /api/drive/stream so it seeks, with a
 * marker bar under it — one circle per stamped comment, lit as the playhead
 * reaches it, a press jumps to it. Right: the comments on this clip in time
 * order, and a box that stamps the current second onto a new one. The
 * comments are the card's own comments (item_comments), live, so everyone
 * on the card sees them the moment they land, and every notice a card
 * comment sends is sent for these too.
 */
export default function VideoReviewPage() {
  const { id, fileId } = useParams<{ id: string; fileId: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const name = search.get('name') ?? 'Clip'
  const { row: item, loading } = useRow<ContentItem>('content_items', id)
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: allComments } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  const nameOf = (uid: string | null | undefined) => {
    const u = team.find(t => t.id === uid)
    return u ? personLabel(u.name, u.email) : 'Someone'
  }

  const video = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState(0)
  const [text, setText] = useState('')
  const [stamp, setStamp] = useState(true)
  const [sending, setSending] = useState(false)

  const comments = useMemo(() => commentsOnClip(allComments as never, fileId), [allComments, fileId])
  const markers = useMemo(() => markersFor(comments as never, duration), [comments, duration])
  const active = activeCommentId(comments as never, now)

  // the comment the playhead is on scrolls into view on the right
  useEffect(() => {
    if (!active) return
    document.getElementById(`clip-comment-${active}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const seek = (at: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = at
    void v.play().catch(() => { /* a press on the marker is enough */ })
  }

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setSending(true)
    try {
      const at = stamp ? Math.floor(video.current?.currentTime ?? 0) : null
      const res = await fetch(`/api/production/items/${id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, video_file_id: fileId, video_file_name: name, ...(at !== null ? { video_timestamp_sec: at } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not send')
      setText('')
      toast.success(at !== null ? `Noted at ${formatStamp(at)}` : 'Noted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className="flex flex-col gap-4"><Skeleton className="h-6 w-40" /><Skeleton className="h-64 w-full" /></div>
  if (!item) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle title="Card not found" summary="It may have been deleted, or the link is not quite right." />
        <Link href="/dashboard/editor" className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Editor</Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={() => router.push(`/dashboard/editor/${id}`)}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {item.title}
      </button>
      <PageTitle title={name} summary={`A clip on ${item.title}. Press a circle under the clip to jump to that comment.`} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
        {/* ── the clip, and the markers under it ── */}
        <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-3" aria-label="The clip">
          <video ref={video} controls playsInline preload="metadata"
            src={`/api/drive/stream?id=${encodeURIComponent(fileId)}`}
            className="max-h-[70vh] w-full rounded-tile bg-black"
            onTimeUpdate={e => setNow(e.currentTarget.currentTime)}
            onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
            onDurationChange={e => setDuration(e.currentTarget.duration || 0)} />
          {/* THE MARKERS: one circle per stamped comment, lit as the playhead reaches it */}
          <div className="relative mx-3 mt-1 h-8" role="group" aria-label="Comments on the timeline">
            <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-foreground/15" />
            {duration > 0 && (
              <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground/60" style={{ left: `${Math.min(100, (now / duration) * 100)}%` }} aria-hidden />
            )}
            {markers.map(m => (
              <button key={m.id} type="button" title={m.stamp} aria-label={`Comment at ${m.stamp}`}
                onClick={() => seek(m.at)}
                className={`absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-transform ${
                  active === m.id ? 'scale-125 border-accent-blue bg-accent-blue text-white shadow' : 'border-foreground bg-surface text-foreground hover:scale-110'
                }`}
                style={{ left: `${m.left}%` }}>
                <span className="sr-only">{m.stamp}</span>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted-foreground">{duration > 0 ? `${formatStamp(now)} / ${formatStamp(duration)}` : 'Loading the clip…'}{markers.length > 0 ? ` · ${markers.length} ${markers.length === 1 ? 'comment' : 'comments'} on the timeline` : ''}</p>
        </section>

        {/* ── the comments, in time order ── */}
        <aside className="flex min-w-0 flex-col rounded-card border border-border bg-card" aria-label="Comments on this clip">
          <div className="flex-1 overflow-y-auto p-3 lg:max-h-[60vh]">
            {comments.length === 0 && <p className="text-[13px] text-muted-foreground">No comments on this clip yet. Pause where you want to say something and write it below — the second is stamped on it.</p>}
            <ul className="flex flex-col gap-2">
              {comments.map(c => (
                <li key={c.id} id={`clip-comment-${c.id}`}
                  className={`rounded-inner border p-3 text-[14px] ${active === c.id ? 'border-accent-blue bg-tint-blue' : 'border-border'}`}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    {typeof c.video_timestamp_sec === 'number' && (
                      <button type="button" onClick={() => seek(c.video_timestamp_sec as number)}
                        className="rounded-full bg-foreground px-2 py-0.5 font-mono text-[12px] font-semibold text-background">
                        {formatStamp(c.video_timestamp_sec)}
                      </button>
                    )}
                    <span className="text-[13px] font-semibold">{nameOf(c.author_id)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2 border-t border-border p-3">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4 accent-foreground" checked={stamp} onChange={e => setStamp(e.target.checked)} />
              Stamp the current second{stamp && duration > 0 ? `: ${formatStamp(now)}` : ''}
            </label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
              placeholder="What needs changing here?"
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send() }}
              className="w-full rounded-inner border border-border bg-surface px-3 py-2 text-[14px] outline-none" />
            <Button disabled={sending || !text.trim()} onClick={() => void send()}
              className="h-11 w-fit rounded-full bg-foreground px-5 text-[14px] font-semibold text-background">
              <Send className="mr-1.5 h-4 w-4" aria-hidden /> {sending ? 'Sending…' : 'Add the comment'}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
