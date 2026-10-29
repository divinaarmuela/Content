'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Check, MessageSquarePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { LinkedText } from './LinkedText'
import { markQuotes, planThreads, threadsOn, type PlanComment, type PlanThread } from '../lib/plan-comments-core'

/**
 * COMMENTS ON THE PLAN'S OWN WORDS, AS GOOGLE DOCS DOES THEM (29 Oct 2026, the owner with a video: "idk how u will do this
 * but we need this robust feature"). Select some words of a part of the plan → "Comment on the selected words" → the
 * comment is kept on exactly those words, lit up where they stand, with its thread under the part: replies, and Resolve.
 * The same pieces draw the client's portal and the team's shoot page; each page hands in how to post and resolve.
 */
export type PlanCommentRow = PlanComment & { author_name?: string | null; from_team?: boolean | null }
type Ctx = {
  threads: PlanThread<PlanCommentRow>[]
  canComment: boolean
  /** the words picked, waiting for a comment */
  picked: { part: string; quote: string } | null
  setPicked: (p: { part: string; quote: string } | null) => void
  post: (input: { body: string; part?: string; quote?: string; parent_id?: string; name?: string }) => Promise<boolean>
  resolve: (id: string, on: boolean) => Promise<boolean>
  /** the portal asks for a name; the team is signed in */
  needsName: boolean
}
const PlanCtx = createContext<Ctx | null>(null)
const NAME_KEY = 'portal-commenter-name'

export function PlanCommentsProvider({ comments, canComment, post, resolve, needsName = false, children }: {
  comments: readonly PlanCommentRow[]
  canComment: boolean
  post: Ctx['post']
  resolve: Ctx['resolve']
  needsName?: boolean
  children: React.ReactNode
}) {
  // SHOWN THE MOMENT IT IS SENT (29 Oct 2026): the page's own refresh takes seconds, and "Comment added" over a page
  // without it reads as lost — a sent comment is drawn at once, and dropped when the real row arrives
  const [sent, setSent] = useState<PlanCommentRow[]>([])
  // the real row: the same words in the same place, written since (the portal adds "— Name" under the words)
  const arrived = (c: PlanCommentRow, x: PlanCommentRow) => c.body.trim().startsWith(x.body.trim())
    && (c.parent_id ?? null) === (x.parent_id ?? null) && (c.anchor_part ?? null) === (x.anchor_part ?? null)
    && Date.parse(c.created_at) >= Date.parse(x.created_at) - 60_000
  const waiting = useMemo(() => sent.filter(x => !comments.some(c => arrived(c, x))), [sent, comments])
  const all = useMemo(() => [...comments, ...waiting], [comments, waiting])
  const threads = useMemo(() => planThreads(all), [all])
  const postAndShow = useCallback<Ctx['post']>(async input => {
    const ok = await post(input)
    if (ok) setSent(cur => [...cur, {
      id: `sending-${Date.now()}`, created_at: new Date().toISOString(), body: input.body,
      anchor_part: input.part ?? null, anchor_quote: input.quote ?? null, parent_id: input.parent_id ?? null,
      author_name: input.name || 'You', resolved: false,
    }])
    return ok
  }, [post])
  const [picked, setPicked] = useState<{ part: string; quote: string } | null>(null)
  // WORDS SELECTED IN A PART: read on every change of the selection, so a mouse, a finger and a keyboard all work
  useEffect(() => {
    if (!canComment) return
    const read = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const quote = sel.toString().replace(/\s+/g, ' ').trim()
      if (quote.length < 2) return
      const node = (n: Node | null) => (n instanceof Element ? n : n?.parentElement ?? null)
      const a = node(sel.anchorNode)?.closest('[data-plan-part]')
      const b = node(sel.focusNode)?.closest('[data-plan-part]')
      // within one part only — a comment is on one part's words
      if (!a || a !== b) return
      setPicked({ part: String(a.getAttribute('data-plan-part')), quote: quote.slice(0, 300) })
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [canComment])
  const value = useMemo(() => ({ threads, canComment, picked, setPicked, post: postAndShow, resolve, needsName }), [threads, canComment, picked, postAndShow, resolve, needsName])
  return (
    <PlanCtx.Provider value={value}>
      {children}
      {canComment && picked && <PickedBar />}
    </PlanCtx.Provider>
  )
}

/**
 * WORDS PICKED IN A BOX BEING TYPED IN (the team's shoot page): a browser keeps a text box's selection to itself, so the
 * box hands it over on select — `onSelect={pickFromBox('objective')}` on the box.
 */
export function usePickFromBox() {
  const ctx = useContext(PlanCtx)
  return useCallback((part: string) => (e: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!ctx?.canComment) return
    const el = e.currentTarget
    const a = el.selectionStart ?? 0, b = el.selectionEnd ?? 0
    const quote = el.value.slice(Math.min(a, b), Math.max(a, b)).replace(/\s+/g, ' ').trim()
    if (quote.length >= 2) ctx.setPicked({ part, quote: quote.slice(0, 300) })
  }, [ctx])
}

/** one part's words with the commented ones lit up, then its threads; `data-plan-part` is what a selection reads */
export function PlanPart({ part, text, as = 'p', className = '' }: { part: string; text: string; as?: 'p' | 'span' | 'div'; className?: string }) {
  const ctx = useContext(PlanCtx)
  const open = ctx ? threadsOn(ctx.threads, part).filter(t => !t.root.resolved) : []
  const pieces = markQuotes(text, open.map(t => ({ id: t.root.id, quote: String(t.root.anchor_quote ?? '') })))
  const Tag = as
  return (
    <Tag data-plan-part={part} className={className}>
      {pieces.map((p, i) => p.ids.length
        ? <mark key={i} className="cursor-pointer rounded-[2px] bg-accent-amber/50 text-inherit" title="Commented — see below"
            onClick={() => document.getElementById(`plan-thread-${p.ids[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            <LinkedText text={p.text} />
          </mark>
        : <LinkedText key={i} text={p.text} />)}
    </Tag>
  )
}

/** the threads on one part, under it: open ones in full, resolved ones folded */
export function PlanPartThreads({ part }: { part: string }) {
  const ctx = useContext(PlanCtx)
  const [showDone, setShowDone] = useState(false)
  if (!ctx) return null
  const list = threadsOn(ctx.threads, part)
  const open = list.filter(t => !t.root.resolved)
  const done = list.filter(t => t.root.resolved)
  if (list.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {open.map(t => <Thread key={t.root.id} t={t} />)}
      {done.length > 0 && (
        <button type="button" onClick={() => setShowDone(v => !v)} className="w-fit text-[12px] font-semibold text-muted-foreground underline underline-offset-2">
          {showDone ? 'Hide' : 'Show'} {done.length} resolved comment{done.length === 1 ? '' : 's'}
        </button>
      )}
      {showDone && done.map(t => <Thread key={t.root.id} t={t} />)}
    </div>
  )
}

function useName() {
  const [name, setName] = useState('')
  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? '') } catch { /* private window */ } }, [])
  const keep = (n: string) => { setName(n); try { localStorage.setItem(NAME_KEY, n) } catch { /* private window */ } }
  return [name, keep] as const
}

function Thread({ t }: { t: PlanThread<PlanCommentRow> }) {
  const ctx = useContext(PlanCtx)!
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useName()
  const resolved = !!t.root.resolved
  // a comment still on its way has no row to reply to or resolve yet
  const sending = t.root.id.startsWith('sending-')
  const send = async () => {
    if (!reply.trim()) return
    if (ctx.needsName && !name.trim()) { toast.error('Add your name so the team knows who replied.'); return }
    setBusy(true)
    const ok = await ctx.post({ body: reply.trim(), parent_id: t.root.id, name: name.trim() })
    setBusy(false)
    if (ok) setReply('')
  }
  return (
    <div id={`plan-thread-${t.root.id}`} className={`flex flex-col gap-1.5 rounded-inner border p-2.5 text-[13px] ${resolved ? 'border-border bg-muted/40 opacity-75' : 'border-accent-amber/60 bg-tint-amber/40'}`}>
      <p className="border-l-2 border-accent-amber pl-2 text-[12px] italic text-muted-foreground">“{t.root.anchor_quote}”</p>
      {[t.root, ...t.replies].map(c => (
        <div key={c.id} className="flex flex-col">
          <span className="text-[12px] font-semibold">{c.author_name ?? (c.from_team ? 'MD Media' : 'Client')}
            <span className="ml-1.5 font-normal text-muted-foreground">{new Date(c.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })}</span>
          </span>
          <span className="whitespace-pre-wrap"><LinkedText text={c.body} /></span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {ctx.canComment && !resolved && !sending && (
          <>
            {ctx.needsName && <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name"
              className="h-9 w-32 rounded-full border border-border bg-background px-3 text-[12px]" />}
            <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply" aria-label="Reply"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send() } }}
              className="h-9 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-[12px]" />
            <button type="button" disabled={busy || !reply.trim()} onClick={() => void send()}
              className="h-9 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background disabled:opacity-50">Reply</button>
          </>
        )}
        {ctx.canComment && !sending && (
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); await ctx.resolve(t.root.id, !resolved); setBusy(false) }}
            className="ml-auto inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted">
            <Check className="h-3.5 w-3.5" aria-hidden /> {resolved ? 'Open again' : 'Resolve'}
          </button>
        )}
      </div>
    </div>
  )
}

/** the words picked, and the comment on them — pinned to the foot of the screen, so a phone keeps it in reach */
function PickedBar() {
  const ctx = useContext(PlanCtx)!
  const picked = ctx.picked!
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useName()
  const close = useCallback(() => { ctx.setPicked(null); setWriting(false); setText(''); window.getSelection()?.removeAllRanges() }, [ctx])
  const send = async () => {
    if (!text.trim()) return
    if (ctx.needsName && !name.trim()) { toast.error('Add your name so the team knows who commented.'); return }
    setBusy(true)
    const ok = await ctx.post({ body: text.trim(), part: picked.part, quote: picked.quote, name: name.trim() })
    setBusy(false)
    if (ok) { toast.success('Comment added — it sits on those words.'); close() }
  }
  return (
    <div role="dialog" aria-label="Comment on the selected words"
      className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-[70] mx-auto flex max-w-[560px] flex-col gap-2 rounded-2xl border border-border bg-popover p-3 shadow-xl">
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 border-l-2 border-accent-amber pl-2 text-[12px] italic text-muted-foreground">“{picked.quote}”</p>
        <button type="button" onClick={close} aria-label="Cancel" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      {!writing ? (
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setWriting(true)}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-[14px] font-semibold text-background">
          <MessageSquarePlus className="h-4 w-4" aria-hidden /> Comment on the selected words
        </button>
      ) : (
        <>
          {ctx.needsName && <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name"
            className="h-10 rounded-full border border-border bg-background px-4 text-[14px]" />}
          <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="What would you like to say about these words?"
            aria-label="Your comment" className="rounded-inner border border-border bg-background p-3 text-[14px]" />
          <button type="button" disabled={busy || !text.trim()} onClick={() => void send()}
            className="h-11 rounded-full bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-50">{busy ? 'Sending…' : 'Add the comment'}</button>
        </>
      )}
    </div>
  )
}
