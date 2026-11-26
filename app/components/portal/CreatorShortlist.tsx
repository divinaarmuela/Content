'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { followerWords } from '../../lib/creator-campaign-core'
import { chosenWords, type ClientCreator } from '../../lib/creator-portal-core'

/**
 * THE CLIENT CHOOSES THEIR CREATORS. Three lists: to look at (Approve / Not this one, with a note if they like),
 * said yes to (where each has got to), and passed on (Change my mind, while the list is open). Each answer is sent
 * with the version of the creator the client was looking at; if the team changed that creator in between, the page
 * shows them as they now stand instead of answering on something stale.
 */
export default function CreatorShortlist({ token, campaignId, open, closedReason, shortlist: s0, chosen: c0, passed: p0 }: {
  token: string
  campaignId: string
  /** may the client still answer */
  open: boolean
  closedReason: string | null
  shortlist: ClientCreator[]
  chosen: ClientCreator[]
  passed: ClientCreator[]
}) {
  const [rows, setRows] = useState<ClientCreator[]>([...s0, ...c0, ...p0])
  const [busy, setBusy] = useState<string | null>(null)
  const [noting, setNoting] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const shortlist = rows.filter(r => r.stage === 'with_client')
  const chosen = rows.filter(r => r.stage === 'approved' || r.stage === 'invited' || r.stage === 'confirmed')
  const passed = rows.filter(r => r.stage === 'passed')

  const answer = async (row: ClientCreator, to: 'approved' | 'passed') => {
    setBusy(row.id)
    try {
      const res = await fetch('/api/portal/creators', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, campaign_id: campaignId, row_id: row.id, to, expect_rev: row.rev, note: notes[row.id] ?? null }),
      })
      const json = await res.json().catch(() => ({}))
      const now = (json?.creator ?? json?.fresh) as ClientCreator | undefined
      if (now) setRows(rs => rs.map(r => (r.id === row.id ? { ...r, stage: now.stage, client_note: now.client_note, rev: now.rev } : r)))
      if (!res.ok) { toast.error(json?.error ?? 'That did not save. Try again.'); return }
      toast.success(to === 'approved' ? `Yes to ${row.name}` : `Passed on ${row.name}`)
      setNoting(null)
    } catch {
      toast.error('That did not save. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-8" data-creator-shortlist>
      {!open && closedReason && (
        <p role="status" className="rounded-card border border-border bg-card p-4 text-[15px]">{closedReason} You can still look.</p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="cs-look">
        <h2 id="cs-look" className="text-[19px] font-semibold">To look at <span className="font-normal text-muted-foreground">({shortlist.length})</span></h2>
        {shortlist.length === 0 ? (
          <p className="rounded-card border border-border bg-card p-5 text-[15px] text-muted-foreground">Nobody waiting on you right now.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {shortlist.map(row => (
              <li key={row.id} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4" data-creator={row.id}>
                <Profile row={row} />
                {open && (
                  <>
                    {noting === row.id && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[13px] font-semibold">A note for the team (optional)</span>
                        <textarea className="min-h-[72px] w-full rounded-inner border border-border bg-background p-3 text-[15px] outline-none focus:border-foreground" maxLength={600}
                          value={notes[row.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [row.id]: e.target.value }))} placeholder="Sent with your yes or no" />
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button className="h-11 rounded-full px-5 text-[14px] font-semibold" disabled={busy === row.id} onClick={() => void answer(row, 'approved')}>Approve</Button>
                      <Button variant="outline" className="h-11 rounded-full px-4 text-[14px]" disabled={busy === row.id} onClick={() => void answer(row, 'passed')}>Not this one</Button>
                      {noting !== row.id && (
                        <Button variant="ghost" className="h-11 rounded-full px-3 text-[14px]" disabled={busy === row.id} onClick={() => setNoting(row.id)}>Add a note</Button>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="cs-yes">
        <h2 id="cs-yes" className="text-[19px] font-semibold">You said yes to <span className="font-normal text-muted-foreground">({chosen.length})</span></h2>
        {chosen.length === 0 ? (
          <p className="rounded-card border border-border bg-card p-5 text-[15px] text-muted-foreground">Nobody yet.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {chosen.map(row => (
              <li key={row.id} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
                <Profile row={row} compact />
                <p className="text-[14px] font-semibold">{chosenWords(row)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {passed.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="cs-no">
          <h2 id="cs-no" className="text-[19px] font-semibold">Passed on <span className="font-normal text-muted-foreground">({passed.length})</span></h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {passed.map(row => (
              <li key={row.id} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
                <Profile row={row} compact />
                {row.client_note && <p className="text-[14px] text-muted-foreground">Your note: {row.client_note}</p>}
                {open && (
                  <div>
                    <Button variant="outline" className="h-11 rounded-full px-4 text-[14px]" disabled={busy === row.id} onClick={() => void answer(row, 'approved')}>Change my mind</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Profile({ row, compact = false }: { row: ClientCreator; compact?: boolean }) {
  const ig = followerWords(row.instagram_followers)
  const tt = followerWords(row.tiktok_followers)
  return (
    <div className="flex items-start gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {row.photo_url ? <img src={row.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-full border border-border object-cover" />
        : <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-[20px] font-semibold">{row.name.slice(0, 1).toUpperCase()}</span>}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[17px] font-semibold leading-tight">{row.name}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 break-words text-[14px] text-muted-foreground">
          {row.instagram && <a href={`https://www.instagram.com/${row.instagram}/`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Instagram @{row.instagram}{ig ? ` · ${ig}` : ''}</a>}
          {row.tiktok && <a href={`https://www.tiktok.com/@${row.tiktok}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">TikTok @{row.tiktok}{tt ? ` · ${tt}` : ''}</a>}
          <span>{row.terms === 'paid' ? 'Paid' : 'Gifted'}</span>
        </p>
        {!compact && row.why && <p className="whitespace-pre-wrap text-[15px]">{row.why}</p>}
        {!compact && row.samples.length > 0 && (
          <p className="flex flex-wrap gap-x-3 text-[14px]">
            {row.samples.map((s, i) => <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="min-h-6 underline underline-offset-2">Their post {i + 1}</a>)}
          </p>
        )}
      </div>
    </div>
  )
}
