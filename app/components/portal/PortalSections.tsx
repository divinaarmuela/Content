'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays, Check, ExternalLink, MessageSquare, Send } from 'lucide-react'
import type { PortalData, PortalItem } from '../../lib/portal-data'
import {
  APPROVED_TOAST, approveConsequence, changesSentToast,
  contentTypeLabel, contentTypePlural, scheduledWhen,
} from '../../lib/portal-words'

/**
 * The client portal's building blocks — themed by CSS variables set from the
 * client's own brand guidelines (--p-bg, --p-ink, --p-surface, --p-border,
 * --p-accent, --p-accent-ink, --p-heading-font). Shared by the share-link
 * portal and the logged-in portal.
 */

const surface: React.CSSProperties = {
  background: 'var(--p-surface, #ffffff)',
  border: '1px solid var(--p-border, #e4e4e7)',
}

export function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2
          className="text-xs uppercase tracking-[0.14em]"
          style={{ fontFamily: 'var(--p-mono-font, var(--p-heading-font, inherit))' }}
        >
          {children}
        </h2>
        {typeof count === 'number' && count > 0 && (
          <span
            className="px-1.5 py-0.5 font-mono text-[10px] tabular-nums"
            style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}
          >
            {String(count).padStart(2, '0')}
          </span>
        )}
      </div>
      <div className="h-0.5 w-full origin-left" style={{ background: 'var(--p-border, #e4e4e7)' }} />
    </div>
  )
}

export function CommitmentCards({ data }: { data: PortalData }) {
  const monthName = new Date(2000, (data.commitment?.month ?? new Date().getMonth() + 1) - 1, 1)
    .toLocaleString('en-AU', { month: 'long' })
  if (!data.commitment || data.commitment.quotas.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading>{monthName} at a glance</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.commitment.quotas.map(q => {
          const pct = q.quota === 0 ? 0 : Math.min(100, Math.round((q.published / q.quota) * 100))
          return (
            <div key={q.type} className="rounded-xl p-4" style={surface}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">{contentTypePlural(q.type)}</span>
                <span className="font-mono text-xs tabular-nums opacity-60">{q.published}/{q.quota}</span>
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--p-border, #e4e4e7)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--p-accent, #18181b)' }} />
              </div>
              <p className="mt-1.5 text-[11px] opacity-50">published this month</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Media({ src }: { src: string }) {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    return <video src={src} controls playsInline className="h-full w-full object-contain" />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-full w-full object-contain" />
}

/**
 * A piece awaiting the client's decision — preview large, decision obvious.
 * Approve is one click; Request changes asks for the note that makes the
 * revision loop useful.
 */
export function ReviewCard({ item, token, amName, bare }: {
  item: PortalItem; token?: string; amName?: string | null
  /** already on the piece's own page — its title is the page's heading */
  bare?: boolean
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // null = the two buttons · 'changes' = request-changes note · 'approve' = approve-with-note
  const [mode, setMode] = useState<null | 'changes' | 'approve'>(null)
  // who at the client is speaking — asked once, remembered in this browser
  const [name, setName] = useState(() =>
    typeof window === 'undefined' ? '' : localStorage.getItem('mdm-portal-name') ?? '')

  const act = async (action: 'approve' | 'request_changes') => {
    if (!token) return
    // a dead-looking disabled button explains nothing — validate loudly
    if (action === 'request_changes') {
      if (!note.trim()) return toast.error('Write what should change first')
      if (!name.trim()) return toast.error('Add your name so the team knows who asked')
    }
    if (action === 'approve' && note.trim() && !name.trim()) {
      return toast.error('Add your name so the team knows who the note is from')
    }
    if (name.trim()) localStorage.setItem('mdm-portal-name', name.trim())
    setBusy(action)
    try {
      const res = await fetch('/api/portal/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, item_id: item.id, action, comment: note, author_name: name.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      toast.success(action === 'approve' ? APPROVED_TOAST : changesSentToast(amName))
      setNote('')
      setMode(null)
      router.refresh()
    } catch (e) {
      if (e instanceof TypeError) {
        // the connection dropped — the action may or may not have landed;
        // refresh so the page shows the truth rather than guessing
        toast.message('Connection hiccup — refreshing to check…')
        router.refresh()
      } else {
        toast.error(e instanceof Error ? e.message : 'Something went wrong')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl" style={surface}>
      {item.preview_url && (
        <div className="max-h-[420px] w-full" style={{ background: '#0a0a0a' }}>
          <Media src={item.preview_url} />
        </div>
      )}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {bare ? null : token ? (
              <Link href={`/portal/${token}/item/${item.id}`} className="portal-tap text-base font-semibold underline-offset-4 hover:underline"
                style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>
                {item.title}
              </Link>
            ) : (
              <p className="text-base font-semibold" style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>{item.title}</p>
            )}
            {!bare && contentTypeLabel(item.content_type) && (
              <p className="font-mono text-[10px] uppercase tracking-wider opacity-50">{contentTypeLabel(item.content_type)}</p>
            )}
          </div>
          {item.drive_url && (
            <a href={item.drive_url} target="_blank" rel="noreferrer noopener"
              className="portal-tap flex shrink-0 items-center gap-1 text-xs opacity-60 hover:opacity-100">
              Open the file <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {token && (
          <>
            {mode === null && (
              // say what the button DOES before it is pressed — approving is a
              // handover, not a like
              <p className="text-xs opacity-60">{approveConsequence(amName)}</p>
            )}
            {mode !== null && (
              <div className="flex flex-col gap-2">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  className="min-h-11 w-full rounded-lg px-3 py-2 text-sm outline-none sm:w-56"
                  style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
                />
                <textarea
                  rows={3}
                  value={note}
                  autoFocus
                  onChange={e => setNote(e.target.value)}
                  placeholder={mode === 'changes'
                    ? 'What should change? e.g. “Tighter intro, and use the daytime shots.”'
                    : 'Anything with your approval — e.g. “Love it. Can this go out Friday morning?”'}
                  className="w-full rounded-lg p-3 text-sm outline-none"
                  style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {mode === null ? (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act('approve')}
                    className="portal-tap flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}
                  >
                    <Check className="h-4 w-4" /> {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setMode('changes')}
                    className="portal-tap flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                    style={{ background: 'transparent', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
                  >
                    <MessageSquare className="h-4 w-4" /> Request changes
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setMode('approve')}
                    className="portal-tap px-1 py-2 text-xs underline-offset-2 opacity-60 hover:underline hover:opacity-100"
                  >
                    Approve with a note
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act(mode === 'changes' ? 'request_changes' : 'approve')}
                    className="portal-tap flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}
                  >
                    {mode === 'changes'
                      ? <><Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send'}</>
                      : <><Check className="h-4 w-4" /> {busy ? 'Approving…' : 'Approve'}</>}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => { setMode(null); setNote('') }}
                    className="portal-tap rounded-lg px-3 py-2 text-sm opacity-60 hover:opacity-100"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** A piece as a media card — the work stays visible at every stage, not
 *  just while it's being reviewed. No preview yet → a quiet dark slate. */
export function PortalItemCard({ item, token }: { item: PortalItem; token?: string }) {
  const typeLabel = contentTypeLabel(item.content_type)
  // a black slate reading "in the works" under the word "Approved" is a
  // contradiction — the slate says whatever is true at this stage
  const slate = ['approved_for_scheduling', 'scheduled', 'published'].includes(item.status)
    ? 'No preview here — ask us for the file'
    : 'Preview coming soon'
  return (
    <div className="group overflow-hidden rounded-xl" style={surface}>
      <div className="relative aspect-video w-full overflow-hidden" style={{ background: '#0a0a0a' }}>
        {item.preview_url ? (
          /\.(mp4|webm|mov)(\?|$)/i.test(item.preview_url)
            ? <video src={item.preview_url} controls playsInline preload="metadata" className="h-full w-full object-cover" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={item.preview_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-3 text-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-30">{slate}</span>
          </div>
        )}
        {typeLabel && (
          <span className="absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}>
            {typeLabel}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          {token ? (
            <Link href={`/portal/${token}/item/${item.id}`} className="portal-tap-block min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline">
              {item.title}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">{item.title}</p>
          )}
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider opacity-50">{item.status_label}</span>
        </div>
        {(item.schedule.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {item.schedule.filter(s => s.scheduled_at && !s.live_url).map(s => (
              <span key={s.platform} className="flex items-center gap-1 font-mono text-[10px] uppercase opacity-60">
                <CalendarDays className="h-3 w-3" />
                {/* the hour matters to whoever is waiting for it — a date
                    alone made them ask us what time it goes out */}
                {s.platform} · {scheduledWhen(s.scheduled_at)}
              </span>
            ))}
            {item.schedule.filter(s => s.live_url).map(s => (
              <a key={s.platform} href={s.live_url!} target="_blank" rel="noreferrer noopener"
                className="portal-tap flex items-center gap-1 text-xs font-medium capitalize hover:underline"
                style={{ color: 'var(--p-accent, #18181b)' }}>
                Watch on {s.platform} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function PortalSection({ title, items, empty, token }: {
  title: string; items: PortalItem[]; empty: string; token?: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading count={items.length}>{title}</SectionHeading>
      {items.length === 0
        ? <p className="rounded-xl px-4 py-6 text-center text-sm opacity-50" style={surface}>{empty}</p>
        : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(i => <PortalItemCard key={i.id} item={i} token={token} />)}</div>}
    </div>
  )
}

/** The review queue: each awaiting piece as a full card with actions. */
export function ReviewSection({ items, token, amName }: {
  items: PortalItem[]; token?: string; amName?: string | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading count={items.length}>Needs your review</SectionHeading>
      {items.length === 0 ? (
        <p className="rounded-xl px-4 py-6 text-center text-sm opacity-50" style={surface}>
          Nothing waiting on you right now.
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map(i => <ReviewCard key={i.id} item={i} token={token} amName={amName} />)}
        </div>
      )}
    </div>
  )
}
