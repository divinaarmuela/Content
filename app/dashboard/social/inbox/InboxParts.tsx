'use client'

/**
 * THE INBOX'S PIECES, each drawn only when its own data changes (6 Nov 2026: "the page feels laggy" — the same fixes
 * as the to-dos page): a conversation row, a chat bubble and a comment are memoised and get their actions through
 * one stable channel; every box you type in keeps its own words, so a key press redraws that box alone; the small
 * "Updated N min ago" line ticks by itself.
 */
import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { CheckCircle2, EyeOff, Loader2, Reply, Send, Trash2 } from 'lucide-react'
import PlatformIcon from '../PlatformIcon'
import ConfirmAction from '../../ConfirmAction'
import {
  attachmentView, byAutomation, clockWords, deliveryWords, messageButtons, previewWords,
  type InboxConversation, type InboxMessage,
} from '@/app/lib/inbox-core'
import { freshnessWords, replyLabel, type AnnotatedComment } from '@/app/lib/inbox-copy-core'

/** Counts of draws, for the render-count test and for measuring in the browser (window.__inboxRenders). */
export const renders: Record<string, number> = {}
const counted = (name: string) => {
  renders[name] = (renders[name] ?? 0) + 1
  if (typeof window !== 'undefined') (window as unknown as { __inboxRenders?: Record<string, number> }).__inboxRenders = renders
}

export const convName = (c: InboxConversation) => c.participantName ?? c.participantUsername ?? 'someone'
const convPreview = (c: InboxConversation) => previewWords(typeof c.lastMessage === 'string' ? c.lastMessage : c.lastMessage?.text ?? '')
const msgText = (m: InboxMessage) => m.text ?? m.message ?? ''

function ago(iso?: string): string {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const whenWords = (iso?: string | null): string => {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  if ((Date.now() - t) / 1000 < 86400) return ago(iso)
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })
}

/** A person's picture, or their first letter when there is none OR Instagram's link has expired. */
export const Avatar = memo(function Avatar({ src, letter, size }: { src?: string | null; letter: string; size: string }) {
  const [dead, setDead] = useState(false)
  useEffect(() => { setDead(false) }, [src])
  if (src && !dead) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" onError={() => setDead(true)} className={`${size} shrink-0 rounded-full bg-foreground/[0.08] object-cover`} />
  }
  return <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] font-semibold uppercase`}>{letter}</span>
})

/** "Updated 4 min ago" / "Checking for anything new…" — ticks on its own, nothing else redraws for it. */
export const Freshness = memo(function Freshness({ checkedAt, checking }: { checkedAt: string | null; checking: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])
  const words = freshnessWords(checkedAt, checking, now)
  if (!words) return null
  return (
    <p className="flex items-center gap-1.5 px-2 text-[12px] text-muted-foreground" aria-live="polite">
      {checking && <Loader2 className="h-3 w-3 animate-spin" />}{words}
    </p>
  )
})

/* ── direct messages ─────────────────────────────────────────────────────── */

export const ConvoRow = memo(function ConvoRow({ c, active, onOpen }: {
  c: InboxConversation; active: boolean; onOpen: (c: InboxConversation) => void
}) {
  counted('ConvoRow')
  const unread = (c.unreadCount ?? 0) > 0
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(c)}
        className={`flex w-full gap-2.5 rounded-inner p-2.5 text-left transition-colors ${active ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'}`}
      >
        <Avatar src={c.participantPicture} letter={convName(c).slice(0, 1)} size="h-10 w-10 text-[14px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-body-15 ${unread ? 'font-semibold' : 'font-medium'}`}>{convName(c)}</span>
            <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{whenWords(c.updatedTime)}</span>
          </span>
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
            {c.platform && <PlatformIcon platform={c.platform} size={12} />}
            <span className="truncate">to @{c.accountUsername ?? 'account'}</span>
            {unread && <span className="ml-auto shrink-0 rounded-full bg-accent-blue px-2 py-0.5 font-mono text-[11px] text-white">{c.unreadCount}</span>}
          </span>
          <span className="truncate text-secondary-13 text-muted-foreground">{convPreview(c)}</span>
        </span>
      </button>
    </li>
  )
})

export type BubbleInfo = { day: string | null; sameSideAsPrev: boolean; mine: boolean; lastOfMine: boolean; by: string | null }

export const Bubble = memo(function Bubble({ m, info, avatarSrc, letter }: {
  m: InboxMessage; info: BubbleInfo; avatarSrc?: string | null; letter: string
}) {
  counted('Bubble')
  const { mine, sameSideAsPrev, day, lastOfMine, by } = info
  const at = m.createdTime ?? m.createdAt ?? m.timestamp ?? null
  const buttons = messageButtons(m)
  const auto = byAutomation(m)
  return (
    <div className="flex flex-col">
      {day && <p className="my-2 self-center rounded-full bg-foreground/[0.06] px-3 py-0.5 text-[12px] font-medium text-muted-foreground">{day}</p>}
      <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${sameSideAsPrev ? 'mt-0.5' : 'mt-2'}`}>
        {!mine && (sameSideAsPrev ? <span className="w-7 shrink-0" /> : <Avatar src={avatarSrc} letter={letter} size="h-7 w-7 text-[12px]" />)}
        <div className={`flex max-w-[78%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {auto && !sameSideAsPrev && <span className="mb-0.5 text-[11px] font-medium text-muted-foreground">Sent by automation</span>}
          <div className={`rounded-[18px] px-3.5 py-2 text-body-15 ${mine ? 'rounded-br-md bg-foreground text-background' : 'rounded-bl-md bg-foreground/[0.07]'}`}>
            {m.noRenderableContent
              ? <span className="italic">Instagram does not show this message to apps — open it in Instagram.</span>
              : msgText(m) && <span className="whitespace-pre-wrap break-words">{msgText(m)}</span>}
            {m.isStoryMention && !(m.attachments ?? []).length && <span className="block italic">Mentioned the account in their story</span>}
            {(m.attachments ?? []).map((a, k) => {
              const v = attachmentView(a)
              if (v.url && v.kind === 'image') {
                // eslint-disable-next-line @next/next/no-img-element
                return <img key={k} src={v.url} alt={v.words} loading="lazy" className="mt-1 max-h-72 rounded-xl object-contain" />
              }
              if (v.url && v.kind === 'video') return <video key={k} src={v.url} controls preload="metadata" className="mt-1 max-h-72 rounded-xl" />
              if (v.url && v.kind === 'audio') return <audio key={k} src={v.url} controls preload="none" className="mt-1 w-56" />
              return v.url
                ? <a key={k} href={v.url} target="_blank" rel="noopener noreferrer" className="mt-1 block font-medium underline underline-offset-2">{v.words} — open</a>
                : <span key={k} className="mt-1 block italic">{v.words}</span>
            })}
          </div>
          {buttons.map((b, k) => (
            <span key={k} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-1.5 text-center text-[13px] font-semibold">{b.title}</span>
          ))}
          <span className="mt-0.5 px-1 text-[11px] text-muted-foreground">
            {clockWords(at)}
            {mine && by ? ` · Sent by ${by}` : ''}
            {lastOfMine && deliveryWords(m) ? ` · ${deliveryWords(m)}` : ''}
          </span>
        </div>
      </div>
    </div>
  )
})

/** The DM box keeps its own words: a key press redraws this box and nothing else. */
export const DmComposer = memo(function DmComposer({ convoKey, disabled, placeholder, onSend }: {
  convoKey: string; disabled: boolean; placeholder: string; onSend: (text: string) => Promise<boolean>
}) {
  counted('DmComposer')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => { setDraft('') }, [convoKey])
  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try { if (await onSend(text)) setDraft('') } finally { setSending(false) }
  }
  return (
    <div className="flex gap-2 border-t border-border pt-3">
      <Textarea rows={2} value={draft} disabled={disabled} placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
        className="min-h-9 rounded-2xl" />
      <Button size="sm" aria-label="Send" onClick={() => void send()} disabled={!draft.trim() || sending || disabled}>
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
})

/* ── comments ────────────────────────────────────────────────────────────── */

export type CommentAction = 'reply' | 'private_reply' | 'hide' | 'unhide' | 'delete'

const commentText = (c: AnnotatedComment) => c.text ?? c.message ?? ''
export const commentAuthor = (c: AnnotatedComment & { username?: string }) => c.username ?? c.from?.username ?? 'someone'

/** The "Replied by Sam · 3h ago" / "Needs a reply" tag. */
export function ReplyTag({ c, platform }: { c: AnnotatedComment; platform: string | null }) {
  if (!c.reply || c.reply.state === 'own') return null
  const words = replyLabel(c.reply, platform, Date.now())
  return c.reply.state === 'replied'
    ? <span className="inline-flex items-center gap-1 rounded-full bg-tint-green px-2.5 py-1 text-chip-12 font-medium"><CheckCircle2 className="h-3 w-3" />{words}</span>
    : <span className="rounded-full bg-tint-amber px-2.5 py-1 text-chip-12 font-medium">{words}</span>
}

/** One comment, with its own reply and DM boxes — typing in either redraws this comment alone. */
export const CommentRow = memo(function CommentRow({ c, platform, busy, onAct, onAbout }: {
  c: AnnotatedComment
  platform: string | null
  /** the action running on THIS comment, else null — so another comment's spinner does not redraw this one */
  busy: string | null
  onAct: (action: CommentAction, c: AnnotatedComment, message?: string, url?: string) => Promise<boolean>
  onAbout: (handle: string) => void
}) {
  counted('CommentRow')
  const [mode, setMode] = useState<null | 'reply' | 'dm'>(null)
  const [draft, setDraft] = useState('')
  const [dmDraft, setDmDraft] = useState('')
  const [dmLink, setDmLink] = useState('')
  const hidden = c.hidden ?? c.isHidden ?? false
  const who = commentAuthor(c)
  const run = async (action: CommentAction, message?: string, url?: string) => {
    if (await onAct(action, c, message, url)) { setMode(null); setDraft(''); setDmDraft(''); setDmLink('') }
  }
  return (
    <li className="rounded-inner border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <button type="button" onClick={() => onAbout(who)} className="font-mono text-secondary-13 font-medium underline-offset-2 hover:underline">@{who}</button>
        <span className="text-secondary-13 text-muted-foreground">{ago(c.createdTime)}</span>
        {hidden && <span className="rounded-full bg-foreground/[0.06] px-2.5 py-1.5 text-chip-12 text-muted-foreground">hidden</span>}
        <span className="ml-auto"><ReplyTag c={c} platform={platform} /></span>
      </div>
      <p className="mt-1 text-body-15">{commentText(c)}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => setMode(m => (m === 'reply' ? null : 'reply'))}>
          <Reply className="h-3.5 w-3.5" /> Reply
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(m => (m === 'dm' ? null : 'dm'))}>
          <Send className="h-3.5 w-3.5" /> DM
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void run(hidden ? 'unhide' : 'hide')} disabled={busy === 'hide' || busy === 'unhide'}>
          <EyeOff className="h-3.5 w-3.5" /> {hidden ? 'Unhide' : 'Hide'}
        </Button>
        <ConfirmAction
          title="Delete this comment from the client's post?"
          body="It disappears for everyone on the client's post and cannot be restored. Hiding it instead keeps it recoverable — only the person who wrote it can still see it."
          confirmLabel="Delete comment"
          onConfirm={() => { void run('delete') }}
        >
          <Button size="sm" variant="ghost" aria-label="Delete this comment" disabled={busy === 'delete'}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </ConfirmAction>
      </div>
      {mode === 'reply' && (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea rows={2} value={draft} placeholder={`Reply to @${who}…`} onChange={e => setDraft(e.target.value)} />
          <Button size="sm" className="w-fit" onClick={() => void run('reply', draft)} disabled={!draft.trim() || busy === 'reply'}>
            {busy === 'reply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Reply className="h-3.5 w-3.5" />} Post reply
          </Button>
        </div>
      )}
      {mode === 'dm' && (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea rows={2} value={dmDraft} placeholder={`Message @${who} privately…`} onChange={e => setDmDraft(e.target.value)} />
          <Input value={dmLink} placeholder="Optional link for a button — https://…" onChange={e => setDmLink(e.target.value)} />
          <p className="text-secondary-13 text-muted-foreground">
            One private reply is allowed per comment, and only for a limited period after it was posted.
          </p>
          <Button size="sm" className="w-fit" onClick={() => void run('private_reply', dmDraft, dmLink.trim() || undefined)}
            disabled={!dmDraft.trim() || busy === 'private_reply'}>
            {busy === 'private_reply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send DM
          </Button>
        </div>
      )}
    </li>
  )
})
