'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Send } from 'lucide-react'
import PlatformIcon from '../../social/PlatformIcon'
import {
  choosePlatform, derivePostingState, platformLabel, postingPrimaryLabel,
  type PostingEntry, type PostingJob, type PostingJobStatus, type PostingState,
} from '../../../lib/posting-card-core'
import {
  METRICS_PENDING_LINE, compactCount, isExternalRow, metricCells, metricsPending, updatedAgo,
  type PostMetrics,
} from '../../../lib/post-analytics-core'

export type PostingContext = {
  configured: boolean
  accounts: { platform: string; username: string | null; name: string | null }[]
  job: {
    id: string; status: string; scheduled_for: string | null
    permalink: string | null; error: string | null; published_at: string | null
  } | null
  metrics?: (Partial<PostMetrics> & {
    sync_status: string | null; synced_at: string; post_url: string | null
    source?: string | null
  }) | null
}

/**
 * The live post's numbers, under its link.
 *
 * Deliberately the SAME shaping the client's portal uses, from the same pure
 * module: a scheduler being asked "how did that one do?" and the client
 * reading their own portal must never see two different answers.
 */
function PostedMetrics(
  { metrics, platform }: { metrics: PostingContext['metrics']; platform: string },
) {
  const cells = metricCells(metrics)
  if (metricsPending(metrics)) {
    return (
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{METRICS_PENDING_LINE}</p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {cells.map(c => (
          <span key={c.key} className="flex items-baseline gap-1">
            <span className="font-mono text-xs tabular-nums">{compactCount(c.value)}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {c.label}
            </span>
          </span>
        ))}
      </div>
      <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
        suppressHydrationWarning>
        {/* These numbers belong to a post this app never published. Saying so
            is the difference between a figure and an unexplained figure: the
            scheduler pasted a link, and this is what that link turned out to
            be. The client's portal stays silent — how we found the numbers is
            our business, not theirs. */}
        {isExternalRow(metrics)
          ? `Stats from ${platformLabel(platform)} · linked by URL`
          : metrics?.synced_at ? updatedAgo(metrics.synced_at) : null}
      </span>
      {isExternalRow(metrics) && metrics?.synced_at && (
        <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
          suppressHydrationWarning>
          {updatedAgo(metrics.synced_at)}
        </span>
      )}
    </div>
  )
}

type Props = {
  itemId: string
  clientId: string
  clientName: string
  /** who at the client would be emailed a connect link */
  clientUsers: { name: string; email: string }[]
  platformTargets: string[]
  caption: string | null
  posting: PostingContext | null
  entries: PostingEntry[]
  /** may this person publish to the client's live accounts? */
  canAutoPublish: boolean
  platforms: readonly string[]
  /** save a platform + time on the item, then open the notify picker */
  onPost: (platform: string, whenIso: string | null, publishNow: boolean) => Promise<void>
  /** the manual path: live link, or "it went out, no link" */
  onManual: (input: { platform: string; whenIso?: string | null; liveUrl?: string; markPosted?: boolean }) => Promise<void>
  onChanged: () => Promise<void> | void
  busy: boolean
}

/** A datetime-local value for an ISO instant, in the browser's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
  : null

/**
 * The one card that decides whether a post goes out.
 *
 * Schedulers post FROM the app; posting by hand is the exception. So this card
 * shows one state and one obvious action, and the manual fields are a link you
 * have to press — not a second set of buttons sitting beside the first,
 * competing for the same decision.
 */
export default function PostingCard(props: Props) {
  const {
    itemId, clientId, clientName, clientUsers, platformTargets, caption,
    posting, entries, canAutoPublish, platforms, onPost, onManual, onChanged, busy,
  } = props

  const connected = (posting?.accounts ?? []).map(a => a.platform)
  const platform = choosePlatform(platformTargets, connected)
  const state = derivePostingState({
    connected,
    platform,
    entries,
    job: posting?.job
      ? { ...posting.job, status: posting.job.status as PostingJobStatus } as PostingJob
      : null,
    configured: posting?.configured ?? false,
  })

  const entry = entries.find(e => e.platform === platform) ?? null
  // the row that says "this went out" — the same one derivePostingState reads,
  // and the one carrying the outcome of the hunt for its numbers
  const postedEntry = entries.find(e => e.publish_status === 'published') ?? null
  const [pickedWhen, setPickedWhen] = useState<string>(() => toLocalInput(entry?.scheduled_at ?? null))
  const [manual, setManual] = useState(false)
  const [manualPlatform, setManualPlatform] = useState(platform)
  const [liveUrl, setLiveUrl] = useState('')
  const [inviting, setInviting] = useState(false)
  const [confirmInvite, setConfirmInvite] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)

  const label = platformLabel(platform)
  const primary = postingPrimaryLabel(state)
  const whenIso = pickedWhen ? new Date(pickedWhen).toISOString() : null
  /** a time already gone is not a schedule — the button says "Post now" */
  const isPast = !whenIso || new Date(whenIso).getTime() <= Date.now()

  const sendInvite = async () => {
    setInviting(true)
    try {
      const res = await fetch('/api/social/connect/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, platform }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send the link')
      const n = Number(json.sent ?? json.recipients?.length ?? 0)
      toast.success(`Connect link emailed to ${n} ${n === 1 ? 'person' : 'people'} at ${clientName}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the link')
    } finally {
      setInviting(false)
      setConfirmInvite(false)
    }
  }

  const connectNow = async () => {
    setWorking('connect')
    try {
      const res = await fetch('/api/social/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, platform }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not start the connection')
      // a new tab, not this one: the person doing this is mid-way through
      // scheduling a post and should come back to it
      window.open(json.authUrl, '_blank', 'noopener,noreferrer')
      toast.message('Finish the connection in the new tab, then press Re-check here.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the connection')
    } finally {
      setWorking(null)
    }
  }

  const cancelQueued = async () => {
    setWorking('cancel')
    try {
      const res = await fetch(`/api/production/items/${itemId}/publish`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not cancel it')
      toast.success('Cancelled — nothing will go out')
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel it')
    } finally {
      setWorking(null)
    }
  }

  /** Move a queued post: take it back first, then queue the new time. */
  const reschedule = async () => {
    setWorking('reschedule')
    try {
      const res = await fetch(`/api/production/items/${itemId}/publish`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not move it')
      await onPost(platform, whenIso, false)
      setRescheduling(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move it')
    } finally {
      setWorking(null)
    }
  }

  const manualRow = (
    <div className="mt-1 flex flex-col gap-2.5 rounded-lg border border-dashed border-zinc-200 p-3 dark:border-zinc-800">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
        Posting it yourself
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={manualPlatform} onValueChange={v => v && setManualPlatform(v)}>
          <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
          <SelectContent>
            {platforms.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="datetime-local" value={pickedWhen} className="font-mono text-xs"
          onChange={e => setPickedWhen(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => void onManual({ platform: manualPlatform, whenIso })}>
          Set date
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => void onManual({ platform: manualPlatform, markPosted: true })}>
          Mark as posted
        </Button>
      </div>
      <div className="flex gap-2">
        <Input value={liveUrl} placeholder="Live URL once posted"
          onChange={e => setLiveUrl(e.target.value)} />
        <Button size="sm" disabled={busy || !liveUrl}
          onClick={async () => { await onManual({ platform: manualPlatform, liveUrl }); setLiveUrl('') }}>
          Save the live link
        </Button>
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        “Mark as posted” is for anything that went out without a link — a Story,
        or files handed over.
      </p>
    </div>
  )

  const manualLink = (
    <button type="button" onClick={() => setManual(m => !m)}
      className="w-fit text-xs text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400">
      {manual ? 'Hide the manual fields' : 'Post manually instead'}
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      {!canAutoPublish ? (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Publishing to the channels is done by the scheduling team; add the live link here once it&rsquo;s up.
          </p>
          {manualRow}
        </>
      ) : (
        <>
          {state.kind === 'not_configured' && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Publishing is not configured on the server, so nothing can go out from here yet. Post it yourself and record the link below.</span>
            </div>
          )}

          {state.kind === 'not_connected' && (
            <>
              <div className="flex items-center gap-2">
                <PlatformIcon platform={platform} size={22} className="opacity-40 grayscale" />
                <p className="text-sm font-medium">{clientName} has no {label} connected</p>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                We can&rsquo;t post for them until their account is linked. The link opens
                {' '}{label}&rsquo;s own login — nobody types the client&rsquo;s password here.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={inviting} onClick={() => setConfirmInvite(true)}>
                  {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Send the client a connect link
                </Button>
                <Button size="sm" variant="outline" disabled={working === 'connect'} onClick={() => void connectNow()}>
                  Connect now
                </Button>
              </div>
              {manualLink}
            </>
          )}

          {state.kind === 'ready' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <PlatformIcon platform={platform} size={22} />
                <span className="text-sm font-medium">{label}</span>
                {posting?.accounts.find(a => a.platform === platform)?.username && (
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    @{posting.accounts.find(a => a.platform === platform)!.username}
                  </span>
                )}
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">When should it go out?</Label>
                <Input type="datetime-local" value={pickedWhen} className="w-fit font-mono text-xs"
                  onChange={e => setPickedWhen(e.target.value)} />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {whenIso
                    ? isPast
                      ? 'That time has passed — this will post immediately.'
                      : `Posts automatically on ${when(whenIso)}.`
                    : 'Leave it empty to post as soon as you press the button.'}
                </p>
              </div>
              {!caption?.trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  There is no caption yet — it will go out with the title as its text.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy}
                  onClick={() => void onPost(platform, whenIso, isPast)}>
                  {busy ? 'Working…' : isPast ? `Post now on ${label}` : `Schedule on ${label}`}
                </Button>
                {manualLink}
              </div>
            </>
          )}

          {state.kind === 'queued' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <PlatformIcon platform={platform} size={22} />
                <p className="text-sm font-medium">
                  {state.when
                    ? `Queued for ${when(state.when)} on ${label}`
                    : `Queued on ${label}`}
                  <span className="font-normal text-zinc-500 dark:text-zinc-400"> · will post automatically</span>
                </p>
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {state.handedOver
                  ? `${label} is holding it until then — nobody needs to do anything.`
                  : 'Waiting to be handed to the channel; this happens within a minute.'}
              </p>
              {rescheduling && (
                <div className="grid gap-1.5">
                  <Label className="text-xs">New time</Label>
                  <Input type="datetime-local" value={pickedWhen} className="w-fit font-mono text-xs"
                    onChange={e => setPickedWhen(e.target.value)} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {rescheduling ? (
                  <>
                    <Button size="sm" disabled={busy || working !== null} onClick={() => void reschedule()}>
                      {working === 'reschedule' ? 'Moving…' : 'Move it'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRescheduling(false)}>Keep it as it is</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" disabled={working !== null} onClick={() => setRescheduling(true)}>
                      Reschedule
                    </Button>
                    <Button size="sm" variant="ghost" disabled={working !== null} onClick={() => void cancelQueued()}>
                      {working === 'cancel' ? 'Cancelling…' : 'Cancel'}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}

          {state.kind === 'posted' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <PlatformIcon platform={platform} size={22} />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Posted{state.at ? ` ${when(state.at)}` : ''}
                </span>
                {state.manual && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    recorded by hand
                  </span>
                )}
              </div>
              {(state.permalink ?? posting?.metrics?.post_url)
                ? (
                  <a href={(state.permalink ?? posting?.metrics?.post_url)!} target="_blank" rel="noreferrer noopener"
                    className="flex w-fit items-center gap-1 text-xs text-emerald-600 hover:underline dark:text-emerald-400">
                    See the post <ExternalLink className="h-3 w-3" />
                  </a>
                )
                : <p className="text-[11px] text-zinc-400 dark:text-zinc-500">No link — a Story, or posted without one.</p>}
              {/* A post recorded by hand was never handed to the provider — but
                  the platform still counted it, and the provider's own list of
                  posts made directly on the account is where those numbers
                  come from. So a hand-posted item shows its figures like any
                  other once its link has been matched, and says plainly when
                  the link matched nothing. Before the first lookup lands there
                  is nothing honest to say, so it says nothing. */}
              {!state.manual
                ? <PostedMetrics metrics={posting?.metrics ?? null} platform={state.platform} />
                : posting?.metrics
                  ? <PostedMetrics metrics={posting.metrics} platform={state.platform} />
                  : postedEntry?.external_match_state === 'not_found' && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Couldn&rsquo;t find this post on {label} — check the link.
                    </p>
                  )}
            </>
          )}

          {state.kind === 'failed' && (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>{label} did not post it.</strong><br />{state.error}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy} onClick={() => void onPost(platform, whenIso, isPast)}>
                  {busy ? 'Working…' : 'Retry'}
                </Button>
                {manualLink}
              </div>
            </>
          )}

          {manual && manualRow}
        </>
      )}

      {/* naming who receives it: "send the client a link" is a promise about
          other people's inboxes, and it should never be a guess */}
      <AlertDialog open={confirmInvite} onOpenChange={o => !o && setConfirmInvite(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Email {clientName} a {label} connect link?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {clientUsers.length > 0 ? (
                  <>
                    <p>It goes to:</p>
                    <ul className="mt-1.5 list-disc pl-5">
                      {clientUsers.map(u => (
                        <li key={u.email}><strong>{u.name}</strong> — {u.email}</li>
                      ))}
                    </ul>
                    <p className="mt-2">
                      They press one button and sign in at {label}. We never see their password.
                    </p>
                  </>
                ) : (
                  <p>
                    Nobody from {clientName} has a portal login yet, so there is no one to
                    email. Add a client login first, or use “Connect now” if you have their
                    details in front of you.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction disabled={clientUsers.length === 0} onClick={() => void sendInvite()}>
              Send it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export type { PostingState }
