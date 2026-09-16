'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Send } from 'lucide-react'
import type { EditingPortal, EditingPortalComment } from '../../lib/editing-portal'
import type { ClipApproval } from '../../lib/clip-approvals-core'
import { clipApproval, approvedClipsWords } from '../../lib/clip-approvals-core'
import { activeCommentId, commentsOnClip, formatStamp, markersFor } from '../../lib/video-review-core'
import { roundLabel } from '../../lib/edit-round-core'
import HoverClip from '../media/HoverClip'

/**
 * THE EDITING PORTAL (the owner, 16 Sep 2026: "a new look where the videos
 * are on the left and the comment section is on the right — comments only,
 * for the client to log each video; make it look good; no more 'in
 * production' etc. — this is the editing portal").
 *
 * Left: the clip, played here, with a marker under it for every comment on
 * it, and the strip of the other clips. Right: the client's comments on
 * THIS clip in time order, a box that stamps the second, and one Approved
 * button per clip. Approving is a tick the team sees on the card, never a
 * move — the account manager logs the approval or sends it back.
 *
 * Painted from the portal's tokens, so the light/dark toggle on the shell
 * moves the whole page; the player itself stays black in both.
 */
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const input = 'w-full rounded-full border border-border bg-background px-4 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50'

export default function EditingReview({ data }: { data: EditingPortal }) {
  const router = useRouter()
  const { token, item } = data
  // VERSION 1, VERSION 2 (16 Sep 2026): the newest round opens; the pills
  // switch to an earlier one, whose clips keep their own comments and ticks
  const [round, setRound] = useState(data.rounds[0] ?? data.round)
  const clips = useMemo(() => data.clips.filter(c => c.version === round), [data.clips, round])
  const [current, setCurrent] = useState(0)
  useEffect(() => { setCurrent(0) }, [round])
  const clip = clips[current] ?? null
  const [comments, setComments] = useState<EditingPortalComment[]>(data.comments)
  const [approvals, setApprovals] = useState<ClipApproval[]>(data.approvals)
  useEffect(() => { setComments(data.comments) }, [data.comments])
  useEffect(() => { setApprovals(data.approvals) }, [data.approvals])

  const video = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState(0)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [stamp, setStamp] = useState(true)
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { try { setName(localStorage.getItem('mdm-portal-name') ?? '') } catch { /* fine */ } }, [])
  useEffect(() => { setNow(0); setDuration(0) }, [current])

  const onClip = useMemo(() => (clip ? commentsOnClip(comments as never, clip.id) : []) as unknown as EditingPortalComment[], [comments, clip])
  const markers = useMemo(() => markersFor(onClip as never, duration), [onClip, duration])
  const active = activeCommentId(onClip as never, now)
  const approved = clip ? clipApproval(approvals, clip.id) : null
  const approvedWords = approvedClipsWords(clips.filter(c => clipApproval(approvals, c.id)).length, clips.length)

  const seek = (at: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = at
    void v.play().catch(() => { /* a press on the marker is enough */ })
  }

  const send = async () => {
    if (!clip || !draft.trim() || sending) return
    setSending(true); setError(null)
    try { localStorage.setItem('mdm-portal-name', name) } catch { /* fine */ }
    const at = stamp ? Math.floor(video.current?.currentTime ?? 0) : null
    const res = await fetch('/api/portal/comment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token, kind: 'item', id: item.id, author_name: name, body: draft,
        video_file_id: clip.id, video_file_name: clip.name, ...(at !== null ? { video_timestamp_sec: at } : {}),
      }),
    })
    setSending(false)
    if (!res.ok) { setError((await res.json().catch(() => null))?.error ?? 'Could not send — try again'); return }
    setComments(prev => [...prev, {
      id: `local-${Date.now()}`, created_at: new Date().toISOString(), body: draft.trim(),
      author_name: name.trim() || data.client.name, video_file_id: clip.id, video_timestamp_sec: at,
    }])
    setDraft('')
    router.refresh()
  }

  const approve = async (undo: boolean) => {
    if (!clip || approving) return
    setApproving(true); setError(null)
    try { localStorage.setItem('mdm-portal-name', name) } catch { /* fine */ }
    const res = await fetch('/api/portal/clip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, item: item.id, file_id: clip.id, name: clip.name, decision: undo ? 'undo' : 'approve', author_name: name }),
    })
    setApproving(false)
    const json = await res.json().catch(() => null)
    if (!res.ok) { setError(json?.error ?? 'Could not save — try again'); return }
    if (Array.isArray(json?.approvals)) setApprovals(json.approvals)
    router.refresh()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      {/* ── the clip ── */}
      <section className="flex min-w-0 flex-col gap-4" aria-label="The clip">
        {data.rounds.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Versions">
            {data.rounds.map(r => (
              <button key={r} type="button" role="tab" aria-selected={r === round} onClick={() => setRound(r)}
                className={`inline-flex min-h-9 items-center rounded-full border px-4 text-[13px] font-semibold ${r === round ? 'border-foreground bg-foreground text-background' : 'border-border text-foreground hover:border-foreground/50'}`}>
                {roundLabel(r)}{r === data.rounds[0] ? ' · latest' : ''}
              </button>
            ))}
          </div>
        )}
        {clip ? (
          <>
            <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
              <video key={clip.id} ref={video} controls playsInline preload="metadata" src={clip.src}
                className="mx-auto max-h-[68vh] w-full bg-black"
                onTimeUpdate={e => setNow(e.currentTarget.currentTime)}
                onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
                onDurationChange={e => setDuration(e.currentTarget.duration || 0)} />
              {/* the markers: one circle per comment, lit as the playhead reaches it — on the player, so always on black */}
              <div className="relative mx-5 my-4 h-8" role="group" aria-label="Your comments on the timeline">
                <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-white/15" />
                {duration > 0 && (
                  <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white/70" style={{ left: `${Math.min(100, (now / duration) * 100)}%` }} aria-hidden />
                )}
                {markers.map(m => (
                  <button key={m.id} type="button" title={m.stamp} aria-label={`Comment at ${m.stamp}`} onClick={() => seek(m.at)}
                    className={`absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 transition-transform ${
                      active === m.id ? 'scale-125 border-amber-300 bg-amber-300 shadow-[0_0_0_4px_rgba(252,211,77,0.25)]' : 'border-white bg-black hover:scale-110'
                    }`} style={{ left: `${m.left}%` }}>
                    <span className="sr-only">{m.stamp}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-foreground" title={clip.name}>{clip.name}</p>
                <p className="text-[12px] text-muted-foreground" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>
                  {current + 1} / {clips.length}{duration > 0 ? ` · ${formatStamp(now)} / ${formatStamp(duration)}` : ''}
                  {onClip.length > 0 ? ` · ${onClip.length} ${onClip.length === 1 ? 'comment' : 'comments'}` : ''}
                </p>
              </div>
              {approved ? (
                <button type="button" onClick={() => void approve(true)} disabled={approving}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-400 px-5 text-[14px] font-semibold text-black hover:bg-emerald-300 disabled:opacity-60"
                  title={`Approved by ${approved.by}, ${when(approved.at)} — press to take it back`}>
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> Approved
                </button>
              ) : (
                <button type="button" onClick={() => void approve(false)} disabled={approving}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-foreground/30 px-5 text-[14px] font-semibold text-foreground hover:border-foreground hover:bg-foreground/10 disabled:opacity-60">
                  <Check className="h-4 w-4" aria-hidden /> {approving ? 'Saving…' : 'Approve this clip'}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
            <p>{data.folder_note ?? 'Nothing to play yet.'}</p>
            <a href={data.folder.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-foreground/30 px-5 text-[14px] font-semibold text-foreground hover:bg-foreground/10">
              <ExternalLink className="h-4 w-4" aria-hidden /> Open in Drive
            </a>
          </div>
        )}

        {/* ── the other clips ── */}
        {clips.length > 1 && (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5" aria-label="All the clips">
            {clips.map((c, i) => {
              const tick = clipApproval(approvals, c.id)
              const n = commentsOnClip(comments as never, c.id).length
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setCurrent(i)} aria-pressed={i === current} aria-label={`Play ${c.name}`}
                    className={`group flex w-full flex-col gap-1.5 rounded-xl border p-1.5 text-left transition ${i === current ? 'border-amber-300 bg-foreground/10' : 'border-border hover:border-foreground/40'}`}>
                    <span className="relative block aspect-[4/5] w-full overflow-hidden rounded-lg bg-foreground/5">
                      {c.thumb
                        // eslint-disable-next-line @next/next/no-img-element -- Drive's own picture
                        ? <img src={c.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        // the clip's own first frame, from our copy (16 Sep 2026)
                        : <HoverClip src={c.src} className="h-full w-full object-cover" />}
                      {tick && (
                        <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-black" title="Approved">
                          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                        </span>
                      )}
                      {n > 0 && <span className="absolute bottom-1.5 right-1.5 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">{n}</span>}
                    </span>
                    <span className="truncate px-0.5 text-[12px] text-foreground/80" title={c.name}>{c.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {approvedWords && <p className="text-[13px] text-emerald-600 dark:text-emerald-300">{approvedWords}</p>}
      </section>

      {/* ── the comments on this clip ── */}
      <aside className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card" aria-label="Your comments on this clip">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>Your comments</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Pause the clip where you have something to say and write it here — the second is stamped on it. {data.am_name ? `${data.am_name} is told each time.` : 'Your account manager is told each time.'}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 lg:max-h-[52vh]">
          {onClip.length === 0 && <p className="text-[14px] text-muted-foreground">Nothing said on this clip yet.</p>}
          <ul className="flex flex-col gap-2">
            {onClip.map(c => (
              <li key={c.id} className={`rounded-xl border p-3 ${active === c.id ? 'border-amber-300 bg-amber-300/10' : 'border-border'}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  {typeof c.video_timestamp_sec === 'number' && (
                    <button type="button" onClick={() => seek(c.video_timestamp_sec as number)}
                      className="rounded-full bg-foreground px-2 py-0.5 text-[12px] font-semibold text-background" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>
                      {formatStamp(c.video_timestamp_sec)}
                    </button>
                  )}
                  <span className="text-[13px] font-semibold text-foreground">{c.author_name}</span>
                  <span className="text-[12px] text-muted-foreground">{when(c.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[14px] text-foreground/90">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name" className={`h-11 ${input}`} />
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" checked={stamp} onChange={e => setStamp(e.target.checked)} className="h-4 w-4 accent-amber-300" />
            Stamp the current second{stamp && duration > 0 ? `: ${formatStamp(now)}` : ''}
          </label>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder="Your thoughts on this clip — a note at this second, or anything you’d like us to know"
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send() }}
            className={`${input} rounded-2xl py-3`} />
          {error && <p role="alert" className="text-[13px] text-red-500 dark:text-red-300">{error}</p>}
          <button type="button" onClick={() => void send()} disabled={!clip || sending || !draft.trim()}
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50">
            <Send className="h-4 w-4" aria-hidden /> {sending ? 'Sending…' : 'Add the comment'}
          </button>
        </div>
      </aside>
    </div>
  )
}
