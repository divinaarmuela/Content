'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortalItem } from '../../lib/portal-data'
import { CLIENT_PREVIEW_INTRO } from '../../lib/post-preview-core'
import { changesSentToast } from '../../lib/portal-words'
import PostPreviewPane from '../social/PostPreview'
import { SectionHeading } from './PortalSections'
import type { Surface } from './PortalBoard'

/**
 * THE POST, ON THE CLIENT'S OWN PAGE, BEFORE IT GOES OUT.
 *
 * The client sees exactly what the team sees in the composer — the same
 * frames, from the same function — and answers with one tap. Two rules:
 *
 *  1. NO SECOND APPROVAL FLOW. Approve goes to the route that already
 *     existed (`approve_post` on the share link, the item's own
 *     posting-approval route when they are signed in), which is the same
 *     function the dashboard calls. One gate, three doors.
 *  2. NOTHING INTERNAL ON THE PAGE. The frames arrive as `ClientPreview`
 *     objects, which simply do not carry an account id or a refusal: if a
 *     rule would stop the post, that is ours to fix before we ask anybody.
 *
 * Phone first: one column, big frame, a full-width Approve, and "Ask for a
 * change" as the quiet second — the same shape as every other card here.
 */
export default function PortalPostApprovals({ items, surface, accent, className }: {
  items: PortalItem[]
  surface: Surface
  /** the client's brand colour on the Approve button, when they have one */
  accent?: React.CSSProperties
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <section className={cn('flex flex-col gap-6', className)} data-portal-section="posts">
      <SectionHeading count={items.length}>
        {items.length === 1 ? 'A POST WAITING ON YOU' : 'POSTS WAITING ON YOU'}
      </SectionHeading>
      <p className="text-[14px] text-muted-foreground">{CLIENT_PREVIEW_INTRO}</p>
      {items.map(item => (
        <PostApprovalCard key={item.id} item={item} surface={surface} accent={accent} />
      ))}
    </section>
  )
}

function PostApprovalCard({ item, surface, accent }: {
  item: PortalItem
  surface: Surface
  accent?: React.CSSProperties
}) {
  const router = useRouter()
  const token = 'token' in surface ? surface.token : null
  const [busy, setBusy] = useState<'approve' | 'change' | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [answered, setAnswered] = useState<string | null>(null)

  const refresh = () => {
    router.refresh()
    if ('loggedIn' in surface) surface.onChanged()
  }

  const act = async (what: 'approve' | 'change') => {
    const words = note.trim()
    if (what === 'change' && !words) {
      toast.error('Tell us what to change — a few words is enough')
      return
    }
    setBusy(what)
    try {
      const res = token
        ? await fetch('/api/portal/act', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            item_id: item.id,
            action: what === 'approve' ? 'approve_post' : 'request_post_changes',
            comment: words,
          }),
        })
        : await fetch(`/api/production/items/${item.id}/posting-approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: what === 'approve' ? 'approve' : 'request_changes',
            ...(words ? { note: words } : {}),
          }),
        })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? 'Something went wrong')
      }
      toast.success(what === 'approve'
        ? 'Approved — it will go out as you saw it.'
        : changesSentToast(null))
      setAnswered(what === 'approve'
        ? 'You approved this post.'
        : 'You asked for a change — we are on it.')
      setAsking(false)
      setNote('')
      refresh()
    } catch (e) {
      if (e instanceof TypeError) {
        toast.message('Connection hiccup — refreshing to check…')
        refresh()
      } else {
        toast.error(e instanceof Error ? e.message : 'Something went wrong')
      }
    } finally {
      setBusy(null)
    }
  }

  const frames = item.preview ?? []

  return (
    <article className="flex flex-col gap-4 rounded-inner border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-[17px] font-semibold leading-tight">{item.title}</h3>

      {frames.length > 0 ? (
        <PostPreviewPane
          previews={frames}
          empty="This post has no channel on it yet."
        />
      ) : (
        // the frames could not be built — the words are still the words
        item.caption?.trim() && (
          <p className="whitespace-pre-line rounded-inner border border-border bg-paper p-3 text-[14px] leading-[1.5]">
            {item.caption}
          </p>
        )
      )}

      {answered ? (
        <p className="text-[14px] font-semibold">{answered}</p>
      ) : asking ? (
        <div className="flex flex-col gap-2.5">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="What should change?"
            className="w-full resize-y rounded-inner border border-border bg-background p-3 text-[15px] outline-none"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('change')}
              className="min-h-11 rounded-full bg-foreground px-5 text-[15px] font-semibold text-background disabled:opacity-60"
            >
              {busy === 'change' ? 'Sending…' : 'Send it'}
            </button>
            <button
              type="button"
              onClick={() => { setAsking(false); setNote('') }}
              className="min-h-11 rounded-full border border-border px-5 text-[15px] font-semibold"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act('approve')}
            style={accent}
            className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-semibold text-background disabled:opacity-60"
          >
            <Check className="h-4 w-4" strokeWidth={2.4} aria-hidden />
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="min-h-11 rounded-full border border-border px-5 text-[15px] font-semibold"
          >
            Ask for a change
          </button>
        </div>
      )}

      {!answered && (
        <p className="text-[13px] text-muted-foreground">
          Approving means it goes out exactly as you have just seen it.
        </p>
      )}
    </article>
  )
}
