'use client'

import { useCallback, useEffect, useState } from 'react'
import { CAL_TZ } from '../../lib/gcal-core'
import { canComment, MAX_PROPOSAL_COMMENT, type ProposalComment, type ShootStatus } from '../../lib/shoot-core'

/**
 * Yes / No, in the same dark visual world as the intake form.
 *
 * The FIRST answer is final — the link is shared between several recipients,
 * so the page re-checks the status when the tab regains focus (and on a slow
 * poll) and locks itself the moment a co-recipient has answered. A cancelled
 * proposal reads as no longer available.
 *
 * And the client can say more than Yes or No (the owner, 30 Oct 2026: "leave comments") — a box under the answer,
 * open until the date is called off; the team is emailed each one. `inline` draws it as a card on the portal's Shoot
 * brief tab, open there without a click, rather than as a page of its own.
 */
export default function ShootAnswer({
  token, clientName, title, startsAt, endsAt, location, note, initialStatus, backHref, initialComments = [], inline = false,
}: {
  token: string
  /** on the one portal: the way back to it (app/portal/[token]/home) */
  backHref?: string | null
  clientName: string
  title: string
  startsAt: string
  endsAt: string
  location: string | null
  note: string | null
  initialStatus: ShootStatus
  initialComments?: ProposalComment[]
  /** a card on the portal's Shoot brief tab, not a page of its own */
  inline?: boolean
}) {
  const [status, setStatus] = useState<ShootStatus>(initialStatus)
  const [comments, setComments] = useState<ProposalComment[]>(initialComments)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [sending, setSending] = useState<'yes' | 'no' | null>(null)
  const [beaten, setBeaten] = useState(false) // their click arrived second
  const [error, setError] = useState('')

  const day = new Date(startsAt).toLocaleDateString('en-AU', {
    timeZone: CAL_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', { timeZone: CAL_TZ, hour: 'numeric', minute: '2-digit' })

  // a pre-opened tab catches up when they come back to it
  const sync = useCallback(async () => {
    try {
      const res = await fetch(`/api/shoot/${token}`)
      if (res.ok) {
        const json = await res.json()
        setStatus(json.status as ShootStatus)
        if (Array.isArray(json.comments)) setComments(json.comments)
      }
    } catch { /* offline — the answer POST still re-checks server-side */ }
  }, [token])

  useEffect(() => {
    if (status !== 'pending') return
    const onFocus = () => void sync()
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => void sync(), 60_000)
    return () => { window.removeEventListener('focus', onFocus); window.clearInterval(id) }
  }, [status, sync])

  const answer = async (a: 'yes' | 'no') => {
    if (sending) return
    setSending(a)
    setError('')
    try {
      const res = await fetch(`/api/shoot/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: a }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      setStatus(json.status as ShootStatus)
      setBeaten(json.applied === false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again')
    } finally {
      setSending(null)
    }
  }

  const comment = async () => {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    setCommentError('')
    try {
      const res = await fetch(`/api/shoot/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      setComments(json.comments)
      setDraft('')
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : 'Something went wrong — please try again')
    } finally {
      setPosting(false)
    }
  }
  const said = (iso: string) =>
    new Date(iso).toLocaleString('en-AU', { timeZone: CAL_TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

  const pill = (a: 'yes' | 'no', label: string) => (
    <button
      type="button"
      onClick={() => void answer(a)}
      disabled={sending !== null}
      className={
        'rounded-full px-8 py-4 font-lamam text-[12px] font-bold uppercase tracking-widest transition-opacity ' +
        'disabled:opacity-50 ' +
        (a === 'yes'
          ? 'bg-cream text-ink hover:opacity-85'
          : 'border border-cream/30 bg-transparent text-cream-dim hover:border-cream/60 hover:text-cream')
      }
    >
      {sending === a ? '…' : label}
    </button>
  )

  return (
    <div data-shoot-proposal={token} className={inline
      ? 'flex w-full flex-col items-center rounded-card bg-ink px-6 py-10 text-cream'
      : 'flex min-h-screen flex-col items-center justify-center bg-ink px-6 py-16 text-cream'}>
      {!inline && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/MDLogo-trim.png" alt="MD Media" className="mb-12 h-6 w-auto" />
      )}
      {backHref && <a href={backHref} className="-mt-6 mb-8 inline-flex min-h-11 items-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim underline-offset-4 hover:underline">← Your portal</a>}

      <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-faint">
        Shoot proposal{clientName ? ` · ${clientName}` : ''}
      </p>

      <h1 className="mt-5 max-w-[22ch] text-center font-lamah text-[30px] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        {title}
      </h1>

      <div className="mt-8 flex flex-col items-center gap-1.5 text-center">
        <p className="font-lamah text-[18px] text-cream">{day}</p>
        <p className="font-lamam text-[12px] uppercase tracking-widest text-cream-dim">
          {time(startsAt)} – {time(endsAt)} · Melbourne time
        </p>
        {location && <p className="mt-1 font-lamah text-[15px] text-cream-dim">{location}</p>}
      </div>

      {note && (
        <p className="mt-6 max-w-[48ch] text-center font-lamah text-[15px] leading-relaxed text-cream-dim">
          {note}
        </p>
      )}

      {status === 'cancelled' ? (
        <p className="mt-10 max-w-[40ch] text-center font-lamam text-[12px] uppercase tracking-widest leading-relaxed text-cream-faint">
          This proposal is no longer active — we&rsquo;ll be in touch with a new date.
        </p>
      ) : status === 'pending' ? (
        <>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            {pill('yes', 'Yes, works for us')}
            {pill('no', 'No, that doesn’t work')}
          </div>
          {error && <p className="mt-5 font-lamam text-[12px] tracking-widest text-[#E2725B]">{error}</p>}
        </>
      ) : (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <p className="font-lamam text-[11px] uppercase tracking-widest text-cream">
            {status === 'accepted'
              ? 'Locked in ✓ — we have it in our calendar'
              : 'Declined — we’ll propose another date'}
          </p>
          {beaten && (
            <p className="max-w-[42ch] font-lamah text-[14px] leading-relaxed text-cream-dim">
              Someone from your side answered just before you, so their answer stands.
            </p>
          )}
          <p className="max-w-[42ch] font-lamah text-[13px] text-cream-faint">
            Plans changed? Email{' '}
            <a href="mailto:hello@mdmmarketing.com.au" className="text-cream-dim underline">
              hello@mdmmarketing.com.au
            </a>{' '}
            and we&rsquo;ll sort a new date.
          </p>
        </div>
      )}

      {/* ANYTHING TO ADD — what was said, then a box, open until the date is called off */}
      {(comments.length > 0 || canComment(status)) && (
        <div className="mt-10 flex w-full max-w-[460px] flex-col gap-3 border-t border-cream/15 pt-6">
          {comments.length > 0 && (
            <ol className="flex flex-col gap-2.5">
              {comments.map(c => (
                <li key={c.id} className="rounded-2xl bg-cream/[0.06] px-4 py-3">
                  <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-faint">
                    {clientName || 'You'} · <span suppressHydrationWarning>{said(c.at)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words font-lamah text-[15px] leading-relaxed text-cream">{c.body}</p>
                </li>
              ))}
            </ol>
          )}
          {canComment(status) && (
            <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); void comment() }}>
              <label htmlFor={`shoot-comment-${token}`} className="font-lamam text-[10px] uppercase tracking-widest text-cream-dim">
                Anything to add?
              </label>
              <textarea
                id={`shoot-comment-${token}`}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                maxLength={MAX_PROPOSAL_COMMENT}
                rows={3}
                placeholder="e.g. Can we start an hour later? Or would Thursday work instead?"
                className="w-full resize-none rounded-2xl border border-cream/20 bg-transparent px-4 py-3 font-lamah text-[15px] text-cream placeholder:text-cream-faint focus:border-cream/50 focus:outline-none"
              />
              <button type="submit" disabled={posting || !draft.trim()}
                className="min-h-11 self-end rounded-full bg-cream px-6 font-lamam text-[11px] font-bold uppercase tracking-widest text-ink transition-opacity hover:opacity-85 disabled:opacity-40">
                {posting ? 'Sending…' : 'Send to MD Media'}
              </button>
              {commentError && <p className="font-lamam text-[12px] tracking-widest text-[#E2725B]">{commentError}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  )
}
