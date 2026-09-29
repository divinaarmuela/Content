'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, MessageCircle, MessageSquare } from 'lucide-react'
import SlideCarousel from '../media/SlideCarousel'
import PostPreviewPane from '../social/PostPreview'
import type { PortalPostPage } from '../../lib/portal-thread'
import { notesOnFile, type PortalPostNote } from '../../lib/portal-core'

const NAME_KEY = 'mdm-portal-name'

/**
 * ONE POST, FOR THE CLIENT (the posting rebuild, 29 Sep 2026; SPEC §4.4 and
 * the owner's decisions 2, 6, 8, 9, 11).
 *
 * Top: where the post is, in one sentence, and the version they are looking
 * at. Middle: the post — one file at a time, the notes on THAT file beside it,
 * the caption, when and where it goes. Bottom of the side column, always in
 * view: the answer, when it is theirs to give, and nothing when it is not.
 *
 * What they see is the version they were SENT, frozen; the answer carries its
 * number and the server refuses any other (audit P2). A note is pinned to a
 * file by its address, so it stays on that file whatever the order (decision
 * 9). A question or an error appears beside the button that caused it.
 */
export default function PortalPostReview({ token, data, accent }: {
  token: string
  data: PortalPostPage
  /** the client's brand colour on Approve, when they have one */
  accent?: React.CSSProperties
}) {
  const router = useRouter()
  const { view, files, notes } = data
  const [index, setIndex] = useState(0)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [noteProblem, setNoteProblem] = useState<string | null>(null)
  const [showCaption, setShowCaption] = useState(false)
  const [showFrames, setShowFrames] = useState(false)

  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? '') } catch { /* private mode */ } }, [])

  const total = files.length
  const file = files[index] ?? null
  const what = file?.type === 'video' ? 'video' : 'photo'
  const onThis = useMemo(() => (file ? notesOnFile(notes, file.url) : []), [notes, file])
  const general = useMemo(() => notes.filter(n => !n.file_url), [notes])
  const countOn = useMemo(() => {
    const at = new Map<string, number>()
    for (const n of notes) if (n.file_url) at.set(n.file_url, (at.get(n.file_url) ?? 0) + 1)
    return files.map((f, i) => ({ i, n: at.get(f.url) ?? 0 })).filter(x => x.n > 0)
  }, [notes, files])
  const canWrite = view.canAnswer && !data.preview_mode

  const remember = (who: string) => { try { if (who) localStorage.setItem(NAME_KEY, who) } catch { /* fine */ } }

  const addNote = async (onFile: boolean) => {
    const text = draft.trim()
    if (!text || noteBusy) return
    const who = name.trim().slice(0, 60)
    remember(who)
    setNoteBusy(true); setNoteProblem(null)
    try {
      const res = await fetch('/api/portal/act', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, post_id: data.post_id, version: data.version, action: 'post_note',
          file_url: onFile && file ? file.url : null, note: text, author_name: who,
        }),
      })
      if (!res.ok) throw new Error(String((await res.json().catch(() => ({})))?.error ?? 'Could not send — try again'))
      setDraft('')
      router.refresh()
    } catch (e) {
      setNoteProblem(e instanceof Error ? e.message : 'Could not send — try again')
    } finally {
      setNoteBusy(false)
    }
  }

  const noteLine = (n: PortalPostNote) => (
    <li key={n.id} className="rounded-inner bg-muted/60 px-3 py-2">
      <p className="text-[12px] text-muted-foreground">{n.from_team ? `${n.author_name} · MD Media` : n.author_name}</p>
      <p className="whitespace-pre-line text-[14px]">{n.body}</p>
    </li>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* ── top: where it is, and which version ── */}
      <div role="status" data-post-state={view.state}
        className={`flex flex-col gap-1 rounded-card border p-4 ${view.tone === 'amber' ? 'border-accent-amber/40 bg-tint-amber' : view.tone === 'green' ? 'border-border bg-tint-green' : view.tone === 'blue' ? 'border-border bg-tint-blue' : 'border-border bg-card'}`}>
        <p className="text-[17px] font-semibold">{view.headline}</p>
        {view.line && <p className="text-[14px] text-muted-foreground">{view.line}</p>}
        <p className="text-[12px] text-muted-foreground">
          {data.version != null && !data.shown_as_posted ? `Version ${data.version}` : 'As it went out'}
          {data.from_migration ? ' · Sent before versions were kept' : ''}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        {/* ── middle: the post ── */}
        <section className="flex min-w-0 flex-col gap-2">
          {total > 0 ? (
            <SlideCarousel slides={files} aspect="natural" mode="full" naturalMax="max-h-[72vh]"
              className="overflow-hidden rounded-card" onIndexChange={setIndex}
              label={`${data.title}${total > 1 ? ` — ${total} files` : ''}`} />
          ) : (
            <p className="rounded-card border border-border bg-card p-6 text-[15px] text-muted-foreground">Nothing to look at on this one yet.</p>
          )}
          {total > 1 && (
            <p className="text-[13px] text-muted-foreground">
              {countOn.length > 0 ? `Notes on ${countOn.map(x => x.i + 1).join(', ')} — ` : ''}swipe or use the arrows to move between them
            </p>
          )}
          {data.grid && data.grid.length > 1 && (
            <div className="mt-2 flex flex-col gap-2" data-instagram-grid>
              <p className="text-[14px] font-semibold">How it sits on your Instagram</p>
              <ul className="grid max-w-[360px] grid-cols-3 gap-0.5">
                {data.grid.slice(0, 9).map((g, i) => (
                  <li key={`${g.url}-${i}`} className={`relative aspect-[4/5] overflow-hidden bg-foreground/[0.06] ${i === 0 ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background' : ''}`}>
                    {g.type === 'video'
                      ? <video src={g.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={g.url} alt={i === 0 ? 'This post' : ''} loading="lazy" className="h-full w-full object-cover" />}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-muted-foreground">This post is the one outlined, before your newest posts.</p>
            </div>
          )}
          {data.previews.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <button type="button" onClick={() => setShowFrames(v => !v)}
                className="min-h-11 w-fit text-[14px] font-semibold underline underline-offset-4">
                {showFrames ? 'Hide how each network shows it' : 'See how each network shows it'}
              </button>
              {showFrames && <PostPreviewPane previews={data.previews} empty="This post has no network on it." />}
            </div>
          )}
        </section>

        {/* ── the side column, kept in view ── */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <div className="rounded-card border border-border bg-card p-4">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{data.type_line}</p>
            {(data.when_line || data.networks.length > 0) && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
                {data.when_line && (
                  <>
                    <dt className="text-muted-foreground">{view.state === 'posted' ? 'Went out' : view.state === 'missed' ? 'Was planned' : 'Goes out'}</dt>
                    <dd className={view.state === 'missed' ? 'text-muted-foreground line-through' : 'font-medium'}>{data.when_line}</dd>
                  </>
                )}
                {data.networks.length > 0 && <><dt className="text-muted-foreground">Where</dt><dd className="font-medium">{data.networks.join(', ')}</dd></>}
              </dl>
            )}
            {data.links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3">
                {data.links.map(l => (
                  <a key={l.platform} href={l.url} target="_blank" rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold underline-offset-4 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> Live on {l.network}
                  </a>
                ))}
              </div>
            )}
            {data.caption && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {view.state === 'posted' ? 'Caption' : 'Caption, as it will post'}
                </p>
                <p className={`mt-1 whitespace-pre-line text-[14px] leading-relaxed ${showCaption ? '' : 'line-clamp-6'}`}>{data.caption}</p>
                {data.caption.split('\n').length > 6 || data.caption.length > 360 ? (
                  <button type="button" onClick={() => setShowCaption(v => !v)} className="mt-1 min-h-9 text-[13px] font-semibold underline underline-offset-2">
                    {showCaption ? 'Show less' : 'Read it all'}
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {/* the notes on the file being looked at, and a box for one (decision 9) */}
          {(canWrite || notes.length > 0) && (
            <div className="rounded-card border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                <MessageCircle className="h-4 w-4" aria-hidden />
                {total > 1 ? `Notes on ${what} ${index + 1} of ${total}` : 'Notes'}
              </p>
              {onThis.length > 0
                ? <ul className="mt-2 flex flex-col gap-2">{onThis.map(noteLine)}</ul>
                : <p className="mt-1 text-[13px] text-muted-foreground">Nothing noted on this {total > 1 ? what : 'post'} yet.</p>}
              {canWrite && (
                <div className="mt-3 flex flex-col gap-2">
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} maxLength={2000}
                    placeholder={total > 1 ? `A note on ${what} ${index + 1}` : 'A note on this post'}
                    aria-label="Your note" className="rounded-inner border border-border bg-background px-3 py-2 text-[14px]" />
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Your name" aria-label="Your name"
                    className="min-h-11 min-w-0 rounded-inner border border-border bg-background px-3 text-[14px]" />
                  {noteProblem && <p role="alert" className="text-[13px] text-accent-red">{noteProblem}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void addNote(true)} disabled={noteBusy || !draft.trim() || !file}
                      className="min-h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-50">
                      {noteBusy ? 'Sending…' : total > 1 ? `Add note to ${what} ${index + 1}` : 'Add note'}
                    </button>
                    {total > 1 && (
                      <button type="button" onClick={() => void addNote(false)} disabled={noteBusy || !draft.trim()}
                        className="min-h-11 rounded-full border border-border px-4 text-[14px] font-semibold disabled:opacity-50">
                        On the whole post
                      </button>
                    )}
                  </div>
                </div>
              )}
              {general.length > 0 && (
                <>
                  <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">On the whole post</p>
                  <ul className="mt-2 flex flex-col gap-2">{general.map(noteLine)}</ul>
                </>
              )}
            </div>
          )}

          {/* ── bottom: only what this stage allows ── */}
          {canWrite
            ? <PostAnswer token={token} postId={data.post_id} version={data.version!} name={name} setName={setName} remember={remember} accent={accent} />
            : data.preview_mode
              ? <p className="rounded-card border border-accent-amber/40 bg-tint-amber p-4 text-[14px]">Preview — this is what the client sees. Approve and notes are switched off here.</p>
              : null}
        </aside>
      </div>
    </div>
  )
}

/** Approve, or ask for a change with a few words. The server's rules decide; this only asks. */
function PostAnswer({ token, postId, version, name, setName, remember, accent }: {
  token: string
  postId: string
  version: number
  name: string
  setName: (v: string) => void
  remember: (who: string) => void
  accent?: React.CSSProperties
}) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'change' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [answered, setAnswered] = useState<'approved' | 'changes' | null>(null)

  const act = async (what: 'approve' | 'change') => {
    const text = what === 'change' ? note.trim() : ''
    if (what === 'change' && !text) { setProblem('Say what to change — a few words is enough.'); return }
    const who = name.trim().slice(0, 60)
    remember(who)
    setBusy(what); setProblem(null)
    try {
      const res = await fetch('/api/portal/act', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, post_id: postId, version,
          action: what === 'approve' ? 'client_approve' : 'client_ask_change',
          note: text, author_name: who,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(j?.error ?? 'That did not go through — try again in a moment.'))
      setAnswered(what === 'approve' ? 'approved' : 'changes')
      router.refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That did not go through — try again in a moment.')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  if (answered) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-card border border-border bg-card p-5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${answered === 'approved' ? 'bg-accent-green text-white' : 'bg-foreground text-background'}`}>
          {answered === 'approved' ? <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden /> : <MessageSquare className="h-5 w-5" aria-hidden />}
        </span>
        <div>
          <p className="text-[17px] font-semibold">{answered === 'approved' ? 'You approved this' : 'Thanks — we have your note'}</p>
          <p className="mt-0.5 text-[14px] text-muted-foreground">
            {answered === 'approved' ? 'The team will book it in. Nothing else to do.' : 'The team is making the change.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-5" data-post-answer>
      <div>
        <p className="text-[17px] font-semibold">Happy with this?</p>
        <p className="mt-0.5 text-[14px] text-muted-foreground">Approve this version, or tell us what to change.</p>
      </div>
      <label className="flex flex-col gap-1 text-[13px] font-medium text-muted-foreground">
        Your name (optional)
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
          className="min-h-11 rounded-inner border border-border bg-background px-3 text-[15px] text-foreground" />
      </label>
      {!asking ? (
        <div className="flex flex-col gap-2">
          {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[14px]">{problem}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={busy !== null} onClick={() => void act('approve')} style={accent}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[16px] font-semibold text-background disabled:opacity-60">
              <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden /> {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => { setAsking(true); setProblem(null) }}
              className="min-h-12 rounded-full border border-border px-6 text-[15px] font-semibold hover:bg-muted disabled:opacity-60">
              Ask for a change
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-medium text-muted-foreground">
            What should we change?
            <textarea autoFocus rows={4} value={note} maxLength={2000} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Swap the second picture, and make the caption shorter."
              className="rounded-inner border border-border bg-background px-3 py-2 text-[15px] text-foreground" />
          </label>
          {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[14px]">{problem}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={busy !== null} onClick={() => void act('change')}
              className="min-h-12 flex-1 rounded-full bg-foreground px-6 text-[15px] font-semibold text-background disabled:opacity-60">
              {busy === 'change' ? 'Sending…' : 'Send my note'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => { setAsking(false); setProblem(null) }}
              className="min-h-12 rounded-full border border-border px-6 text-[15px] font-semibold hover:bg-muted">
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
