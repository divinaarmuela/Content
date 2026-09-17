'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow, useTable } from '@/lib/db-client'
import type { Batch, ContentItem, DrivePull, ItemComment, TeamUser } from '@/lib/db-types'
import { driveTargetOf } from '../../../../../lib/card-link-core'
import { filesOf, pullId } from '../../../../../lib/drive-pull-core'
import { kindOf } from '../../../../../lib/files-core'
import { finalFilesAsPulls } from '../../../../../lib/final-files-core'
import { usePreviewRows } from '../../../../../components/media/usePreviewRows'
import { hlsManifestUrl, useHlsSource } from '../../../../../components/media/useHlsSource'
import { pickPoster, streamBaseUrl } from '../../../../../lib/stream-core'
import { DEFAULT_TZ, formatInZone } from '../../../../../lib/timezone-core'
import PageTitle from '../../../../ui/PageTitle'
import { personLabel } from '../../../../../lib/identity-core'
import { clipApproval, clipApprovalsOf } from '../../../../../lib/clip-approvals-core'
import {
  activeCommentId, clipPlace, clipPlaceWords, commentsOnClip, formatStamp, markersFor, reviewPath,
} from '../../../../../lib/video-review-core'
import Chip from '../../../../ui/Chip'

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
  // OUR COPY FIRST (the Drive pull, 16 Sep 2026: "click the file, it opens
  // the page as it is — quicker, because we downloaded it in the backend"):
  // the clip plays from our storage when the folder it sits in has been
  // pulled — the finished edit, the source working folder, or the shoot's
  // footage folder — and through Drive otherwise
  // …EVERY pull this card ever asked for, not only the links it carries
  // today (the owner, 16 Sep 2026: "this video is not getting played — this
  // is version 1": the editor had since pointed the card at a new link, so
  // version 1's copy was no longer looked for and the page fell back to a
  // private Drive file)
  const { row: shootRow } = useRow<Batch>('batches', item?.batch_id ?? null)
  const { rows: cardPulls } = useTable<DrivePull>('drive_pulls', { by: { scope_id: id } as never })
  const footageId = driveTargetOf(shootRow?.footage_url)?.id ?? null
  const { row: footagePull } = useRow<DrivePull>('drive_pulls', footageId ? pullId(footageId) : null)
  const copyUrl = [...[...cardPulls, footagePull].flatMap(p => filesOf(p)), ...finalFilesAsPulls(item ?? {})].find(f => f.id === fileId && f.status === 'done' && f.url)?.url ?? null
  // WHICH VERSION, AND THE CLIPS EITHER SIDE (17 Sep 2026): the finished
  // files of the card, each with its round, and the folder's files without one
  const place = useMemo(() => {
    const finished = [...cardPulls.filter(p => p.purpose === 'finished').flatMap(p => filesOf(p)), ...finalFilesAsPulls(item ?? {})]
      .filter(f => f.status === 'done' && !!f.url).map(f => ({ id: f.id, name: f.name, version: f.version ?? null, finished: true }))
    const folder = [...cardPulls.filter(p => p.purpose !== 'finished'), footagePull].flatMap(p => filesOf(p))
      .map(f => ({ id: f.id, name: f.name, version: null, finished: false }))
    return clipPlace([...finished, ...folder], fileId)
  }, [cardPulls, footagePull, item, fileId])
  const go = (to: { id: string; name: string } | null) => { if (to) router.push(reviewPath(id, to.id, to.name)) }
  // a fresh clip: the playhead, the timing and the half-typed comment start again
  useEffect(() => { setNow(0); setDuration(0); setText('') }, [fileId])
  // the arrow keys step through the version, unless somebody is typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowRight') go(place?.next ?? null)
      if (e.key === 'ArrowLeft') go(place?.prev ?? null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [place]) // eslint-disable-line react-hooks/exhaustive-deps -- go reads only the router and the id
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: allComments } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  const nameOf = (uid: string | null | undefined) => {
    const u = team.find(t => t.id === uid)
    return u ? personLabel(u.name, u.email) : 'Someone'
  }
  // THE CLIENT'S OWN WORDS (the editing portal, 16 Sep 2026): a comment the
  // client left on their portal sits on the same timeline, marked as theirs
  const fromClient = (uid: string | null | undefined) => team.find(t => t.id === uid)?.role === 'client'
  const approved = item ? clipApproval(clipApprovalsOf(item), fileId) : null

  const video = useRef<HTMLVideoElement>(null)
  // A PICTURE HAS THE SAME PAGE (the owner, 16 Sep 2026: "this page is an
  // image, but when opened it's not opening the page to put the comments,
  // like the videos"): the still large on the left, the comments on the
  // right, no timeline and no second to stamp
  const isImage = kindOf('', name) === 'image'
  const fileSrc = copyUrl ?? `/api/drive/stream?id=${encodeURIComponent(fileId)}&name=${encodeURIComponent(name)}`
  // the Stream preview of our copy when there is one — a phone plays it; the master it will not (16 Sep 2026)
  const previews = usePreviewRows(copyUrl ? [copyUrl] : [])
  const preview = copyUrl ? previews.get(copyUrl) : null
  const streamBase = preview && preview.state === 'ready' ? streamBaseUrl(preview) : null
  useHlsSource(video, isImage ? null : streamBase ? hlsManifestUrl(streamBase) : (copyUrl ?? `/api/drive/stream?id=${encodeURIComponent(fileId)}&name=${encodeURIComponent(name)}`))
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState(0)
  const [text, setText] = useState('')
  const [stamp, setStamp] = useState(true)
  const [sending, setSending] = useState(false)
  // A CLEAN SWITCH BETWEEN CLIPS (the owner, 17 Sep 2026: "the animation from
  // one asset to another is not clean — the asset loads weirdly"): the stage
  // keeps one size whatever is in it, the next clip's own still stands in
  // while it loads, and the clip fades in once it can show a frame. Nothing
  // jumps, nothing flashes white.
  const [ready, setReady] = useState(false)
  const poster = pickPoster(preview, null)
  useEffect(() => {
    setReady(false)
    // a master the browser only reads the header of never says "loaded" until
    // it plays — after a moment the clip is shown as it is
    const t = window.setTimeout(() => setReady(true), 2500)
    return () => window.clearTimeout(t)
  }, [fileId])

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
      const at = stamp && !isImage ? Math.floor(video.current?.currentTime ?? 0) : null
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
      <PageTitle title={name} summary={`${isImage ? `A picture on ${item.title}.` : `A clip on ${item.title}. Press a circle under the clip to jump to that comment.`}${approved ? ` Approved by the client (${approved.by}).` : ''}`} />
      {/* THE VERSION AND THE ARROWS (17 Sep 2026): which version this is, where it sits, and the clip either side — the comments on the right follow */}
      {place && (
        <div className="flex flex-wrap items-center gap-2" data-clip-place>
          <Chip tone="ink">{clipPlaceWords(place)}</Chip>
          {place.count > 1 && (
            <div className="inline-flex items-center gap-1">
              <Button variant="outline" className="h-10 w-10 rounded-full p-0" disabled={!place.prev} onClick={() => go(place.prev)} aria-label={place.prev ? `Previous: ${place.prev.name}` : 'This is the first'}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" className="h-10 w-10 rounded-full p-0" disabled={!place.next} onClick={() => go(place.next)} aria-label={place.next ? `Next: ${place.next.name}` : 'This is the last'}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <span className="ml-1 text-[12px] text-muted-foreground">← → on the keyboard too</span>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
        {/* ── the clip, and the markers under it ── */}
        <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-3" aria-label={isImage ? 'The picture' : 'The clip'}>
          {/* THE STAGE: one size, the next clip's still while it loads, a fade in (17 Sep 2026) */}
          <div className="relative w-full overflow-hidden rounded-tile bg-black" style={{ aspectRatio: '16 / 9', maxHeight: '70vh' }} data-clip-stage>
            {poster && !ready && (
              // eslint-disable-next-line @next/next/no-img-element -- the clip's own still, from Stream
              <img src={poster} alt="" aria-hidden className="absolute inset-0 h-full w-full object-contain opacity-70" />
            )}
            {!ready && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-1 text-[12px] font-semibold text-white" role="status">Loading…</span>}
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- the file itself
              <img key={fileId} src={fileSrc} alt={name} onLoad={() => setReady(true)}
                className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`} />
            ) : (
              <video key={fileId} ref={video} controls playsInline preload="metadata" poster={poster ?? undefined}
                className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
                onLoadedData={() => setReady(true)}
                onCanPlay={() => setReady(true)}
                onTimeUpdate={e => setNow(e.currentTarget.currentTime)}
                onLoadedMetadata={e => { setDuration(e.currentTarget.duration || 0); setReady(true) }}
                onDurationChange={e => setDuration(e.currentTarget.duration || 0)} />
            )}
          </div>
          {/* THE MARKERS: one circle per stamped comment, lit as the playhead reaches it */}
          {!isImage && (
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
          )}
          <p className="text-[12px] text-muted-foreground">{isImage ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'} on this picture` : duration > 0 ? `${formatStamp(now)} / ${formatStamp(duration)}` : 'Loading the clip…'}{!isImage && markers.length > 0 ? ` · ${markers.length} ${markers.length === 1 ? 'comment' : 'comments'} on the timeline` : ''}</p>
        </section>

        {/* ── the comments, in time order ── */}
        <aside className="flex min-w-0 flex-col rounded-card border border-border bg-card" aria-label="Comments on this clip">
          <div className="flex-1 overflow-y-auto p-3 lg:max-h-[60vh]">
            {comments.length === 0 && <p className="text-[13px] text-muted-foreground">{isImage ? 'No comments on this picture yet. Write what needs changing below.' : 'No comments on this clip yet. Pause where you want to say something and write it below — the second is stamped on it.'}</p>}
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
                    {fromClient(c.author_id) && <span className="rounded-full bg-accent-blue px-2 py-0.5 text-[11px] font-semibold text-white">Client</span>}
                    {/* WHEN IT WAS SAID (the owner, 17 Sep 2026: "add the date alongside the timestamped comments") — the team's and the client's alike */}
                    {c.created_at && <span className="text-[12px] text-muted-foreground">{formatInZone(String(c.created_at), DEFAULT_TZ, 'full') ?? ''}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2 border-t border-border p-3">
            {!isImage && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4 accent-foreground" checked={stamp} onChange={e => setStamp(e.target.checked)} />
              Stamp the current second{stamp && duration > 0 ? `: ${formatStamp(now)}` : ''}
            </label>
            )}
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
