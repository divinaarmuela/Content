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
import { postPageHref } from '../../../lib/post-page-core'
import { formatWithZone } from '../../../lib/timezone-core'
import PageTitle from '../../ui/PageTitle'

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
  moving:  { chip: 'border-accent-blue/25 bg-tint-blue text-accent-blue-deep', icon: Loader2 },
  waiting: { chip: 'border-accent-amber/35 bg-tint-amber text-foreground', icon: CalendarClock },
  done:    { chip: 'border-accent-green/30 bg-tint-green text-foreground', icon: CheckCircle2 },
  trouble: { chip: 'border-accent-red/30 bg-tint-red text-foreground', icon: XCircle },
  quiet:   { chip: 'border-border bg-foreground/[0.04] text-muted-foreground', icon: CheckCircle2 },
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
      <PageTitle
        title="Posts"
        summary={summary ?? 'Everything you have sent or booked, and what each one is doing.'}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </>}
      />

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
                      <span className="text-secondary-13 text-muted-foreground">{clientName(job.client_id)}</span>
                      <span className="ml-auto text-[12px] text-muted-foreground">
                        made {formatWithZone(job.created_at, tz, 'short')}
                      </span>
                    </div>

                    <p className="mt-1.5 truncate text-body-15">
                      {job.caption.trim() || <span className="text-muted-foreground">No caption</span>}
                    </p>

                    {/* which channels — and, on a failure, which of them the
                        error names, so four channels do not read as one fault */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {job.targets.map((t, i) => (
                        <span
                          key={`${t.platform}-${i}`}
                          title={t.platform}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-chip-12 ${
                            blamed.includes(t.platform)
                              ? 'border-accent-red/30 text-foreground'
                              : 'border-border text-muted-foreground'
                          }`}
                        >
                          {isKnownPlatform(t.platform) && <PlatformIcon platform={t.platform} size={12} />}
                          {t.options?.kind ?? t.platform}
                          {blamed.includes(t.platform) && <AlertTriangle className="h-3 w-3" />}
                        </span>
                      ))}
                    </div>

                    {words.detail && (
                      <p className={`mt-1.5 text-secondary-13 ${
                        words.tone === 'trouble' ? 'text-foreground' : 'text-muted-foreground'
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
                      {job.post_id && (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={postPageHref(job.post_id)}>See the full post</Link>
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
                        <span className="text-[12px] text-muted-foreground">
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
