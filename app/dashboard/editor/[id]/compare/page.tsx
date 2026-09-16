'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow, useTable } from '@/lib/db-client'
import type { Batch, ContentItem, DrivePull, ItemComment, TeamUser } from '@/lib/db-types'
import { driveTargetOf } from '../../../../lib/card-link-core'
import { filesOf, pullId, type PullFile } from '../../../../lib/drive-pull-core'
import { fileRound, roundLabel } from '../../../../lib/edit-round-core'
import { kindOf } from '../../../../lib/files-core'
import { usePreviewRows } from '../../../../components/media/usePreviewRows'
import { hlsManifestUrl, useHlsSource } from '../../../../components/media/useHlsSource'
import { streamBaseUrl } from '../../../../lib/stream-core'
import PageTitle from '../../../ui/PageTitle'
import { personLabel } from '../../../../lib/identity-core'
import { commentsOnClip, formatStamp, reviewPath } from '../../../../lib/video-review-core'
import { canReadClientComments, visibleComments } from '../../../../lib/comment-access-core'
import { useRole } from '../../../useRole'
import type { Role } from '../../../../lib/identity-core'

/**
 * SIDE BY SIDE (the owner, 16 Sep 2026: "a new feature called select view
 * where I can choose videos, as many as I want, taking up the entire page,
 * evenly across both sides — 2, and +2 more would be possible too — where
 * I can see the video and the comments between all the versions").
 *
 * The card page's Select mode picks the files — from the folder to work
 * from and from any version tab — and this page lays them out two across,
 * wrapping onto new rows, videos and pictures alike. Each has its own
 * player, its version, its comments in time order, and a box to add one.
 * The address carries the picks (`?f=<fileId>@<round>,…`), so the view can
 * be sent to somebody.
 */
export function parsePicks(f: string | null): { id: string; round: number | null }[] {
  return String(f ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [id, r] = s.split('@')
    const round = Number(r)
    return { id, round: Number.isFinite(round) && round >= 1 ? round : null }
  })
}

function ClipPanel({ itemId, file, src, streamBase, comments, nameOf, fromClient, one }: {
  itemId: string
  file: PullFile
  src: string | null
  streamBase: string | null
  comments: ItemComment[]
  nameOf: (uid: string | null | undefined) => string
  fromClient: (uid: string | null | undefined) => boolean
  one: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const isImage = kindOf(file.mime, file.name) === 'image'
  useHlsSource(video as RefObject<HTMLVideoElement | null>, isImage ? null : streamBase ? hlsManifestUrl(streamBase) : src)
  const [now, setNow] = useState(0)
  const [text, setText] = useState('')
  const [stamp, setStamp] = useState(true)
  const [sending, setSending] = useState(false)
  const seek = (at: number) => { const v = video.current; if (!v) return; v.currentTime = at; void v.play().catch(() => undefined) }
  const send = async () => {
    const body = text.trim()
    if (!body) return
    setSending(true)
    try {
      const at = stamp && !isImage ? Math.floor(video.current?.currentTime ?? 0) : null
      const res = await fetch(`/api/production/items/${itemId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, video_file_id: file.id, video_file_name: file.name, ...(at !== null ? { video_timestamp_sec: at } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not send')
      setText('')
      toast.success(at !== null ? `Noted at ${formatStamp(at)}` : 'Noted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send')
    } finally { setSending(false) }
  }
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-3" aria-label={file.name} data-clip-panel>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={file.name}>{file.name}</span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[12px] font-semibold">{roundLabel(fileRound(file))}</span>
        <Link href={reviewPath(itemId, file.id, file.name)} className="text-[12px] text-muted-foreground underline-offset-4 hover:underline">Open on its own</Link>
      </div>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- the file itself
        <img src={src ?? ''} alt={file.name} className={`w-full rounded-tile bg-foreground/[0.06] object-contain ${one ? 'max-h-[70vh]' : 'max-h-[52vh]'}`} />
      ) : (
        <video ref={video} controls playsInline preload="metadata"
          className={`w-full rounded-tile bg-black ${one ? 'max-h-[70vh]' : 'max-h-[52vh]'}`}
          onTimeUpdate={e => setNow(e.currentTarget.currentTime)} />
      )}
      <p className="text-[12px] text-muted-foreground">{isImage ? '' : `${formatStamp(now)} · `}{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</p>
      <ul className="flex max-h-[30vh] flex-col gap-1.5 overflow-y-auto">
        {comments.length === 0 && <li className="text-[13px] text-muted-foreground">Nothing said on this one yet.</li>}
        {comments.map(c => (
          <li key={c.id} className="rounded-inner border border-border p-2 text-[13px]">
            <div className="flex flex-wrap items-baseline gap-2">
              {typeof c.video_timestamp_sec === 'number' && !isImage && (
                <button type="button" onClick={() => seek(c.video_timestamp_sec as number)} className="rounded-full bg-foreground px-2 py-0.5 font-mono text-[11px] font-semibold text-background">{formatStamp(c.video_timestamp_sec)}</button>
              )}
              <span className="font-semibold">{nameOf(c.author_id)}</span>
              {fromClient(c.author_id) && <span className="rounded-full bg-accent-blue px-2 py-0.5 text-[11px] font-semibold text-white">Client</span>}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        {!isImage && (
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" className="h-4 w-4 accent-foreground" checked={stamp} onChange={e => setStamp(e.target.checked)} />
            Stamp the current second{stamp ? `: ${formatStamp(now)}` : ''}
          </label>
        )}
        <div className="flex gap-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="What needs changing here?"
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send() }}
            className="min-w-0 flex-1 rounded-inner border border-border bg-surface px-3 py-2 text-[13px] outline-none" />
          <Button disabled={sending || !text.trim()} onClick={() => void send()} aria-label="Add the comment"
            className="h-11 w-11 shrink-0 rounded-full bg-foreground p-0 text-background">
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  )
}

export default function ComparePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const search = useSearchParams()
  const picks = useMemo(() => parsePicks(search.get('f')), [search])
  const { row: item, loading } = useRow<ContentItem>('content_items', id)
  const { row: shootRow } = useRow<Batch>('batches', item?.batch_id ?? null)
  const { rows: cardPulls } = useTable<DrivePull>('drive_pulls', { by: { scope_id: id } as never })
  const footageId = driveTargetOf(shootRow?.footage_url)?.id ?? null
  const { row: footagePull } = useRow<DrivePull>('drive_pulls', footageId ? pullId(footageId) : null)
  const files = useMemo(() => [...cardPulls, footagePull].flatMap(p => filesOf(p)).filter(f => f.status === 'done' && !!f.url), [cardPulls, footagePull])
  // each pick: the file at that round, or the newest copy of it
  const chosen = useMemo(() => picks.map(p => {
    const same = files.filter(f => f.id === p.id)
    return (p.round !== null ? same.find(f => fileRound(f) === p.round) : null) ?? [...same].sort((a, b) => fileRound(b) - fileRound(a))[0] ?? null
  }).filter((f): f is PullFile => f !== null), [picks, files])
  const previews = usePreviewRows(chosen.map(f => f.url as string))
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: allComments } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  const { me } = useRole()
  const nameOf = (uid: string | null | undefined) => { const u = team.find(t => t.id === uid); return u ? personLabel(u.name, u.email) : 'Someone' }
  const fromClient = (uid: string | null | undefined) => team.find(t => t.id === uid)?.role === 'client'
  const visible = useMemo(() => me
    ? visibleComments(me.role as Role, me.id, allComments.map(c => ({ ...c, visibility: String(c.visibility ?? 'internal'), assigned_to: c.assigned_to ?? null, parent_id: c.parent_id ?? null })) as never) as unknown as ItemComment[]
    : [], [allComments, me])
  void canReadClientComments

  if (loading) return <div className="flex flex-col gap-4"><Skeleton className="h-6 w-40" /><Skeleton className="h-64 w-full" /></div>
  if (!item) return <div className="flex flex-col gap-4"><PageTitle title="Card not found" summary="It may have been deleted, or the link is not quite right." /></div>
  const one = chosen.length === 1
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={() => router.push(`/dashboard/editor/${id}`)}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {item.title}
      </button>
      <PageTitle title={`${item.title} — side by side`} summary={chosen.length > 0 ? `${chosen.length} ${chosen.length === 1 ? 'file' : 'files'} from the card, each with its comments. Pick more from the card's Select mode.` : 'Nothing picked yet. Go back to the card, press Select, tick the files and press Open side by side.'} />
      <div className={`grid gap-4 ${one ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`} data-compare-grid>
        {chosen.map(f => {
          const p = previews.get(f.url as string)
          const base = p && p.state === 'ready' ? streamBaseUrl(p) : null
          return <ClipPanel key={`${f.id}@${fileRound(f)}`} itemId={id} file={f} src={f.url} streamBase={base} comments={commentsOnClip(visible as never, f.id) as ItemComment[]} nameOf={nameOf} fromClient={fromClient} one={one} />
        })}
      </div>
    </div>
  )
}
