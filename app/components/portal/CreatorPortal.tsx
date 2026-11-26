'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowRight, Check } from 'lucide-react'
import { followerWords } from '../../lib/creator-campaign-core'
import { chosenWords, seatLine, type ClientCampaign, type ClientCreator } from '../../lib/creator-portal-core'

/**
 * A CREATOR CAMPAIGN, AS THE CLIENT SEES IT.
 *
 * Second look (the owner, 26 Nov 2026, on the first two: "looks ai slop" and then "nah not nice" — a column of boxed
 * cards in the middle of the screen, a small capital label on every one). So: the whole width of the screen; the
 * cover photograph half of the first screen with the title set large beside it and the ONE thing to do next under
 * it; no boxes — a band of three plain columns under a single rule; then every creator as a spread of their own, a
 * large portrait with their posts beside it; then who was said yes to, as a wall of portraits.
 *
 * THREE TABS across the top — Overview, To choose, Your creators (the owner, watching the one-long-page version:
 * "why only one tab"). Each is a page of its own, so a client with one thing to do is not scrolling past the rest.
 * MD Media's own look: ink and cream following the portal's light/dark switch, one blue for the thing to press.
 * Pictures are 14px-cornered, buttons are pills, nothing else is rounded.
 *
 * Each answer is sent with the version of the creator the client was looking at; if the team changed that creator
 * in between, the page shows them as they now stand instead of answering on something stale.
 */

// one left edge for the whole page: the title, the facts and every creator start on the same line
const WIDE = 'w-full px-5 sm:px-10 lg:px-16'
const PRIMARY = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent-blue px-7 text-[15px] font-semibold text-white transition-transform hover:bg-accent-blue-deep active:scale-[0.98] disabled:opacity-60'
const QUIET = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-foreground/25 px-7 text-[15px] font-semibold transition-colors hover:border-foreground active:scale-[0.98] disabled:opacity-60'

type Tab = 'overview' | 'choose' | 'yours'

export default function CreatorPortal({ token, clientName, view, when, backHref }: {
  token: string
  clientName: string
  view: ClientCampaign
  /** the day and time, already in words */
  when: string | null
  /** the client's other campaigns, when they have more than one */
  backHref: string | null
}) {
  const [rows, setRows] = useState<ClientCreator[]>([...view.shortlist, ...view.chosen, ...view.passed])
  const [tab, setTab] = useState<Tab>('overview')
  const [busy, setBusy] = useState<string | null>(null)
  const [noting, setNoting] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [showPassed, setShowPassed] = useState(false)

  const shortlist = rows.filter(r => r.stage === 'with_client')
  const chosen = rows.filter(r => r.stage === 'approved' || r.stage === 'invited' || r.stage === 'confirmed')
  const passed = rows.filter(r => r.stage === 'passed')
  const open = view.open_for_answers
  const confirmed = chosen.filter(r => r.stage === 'confirmed')
  const seats = view.seats

  const answer = async (row: ClientCreator, to: 'approved' | 'passed') => {
    setBusy(row.id)
    try {
      const res = await fetch('/api/portal/creators', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, campaign_id: view.id, row_id: row.id, to, expect_rev: row.rev, note: notes[row.id] ?? null }),
      })
      const json = await res.json().catch(() => ({}))
      const now = (json?.creator ?? json?.fresh) as Pick<ClientCreator, 'stage' | 'client_note' | 'rev'> | undefined
      if (now) setRows(rs => rs.map(r => (r.id === row.id ? { ...r, stage: now.stage, client_note: now.client_note, rev: now.rev } : r)))
      if (!res.ok) { toast.error(json?.error ?? 'That did not save. Try again.'); return }
      toast.success(to === 'approved' ? `Yes to ${row.name}` : `Passed on ${row.name}`)
      // a note belongs to the answer it was sent with, not to the next one
      setNotes(n => { const { [row.id]: _sent, ...rest } = n; void _sent; return rest })
      setNoting(null)
    } catch {
      toast.error('That did not save. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const waiting = open && shortlist.length > 0
  const nextStep = !open ? view.next_step
    : shortlist.length > 0 ? `${shortlist.length} ${shortlist.length === 1 ? 'creator is' : 'creators are'} waiting on your yes or no.`
      : chosen.length > 0 ? 'Nothing is waiting on you right now.' : 'We are finding your creators. They will be here.'
  const closes = view.steps.find(s => s.key === 'closes')?.when ?? null
  const go = (t: Tab) => { setTab(t); if (typeof window !== 'undefined') window.scrollTo({ top: 0 }) }
  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: 'overview', label: 'Overview', count: null },
    { key: 'choose', label: 'To choose', count: shortlist.length },
    { key: 'yours', label: 'Your creators', count: chosen.length },
  ]
  // no cover yet: the creators themselves are the picture
  const faces = [...chosen, ...shortlist].map(r => r.photo_url ?? r.sample_images[0]).filter((s): s is string => !!s).slice(0, 4)

  return (
    <div className="flex flex-col pb-24" data-creator-portal>
      {/* ── the three tabs: one bar under the header, on every tab ── */}
      <nav aria-label="Parts of this campaign" className="sticky top-[57px] z-10 border-b border-border bg-background/90 backdrop-blur">
        <div role="tablist" className="flex gap-1 overflow-x-auto px-3 sm:justify-center sm:px-10">
          {tabs.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => go(t.key)}
              className={`relative inline-flex min-h-12 shrink-0 items-center gap-2 px-4 text-[15px] font-semibold transition-colors sm:px-6 ${tab === t.key ? 'text-foreground' : 'text-foreground/50 hover:text-foreground'}`}>
              {t.label}
              {t.count !== null && t.count > 0 && (
                <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[12px] ${t.key === 'choose' && open ? 'bg-accent-blue text-white' : 'bg-foreground/10 text-foreground'}`}>{t.count}</span>
              )}
              {tab === t.key && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-foreground sm:inset-x-5" />}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'overview' && (<>
      {/* ── first screen: the title and the one thing to do, beside the photograph ── */}
      <header className="grid border-b border-border lg:min-h-[min(76dvh,820px)] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" data-campaign-cover>
        <div className="order-2 flex flex-col justify-between gap-10 px-5 py-8 sm:px-10 lg:order-1 lg:py-14 lg:pl-16 lg:pr-12">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] font-medium text-muted-foreground">
            {backHref && <Link href={backHref} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground">All your campaigns</Link>}
            <span>{clientName}</span>
          </div>
          <div className="flex flex-col gap-6">
            <h1 className="text-[clamp(40px,5.4vw,104px)] font-semibold leading-[0.98] tracking-[-0.035em]">{view.title}</h1>
            {(when || view.place) && <p className="text-[clamp(16px,1.25vw,22px)] text-muted-foreground">{[when, view.place].filter(Boolean).join(', ')}</p>}
            <div className="mt-2 flex flex-col gap-5 border-t border-border pt-6">
              <p className="max-w-[26ch] text-[clamp(22px,2.1vw,38px)] font-medium leading-[1.12] tracking-[-0.015em]">{nextStep}</p>
              {waiting && closes && <p className="text-[15px] text-muted-foreground">Please answer by {closes}.</p>}
              {shortlist.length > 0 ? (
                <button type="button" onClick={() => go('choose')} className={`${PRIMARY} self-start`}>{shortlist.length === 1 ? 'See the creator' : 'See the creators'} <ArrowRight className="h-4 w-4" aria-hidden /></button>
              ) : chosen.length > 0 ? (
                <button type="button" onClick={() => go('yours')} className={`${QUIET} self-start`}>See your creators <ArrowRight className="h-4 w-4" aria-hidden /></button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="relative order-1 min-h-[46dvh] overflow-hidden bg-foreground/[0.06] lg:order-2 lg:min-h-0">
          {view.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : faces.length > 0 ? (
            <div className={`absolute inset-0 grid gap-px ${faces.length === 1 ? '' : 'grid-cols-2'} ${faces.length > 2 ? 'grid-rows-2' : ''}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {faces.map((src, i) => <img key={src} src={src} alt="" className={`h-full w-full object-cover ${faces.length === 3 && i === 0 ? 'row-span-2' : ''}`} />)}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-end bg-accent-blue p-8 text-white sm:p-14">
              <p className="text-[clamp(64px,11vw,220px)] font-semibold leading-[0.85] tracking-[-0.05em]">{view.confirmed}{seats !== null && <span className="text-white/45">/{seats}</span>}</p>
            </div>
          )}
        </div>
      </header>

      {/* ── the facts: three plain columns under the rule above ── */}
      <section className={`${WIDE} grid gap-x-16 gap-y-12 py-12 lg:grid-cols-3 lg:py-20`} aria-label="Where this campaign is up to" data-portal-overview>
        <div className="flex flex-col gap-5">
          <h2 className="text-[17px] font-semibold">{seats === null ? 'Confirmed' : 'Seats'}</h2>
          <p className="text-[clamp(64px,6.5vw,120px)] font-semibold leading-[0.9] tracking-[-0.04em]">{view.confirmed}{seats !== null && <span className="text-foreground/30">/{seats}</span>}</p>
          {seats !== null && seats <= 40 && (
            <div className="flex max-w-[420px] flex-wrap gap-1.5" aria-hidden>
              {Array.from({ length: Math.max(seats, view.confirmed) }, (_, i) => (
                <span key={i} className={`h-2 min-w-6 flex-1 rounded-full ${i < view.confirmed ? 'bg-foreground' : i < view.confirmed + view.waiting ? 'bg-accent-blue' : 'bg-foreground/15'}`} />
              ))}
            </div>
          )}
          <p className="text-[16px] text-muted-foreground">{seatLine(view)}</p>
          {confirmed.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-2">
              {confirmed.slice(0, 10).map(c => (
                <li key={c.id} className="flex items-center gap-2 text-[14px]"><Face row={c} className="h-9 w-9 rounded-full" />{c.name.split(/\s+/)[0]}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <h2 className="text-[17px] font-semibold">Where it is up to</h2>
          <ol className="flex flex-col">
            {view.steps.map((s, i) => (
              <li key={s.key} className="relative flex gap-4 pb-7 last:pb-0">
                {i < view.steps.length - 1 && <span aria-hidden className="absolute left-[9px] top-6 h-full w-px bg-border" />}
                <span aria-hidden className={`relative z-[1] mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${s.state === 'done' ? 'bg-foreground text-background' : s.state === 'now' ? 'bg-accent-blue text-white' : 'border border-foreground/30 bg-background'}`}>
                  {s.state === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className={`text-[clamp(20px,1.6vw,28px)] font-medium leading-tight tracking-[-0.01em] ${s.state === 'next' ? 'text-foreground/45' : ''}`}>{s.label}{s.state === 'now' && <span className="sr-only"> (now)</span>}</span>
                  {s.when && <span className="text-[15px] text-muted-foreground">{s.when}</span>}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {(view.deliverables.length > 0 || view.usage_terms) && (
          <div className="flex flex-col gap-5">
            <h2 className="text-[17px] font-semibold">What each creator delivers</h2>
            <ul className="flex flex-col gap-3">
              {view.deliverables.map(d => <li key={d} className="text-[clamp(20px,1.6vw,28px)] font-medium leading-tight tracking-[-0.01em]">{d}</li>)}
            </ul>
            {view.usage_terms && <p className="max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground">How you may use the content: {view.usage_terms}</p>}
          </div>
        )}
      </section>
      </>)}

      {/* ── to choose: every creator a spread of their own ── */}
      {tab === 'choose' && (
      <section className={`${WIDE} flex flex-col pt-10 lg:pt-16`} aria-label="Creators to choose from" data-creator-shortlist>
        <div className="flex flex-col gap-3 pb-10">
          <h2 className="text-[clamp(34px,4.2vw,76px)] font-semibold leading-[1] tracking-[-0.03em]">To choose{shortlist.length > 0 && <span className="text-foreground/30"> {shortlist.length}</span>}</h2>
          <p className="max-w-[58ch] text-[17px] leading-relaxed text-muted-foreground">
            {open ? 'Say yes to anyone you would like and we invite them. A yes cannot be undone from this page, so tell us if you change your mind.' : `${view.closed_reason ?? 'This list is closed.'} You can still look.`}
          </p>
        </div>

        {shortlist.length === 0 ? (
          <p className="border-t border-border py-12 text-[clamp(20px,1.6vw,28px)] font-medium text-foreground/45">Nobody is waiting on you right now.</p>
        ) : shortlist.map(row => (
          <article key={row.id} className="grid gap-6 border-t border-border py-10 sm:gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:py-14 2xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)] 2xl:gap-16" data-creator={row.id}>
            <Face row={row} className="aspect-[4/5] w-full rounded-[14px]" big />
            <div className="flex min-w-0 flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h3 className="text-[clamp(30px,3.4vw,60px)] font-semibold leading-[1] tracking-[-0.025em]">{row.name}</h3>
                <Reach row={row} terms />
              </div>
              {row.why && <p className="max-w-[62ch] whitespace-pre-wrap text-[clamp(17px,1.25vw,21px)] leading-relaxed">{row.why}</p>}
              {row.sample_images.length > 0 && (
                <div className={`grid max-w-[920px] gap-2 sm:gap-3 ${row.sample_images.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                  {row.sample_images.slice(0, 4).map((src, i) => (
                    <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[14px] bg-foreground/[0.06]" aria-label={`One of ${row.name}'s posts, picture ${i + 1}. Opens larger.`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover transition-transform duration-500 hover:scale-[1.04] motion-reduce:transition-none" />
                    </a>
                  ))}
                </div>
              )}
              {row.samples.length > 0 && (
                <p className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
                  {row.samples.map((s, i) => <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">Watch post {i + 1}</a>)}
                </p>
              )}
              {open && (
                <div className="mt-auto flex flex-col gap-4 pt-2">
                  {noting === row.id && (
                    <label className="flex max-w-[62ch] flex-col gap-2">
                      <span className="text-[14px] font-semibold">A note for the team (optional)</span>
                      <textarea className="min-h-[88px] w-full rounded-[14px] border border-foreground/25 bg-background p-4 text-[16px] outline-none focus:border-foreground" maxLength={600}
                        value={notes[row.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [row.id]: e.target.value }))} placeholder="Sent with your yes or no" />
                    </label>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <button type="button" className={`${PRIMARY} sm:min-w-[200px]`} disabled={busy === row.id} onClick={() => void answer(row, 'approved')}>Approve</button>
                    <button type="button" className={`${QUIET} sm:min-w-[200px]`} disabled={busy === row.id} onClick={() => void answer(row, 'passed')}>Not this one</button>
                    {noting !== row.id && <button type="button" className="min-h-11 self-start px-1 text-[15px] underline underline-offset-4 sm:self-auto" disabled={busy === row.id} onClick={() => setNoting(row.id)}>Add a note</button>}
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}

        {passed.length > 0 && (
          <div className="flex flex-col gap-5 border-t border-border py-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[clamp(20px,1.6vw,28px)] font-medium tracking-[-0.01em]">Passed on <span className="text-foreground/30">{passed.length}</span></p>
              <button type="button" className="min-h-11 text-[15px] underline underline-offset-4" aria-expanded={showPassed} onClick={() => setShowPassed(s => !s)}>{showPassed ? 'Hide them' : open ? 'Show them, or change your mind' : 'Show them'}</button>
            </div>
            {showPassed && (
              <ul className="grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
                {passed.map(row => (
                  <li key={row.id} className="flex items-center gap-4">
                    <Face row={row} className="h-24 w-20 shrink-0 rounded-[14px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-[19px] font-semibold">{row.name}</span>
                      {row.client_note && <span className="text-[14px] text-muted-foreground">Your note: {row.client_note}</span>}
                      {open && <button type="button" className="min-h-11 self-start text-[15px] font-semibold underline underline-offset-4 disabled:opacity-60" disabled={busy === row.id} onClick={() => void answer(row, 'approved')}>Change my mind</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      )}

      {/* ── your creators: a wall of portraits ── */}
      {tab === 'yours' && (
      <section className={`${WIDE} flex flex-col gap-10 pt-10 lg:pt-16`} aria-label="Your creators" data-portal-yours>
        <div className="flex flex-col gap-3">
          <h2 className="text-[clamp(34px,4.2vw,76px)] font-semibold leading-[1] tracking-[-0.03em]">Your creators{chosen.length > 0 && <span className="text-foreground/30"> {chosen.length}</span>}</h2>
          <p className="max-w-[58ch] text-[17px] leading-relaxed text-muted-foreground">Everyone you said yes to, and where each one is up to.</p>
        </div>
        {chosen.length === 0 ? (
          <p className="border-t border-border py-12 text-[clamp(20px,1.6vw,28px)] font-medium text-foreground/45">Nobody yet. Creators you say yes to show here.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-6 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {chosen.map(row => (
              <li key={row.id} className="flex flex-col gap-3">
                <Face row={row} className="aspect-[4/5] w-full rounded-[14px]" big />
                <div className="flex flex-col gap-1">
                  <span className="text-[clamp(18px,1.4vw,24px)] font-semibold leading-tight tracking-[-0.01em]">{row.name}</span>
                  <span className={`text-[15px] ${row.stage === 'confirmed' ? 'font-semibold' : 'text-muted-foreground'}`}>{chosenWords(row)}</span>
                  <Reach row={row} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </div>
  )
}

/** A creator's picture: their photo, else one of their posts, else their initial on blue. Never an empty grey box. */
function Face({ row, className, big = false }: { row: ClientCreator; className: string; big?: boolean }) {
  const src = row.photo_url ?? row.sample_images[0] ?? null
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={big ? row.name : ''} loading="lazy" className={`${className} bg-foreground/[0.06] object-cover`} />
  }
  return (
    <span aria-hidden className={`${className} flex items-center justify-center bg-accent-blue font-semibold text-white ${big ? 'text-[clamp(72px,9vw,160px)] tracking-[-0.04em]' : 'text-[16px]'}`}>
      {row.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Reach({ row, terms = false }: { row: ClientCreator; terms?: boolean }) {
  const ig = followerWords(row.instagram_followers)
  const tt = followerWords(row.tiktok_followers)
  if (!row.instagram && !row.tiktok && !terms) return null
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-muted-foreground">
      {row.instagram && <a href={`https://www.instagram.com/${row.instagram}/`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center hover:text-foreground"><span className="font-semibold text-foreground">{ig ?? `@${row.instagram}`}</span>{ig ? <>&nbsp;on Instagram</> : null}</a>}
      {row.tiktok && <a href={`https://www.tiktok.com/@${row.tiktok}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center hover:text-foreground"><span className="font-semibold text-foreground">{tt ?? `@${row.tiktok}`}</span>{tt ? <>&nbsp;on TikTok</> : null}</a>}
      {terms && <span className="inline-flex min-h-11 items-center">{row.terms === 'paid' ? 'Paid' : 'Gifted'}</span>}
    </p>
  )
}
