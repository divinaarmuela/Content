'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import {
  DEFAULT_TZ, formatWithZone, fromZonedInput, toZonedInput, viewerHint,
  zoneAbbrev, zoneLabel,
} from '../../../lib/timezone-core'
import {
  SEND_LABEL, WAITING_LINE, approvalStep,
  type ApprovalStep, type PostingApprovalState,
} from '../../../lib/posting-approval-core'
import type { Role } from '../../../lib/identity-core'

/** the final-post gate, as the item API hands it over. `supported` is false on
 *  a database the migration has not reached — the card then draws none of it. */
export type PostingApproval = {
  supported: boolean
  state: PostingApprovalState | null
  client_required: boolean
  note: string | null
  approved_at: string | null
}

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
      <p className="text-[12px] text-muted-foreground">{METRICS_PENDING_LINE}</p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {cells.map(c => (
          <span key={c.key} className="flex items-baseline gap-1">
            <span className="font-mono text-secondary-13 tabular-nums">{compactCount(c.value)}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {c.label}
            </span>
          </span>
        ))}
      </div>
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
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
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
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
  /** the AUDIENCE's zone. Every time on this card is entered and read in it —
   *  a scheduler in Manila books 9 am Melbourne by typing 9:00, because the
   *  post is going to a Melbourne feed and that is the only time anybody in
   *  this conversation actually means. */
  clientTz: string
  /** who at the client would be emailed a connect link */
  clientUsers: { name: string; email: string }[]
  platformTargets: string[]
  caption: string | null
  posting: PostingContext | null
  entries: PostingEntry[]
  /** may this person publish to the client's live accounts? */
  canAutoPublish: boolean
  /** the final-post gate — null on payloads from before it existed */
  approval?: PostingApproval | null
  /** the hats the viewer wears ON THIS ITEM — decides send vs approve */
  hats?: readonly Role[]
  /** the piece itself, for the preview the approver signs off */
  previewSlides?: { url: string; type: 'image' | 'video'; name?: string }[]
  /** perform one approval action, then refresh the item */
  onApproval?: (action: 'send' | 'approve' | 'request_changes', opts?: { note?: string; client_too?: boolean }) => Promise<void>
  platforms: readonly string[]
  /** save a platform + time on the item, then open the notify picker */
  onPost: (platform: string, whenIso: string | null, publishNow: boolean) => Promise<void>
  /** the manual path: live link, or "it went out, no link" */
  onManual: (input: { platform: string; whenIso?: string | null; liveUrl?: string; markPosted?: boolean }) => Promise<void>
  onChanged: () => Promise<void> | void
  busy: boolean
}

/** The reader's own zone, for the "= 1:00 pm your time" line. Read once, on
 *  the client, and never on the server — there is no such thing as the
 *  server's opinion of where you are sitting. */
function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

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
    approval, hats, previewSlides, onApproval,
  } = props
  const tz = props.clientTz || DEFAULT_TZ

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
  const [pickedWhen, setPickedWhen] = useState<string>(() => toZonedInput(entry?.scheduled_at ?? null, tz))
  // resolved after mount: on the server there is no viewer to have a zone
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  useEffect(() => { setViewerTz(browserZone()) }, [])
  const [manual, setManual] = useState(false)
  const [manualPlatform, setManualPlatform] = useState(platform)
  const [liveUrl, setLiveUrl] = useState('')
  const [inviting, setInviting] = useState(false)
  const [confirmInvite, setConfirmInvite] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)
  /** the send-for-approval preview is open (the sender's confirm) */
  const [sendOpen, setSendOpen] = useState(false)
  /** "Client approves the final post too" */
  const [clientToo, setClientToo] = useState(approval?.client_required === true)
  /** the approver's request-changes note */
  const [approvalNote, setApprovalNote] = useState('')
  const [approvalMode, setApprovalMode] = useState<null | 'changes'>(null)

  const label = platformLabel(platform)
  const primary = postingPrimaryLabel(state)
  // the typed wall time is the CLIENT's, not this browser's — that single
  // reading is the whole difference between 9 am Melbourne and 11 am Melbourne
  const whenIso = fromZonedInput(pickedWhen, tz)
  /** a time already gone is not a schedule — the button says "Post now" */
  const isPast = !whenIso || new Date(whenIso).getTime() <= Date.now()

  /** every printed posting time on this card, in the client's zone */
  const when = (iso: string | null) => formatWithZone(iso, tz)
  /** …and what that is on the reader's own clock, when it differs */
  const hint = (iso: string | null) => viewerHint(iso, tz, viewerTz)
  const zoneNote = `${zoneLabel(tz)} time (${zoneAbbrev(tz, whenIso ?? undefined)})`

  /** "Melbourne time (AEST)" plus "= 1:00 pm your time" under a picker */
  const pickerNote = (
    <>
      <span className="font-medium text-muted-foreground">{zoneNote}</span>
      {whenIso && hint(whenIso) && <> · {hint(whenIso)}</>}
    </>
  )

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
    <div className="mt-1 flex flex-col gap-2.5 rounded-inner border border-dashed border-border p-3">
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
        Posting it yourself
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={manualPlatform} onValueChange={v => v && setManualPlatform(v)}>
          <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
          <SelectContent>
            {platforms.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="datetime-local" value={pickedWhen} className="font-mono text-secondary-13"
          onChange={e => setPickedWhen(e.target.value)} />
      </div>
      <p className="-mt-1 text-[12px] text-muted-foreground">
        {whenIso
          ? <>“Set date” records {when(whenIso)}. {hint(whenIso)}</>
          : pickerNote}
      </p>
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
      <p className="text-[12px] text-muted-foreground">
        “Mark as posted” is for anything that went out without a link — a Story,
        or files handed over.
      </p>
    </div>
  )

  const manualLink = (
    <button type="button" onClick={() => setManual(m => !m)}
      className="w-fit text-secondary-13 text-muted-foreground underline-offset-4 hover:underline">
      {manual ? 'Hide the manual fields' : 'Post manually instead'}
    </button>
  )

  /**
   * ── the final-post gate ──
   * 'open' either because the post is approved, or because the gate does not
   * exist on this database yet (approval.supported false / no handler) — in
   * which case the card behaves exactly as it did before the gate was built.
   */
  const gate: ApprovalStep = approval?.supported && onApproval
    ? approvalStep(approval.state, hats ?? [])
    : 'open'

  const doApproval = async (
    action: 'send' | 'approve' | 'request_changes', opts?: { note?: string; client_too?: boolean },
  ) => {
    if (!onApproval) return
    setWorking('approval')
    try {
      await onApproval(action, opts)
      setSendOpen(false)
      setApprovalMode(null)
      setApprovalNote('')
    } finally {
      setWorking(null)
    }
  }

  /** THE POST, as it will actually appear — what gets approved. The same
   *  facts the approver's email carries: media, caption word for word, the
   *  channel, and the hour in the client's zone. */
  const firstSlide = (previewSlides ?? [])[0] ?? null
  const previewPanel = (
    <div className="overflow-hidden rounded-inner border border-border">
      {firstSlide && (
        <div className="max-h-64 w-full overflow-hidden bg-foreground">
          {firstSlide.type === 'video' ? (
            <video src={firstSlide.url} muted playsInline controls preload="metadata" className="max-h-64 w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={firstSlide.url} alt="" className="max-h-64 w-full object-contain" />
          )}
        </div>
      )}
      {(previewSlides?.length ?? 0) > 1 && (
        <p className="border-b border-border px-3 py-1.5 text-[12px] text-muted-foreground">
          {previewSlides!.length} slides — the first is shown; they post in the order under Versions.
        </p>
      )}
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2 text-secondary-13 text-muted-foreground">
          <PlatformIcon platform={platform} size={16} />
          <span className="font-medium text-muted-foreground">{label}</span>
          {posting?.accounts.find(a => a.platform === platform)?.username && (
            <span className="font-mono">@{posting!.accounts.find(a => a.platform === platform)!.username}</span>
          )}
          <span>·</span>
          <span>{whenIso ? <>{when(whenIso)} {hint(whenIso) && <span className="text-muted-foreground">({hint(whenIso)})</span>}</> : 'posts as soon as it is queued'}</span>
        </div>
        <div>
          <p className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">The caption, exactly as it will post</p>
          {caption?.trim()
            ? <p className="whitespace-pre-wrap text-body-15">{caption}</p>
            : <p className="text-body-15 text-muted-foreground">No caption — it would go out with the title as its text.</p>}
        </div>
      </div>
    </div>
  )

  /** the disabled queue button + the one line explaining it, while the gate
   *  is anything but approved */
  const waitingRow = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled title={WAITING_LINE}>
        {isPast ? `Post now on ${label}` : `Schedule on ${label}`}
      </Button>
      <span className="text-secondary-13 text-accent-amber">{WAITING_LINE}</span>
    </div>
  )

  /** what the gate asks THIS viewer to do, drawn inside the ready state */
  const approvalBlock = gate === 'open' ? null : (
    <div className="flex flex-col gap-2.5">
      {gate === 'resend' && (
        <div className="flex items-start gap-2 rounded-inner border border-accent-amber/35 bg-tint-amber px-3 py-2 text-secondary-13 text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Changes were asked for on this post.</strong>
            {approval?.note && <><br />“{approval.note}”</>}
            <br />Update the caption or the media, then send it for approval again.
          </span>
        </div>
      )}

      {(gate === 'send' || gate === 'resend') && (
        sendOpen ? (
          <>
            <p className="text-secondary-13 font-medium text-muted-foreground">
              This is what gets approved — check it reads exactly right:
            </p>
            {previewPanel}
            <label className="flex min-h-11 items-center gap-2.5 text-secondary-13 text-muted-foreground md:min-h-0">
              <Switch checked={clientToo} onCheckedChange={setClientToo} />
              {clientName} approves the final post too (it appears on their portal)
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || working !== null} onClick={() => void doApproval('send', { client_too: clientToo })}>
                {working === 'approval' ? 'Sending…' : clientToo ? 'Send to the account manager & the client' : 'Send it for approval'}
              </Button>
              <Button size="sm" variant="ghost" disabled={working !== null} onClick={() => setSendOpen(false)}>
                Not yet
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy || working !== null || !caption?.trim()} onClick={() => setSendOpen(true)}>
                {SEND_LABEL}
              </Button>
              {manualLink}
            </div>
            {!caption?.trim() && (
              <p className="text-secondary-13 text-accent-amber">
                Write the caption first — the caption is what gets approved.
              </p>
            )}
          </div>
        )
      )}

      {gate === 'waiting' && (
        <>
          <p className="text-secondary-13 text-muted-foreground">
            The post is with {approval?.client_required ? `the account manager and ${clientName}` : 'the account manager'} for
            final sign-off. Nothing goes out until someone approves it.
          </p>
          {previewPanel}
        </>
      )}

      {gate === 'decide' && (
        <>
          <p className="text-secondary-13 font-medium text-muted-foreground">
            This post needs your sign-off — the caption and timing, exactly as it will appear:
          </p>
          {previewPanel}
          {approval?.client_required && (
            <p className="text-secondary-13 text-muted-foreground">
              {clientName} was asked to approve it too — it is on their portal.
            </p>
          )}
          {approvalMode === 'changes' && (
            <textarea
              rows={3}
              value={approvalNote}
              autoFocus
              onChange={e => setApprovalNote(e.target.value)}
              placeholder="What should change before it goes out?"
              className="w-full resize-y rounded-tile border border-border bg-transparent p-2.5 text-body-15 outline-none placeholder:text-muted-foreground focus:border-border"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {approvalMode === null ? (
              <>
                <Button size="sm" disabled={busy || working !== null} onClick={() => void doApproval('approve')}>
                  {working === 'approval' ? 'Working…' : 'Approve the post'}
                </Button>
                <Button size="sm" variant="outline" disabled={working !== null} onClick={() => setApprovalMode('changes')}>
                  Request changes
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" disabled={busy || working !== null || !approvalNote.trim()}
                  onClick={() => void doApproval('request_changes', { note: approvalNote })}>
                  {working === 'approval' ? 'Sending…' : 'Send the changes'}
                </Button>
                <Button size="sm" variant="ghost" disabled={working !== null}
                  onClick={() => { setApprovalMode(null); setApprovalNote('') }}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {waitingRow}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {!canAutoPublish ? (
        <>
          <p className="text-secondary-13 text-muted-foreground">
            Publishing to the channels is done by the scheduling team; add the live link here once it&rsquo;s up.
          </p>
          {manualRow}
        </>
      ) : (
        <>
          {state.kind === 'not_configured' && (
            <div className="flex items-start gap-2 rounded-inner border border-accent-amber/35 bg-tint-amber px-3 py-2 text-secondary-13 text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Publishing is not configured on the server, so nothing can go out from here yet. Post it yourself and record the link below.</span>
            </div>
          )}

          {state.kind === 'not_connected' && (
            <>
              <div className="flex items-center gap-2">
                <PlatformIcon platform={platform} size={22} className="opacity-40 grayscale" />
                <p className="text-body-15 font-medium">{clientName} has no {label} connected</p>
              </div>
              <p className="text-secondary-13 text-muted-foreground">
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
                <span className="text-body-15 font-medium">{label}</span>
                {posting?.accounts.find(a => a.platform === platform)?.username && (
                  <span className="font-mono text-secondary-13 text-muted-foreground">
                    @{posting.accounts.find(a => a.platform === platform)!.username}
                  </span>
                )}
                <CheckCircle2 className="h-3.5 w-3.5 text-accent-green" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-secondary-13">When should it go out? — {zoneNote}</Label>
                <Input type="datetime-local" value={pickedWhen} className="w-fit font-mono text-secondary-13"
                  onChange={e => setPickedWhen(e.target.value)} />
                <p className="text-[12px] text-muted-foreground">
                  {whenIso
                    ? isPast
                      ? 'That time has passed — this will post immediately.'
                      : <>Posts automatically on {when(whenIso)}. {hint(whenIso)}</>
                    : 'Leave it empty to post as soon as you press the button.'}
                </p>
              </div>
              {!caption?.trim() && gate === 'open' && (
                <p className="text-secondary-13 text-accent-amber">
                  There is no caption yet — it will go out with the title as its text.
                </p>
              )}
              {gate === 'open' ? (
                <>
                  {/* the gate has been through and said yes — the queue is open */}
                  {approval?.supported && approval.state === 'approved' && (
                    <p className="flex items-center gap-1.5 text-secondary-13 text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Final post approved
                      {approval.approved_at ? ` — ${when(approval.approved_at)}` : ''}.
                      Changing the caption or the media will need a fresh approval.
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
              ) : approvalBlock}
            </>
          )}

          {state.kind === 'queued' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <PlatformIcon platform={platform} size={22} />
                <p className="text-body-15 font-medium">
                  {state.when
                    ? `Queued for ${when(state.when)} on ${label}`
                    : `Queued on ${label}`}
                  <span className="font-normal text-muted-foreground"> · will post automatically</span>
                </p>
                {state.when && hint(state.when) && (
                  <span className="text-secondary-13 text-muted-foreground">{hint(state.when)}</span>
                )}
              </div>
              <p className="text-[12px] text-muted-foreground">
                {state.handedOver
                  ? `${label} is holding it until then — nobody needs to do anything.`
                  : 'Waiting to be handed to the channel; this happens within a minute.'}
              </p>
              {rescheduling && (
                <div className="grid gap-1.5">
                  <Label className="text-secondary-13">New time — {zoneNote}</Label>
                  <Input type="datetime-local" value={pickedWhen} className="w-fit font-mono text-secondary-13"
                    onChange={e => setPickedWhen(e.target.value)} />
                  <p className="text-[12px] text-muted-foreground">{pickerNote}</p>
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
                <span className="text-body-15 font-medium text-foreground">
                  Posted{state.at ? ` ${when(state.at)}` : ''}
                </span>
                {state.at && hint(state.at) && (
                  <span className="text-secondary-13 text-muted-foreground">{hint(state.at)}</span>
                )}
                {state.manual && (
                  <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
                    recorded by hand
                  </span>
                )}
              </div>
              {(state.permalink ?? posting?.metrics?.post_url)
                ? (
                  <a href={(state.permalink ?? posting?.metrics?.post_url)!} target="_blank" rel="noreferrer noopener"
                    className="flex w-fit items-center gap-1 text-secondary-13 text-accent-green hover:underline">
                    See the post <ExternalLink className="h-3 w-3" />
                  </a>
                )
                : <p className="text-[12px] text-muted-foreground">No link — a Story, or posted without one.</p>}
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
                    <p className="text-[12px] text-accent-amber">
                      Couldn&rsquo;t find this post on {label} — check the link.
                    </p>
                  )}
            </>
          )}

          {state.kind === 'failed' && (
            <>
              <div className="flex items-start gap-2 rounded-inner border border-accent-red/30 bg-tint-red px-3 py-2 text-secondary-13 text-foreground">
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
