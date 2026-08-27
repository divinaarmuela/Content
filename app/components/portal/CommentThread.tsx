'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import type { PortalComment } from '../../lib/portal-thread'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * The conversation on a portal child page — a persistent thread, written
 * inline on the page itself. Comments stay for everyone: the client sees
 * the team's replies, the team reads the client's notes from the dashboard.
 */
export default function CommentThread({
  token, kind, id, comments,
}: {
  token: string
  kind: 'item' | 'shoot'
  id: string
  comments: PortalComment[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try { setName(localStorage.getItem('mdm-portal-name') ?? '') } catch { /* fine */ }
  }, [])

  const send = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    setError(null)
    try { localStorage.setItem('mdm-portal-name', name) } catch { /* fine */ }
    const res = await fetch('/api/portal/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, kind, id, author_name: name, body: draft }),
    })
    setSending(false)
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? 'Could not send — try again')
      return
    }
    setDraft('')
    router.refresh()
  }

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-xs uppercase tracking-[0.14em]" style={{ fontFamily: 'var(--p-mono-font, inherit)' }}>
        COMMENTS
        {comments.length > 0 && <span className="ml-2 opacity-50">{String(comments.length).padStart(2, '0')}</span>}
      </h2>

      <div className="flex flex-col gap-4">
        {comments.length === 0 && (
          <p className="text-sm opacity-50">No comments yet — start the conversation below.</p>
        )}
        {comments.map(c => (
          <div key={c.id} className="flex gap-3">
            <span
              className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-semibold uppercase"
              style={c.from_team
                ? { background: 'var(--p-accent)', color: 'var(--p-accent-ink)' }
                : { border: '1px solid var(--p-border)', opacity: 0.9 }}
            >
              {c.author_name.trim().charAt(0) || '?'}
            </span>
            <div className="min-w-0 flex-1 border-b pb-4" style={{ borderColor: 'var(--p-border)' }}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs" style={{ fontFamily: 'var(--p-mono-font, inherit)' }}>
                <span className="font-semibold">{c.author_name}</span>
                {c.from_team && (
                  <span className="px-1 py-px text-[9px] uppercase tracking-[0.12em]"
                    style={{ background: 'var(--p-accent)', color: 'var(--p-accent-ink)' }}>
                    MD Media
                  </span>
                )}
                <span className="opacity-40">{when(c.created_at)}</span>
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{c.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* the composer lives on the page, not in a popup */}
      <div className="flex flex-col gap-2.5 border p-4" style={{ borderColor: 'var(--p-border)', background: 'var(--p-surface)' }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          className="min-h-11 w-full max-w-[240px] border-b bg-transparent pb-1 text-sm outline-none placeholder:opacity-40"
          style={{ borderColor: 'var(--p-border)' }}
        />
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
          placeholder="Write a comment — it stays on this page for you and the team…"
          rows={3}
          className="min-h-11 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:opacity-40"
        />
        {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          className="portal-tap flex w-fit items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] transition-opacity disabled:opacity-40"
          style={{ background: 'var(--p-accent)', color: 'var(--p-accent-ink)', fontFamily: 'var(--p-mono-font, inherit)' }}
        >
          <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  )
}
