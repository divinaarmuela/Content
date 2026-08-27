'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays, Check, ExternalLink, MessageSquare, Send } from 'lucide-react'
import type { PortalData, PortalItem } from '../../lib/portal-data'
import SlideCarousel from '../media/SlideCarousel'
import { seenLabel, slidesFor } from '../../lib/slide-carousel-core'
import {
  APPROVED_TOAST, approveConsequence, changesSentToast,
  contentTypeLabel, contentTypePlural, scheduledWhen,
} from '../../lib/portal-words'
import {
  METRICS_PENDING_LINE, compactCount, metricCells, metricsPending,
  monthTotalsLine, typeTotalsLine, updatedAgo,
} from '../../lib/post-analytics-core'

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

/**
 * How a published post is doing — Views · Likes · Comments · Shares · Saves.
 *
 * Only the figures the platform actually reported appear: a missing metric is
 * a metric that platform does not publish (Reels have no impressions, stills
 * have no plays), and printing "0 saves" for it would be a number the client
 * would try to explain. Nothing yet, or the provider still syncing, gets one
 * honest sentence instead.
 */
export function PostMetricsRow({ item }: { item: PortalItem }) {
  const m = item.metrics
  const cells = metricCells(m)
  if (metricsPending(m)) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-wider opacity-40">
        {METRICS_PENDING_LINE}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {cells.map(c => (
          <span key={c.key} className="flex items-baseline gap-1">
            <span className="font-mono text-xs tabular-nums">{compactCount(c.value)}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider opacity-45">{c.label}</span>
          </span>
        ))}
      </div>
      {/* a figure with no age on it invites the reader to think it is live */}
      {m?.synced_at && (
        <span className="font-mono text-[9px] uppercase tracking-wider opacity-35" suppressHydrationWarning>
          <UpdatedAgo iso={m.synced_at} />
        </span>
      )}
    </div>
  )
}

/** Rendered on the client after mount: "12 min ago" computed on the server
 *  and again in the browser is two different sentences a minute apart, and
 *  React calls that a hydration error. */
function UpdatedAgo({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => setText(updatedAgo(iso))
    tick()
    const t = setInterval(tick, 60_000)
    return () => clearInterval(t)
  }, [iso])
  return <>{text ?? ''}</>
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
  // which cards of a carousel this browser has actually had on screen. It is
  // printed beside Approve and nothing more: approving is the client's call,
  // and a portal that refuses the button until they have flicked through six
  // images is a portal arguing with the person paying for the work.
  const [seen, setSeen] = useState<number[]>([])
  const slides = slidesFor(item)
  const seenLine = seenLabel(seen, slides.length)
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
      {slides.length > 0 && (
        <SlideCarousel
          slides={slides}
          aspect="natural"
          naturalMax="max-h-[420px]"
          mode="full"
          className="pb-1"
          chromeClassName="px-4"
          label={`${item.title} — ${slides.length} slides`}
          onSeenChange={s => setSeen(s.seen)}
        />
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
                  {/* a carousel is approved whole — this says how much of it
                      they have actually looked at. It never disables Approve;
                      see the note on `seen`. */}
                  {seenLine && (
                    <span className="font-mono text-[10px] uppercase tracking-wider opacity-50">
                      {seenLine}
                    </span>
                  )}
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
export function PortalItemCard({ item, token, tz }: {
  item: PortalItem; token?: string
  /** the client's own zone — every posting time on the card is in it */
  tz?: string
}) {
  const typeLabel = contentTypeLabel(item.content_type)
  const slides = slidesFor(item)
  // a black slate reading "in the works" under the word "Approved" is a
  // contradiction — the slate says whatever is true at this stage
  const slate = ['approved_for_scheduling', 'scheduled', 'published'].includes(item.status)
    ? 'No preview here — ask us for the file'
    : 'Preview coming soon'
  const isPublished = item.status === 'published'
  // once a piece is live, the thing behind its name is the POST — the client
  // asked "where is it", and a link to our own page about it is not an answer
  const liveUrl = isPublished
    ? item.metrics?.post_url ?? item.schedule.find(s => s.live_url)?.live_url ?? null
    : null
  return (
    <div className="group overflow-hidden rounded-xl" style={surface}>
      <div className="relative w-full overflow-hidden" style={{ background: '#0a0a0a' }}>
        {slides.length > 0 ? (
          // square, not 16:9: a Reel or a 4:5 carousel card cropped to a
          // letterbox is the wrong half of the picture
          <SlideCarousel slides={slides} aspect="square" mode="compact"
            label={`${item.title}${slides.length > 1 ? ` — ${slides.length} slides` : ''}`} />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center px-3 text-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-30">{slate}</span>
          </div>
        )}
        {typeLabel && (
          <span className="absolute left-2 top-2 z-10 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}>
            {typeLabel}
          </span>
        )}
        {slides.length > 1 && (
          <span className="absolute right-2 top-2 z-10 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white">
            {slides.length} slides
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          {liveUrl ? (
            <a href={liveUrl} target="_blank" rel="noreferrer noopener"
              className="portal-tap-block flex min-w-0 items-baseline gap-1 text-sm font-medium underline-offset-4 hover:underline">
              <span className="min-w-0 truncate">{item.title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 self-center opacity-60" />
            </a>
          ) : token ? (
            <Link href={`/portal/${token}/item/${item.id}`} className="portal-tap-block min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline">
              {item.title}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">{item.title}</p>
          )}
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider opacity-50">{item.status_label}</span>
        </div>
        {isPublished && <PostMetricsRow item={item} />}
        {/* the piece was pulled back out of their review by a new cut — the
            card that was asking them to approve it is gone, and saying nothing
            about that reads as work disappearing */}
        {item.progress_line && (
          <p className="text-xs opacity-60">{item.progress_line}</p>
        )}
        {(item.schedule.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {item.schedule.filter(s => s.scheduled_at && !s.live_url).map(s => (
              <span key={s.platform} className="flex items-center gap-1 font-mono text-[10px] uppercase opacity-60">
                <CalendarDays className="h-3 w-3" />
                {/* the hour matters to whoever is waiting for it — a date
                    alone made them ask us what time it goes out */}
                {s.platform} · {scheduledWhen(s.scheduled_at, tz)}
              </span>
            ))}
            {/* the title already IS that link once the piece is live — a
                second one to the same URL is just noise on the card */}
            {item.schedule.filter(s => s.live_url && s.live_url !== liveUrl).map(s => (
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

export function PortalSection({ title, items, empty, token, lines, tz }: {
  title: string; items: PortalItem[]; empty: string; token?: string
  /** the client's own zone, handed down to every card's posting time */
  tz?: string
  /** one-line roll-ups printed under the heading — the month's totals */
  lines?: (string | null)[]
}) {
  const shown = (lines ?? []).filter((l): l is string => Boolean(l))
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading count={items.length}>{title}</SectionHeading>
      {shown.length > 0 && (
        <div className="-mt-1 flex flex-col gap-0.5">
          {shown.map((l, i) => (
            <p key={l}
              className={i === 0
                ? 'font-mono text-[11px] tracking-wide opacity-70'
                : 'font-mono text-[10px] tracking-wide opacity-45'}>
              {l}
            </p>
          ))}
        </div>
      )}
      {items.length === 0
        ? <p className="rounded-xl px-4 py-6 text-center text-sm opacity-50" style={surface}>{empty}</p>
        : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(i => <PortalItemCard key={i.id} item={i} token={token} tz={tz} />)}</div>}
    </div>
  )
}

/**
 * The lines under the Published heading: the month in total, then the same
 * month per kind of piece. Shared so the share-link portal and the logged-in
 * portal say the identical thing.
 */
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
