'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CalendarClock, CheckCircle2, ExternalLink, Hand, Loader2, RefreshCw,
  Send, XCircle,
} from 'lucide-react'
import PlatformIcon from '../PlatformIcon'
import ConfirmAction from '../../ConfirmAction'
import EmptyState from '../../EmptyState'
import { useProductionLive } from '../../production/useProductionLive'
import {
  attentionLine, isKnownPlatform, jobWords, looksStuck,
  type PublishJob, type Tone,
} from '../../../lib/publish-activity-core'
import {
  clientStats, kindsLine, outcomeTitle, outcomeWords, outcomesForJob, sortForTab,
  type ByHandRow, type PlatformOutcome, type PostsTab,
} from '../../../lib/post-outcome-core'
import { postPageHref } from '../../../lib/post-page-core'
import { formatWithZone } from '../../../lib/timezone-core'
import PageTitle from '../../ui/PageTitle'

/**
 * Every post, and what it did on EACH channel.
 *
 * This page did not exist, and its absence is why every publishing problem
 * this app has had looked like a mystery. Then it existed with one word per
 * job — and one word cannot say "went out on Instagram, refused by TikTok",
 * which is what the 15:45 post of 8 Sep 2026 did. So now: three piles
 * (Scheduled, Did not post, Posted — a partial sits on two of them), one line
 * per channel saying what kind of post it was and what happened to it, the
 * files marked "Posted by hand" on the cards listed next to the jobs, and
 * the last thirty days' numbers per client along the top.
 */

type Client = { id: string; name: string; timezone?: string | null }
type Job = PublishJob & { platform_results?: unknown; item_title?: string | null }

const TONE: Record<Tone, { chip: string; icon: typeof CheckCircle2 }> = {
  moving:  { chip: 'border-accent-blue/25 bg-tint-blue text-accent-blue-deep', icon: Loader2 },
  waiting: { chip: 'border-accent-amber/35 bg-tint-amber text-foreground', icon: CalendarClock },
  done:    { chip: 'border-accent-green/30 bg-tint-green text-foreground', icon: CheckCircle2 },
  trouble: { chip: 'border-accent-red/30 bg-tint-red text-foreground', icon: XCircle },
  quiet:   { chip: 'border-border bg-foreground/[0.04] text-muted-foreground', icon: CheckCircle2 },
}

const TABS: { key: PostsTab; label: string }[] = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'did_not_post', label: 'Did not post' },
  { key: 'posted', label: 'Posted' },
]

const THIRTY_DAYS = 30 * 24 * 3600_000

export default function PublishActivityPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [byHand, setByHand] = useState<ByHandRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<PostsTab>('scheduled')
  const [onlyClient, setOnlyClient] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [jRes, cRes] = await Promise.all([
        fetch('/api/social/publish?limit=200', { cache: 'no-store' }),
        fetch('/api/website/clients'),
      ])
      const j = await jRes.json().catch(() => ({}))
      if (!jRes.ok) throw new Error(j.error ?? 'Could not load the posts')
      setJobs(j.jobs ?? [])
      setByHand(Array.isArray(j.by_hand) ? j.by_hand : [])
      if (cRes.ok) setClients(await cRes.json())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the posts')
      setJobs([])
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // live: the composer's own change signal, plus a poll for the provider's
  // side, which announces nothing to us until the webhook lands
  useProductionLive(load, { pollMs: 30_000 })

  const clientName = (id: string | null) => clients.find(c => c.id === id)?.name ?? 'No client'
  const summary = attentionLine(jobs ?? [])

  const stats = useMemo(
    () => clientStats(jobs ?? [], byHand, { sinceMs: Date.now() - THIRTY_DAYS }),
    [jobs, byHand])
  const counts = useMemo(() => {
    const scoped = (jobs ?? []).filter(j => !onlyClient || j.client_id === onlyClient)
    const hand = byHand.filter(h => !onlyClient || h.client_id === onlyClient)
    return {
      scheduled: sortForTab(scoped, 'scheduled').length,
      did_not_post: sortForTab(scoped, 'did_not_post').length,
      posted: sortForTab(scoped, 'posted').length + hand.length,
    }
  }, [jobs, byHand, onlyClient])

  /** the rows on the open tab: jobs, and on Posted the by-hand files too,
   *  interleaved by time so "what went out this week" reads in order */
  const rows = useMemo(() => {
    const scoped = (jobs ?? []).filter(j => !onlyClient || j.client_id === onlyClient)
    const list: ({ kind: 'job'; job: Job; t: number } | { kind: 'hand'; row: ByHandRow; t: number })[] =
      sortForTab(scoped, tab).map(job => ({
        kind: 'job' as const, job,
        t: Date.parse(tab === 'scheduled' ? job.scheduled_for ?? job.created_at : job.published_at ?? job.updated_at ?? job.created_at) || 0,
      }))
    if (tab === 'posted') {
      for (const row of byHand) {
        if (onlyClient && row.client_id !== onlyClient) continue
        list.push({ kind: 'hand', row, t: Date.parse(row.at) || 0 })
      }
      list.sort((a, b) => b.t - a.t)
    }
    return list
  }, [jobs, byHand, tab, onlyClient])

  const cancel = async (job: Job) => {
    setBusy(job.id)
    try {
      const res = await fetch(`/api/social/publish/${job.id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not cancel it')
      toast.success('Cancelled — it will not go out')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel it')
    } finally { setBusy(null) }
  }

  const retry = async (job: Job) => {
    setBusy(job.id)
    try {
      const res = await fetch(`/api/social/publish/${job.id}`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not send it again')
      toast.success('Sending again')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send it again')
    } finally { setBusy(null) }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Posts"
        summary={summary ?? 'Everything booked or sent, and what each channel did with it.'}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </>}
      />

      {/* ── the last 30 days, per client ─────────────────────────────── */}
      {stats.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {stats.map(s => {
            const on = onlyClient === s.client_id
            const kinds = kindsLine(s.kinds)
            return (
              <button
                key={s.client_id ?? 'none'}
                type="button"
                aria-pressed={on}
                onClick={() => setOnlyClient(on ? null : s.client_id)}
                className={`flex min-w-[220px] shrink-0 flex-col gap-1 rounded-inner border px-3 py-2.5 text-left transition-colors ${
                  on ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface hover:bg-foreground/[0.04]'
                }`}
              >
                <span className="truncate text-[13px] font-semibold">{clientName(s.client_id)}</span>
                <span className={`text-[12px] ${on ? 'opacity-80' : 'text-muted-foreground'}`}>
                  {s.went_out} went out · {s.booked} booked · {s.did_not} did not
                  {s.by_hand > 0 ? ` · ${s.by_hand} by hand` : ''}
                </span>
                {kinds && <span className={`truncate text-[12px] ${on ? 'opacity-80' : 'text-muted-foreground'}`}>{kinds}</span>}
              </button>
            )
          })}
          {onlyClient && (
            <button type="button" onClick={() => setOnlyClient(null)} className="shrink-0 self-center text-[13px] underline underline-offset-4">
              Show every client
            </button>
          )}
        </div>
      )}

      {/* ── the piles ────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Posts" className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-body-15 transition-colors ${
              tab === t.key ? 'bg-foreground text-background' : 'border border-border hover:bg-foreground/[0.04]'
            }`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 text-[12px] ${tab === t.key ? 'bg-background/20' : 'bg-foreground/[0.06]'}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {jobs === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Send}
          title={tab === 'scheduled' ? 'Nothing scheduled' : tab === 'did_not_post' ? 'Nothing refused' : 'Nothing out yet'}
          body={tab === 'scheduled'
            ? 'Posts scheduled from the Schedule page wait here until they go out.'
            : tab === 'did_not_post'
            ? 'A channel that refuses a post lands here, with the reason.'
            : 'Posts that went out — by a channel or by hand — are listed here, newest first.'}
          actionLabel="Open the Schedule"
          actionHref="/dashboard/social/schedule"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(r => r.kind === 'hand'
            ? <ByHandCard key={`hand-${r.row.item_id}-${r.row.url}`} row={r.row} client={clientName(r.row.client_id)} />
            : (
              <JobCard
                key={r.job.id} job={r.job} client={clientName(r.job.client_id)} busy={busy === r.job.id}
                onRetry={() => void retry(r.job)} onCancel={() => void cancel(r.job)}
              />
            ))}
        </div>
      )}
    </div>
  )
}

/* ── one job ────────────────────────────────────────────────────────────── */

function JobCard({ job, client, busy, onRetry, onCancel }: {
  job: Job; client: string; busy: boolean; onRetry: () => void; onCancel: () => void
}) {
  const stuck = looksStuck(job)
  const words = stuck
    ? {
        headline: 'Taking longer than it should',
        detail: 'It has been sending for over fifteen minutes. It will be returned to the queue and retried automatically on the next pass — nothing to do unless it is still here in half an hour.',
        tone: 'trouble' as Tone, canCancel: false, canRetry: false,
      }
    : jobWords(job)
  const tone = TONE[words.tone]
  const Icon = tone.icon
  const thumb = job.media?.find(m => m.type === 'image')?.url ?? null
  const tz = job.timezone || 'Australia/Melbourne'
  const outcomes = outcomesForJob(job)

  return (
    <Card>
      <CardContent className="flex gap-3 p-3 sm:p-4">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-foreground/[0.06] text-[12px] text-muted-foreground">
            {(job.media?.length ?? 0) > 0 ? 'video' : 'text'}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-chip-12 font-medium ${tone.chip}`}>
              <Icon className={`h-3 w-3 ${words.tone === 'moving' ? 'animate-spin' : ''}`} />
              {words.headline}
            </span>
            <span className="text-secondary-13 text-muted-foreground">{client}</span>
            <span className="ml-auto text-[12px] text-muted-foreground">
              made {formatWithZone(job.created_at, tz, 'short')}
            </span>
          </div>

          <p className="mt-1.5 truncate text-body-15">
            {job.item_title
              ? <span className="font-semibold">{job.item_title}</span>
              : job.caption.trim() || <span className="text-muted-foreground">No caption</span>}
            {job.item_title && job.caption.trim() && <span className="text-muted-foreground"> · {job.caption.trim()}</span>}
          </p>

          {/* WHAT EACH CHANNEL DID — the kind of post, and the outcome, one
              line per channel, so "went out on Instagram, TikTok refused it"
              reads as exactly that */}
          <ul className="mt-2 flex flex-col gap-1">
            {outcomes.map((o, i) => <OutcomeLine key={`${o.platform}-${i}`} o={o} tz={tz} />)}
          </ul>

          {words.detail && !outcomes.some(o => o.reason) && job.status !== 'published' && (
            <p className={`mt-1.5 text-secondary-13 ${words.tone === 'trouble' ? 'text-foreground' : 'text-muted-foreground'}`}>
              {words.detail}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {job.permalink && !outcomes.some(o => o.url) && (
              <Button variant="outline" size="sm" asChild>
                <a href={job.permalink} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="h-3.5 w-3.5" /> Open the post
                </a>
              </Button>
            )}
            {job.post_id && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={postPageHref(job.post_id)}>See the full post</Link>
              </Button>
            )}
            {job.content_item_id && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/dashboard/production/${job.content_item_id}`}>Open the card</Link>
              </Button>
            )}
            {words.canRetry && (
              <Button size="sm" disabled={busy} onClick={onRetry}>
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Send again
              </Button>
            )}
            {words.canCancel && (
              <ConfirmAction
                title={job.status === 'scheduled' ? 'Cancel this booked post?' : 'Cancel this post?'}
                body={job.status === 'scheduled'
                  ? 'It is pulled back from the platform and will not go out. You can make it again from the Schedule page.'
                  : 'It has not left yet, so cancelling is complete. You can make it again from the Schedule page.'}
                confirmLabel="Cancel the post"
                onConfirm={onCancel}
              >
                <Button variant="outline" size="sm" disabled={busy}>
                  <XCircle className="h-3.5 w-3.5" /> Cancel
                </Button>
              </ConfirmAction>
            )}
            {job.attempts > 1 && (
              <span className="text-[12px] text-muted-foreground">{job.attempts} attempts</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const MARK: Record<ReturnType<typeof outcomeWords>['tone'], string> = {
  done: 'text-accent-green', waiting: 'text-foreground', trouble: 'text-accent-red',
  moving: 'text-accent-blue-deep', quiet: 'text-muted-foreground',
}

function OutcomeLine({ o, tz }: { o: PlatformOutcome; tz: string }) {
  const w = outcomeWords(o)
  const when = o.at ? formatWithZone(o.at, tz, 'short') : null
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
      <span className="inline-flex items-center gap-1.5 font-medium">
        {isKnownPlatform(o.platform) && <PlatformIcon platform={o.platform} size={14} />}
        {outcomeTitle(o)}
      </span>
      <span className={`inline-flex items-center gap-1 ${MARK[w.tone]}`}>
        {w.tone === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" />
          : w.tone === 'trouble' ? <XCircle className="h-3.5 w-3.5" />
          : w.tone === 'moving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <CalendarClock className="h-3.5 w-3.5" />}
        {w.label}{when ? ` · ${when}` : ''}
      </span>
      {o.reason && <span className="text-muted-foreground">— {o.reason}</span>}
      {o.url && (
        <a href={o.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline underline-offset-4">
          <ExternalLink className="h-3 w-3" /> Open
        </a>
      )}
    </li>
  )
}

/* ── one file posted by hand ─────────────────────────────────────────────── */

function ByHandCard({ row, client }: { row: ByHandRow; client: string }) {
  return (
    <Card>
      <CardContent className="flex gap-3 p-3 sm:p-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-tint-green">
          <Hand className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-chip-12 font-medium ${TONE.done.chip}`}>
              <CheckCircle2 className="h-3 w-3" /> Posted by hand
            </span>
            <span className="text-secondary-13 text-muted-foreground">{client}</span>
            <span className="ml-auto text-[12px] text-muted-foreground">
              {formatWithZone(row.at, 'Australia/Melbourne', 'short')}
            </span>
          </div>
          <p className="mt-1.5 truncate text-body-15">
            <span className="font-semibold">{row.title}</span>
            {row.index > 0 && <span className="text-muted-foreground"> · file {row.index} of {row.total}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.link && (
              <Button variant="outline" size="sm" asChild>
                <a href={row.link} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="h-3.5 w-3.5" /> Open the post
                </a>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard/production/${row.item_id}`}>Open the card</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
