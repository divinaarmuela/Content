'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import SlideCarousel from '../media/SlideCarousel'
import ApprovePanel from './ApprovePanel'
import { slideTag, splitSlideTag, tagComment } from '../../lib/slide-comment-core'

const NAME_KEY = 'mdm-portal-name'

type Slide = { url: string; name?: string; type?: 'image' | 'video' }
type Note = { id: string; created_at: string; body: string; author_name: string; from_team: boolean }

/**
 * ONE PAGE FOR A CLIENT'S YES (the owner, 28 Sep 2026: "there are two different portals … the layout is horrible, one
 * scroll down if there are many assets … clients have two links now, and the post approval card has board and brief
 * plan info, which is not right").
 *
 * The post on the left, one slide at a time with the strip under it — a fourteen-slide carousel is one screen, not
 * fourteen. On the right, and kept in view: what it is, when and where it goes, the caption, the notes on THE SLIDE
 * BEING LOOKED AT with a box for another, then Approve or Ask for a change. On a phone the same, stacked.
 */
export default function PostReview({
  token, itemId, title, slides, caption, typeLine, whenLine, whereLine, missed, state, kind, preview, clientName, comments,
}: {
  token: string
  itemId: string
  title: string
  slides: Slide[]
  caption: string
  typeLine: string
  whenLine: string | null
  whereLine: string | null
  missed: boolean
  state: 'waiting' | 'approved' | 'changes' | 'not_ready'
  /** the edit; a post has its own page since the posting rebuild (PortalPostReview) */
  kind: 'card'
  preview: boolean
  clientName: string
  comments: Note[]
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [showCaption, setShowCaption] = useState(false)

  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? '') } catch { /* private mode */ } }, [])

  const total = slides.length
  const notes = useMemo(() => comments.map(c => ({ ...c, ...splitSlideTag(c.body) })), [comments])
  const onThis = notes.filter(n => n.index === index)
  const general = notes.filter(n => n.index === null)
  const countOn = useMemo(() => {
    const m = new Map<number, number>()
    for (const n of notes) if (n.index !== null) m.set(n.index, (m.get(n.index) ?? 0) + 1)
    return m
  }, [notes])
  const what = slides[index]?.type === 'video' ? 'video' : 'photo'

  const send = async () => {
    if (preview) { setProblem('Preview — notes are switched off here'); return }
    const text = draft.trim()
    if (!text || busy) return
    const who = name.trim().slice(0, 60)
    try { if (who) localStorage.setItem(NAME_KEY, who) } catch { /* fine */ }
    setBusy(true); setProblem(null)
    try {
      const body = tagComment(text, total > 0 ? slideTag(index, total, slides[index]?.type ?? null) : null)
      const res = await fetch('/api/portal/comment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, kind: 'item', id: itemId, body, author_name: who }),
      })
      if (!res.ok) throw new Error(String((await res.json().catch(() => ({})))?.error ?? 'Could not send — try again'))
      setDraft('')
      router.refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not send — try again')
    } finally {
      setBusy(false)
    }
  }

  const noteLine = (n: (typeof notes)[number]) => (
    <li key={n.id} className="rounded-inner bg-muted/60 px-3 py-2">
      <p className="text-[12px] text-muted-foreground">{n.from_team ? `${n.author_name} · MD Media` : n.author_name}</p>
      <p className="whitespace-pre-line text-[14px]">{n.rest}</p>
    </li>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      {/* the post */}
      <section className="flex min-w-0 flex-col gap-2">
        {total > 0 ? (
          <SlideCarousel slides={slides} aspect="natural" mode="full" naturalMax="max-h-[72vh]"
            className="overflow-hidden rounded-card" onIndexChange={setIndex}
            label={`${title}${total > 1 ? ` — ${total} slides` : ''}`} />
        ) : (
          <p className="rounded-card border border-border bg-card p-6 text-[15px] text-muted-foreground">Nothing to look at on this one yet.</p>
        )}
        {total > 1 && (
          <p className="text-[13px] text-muted-foreground">
            {countOn.size > 0 ? `Notes on ${[...countOn.keys()].sort((a, b) => a - b).map(i => i + 1).join(', ')} — ` : ''}swipe or use the arrows to move between slides
          </p>
        )}
      </section>

      {/* everything to decide with, kept in view */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <div className="rounded-card border border-border bg-card p-4">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{typeLine}</p>
          {(whenLine || whereLine) && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
              {whenLine && <><dt className="text-muted-foreground">{missed ? 'Was planned' : 'Goes out'}</dt><dd className={missed ? 'text-muted-foreground line-through' : 'font-medium'}>{whenLine}</dd></>}
              {whereLine && <><dt className="text-muted-foreground">Where</dt><dd className="font-medium">{whereLine}</dd></>}
            </dl>
          )}
          {missed && state === 'waiting' && (
            <p role="status" className="mt-3 rounded-inner border border-accent-amber/40 bg-tint-amber px-3 py-2 text-[14px]">
              The planned time for this post has passed, so this approval has closed. We&rsquo;ll pick a new time and send it to you again to approve.
            </p>
          )}
          {caption && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Caption</p>
              <p className={`mt-1 whitespace-pre-line text-[14px] leading-relaxed ${showCaption ? '' : 'line-clamp-6'}`}>{caption}</p>
              {caption.split('\n').length > 6 || caption.length > 360 ? (
                <button type="button" onClick={() => setShowCaption(v => !v)} className="mt-1 min-h-9 text-[13px] font-semibold underline underline-offset-2">
                  {showCaption ? 'Show less' : 'Read it all'}
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* the notes on the slide being looked at, and a box for one */}
        <div className="rounded-card border border-border bg-card p-4">
          <p className="flex items-center gap-1.5 text-[14px] font-semibold">
            <MessageCircle className="h-4 w-4" aria-hidden />
            {total > 1 ? `Notes on ${what} ${index + 1} of ${total}` : 'Notes'}
          </p>
          {onThis.length > 0
            ? <ul className="mt-2 flex flex-col gap-2">{onThis.map(noteLine)}</ul>
            : <p className="mt-1 text-[13px] text-muted-foreground">Nothing noted on this {total > 1 ? what : 'post'} yet.</p>}
          {!preview && (
            <div className="mt-3 flex flex-col gap-2">
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} maxLength={2000}
                placeholder={total > 1 ? `A change for ${what} ${index + 1}, e.g. new wording for the text on it` : 'Anything you’d like changed'}
                aria-label="Your note" className="rounded-inner border border-border bg-background px-3 py-2 text-[14px]" />
              <div className="flex flex-wrap items-center gap-2">
                <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Your name" aria-label="Your name"
                  className="min-h-11 min-w-0 flex-1 rounded-inner border border-border bg-background px-3 text-[14px]" />
                <button type="button" onClick={() => void send()} disabled={busy || !draft.trim()}
                  className="min-h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-50">
                  {busy ? 'Sending…' : 'Add note'}
                </button>
              </div>
              {problem && <p role="alert" className="text-[13px] text-accent-red">{problem}</p>}
            </div>
          )}
          {general.length > 0 && (
            <>
              <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">On the whole post</p>
              <ul className="mt-2 flex flex-col gap-2">{general.map(noteLine)}</ul>
            </>
          )}
        </div>

        <ApprovePanel token={token} itemId={itemId} state={state} kind={kind} preview={preview} clientName={clientName} missed={missed} />
      </aside>
    </div>
  )
}
