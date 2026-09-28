'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import PageTitle from '../../ui/PageTitle'
import Chip, { type ChipTone } from '../../ui/Chip'
import {
  CRM_STATUS_WORDS, PEOPLE_CRM_CLIENTS, crmFilter, dayWords,
  type CrmFilter, type CrmRow, type CrmStatus,
} from '@/app/lib/people-crm-core'

/**
 * PEOPLE — a CRM of a client's Instagram audience (the owner, 28 Sep 2026: "a page like this — rows, data per user:
 * new follower, interactions, only for Justin and Jordan, a CRM based on post liked etc, if DMed, track every touch
 * point, view DM, interacted"). One row per person: what they are to the client now, when we first and last saw
 * them, their likes, comments and DMs; open a row for every touch, dated, newest first.
 */

type Payload = {
  state: string
  client: { id: string; name: string }
  today: string
  as_of: string | null
  counts: { people: number; new_followers: number; engaged: number; dmed: number; likely_from_posts: number; unfollowed: number }
  rows: CrmRow[]
}

const STATUS_TONE: Record<CrmStatus, ChipTone> = {
  dmed: 'green', commented: 'blue', liked: 'blue', new_follower: 'amber', follower: 'muted', unfollowed: 'red', ours: 'surface',
}

const FILTERS: { key: CrmFilter; label: string }[] = [
  { key: 'active', label: 'Everyone with a touch' },
  { key: 'new', label: 'New followers' },
  { key: 'engaged', label: 'Liked or commented' },
  { key: 'dmed', label: 'DMed' },
  { key: 'all', label: 'All followers' },
]

const PAGE = 100

export default function PeopleCrmPage() {
  const [clientId, setClientId] = useState(PEOPLE_CRM_CLIENTS[0].id)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<CrmFilter>('active')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    let gone = false
    setData(null); setError(null); setOpen(null); setShown(PAGE)
    fetch(`/api/social/people-crm?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (gone) return
        if (!r.ok) setError(String(j?.error ?? 'Could not load the people'))
        else setData(j as Payload)
      })
      .catch(() => { if (!gone) setError('Could not load the people — check the connection') })
    return () => { gone = true }
  }, [clientId])

  const rows = useMemo(() => (data ? crmFilter(data.rows, filter, search) : []), [data, filter, search])
  const today = data?.today ?? ''

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="People"
        summary="Everyone on the client’s Instagram and every touch we have seen: followed, liked, commented, DMed, left. Open a row for their timeline."
      />

      {/* the client */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Client">
        {PEOPLE_CRM_CLIENTS.map(c => (
          <button key={c.id} type="button" role="tab" aria-selected={c.id === clientId} onClick={() => setClientId(c.id)}
            className={`min-h-11 rounded-full border px-4 text-[14px] font-semibold ${c.id === clientId ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
            {c.name}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[14px]">{error}</p>}

      {!data && !error && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full rounded-card" />
          <Skeleton className="h-96 w-full rounded-card" />
        </div>
      )}

      {data && (
        <>
          {/* the headline numbers */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['People with a touch', data.counts.people],
              ['New followers', data.counts.new_followers],
              ['Liked or commented', data.counts.engaged],
              ['DMed', data.counts.dmed],
              ['Likely from a post', data.counts.likely_from_posts],
              ['Unfollowed', data.counts.unfollowed],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-card border border-border bg-card p-3">
                <p className="text-[12px] text-muted-foreground">{label}</p>
                <p className="text-[24px] font-semibold tabular-nums">{n}</p>
              </div>
            ))}
          </div>

          {/* filters and search */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button key={f.key} type="button" onClick={() => { setFilter(f.key); setShown(PAGE) }} aria-pressed={filter === f.key}
                  className={`min-h-9 rounded-full border px-3 text-[13px] font-medium ${filter === f.key ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <label className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE) }} placeholder="Search a handle or name" className="min-h-11 pl-9" aria-label="Search people" />
            </label>
          </div>

          {data.state !== 'ready' && (
            <p className="rounded-inner border border-border bg-card px-3 py-2 text-[14px] text-muted-foreground">
              {data.state === 'waiting' ? 'The first follower look has not finished yet — the list fills in after the next 6 am look.'
                : data.state === 'private' ? 'This Instagram account is private, so its followers cannot be read.'
                : data.state === 'not_instagram' ? 'This client has no Instagram connected.'
                : 'Follower tracking is not switched on.'}
            </p>
          )}

          {/* the rows */}
          <div className="overflow-x-auto rounded-card border border-border bg-card">
            <table className="w-full min-w-[860px] text-left text-[14px]">
              <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-semibold">Person</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">First seen</th>
                  <th className="px-3 py-3 font-semibold">Last active</th>
                  <th className="px-3 py-3 font-semibold">Channel</th>
                  <th className="px-3 py-3 font-semibold">Platform</th>
                  <th className="px-3 py-3 text-right font-semibold">Likes</th>
                  <th className="px-3 py-3 text-right font-semibold">Comments</th>
                  <th className="px-3 py-3 font-semibold">DM</th>
                  <th className="px-3 py-3 font-semibold">Came from</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Nobody here yet for this filter.</td></tr>
                )}
                {rows.slice(0, shown).map(r => {
                  const isOpen = open === r.key
                  return (
                    <Fragment key={r.key}>
                      <tr className={`border-b border-border/60 ${isOpen ? 'bg-muted/60' : 'hover:bg-muted/40'}`}>
                        <td className="px-3 py-2.5">
                          <button type="button" onClick={() => setOpen(isOpen ? null : r.key)} aria-expanded={isOpen}
                            className="flex min-h-11 items-center gap-2 text-left">
                            {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[12px] font-semibold uppercase">
                              {r.username.slice(0, 1)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">@{r.username}</span>
                              {r.full_name && <span className="block truncate text-[12px] text-muted-foreground">{r.full_name}</span>}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-2.5"><Chip tone={STATUS_TONE[r.status]}>{CRM_STATUS_WORDS[r.status]}</Chip></td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{dayWords(r.first_seen, today)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{dayWords(r.last_active, today)}</td>
                        <td className="px-3 py-2.5"><Chip tone="surface">Organic social</Chip></td>
                        <td className="px-3 py-2.5 text-muted-foreground">instagram.com</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.likes || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.comments || '—'}</td>
                        <td className="px-3 py-2.5">
                          {r.dmed ? <Link href={r.inbox_href} className="font-semibold underline underline-offset-2">View DM</Link> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2.5 text-muted-foreground" title={r.from_post ?? undefined}>
                          {r.from_post ? `Likely ‘${r.from_post}’` : '—'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-border bg-muted/30">
                          <td colSpan={10} className="px-3 pb-4 pt-2">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Activity</p>
                              <a href={r.profile_href} target="_blank" rel="noreferrer noopener" className="text-[13px] underline underline-offset-2">Open their Instagram</a>
                              <Link href={r.inbox_href} className="text-[13px] underline underline-offset-2">Open in Inbox</Link>
                              <span className="text-[13px] text-muted-foreground">{r.following ? 'Follows the client' : 'Not on the follower list'}</span>
                            </div>
                            {r.timeline.length === 0 ? (
                              <p className="text-[13px] text-muted-foreground">Followed before we started watching — no touch seen since.</p>
                            ) : (
                              <ul className="max-w-3xl divide-y divide-border/60">
                                {r.timeline.map((e, i) => (
                                  <li key={i} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 py-2 text-[13px]">
                                    <span className={`font-semibold ${e.tone === 'lost' ? 'text-accent-red' : e.tone === 'strong' ? 'text-foreground' : 'text-foreground/80'}`}>{e.what}</span>
                                    <span className="truncate text-muted-foreground">
                                      {e.detail}
                                      {e.href && e.link && <>{e.detail ? ' · ' : ''}<Link href={e.href} className="underline underline-offset-2">{e.link}</Link></>}
                                    </span>
                                    <span className="whitespace-nowrap text-muted-foreground">{dayWords(e.day, today)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rows.length > shown && (
            <button type="button" onClick={() => setShown(n => n + PAGE)} className="min-h-11 self-center rounded-full border border-border px-5 text-[14px] font-semibold hover:bg-muted">
              Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
            </button>
          )}
          <p className="text-[12px] text-muted-foreground">
            Instagram gives no time for a follow or a like. A follow is dated by the morning look that first saw it, a like or
            comment by the day its post went out, and a DM by when it arrived.{data.as_of ? ` Last follower look: ${dayWords(data.as_of, today)}.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
