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
import { hlsManifestUrl, useHlsSource } from '../media/useHlsSource'
import { assetLine, changedAtRound, clipsAtRound, pieceWords } from '../../lib/editing-portal-core'

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
  new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const input = 'w-full rounded-full border border-border bg-background px-4 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50'

export default function EditingReview({ data, approved: clientApproved = false }: {
  data: EditingPortal
  /** the one portal: the client approved the newest version; the card's own stage (back with the team for
   *  posting) is not "making changes" to them (2 Oct 2026, the phone walk) */
  approved?: boolean
}) {
  const router = useRouter()
  const { token, item } = data
  // VERSION 1, VERSION 2 (16 Sep 2026): the newest round opens; the pills
  // switch to an earlier one, whose clips keep their own comments and ticks
  const [round, setRound] = useState(data.rounds[0] ?? data.round)
  // THE CARD AS IT STOOD AT THAT VERSION (22 Sep 2026; editing-portal-core.ts): the ones that were fine carried
  // forward, the one that was replaced in its new version
  const clips = useMemo(() => clipsAtRound(data.clips, round), [data.clips, round])
  // designs, clips or files — a designer's carousel is not "clips" (28 Sep 2026)
  const words = useMemo(() => pieceWords(data.clips.map(c => c.kind)), [data.clips])
  const [current, setCurrent] = useState(0)
  useEffect(() => { setCurrent(0) }, [round])
  const newest = clips[current] ?? null
  // THE OLD VERSION, WITH ITS COMMENTS, BESIDE THE NEW ONE: a replaced piece has tabs; the comments shown are the
  // ones written on the version being looked at, at the moments they were written about
  const line = useMemo(() => (newest ? assetLine(data.clips, newest) : []), [data.clips, newest])
  const [olderId, setOlderId] = useState<string | null>(null)
  useEffect(() => { setOlderId(null) }, [current, round])
  const clip = (olderId ? line.find(c => c.id === olderId) : null) ?? newest
  const lookingBack = !!clip && !!newest && clip.id !== newest.id
  const [comments, setComments] = useState<EditingPortalComment[]>(data.comments)
  const [approvals, setApprovals] = useState<ClipApproval[]>(data.approvals)
  useEffect(() => { setComments(data.comments) }, [data.comments])
  useEffect(() => { setApprovals(data.approvals) }, [data.approvals])

  const video = useRef<HTMLVideoElement>(null)
  // the Stream preview when there is one — a phone plays it; the master it will not (16 Sep 2026)
  const isImage = clip?.kind === 'image'
  useHlsSource(video, clip && !isImage ? (clip.stream ? hlsManifestUrl(clip.stream.base) : clip.src) : null)
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState(0)
  const [name, setName] = useState('')
  // the box beside Approve stays while it is being typed in — it used to unmount after the first letter (E2E walk, 22 Sep 2026)
  const [nameTyping, setNameTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [stamp, setStamp] = useState(true)
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // THE CLIENT'S ANSWER ON THE WHOLE PIECE lives here too (the owner, 30 Sep 2026): the email opens this page, so
  // "Ask for a change" and the approval of the version are here, beside the clips — the same /api/portal/act
  const [asking, setAsking] = useState(false)
  const [changeNote, setChangeNote] = useState('')
  const [answered, setAnswered] = useState<'approved' | 'changes' | null>(null)
  useEffect(() => { try { setName(localStorage.getItem('mdm-portal-name') ?? '') } catch { /* fine */ } }, [])
  useEffect(() => { setNow(0); setDuration(0) }, [current])

  const onClip = useMemo(() => (clip ? commentsOnClip(comments as never, clip.id) : []) as unknown as EditingPortalComment[], [comments, clip])
  const markers = useMemo(() => markersFor(onClip as never, duration), [onClip, duration])
  const onPiece = useMemo(() => comments.filter(c => !c.video_file_id), [comments])
  const active = activeCommentId(onClip as never, now)
  const approved = clip ? clipApproval(approvals, clip.id) : null
  const approvedWords = approvedClipsWords(clips.filter(c => clipApproval(approvals, c.id)).length, clips.length, words)

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
    // a picture has no second to stamp (1 Oct 2026, the designer walk: a design's comment read "0:00")
    const at = stamp && !isImage ? Math.floor(video.current?.currentTime ?? 0) : null
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

  // APPROVE THE WHOLE VERSION (the owner, 30 Sep 2026): every piece of the version shown, one tick each through the
  // same per-piece approval — nothing else changes, and every earlier version stays as it was
  const unapproved = clips.filter(c => !clipApproval(approvals, c.id))
  // only the LATEST version is approved; an earlier one is there to look back at, with what was said on it
  const latest = round === (data.rounds[0] ?? data.round)
  // with the client now: their answer moves the piece (the same rule as the server's portalActions)
  const decides = item.status === 'client_review' && latest && !answered
  const actOnPiece = async (action: 'approve' | 'request_changes', comment = '') => {
    const res = await fetch('/api/portal/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, item_id: item.id, action, comment, author_name: name.trim().slice(0, 60) }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(String(json?.error ?? 'That did not go through — try again in a moment'))
  }
  const askForChange = async () => {
    if (sending || !changeNote.trim()) return
    setSending(true); setError(null)
    try { localStorage.setItem('mdm-portal-name', name) } catch { /* fine */ }
    try { await actOnPiece('request_changes', changeNote.trim()); setAnswered('changes'); setAsking(false); router.refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not go through — try again in a moment') }
    setSending(false)
  }
  const approveAll = async () => {
    if (approving || !name.trim() || (unapproved.length === 0 && !decides)) return
    setApproving(true); setError(null)
    try { localStorage.setItem('mdm-portal-name', name) } catch { /* fine */ }
    for (const [i, c] of unapproved.entries()) {
      // one email for the whole press: quiet ticks, then one summary on the last — or none when the piece's own
      // approval below tells the manager (1 Oct 2026)
      const last = i === unapproved.length - 1
      const res = await fetch('/api/portal/clip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, item: item.id, file_id: c.id, name: c.name, decision: 'approve', author_name: name,
          quiet: decides || !last, ...(last && !decides ? { summary_of: unapproved.length } : {}) }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? `Could not approve ${c.name} — try again`); break }
      if (Array.isArray(json?.approvals)) setApprovals(json.approvals)
    }
    // …and, with the client now, the piece itself is approved — what the old page's Approve did
    if (decides) {
      try { await actOnPiece('approve'); setAnswered('approved') }
      catch (e) { setError(e instanceof Error ? e.message : 'That did not go through — try again in a moment') }
    }
    setApproving(false)
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
        {/* the count follows the version chosen (22 Sep 2026) */}
        {data.rounds.length <= 1 && clips.length > 0 && <p className="text-[12px] text-muted-foreground">{clips.length} {clips.length === 1 ? words.one : words.many}</p>}
        {data.rounds.length > 1 && (
          <div className="flex w-full max-w-full items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none]" role="tablist" aria-label="Versions of the whole set">
            <span className="shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">The whole set</span>
            {data.rounds.map(r => (
              <button key={r} type="button" role="tab" aria-selected={r === round} onClick={() => setRound(r)}
                className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold ${r === round ? 'border-foreground bg-foreground text-background' : 'border-border text-foreground hover:border-foreground/50'}`}>
                {r === data.rounds[0] ? `Latest — ${roundLabel(r)}` : `Earlier — ${roundLabel(r)}`}
              </button>
            ))}
            <span className="shrink-0 text-[12px] text-muted-foreground">{clips.length} {clips.length === 1 ? words.one : words.many}</span>
          </div>
        )}
        {!data.can_approve && !clientApproved && (
          <p role="status" className="rounded-xl border border-border bg-card p-3 text-[14px]">
            <span className="font-semibold">The team is making changes. </span>
            This is the version you were sent, with everything you said on it. You can still comment, approve a clip or take an approval back; the new cut will appear here, on this same link, when it is ready for you.
          </p>
        )}
        {line.length > 1 && (
          <div className="flex w-full max-w-full items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none]" role="tablist" aria-label="Versions of this piece">
            <span className="shrink-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">This {words.one}</span>
            {line.map(v => (
              <button key={v.id} type="button" role="tab" aria-selected={v.id === clip?.id} onClick={() => setOlderId(v.id === newest?.id ? null : v.id)}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold ${v.id === clip?.id ? 'border-amber-300 bg-amber-300 text-black' : 'border-border text-foreground hover:border-foreground/50'}`}>
                {/* a design is not a cut (1 Oct 2026) */}{v === line[0] ? `${isImage ? 'Newest' : 'Newest cut'} — ${roundLabel(v.version)}` : `${isImage ? 'Earlier' : 'Earlier cut'} — ${roundLabel(v.version)}`}
                {commentsOnClip(comments as never, v.id).length > 0 && <span className="rounded-full bg-black/15 px-1.5 text-[11px]">{commentsOnClip(comments as never, v.id).length}</span>}
              </button>
            ))}
            {lookingBack && <span className="shrink-0 text-[12px] text-muted-foreground">An earlier cut, with what was said on it.</span>}
          </div>
        )}
        {clip ? (
          <>
            <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- the picture handed in
                <img key={clip.id} src={clip.src} alt={clip.name} className="mx-auto max-h-[68vh] w-full bg-black object-contain" />
              ) : (
              <video key={clip.id} ref={video} controls playsInline preload="metadata"
                className="mx-auto max-h-[68vh] w-full bg-black"
                onTimeUpdate={e => setNow(e.currentTarget.currentTime)}
                onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
                onDurationChange={e => setDuration(e.currentTarget.duration || 0)} />
              )}
              {/* the markers: one circle per comment, lit as the playhead reaches it — on the player, so always on black.
                  None under a picture: it has no timeline (1 Oct 2026) */}
              {!isImage && <div className="relative mx-5 my-4 h-8" role="group" aria-label="Your comments on the timeline">
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
              </div>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-foreground" title={clip.name}>{clip.name}</p>
                {/* the whole set at this version (30 Sep 2026): what changed in it, what was carried as it was */}
                {data.rounds.length > 1 && !lookingBack && round !== data.rounds[data.rounds.length - 1] && (
                  <p data-version-mark className="text-[12px] font-semibold text-muted-foreground">{changedAtRound(clip, round) ? `New in ${roundLabel(round)}` : `Unchanged since ${roundLabel(clip.version)}`}</p>
                )}
                <p className="text-[12px] text-muted-foreground" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>
                  {current + 1} / {clips.length}{duration > 0 ? ` · ${formatStamp(now)} / ${formatStamp(duration)}` : ''}
                  {onClip.length > 0 ? ` · ${onClip.length} ${onClip.length === 1 ? 'comment' : 'comments'}` : ''}
                </p>
              </div>
              {/* an earlier version or an earlier cut is looked at, not approved — the approval is on the latest */}
              {(!latest || lookingBack) ? null : approved ? (
                <button type="button" onClick={() => void approve(true)} disabled={approving}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-400 px-5 text-[14px] font-semibold text-black hover:bg-emerald-300 disabled:opacity-60"
                  title={`Approved by ${approved.by}, ${when(approved.at)} — press to take it back`}>
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> Approved
                </button>
              ) : (
                // signed, or not at all (16 Sep 2026): the tick carries a name. The name box used to be only in
                // the comments panel, so the button read "Add your name to approve" and looked missing (the owner,
                // 22 Sep 2026: "where is the approve button"). It is here now, beside the button, the same name.
                <span className="flex flex-wrap items-center gap-2">
                  {(!name.trim() || nameTyping) && (
                    <input value={name} onChange={e => setName(e.target.value)} onFocus={() => setNameTyping(true)} onBlur={() => setNameTyping(false)} placeholder="Your name, to approve" aria-label="Your name, to approve"
                      className="h-11 w-44 rounded-full border border-border bg-background px-4 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50" />
                  )}
                  <button type="button" onClick={() => void approve(false)} disabled={approving || !name.trim()}
                    title={name.trim() ? undefined : 'Type your name first — the approval carries it'}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-foreground/30 px-5 text-[14px] font-semibold text-foreground hover:border-foreground hover:bg-foreground/10 disabled:opacity-60">
                    <Check className="h-4 w-4" aria-hidden /> {approving ? 'Saving…' : `Approve this ${words.one}`}
                  </button>
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
            <p>{data.folder_note ?? 'Nothing to play yet.'}</p>
          </div>
        )}

        {/* ── the other clips ── */}
        {clips.length > 1 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="All the clips">
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
                        : <HoverClip src={c.src} className="h-full w-full object-cover"
                            poster={c.stream ? `${c.stream.base}/thumbnails/thumbnail.jpg?time=1s&height=480` : null} duration={c.stream?.duration ?? null}
                            frames={c.stream ? (s => `${c.stream!.base}/thumbnails/thumbnail.jpg?time=${s}s&height=480`) : null} />}
                      {tick && (
                        <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-black" title="Approved">
                          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                        </span>
                      )}
                      {n > 0 && <span className="absolute bottom-1.5 right-1.5 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">{n}</span>}
                    </span>
                    <span className="truncate px-0.5 text-[12px] text-foreground/80" title={c.name}>{c.name}</span>
                    {data.rounds.length > 1 && round !== data.rounds[data.rounds.length - 1] && <span className="px-0.5 text-[11px] text-muted-foreground">{changedAtRound(c, round) ? `New in ${roundLabel(round)}` : 'Unchanged'}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {approvedWords && <p className="text-[13px] text-emerald-600 dark:text-emerald-300">{approvedWords}</p>}
        {answered && (
          <p role="status" className="rounded-xl border border-border bg-card p-3 text-[14px]">
            <span className="font-semibold">{answered === 'approved' ? 'Approved — thank you. ' : 'Thanks — we have your note. '}</span>
            {answered === 'approved' ? 'The team takes it from here.' : 'We’ll make the change and send the new version here, on this same link.'}
          </p>
        )}
        {/* only while the piece waits on them: once they have answered (or the team has it back), approving the
            whole set beside a note asking for changes would say two things */}
        {decides && (
          <div className="flex flex-wrap items-center gap-2">
            {/* the approval carries a name: the box is here, beside the button, not only in the comments panel
                (30 Sep 2026, the walk: the button looked greyed out for no reason) */}
            {(!name.trim() || nameTyping) && (
              <input value={name} onChange={e => setName(e.target.value)} onFocus={() => setNameTyping(true)} onBlur={() => setNameTyping(false)} placeholder="Your name, to approve" aria-label="Your name, to approve"
                className="h-11 w-44 rounded-full border border-border bg-background px-4 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50" />
            )}
            <button type="button" onClick={() => void approveAll()} disabled={approving || !name.trim()}
              title={name.trim() ? undefined : 'Type your name first — the approval carries it'}
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-foreground/30 px-5 text-[14px] font-semibold text-foreground hover:border-foreground hover:bg-foreground/10 disabled:opacity-60">
              <Check className="h-4 w-4" aria-hidden /> {approving ? 'Saving…' : decides ? `Approve ${roundLabel(round)} — all ${clips.length} ${clips.length === 1 ? words.one : words.many}` : `Approve all ${clips.length} ${words.many} in ${roundLabel(round)}`}
            </button>
            {decides && !asking && (
              <button type="button" onClick={() => { setAsking(true); setError(null) }}
                className="inline-flex min-h-11 w-fit items-center rounded-full border border-border px-5 text-[14px] font-semibold hover:bg-muted">
                Ask for a change
              </button>
            )}
          </div>
        )}
        {decides && asking && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <label className="flex flex-col gap-1 text-[13px] font-medium text-muted-foreground">
              What should we change? A note on one {words.one} can also go in the comments beside it.
              <textarea autoFocus rows={3} value={changeNote} maxLength={2000} onChange={e => setChangeNote(e.target.value)}
                className={`${input} rounded-2xl py-3`} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void askForChange()} disabled={sending || !changeNote.trim()}
                className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-50">
                {sending ? 'Sending…' : 'Send my note'}
              </button>
              <button type="button" onClick={() => setAsking(false)} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-[14px] font-semibold hover:bg-muted">Back</button>
            </div>
          </div>
        )}
      </section>

      {/* ── the comments on this clip ── */}
      <aside className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card" aria-label="Your comments on this clip">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>Your comments</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{clip?.kind === 'image' ? 'Write what you’d like changed on this design.' : 'Pause the clip where you have something to say and write it here — the second is stamped on it.'} {data.am_name ? `${data.am_name} is told each time.` : 'Your account manager is told each time.'}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 lg:max-h-[52vh]">
          {onClip.length === 0 && <p className="text-[14px] text-muted-foreground">Nothing said on this {words.one} yet.</p>}
          {/* NOTES ON THE WHOLE PIECE (30 Sep 2026, the walk): what was said about the piece, not one clip — "Ask for a
              change", and notes written before this page was the client's — showed nowhere here */}
          {onPiece.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>On the whole piece</p>
              <ul className="flex flex-col gap-2">
                {onPiece.map(c => (
                  <li key={c.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{c.author_name}</span>
                      <span className="text-[12px] text-muted-foreground">{when(c.created_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[14px] text-foreground/90">{c.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {onClip.map(c => (
              <li key={c.id} className={`rounded-xl border p-3 ${active === c.id ? 'border-amber-300 bg-amber-300/10' : 'border-border'}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  {typeof c.video_timestamp_sec === 'number' && !isImage && (
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
          {!isImage && (
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" checked={stamp} onChange={e => setStamp(e.target.checked)} className="h-4 w-4 accent-amber-300" />
            Stamp the current second{stamp && duration > 0 ? `: ${formatStamp(now)}` : ''}
          </label>
          )}
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder={clip?.kind === 'image' ? 'Your thoughts on this design — anything you’d like us to change' : 'Your thoughts on this clip — a note at this second, or anything you’d like us to know'}
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
