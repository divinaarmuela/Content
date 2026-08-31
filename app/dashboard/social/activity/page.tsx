'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Loader2, RefreshCw,
  Send, XCircle,
} from 'lucide-react'
import PlatformIcon from '../PlatformIcon'
import ConfirmAction from '../../ConfirmAction'
import EmptyState from '../../EmptyState'
import { useProductionLive } from '../../production/useProductionLive'
import {
  attentionLine, isKnownPlatform, jobWords, looksStuck, platformsNamedIn,
  sortForAttention, type PublishJob, type Tone,
} from '../../../lib/publish-activity-core'
import { formatWithZone } from '../../../lib/timezone-core'

/**
 * Every post, and what it is doing right now.
 *
 * This page did not exist, and its absence is why every publishing problem
 * this app has had looked like a mystery. A post was the toast at the moment
 * of sending and a permalink weeks later; in between — uploading in the
 * background, waiting on a worker, booked at the provider, refused by one
 * channel of four — it was nowhere. The reason a post failed was written to
 * a database column no screen read.
 *
 * So: the job as a sentence, the error in full when there is one, a Retry
 * where a retry can help and a Cancel while it still can, refreshing on the
 * same signal the boards use so `queued → booked` moves in front of you.
 */

type Client = { id: string; name: string; timezone?: string | null }

const TONE: Record<Tone, { chip: string; icon: typeof CheckCircle2 }> = {
  moving:  { chip: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300', icon: Loader2 },
  waiting: { chip: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300', icon: CalendarClock },
  done:    { chip: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300', icon: CheckCircle2 },
  trouble: { chip: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300', icon: XCircle },
  quiet:   { chip: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400', icon: CheckCircle2 },
}

export default function PublishActivityPage() {
  const [jobs, setJobs] = useState<PublishJob[] | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [jRes, cRes] = await Promise.all([
        fetch('/api/social/publish?limit=100', { cache: 'no-store' }),
        fetch('/api/website/clients'),
      ])
      const j = await jRes.json().catch(() => ({}))
      if (!jRes.ok) throw new Error(j.error ?? 'Could not load the posts')
      setJobs(j.jobs ?? [])
      if (cRes.ok) setClients(await cRes.json())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the posts')
      setJobs([])
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // live: the composer's own change signal, plus a 60s poll for the provider's
  // side, which announces nothing to us until the webhook lands
  useProductionLive(load, { pollMs: 30_000 })

  const clientName = (id: string | null) => clients.find(c => c.id === id)?.name ?? 'No client'
  const sorted = useMemo(() => sortForAttention(jobs ?? []), [jobs])
  const summary = attentionLine(jobs ?? [])

  const cancel = async (job: PublishJob) => {
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

  const retry = async (job: PublishJob) => {
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
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Posts</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {summary ?? 'Everything you have sent or booked, and what each one is doing.'}
          </p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {jobs === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nothing sent yet"
          body="Posts you publish or book from the composer show up here, with where each one has got to."
          actionLabel="Open Social channels"
          actionHref="/dashboard/social"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map(job => {
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
            const blamed = platformsNamedIn(job.error, job.targets)
            const thumb = job.media?.find(m => m.type === 'image')?.url ?? null
            const tz = job.timezone || 'Australia/Melbourne'

            return (
              <Card key={job.id}>
                <CardContent className="flex gap-3 p-3 sm:p-4">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-zinc-100 text-[11px] text-zinc-400 dark:bg-zinc-800">
                      {(job.media?.length ?? 0) > 0 ? 'video' : 'text'}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}>
                        <Icon className={`h-3 w-3 ${words.tone === 'moving' ? 'animate-spin' : ''}`} />
                        {words.headline}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{clientName(job.client_id)}</span>
                      <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
                        made {formatWithZone(job.created_at, tz, 'short')}
                      </span>
                    </div>

                    <p className="mt-1.5 truncate text-sm">
                      {job.caption.trim() || <span className="text-zinc-400">No caption</span>}
                    </p>

                    {/* which channels — and, on a failure, which of them the
                        error names, so four channels do not read as one fault */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {job.targets.map((t, i) => (
                        <span
                          key={`${t.platform}-${i}`}
                          title={t.platform}
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                            blamed.includes(t.platform)
                              ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                              : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          {isKnownPlatform(t.platform) && <PlatformIcon platform={t.platform} size={12} />}
                          {t.options?.kind ?? t.platform}
                          {blamed.includes(t.platform) && <AlertTriangle className="h-3 w-3" />}
                        </span>
                      ))}
                    </div>

                    {words.detail && (
                      <p className={`mt-1.5 text-xs ${
                        words.tone === 'trouble' ? 'text-red-700 dark:text-red-300' : 'text-zinc-500 dark:text-zinc-400'
                      }`}>
                        {words.detail}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {job.permalink && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={job.permalink} target="_blank" rel="noreferrer noopener">
                            <ExternalLink className="h-3.5 w-3.5" /> Open the post
                          </a>
                        </Button>
                      )}
                      {job.content_item_id && (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/dashboard/production/${job.content_item_id}`}>The item it delivers</Link>
                        </Button>
                      )}
                      {words.canRetry && (
                        <Button size="sm" disabled={busy === job.id} onClick={() => void retry(job)}>
                          <RefreshCw className={`h-3.5 w-3.5 ${busy === job.id ? 'animate-spin' : ''}`} /> Send again
                        </Button>
                      )}
                      {words.canCancel && (
                        <ConfirmAction
                          title={job.status === 'scheduled' ? 'Cancel this booked post?' : 'Cancel this post?'}
                          body={job.status === 'scheduled'
                            ? 'It is pulled back from the platform and will not go out. You can make it again from the composer.'
                            : 'It has not left yet, so cancelling is complete. You can make it again from the composer.'}
                          confirmLabel="Cancel the post"
                          onConfirm={() => void cancel(job)}
                        >
                          <Button variant="outline" size="sm" disabled={busy === job.id}>
                            <XCircle className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        </ConfirmAction>
                      )}
                      {job.attempts > 1 && (
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {job.attempts} attempts
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
