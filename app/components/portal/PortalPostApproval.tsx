'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortalWaitingPost } from '../../lib/portal-data'
import { CLIENT_PREVIEW_INTRO } from '../../lib/post-preview-core'
import { portalWaitingPath } from '../../lib/portal-core'
import { portalPostHref } from '../../lib/post-page-core'
import PostPreviewPane from '../social/PostPreview'
import { SectionHeading } from './PortalSections'
import type { Surface } from './PortalBoard'

/**
 * THE POSTS WAITING ON THE CLIENT, at the top of their page (the posting
 * rebuild, 29 Sep 2026).
 *
 * Only posts that are With client, that actually reached them, and whose
 * approve-by time is still open (audit P9, decision 11). Each shows the
 * VERSION THEY WERE SENT — the frames are built from `post_versions`, never
 * the live post (audit P2) — and carries that version number with the
 * answer, so the server refuses a yes to anything else.
 *
 * On the share link every post opens its own page (every file, a note on
 * each, the answer). Signed in, there is no share token, so the answer is
 * given here, through the same route and the same rules.
 */
export default function PortalPostApprovals({ items, missed = 0, surface, accent, className }: {
  items: PortalWaitingPost[]
  /** how many posts missed their time while with the client */
  missed?: number
  surface: Surface
  /** the client's brand colour on the Approve button, when they have one */
  accent?: React.CSSProperties
  className?: string
}) {
  if (items.length === 0 && missed === 0) return null
  const token = 'token' in surface ? surface.token : null
  return (
    <section className={cn('flex flex-col gap-6', className)} data-portal-section="posts">
      {items.length > 0 && (
        <>
          <SectionHeading count={items.length}>
            {items.length === 1 ? 'A POST WAITING ON YOU' : 'POSTS WAITING ON YOU'}
          </SectionHeading>
          <p className="text-[14px] text-muted-foreground">
            {CLIENT_PREVIEW_INTRO}
            {token && items.length > 1 && (
              <> <Link href={portalWaitingPath(token)} className="font-semibold text-foreground underline underline-offset-4">See them all on one page</Link>.</>
            )}
          </p>
          {items.map(item => (
            <WaitingPostCard key={item.id} item={item} surface={surface} accent={accent} />
          ))}
        </>
      )}
      {missed > 0 && (
        <p role="status" className="rounded-inner border border-border bg-surface px-4 py-3 text-[14px]">
          {missed === 1 ? 'One post' : `${missed} posts`} passed {missed === 1 ? 'its' : 'their'} time before you could answer. The team will send you a new time.
        </p>
      )}
    </section>
  )
}

function WaitingPostCard({ item, surface, accent }: {
  item: PortalWaitingPost
  surface: Surface
  accent?: React.CSSProperties
}) {
  const router = useRouter()
  const token = 'token' in surface ? surface.token : null
  const [busy, setBusy] = useState<'approve' | 'change' | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [answered, setAnswered] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = () => {
    router.refresh()
    if ('loggedIn' in surface) surface.onChanged()
  }

  // signed in only: the share link answers on the post's own page
  const act = async (what: 'approve' | 'change') => {
    const words = note.trim()
    if (what === 'change' && !words) { setProblem('Say what to change — a few words is enough.'); return }
    setBusy(what); setProblem(null)
    try {
      const res = await fetch('/api/portal/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: item.id,
          version: item.version,
          action: what === 'approve' ? 'client_approve' : 'client_ask_change',
          ...(words ? { note: words } : {}),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(j?.error ?? 'That did not go through — try again in a moment.'))
      toast.success(what === 'approve' ? 'Approved — thank you.' : 'Thanks — we have your note.')
      setAnswered(what === 'approve' ? 'You approved this post.' : 'Thanks — we have your note. The team is making the change.')
      setAsking(false)
      setNote('')
      refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That did not go through — try again in a moment.')
      refresh()
    } finally {
      setBusy(null)
    }
  }

  const frames = item.preview ?? []

  return (
    <article className="flex flex-col gap-4 rounded-inner border border-border bg-surface p-4 sm:p-5" data-portal-post={item.id}>
      <div className="flex flex-col gap-1">
        <h3 className="text-[17px] font-semibold leading-tight">{item.title}</h3>
        <p className="text-[13px] text-muted-foreground">
          {[item.type_line, item.networks.join(' · ') || null, item.when ? `Goes out ${item.when}` : null].filter(Boolean).join(' · ')}
        </p>
        {item.approve_by && <p className="text-[14px] font-semibold">{item.approve_by}</p>}
      </div>

      {frames.length > 0 ? (
        <PostPreviewPane previews={frames} empty="This post has no network on it yet." />
      ) : item.cover ? (
        <div className="overflow-hidden rounded-tile bg-foreground/[0.06]">
          {item.cover.type === 'video'
            ? <video src={item.cover.url} muted playsInline preload="metadata" className="max-h-[420px] w-full object-contain" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={item.cover.url} alt="" loading="lazy" className="max-h-[420px] w-full object-contain" />}
        </div>
      ) : null}

      {answered ? (
        <p role="status" className="text-[14px] font-semibold">{answered}</p>
      ) : token ? (
        // ONE WAY IN: the post's own page — every file, a note on each, the answer
        <Link href={portalPostHref(token, item.id)} style={accent}
          className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-semibold text-background sm:w-fit">
          <Check className="h-4 w-4" strokeWidth={2.4} aria-hidden /> Review and approve
        </Link>
      ) : asking ? (
        <div className="flex flex-col gap-2.5">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus maxLength={2000}
            placeholder="What should change?" aria-label="What should change?"
            className="w-full resize-y rounded-inner border border-border bg-background p-3 text-[15px] outline-none" />
          {problem && <p role="alert" className="text-[14px] text-accent-red">{problem}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={busy !== null} onClick={() => void act('change')}
              className="min-h-11 rounded-full bg-foreground px-5 text-[15px] font-semibold text-background disabled:opacity-60">
              {busy === 'change' ? 'Sending…' : 'Send my note'}
            </button>
            <button type="button" onClick={() => { setAsking(false); setNote(''); setProblem(null) }}
              className="min-h-11 rounded-full border border-border px-5 text-[15px] font-semibold">
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {problem && <p role="alert" className="text-[14px] text-accent-red">{problem}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" disabled={busy !== null} onClick={() => void act('approve')} style={accent}
              className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-semibold text-background disabled:opacity-60">
              <Check className="h-4 w-4" strokeWidth={2.4} aria-hidden />
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" onClick={() => { setAsking(true); setProblem(null) }}
              className="min-h-11 rounded-full border border-border px-5 text-[15px] font-semibold">
              Ask for a change
            </button>
          </div>
          <p className="text-[13px] text-muted-foreground">Approving means this version goes out, as you see it here.</p>
        </div>
      )}
    </article>
  )
}
