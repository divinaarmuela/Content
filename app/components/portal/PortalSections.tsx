'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays, Check, ExternalLink, MessageSquare, Send } from 'lucide-react'
import type { PortalData, PortalItem } from '../../lib/portal-data'

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
    <div className="flex items-baseline gap-2.5">
      <h2 className="text-base font-semibold tracking-tight" style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>
        {children}
      </h2>
      {typeof count === 'number' && count > 0 && (
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums"
          style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}
        >
          {count}
        </span>
      )}
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
                <span className="text-sm font-medium capitalize">{q.type}s</span>
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
export function ReviewCard({ item, token }: { item: PortalItem; token?: string }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  // who at the client is speaking — asked once, remembered in this browser
  const [name, setName] = useState(() =>
    typeof window === 'undefined' ? '' : localStorage.getItem('mdm-portal-name') ?? '')

  const act = async (action: 'approve' | 'request_changes') => {
    if (!token) return
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
      toast.success(action === 'approve' ? 'Approved — thank you!' : 'Sent to your account manager')
      setNote('')
      setAsking(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
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
            <p className="text-base font-semibold" style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>{item.title}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider opacity-50">{item.content_type}</p>
          </div>
          {item.drive_url && (
            <a href={item.drive_url} target="_blank" rel="noreferrer noopener"
              className="flex shrink-0 items-center gap-1 text-xs opacity-60 hover:opacity-100">
              Full quality <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {token && (
          <>
            {asking && (
              <div className="flex flex-col gap-2">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none sm:w-56"
                  style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
                />
                <textarea
                  rows={3}
                  value={note}
                  autoFocus
                  onChange={e => setNote(e.target.value)}
                  placeholder="What should change? e.g. “Tighter intro, and use the daytime shots.”"
                  className="w-full rounded-lg p-3 text-sm outline-none"
                  style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {!asking ? (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act('approve')}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}
                  >
                    <Check className="h-4 w-4" /> {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setAsking(true)}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                    style={{ background: 'transparent', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
                  >
                    <MessageSquare className="h-4 w-4" /> Request changes
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy !== null || !note.trim() || !name.trim()}
                    onClick={() => act('request_changes')}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}
                  >
                    <Send className="h-4 w-4" /> {busy === 'request_changes' ? 'Sending…' : 'Send to your account manager'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => { setAsking(false); setNote('') }}
                    className="rounded-lg px-3 py-2 text-sm opacity-60 hover:opacity-100"
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

export function PortalItemRow({ item }: { item: PortalItem }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={surface}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="font-mono text-[10px] uppercase tracking-wider opacity-50">{item.content_type}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {item.schedule.filter(s => s.scheduled_at && !s.live_url).map(s => (
          <span key={s.platform} className="flex items-center gap-1 font-mono text-[10px] uppercase opacity-60">
            <CalendarDays className="h-3 w-3" />
            {s.platform} · {new Date(s.scheduled_at!).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
          </span>
        ))}
        {item.schedule.filter(s => s.live_url).map(s => (
          <a key={s.platform} href={s.live_url!} target="_blank" rel="noreferrer noopener"
            className="flex items-center gap-1 text-xs font-medium capitalize hover:underline"
            style={{ color: 'var(--p-accent, #18181b)' }}>
            {s.platform} <ExternalLink className="h-3 w-3" />
          </a>
        ))}
        <span className="rounded-full px-2.5 py-1 text-[11px]"
          style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)' }}>
          {item.status_label}
        </span>
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
        : <div className="flex flex-col gap-2">{items.map(i => <PortalItemRow key={i.id} item={i} />)}</div>}
      {void token}
    </div>
  )
}

/** The review queue: each awaiting piece as a full card with actions. */
export function ReviewSection({ items, token }: { items: PortalItem[]; token?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading count={items.length}>Ready for your review</SectionHeading>
      {items.length === 0 ? (
        <p className="rounded-xl px-4 py-6 text-center text-sm opacity-50" style={surface}>
          Nothing waiting on you — we&rsquo;ll email you when the next piece is ready.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map(i => <ReviewCard key={i.id} item={i} token={token} />)}
        </div>
      )}
    </div>
  )
}
