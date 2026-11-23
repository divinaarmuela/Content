'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, ChevronRight, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Chip from '../../../ui/Chip'
import {
  STAGE_LABEL, ackState, briefChecklist, briefIsLate, clientPlanWords, clockWords, goReady, isFootageOnly, overrideWords,
  planReviewPassed, shootStage, stageMove, stampWords, FOOTAGE_ONLY_WORDS,
} from '../../../../lib/shoot-sop-core'
import { shootCardId } from '../../../../lib/deliverable-group-core'
import { PeoplePanel, WherePanel, type CrewRow, type TeamRow } from './ShootSop'

/**
 * THE SHOOT, RIGHT NOW (the owner, 19 Nov 2026: "still looks very messy … still too many things happening here … not
 * timeline … as a developer, remove the overwhelming ui"). The right side was three cards showing everything a shoot
 * can ever need, all at once. This is one small card that answers three questions and nothing else:
 *
 *   where is it      the stage and the days left
 *   what is left     one line, and ONE button
 *   who and what     People · The client · The editor's card · More — one quiet row each
 *
 * Everything else opens in a popup, holding only what was asked for. The popups draw the very rows and buttons the page
 * had before (WherePanel's parts, PeoplePanel), so no rule and no wording changed — only when they are on screen.
 */
type WhereProps = ComponentProps<typeof WherePanel>
type PeopleProps = ComponentProps<typeof PeoplePanel>

type Open = 'step' | 'people' | 'client' | 'more' | null

export default function ShootNow(props: Omit<WhereProps, 'part'> & {
  crew: CrewRow[]
  team: TeamRow[]
  items: { id: string; title: string; status: string; work_kinds?: { slug?: string } | null }[]
  onUnack: PeopleProps['onUnack']
  onAck?: PeopleProps['onAck']
  onResend?: PeopleProps['onResend']
}) {
  const { batch, role, viewerId, today, itemCount, busy, nameOf, onMove, onDecide, planReviewRequired, viewerIsReviewer, crew, team, items } = props
  const [open, setOpen] = useState<Open>(null)
  const gate = planReviewRequired === true
  const planReview = { required: gate }
  const stage = shootStage(batch, today, { planReview: gate })
  const late = briefIsLate(batch, today)
  const clock = clockWords(batch, today)
  const footageOnly = isFootageOnly(batch)
  const closed = batch.status === 'wrapped'
  const go = goReady(batch, { itemCount, role, planReview })
  const plan = briefChecklist(batch, { itemCount })
  const ack = ackState(batch)
  const where: Omit<WhereProps, 'part'> = props

  /* ── what is left, in one line, and the one button ── */
  const reviewOpen = gate && !planReviewPassed(batch) && !batch.go_at
  const sharing = !batch.brief_shared_at && (stage === 'drafting' || stage === 'quality_review' || stage === 'reminder_sent' || stage === 'shoot_day')
  let left: string | null = null
  let action: { label: string; press: () => void; strong: boolean; disabled?: boolean } | null = null
  if (closed) {
    left = 'This shoot is done and archived.'
  } else if (footageOnly) {
    left = 'Typed in from the Editor page. Nothing to confirm here; its cards are on the Editor page.'
  } else if (sharing) {
    const n = plan.missing.length + (reviewOpen ? 1 : 0)
    left = n === 0 ? 'The plan is ready to go to the team.'
      : [plan.missing.length > 0 ? `${plan.missing.length} plan ${plan.missing.length === 1 ? 'part' : 'parts'} still to fill in` : null,
        reviewOpen ? (batch.review_asked_at ? 'with the quality checker' : 'quality review not sent yet') : null].filter(Boolean).join(' · ')
    action = { label: reviewOpen ? 'Quality review and sharing' : 'Share the plan with the team', press: () => setOpen('step'), strong: true }
  } else if (stage === 'shared') {
    left = go.ok ? 'Everything is in. Ready to confirm.' : `${go.reasons.length} ${go.reasons.length === 1 ? 'thing' : 'things'} left before it can be confirmed`
    action = { label: go.ok ? 'Confirm — it is go' : 'Finish and confirm', press: () => setOpen('step'), strong: true }
  } else if (stage === 'confirmed') {
    // one press, nothing to fill in: it acts here, no popup
    const can = stageMove(batch, 'reminder_sent', { role, today, checklist: { itemCount }, planReview, reviewer: viewerIsReviewer === true }, 'now', viewerId)
    left = can.ok ? 'Confirmed. Send the day-before reminder, then press this.' : can.reason
    action = { label: 'Reminder sent to everyone', press: () => void onMove('reminder_sent'), strong: true, disabled: !can.ok }
  } else if (stage === 'reminder_sent' || stage === 'shoot_day') {
    left = batch.footage_url ? 'The footage folder is in. Press when the footage is up.' : 'After the shoot: paste the footage folder link.'
    action = { label: 'Footage is in', press: () => setOpen('step'), strong: true }
  } else {
    left = `Footage is with the editor${batch.edit_deadline ? `, due ${stampWords(batch.edit_deadline)}` : ''}. The work is on the Editor page.`
    action = { label: 'Footage folder', press: () => setOpen('step'), strong: false }
  }

  /* ── the quiet rows ── */
  const crewIds = Array.isArray(batch.crew_ids) ? batch.crew_ids.map(String) : []
  const onDay = crewIds.filter(id => id !== batch.editor_id).length
  const peopleLine = [
    nameOf(batch.owner_id) ?? 'No account manager',
    batch.editor_id ? `${nameOf(batch.editor_id) ?? 'An editor'} edits` : 'no editor yet',
    onDay > 0 ? `${onDay} on the day` : 'no crew yet',
    ack.total > 0 ? ack.words : null,
  ].filter(Boolean).join(' · ')
  const peopleMissing = !batch.editor_id && onDay === 0

  const onPortal = batch.shared_with_client === true
  const clientLine = clientPlanWords(batch) ?? (onPortal ? 'On the client portal' : 'Not on the client portal yet')
  // THE TEAM OFTEN ANSWERS FOR THE CLIENT (Manal, 4 Nov 2026; the owner, 19 Nov 2026: "sometimes client approve, we
  // approve from our side"): the press sits where the waiting is said, not under More
  const mayAnswerForClient = !!onDecide && (role === 'account_manager' || role === 'super_admin')
    && (batch.client_approval_needed === true || onPortal) && batch.client_decision !== 'approved' && !closed && !footageOnly
  const clientWaiting = onPortal && !batch.client_decision

  const cards = items.filter(i => i.work_kinds?.slug !== 'shoot_brief')
  const editorCard = cards.find(c => c.id === shootCardId(batch.id)) ?? cards[0] ?? null

  return (
    <Card className={late ? 'border-accent-red/40 bg-tint-red' : undefined} data-shoot-now>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-[15px] font-semibold ${late ? 'text-accent-red-deep' : ''}`} role={late ? 'alert' : undefined}>{clock ?? 'No shoot date yet'}</p>
          <Chip tone={stage === 'footage_handed' ? 'green' : stage === 'shoot_day' ? 'amber' : 'ink'} className="ml-auto">{closed ? 'Done' : STAGE_LABEL[stage]}</Chip>
        </div>
        {overrideWords(batch) && <Chip tone="amber" className="w-fit">{overrideWords(batch)}</Chip>}
        {footageOnly && <Chip tone="surface" className="w-fit">{FOOTAGE_ONLY_WORDS}</Chip>}

        <p className="text-[14px]" role="status" data-whats-left-line>{left}</p>
        {action && (
          <Button variant={action.strong ? 'default' : 'outline'} disabled={busy || action.disabled} onClick={action.press}
            className={action.strong ? 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90' : 'h-11 rounded-full px-4 text-[14px] font-semibold'}>
            {action.label}
          </Button>
        )}

        <div className="flex flex-col border-t border-border">
          <Row label="People" line={peopleLine} alert={peopleMissing && !closed && !footageOnly} onClick={() => setOpen('people')} />
          {!closed && !footageOnly && <Row label="The client" line={clientLine} alert={clientWaiting} onClick={() => setOpen('client')} />}
          {editorCard && (
            <Link href={`/dashboard/editor?card=${editorCard.id}`} className="flex min-h-12 items-center gap-3 border-b border-border py-2 text-left hover:bg-muted/40">
              <span className="w-[84px] shrink-0 text-[13px] font-semibold">Editor’s card</span>
              <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{nameOf(batch.editor_id) ? `${nameOf(batch.editor_id)} has it` : 'Nobody is on it yet'}{batch.edit_deadline ? ` · due ${stampWords(batch.edit_deadline)}` : ''}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          )}
          <TeamLinkRow batchId={batch.id} has={!!(batch as { team_share_token?: string | null }).team_share_token} />
          <Row label="More" line="PDF · delivery only · what happened · manager options" last onClick={() => setOpen('more')} />
        </div>
      </CardContent>

      {/* ── the popups: each holds only what was asked for ── */}
      <Popup open={open === 'step'} onClose={() => setOpen(null)}
        title={sharing ? 'Get the plan to the team' : stage === 'shared' ? 'Confirm the shoot' : 'The footage'}
        words={sharing ? 'Fill in what is left on the plan, then share it. Everyone on the shoot is emailed and asked to read it.'
          : stage === 'shared' ? 'Tick what is done. The button turns on when nothing is left.'
          : 'Paste the footage folder link. The editor is told the moment it is in.'}>
        {sharing && plan.missing.length > 0 && (
          <div className="rounded-inner border border-accent-amber/40 bg-tint-amber p-3 text-[13px]" data-plan-missing>
            <p className="font-semibold">Still to fill in on the plan</p>
            <ul className="mt-1 list-disc pl-5">{plan.missing.map(m => <li key={m.key}>{m.label}</li>)}</ul>
          </div>
        )}
        {/* nobody on the shoot is the one thing this popup cannot fix by a tick: straight to the people */}
        {!closed && !footageOnly && ack.total === 0 && (
          <Button variant="outline" className="h-11 w-fit rounded-full px-4 text-[14px] font-semibold" onClick={() => setOpen('people')} data-pick-people>
            Pick the editor and crew
          </Button>
        )}
        <WherePanel {...where} part="step" />
      </Popup>

      <Popup open={open === 'people'} onClose={() => setOpen(null)} title="Who is on this shoot"
        words="The account manager, the editor, and everyone on set. Each person is emailed the plan when it is shared.">
        <PeoplePanel bare batch={batch} crew={crew} team={team} busy={busy} onPatch={props.onPatch} onUnack={props.onUnack}
          viewerId={viewerId} onAck={props.onAck} onResend={props.onResend} />
      </Popup>

      <Popup open={open === 'client'} onClose={() => setOpen(null)} title="The client" words={clientLine}>
        {mayAnswerForClient && (
          <div className="flex flex-col gap-1.5 rounded-inner border border-border bg-surface p-3" data-answer-for-client>
            <p className="text-[13px] font-semibold">Did the client say yes somewhere else?</p>
            <p className="text-[13px] text-muted-foreground">On a call, by text, in the group chat. Mark it here and it is stamped with your name and the time.</p>
            <Button variant="outline" className="h-11 w-fit rounded-full px-4 text-[14px] font-semibold" disabled={busy}
              onClick={() => { void onDecide!('client_approved'); setOpen(null) }}>
              Client approved — mark it ourselves
            </Button>
          </div>
        )}
        <WherePanel {...where} part="client" />
      </Popup>

      <Popup open={open === 'more'} onClose={() => setOpen(null)} title="More" words="The plan’s PDF, delivery only, and the manager’s ways past the checks.">
        <WherePanel {...where} part="more" />
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[13px] font-semibold">What happened</p>
          <WherePanel {...where} part="history" />
        </div>
      </Popup>
    </Card>
  )
}

/** one quiet row: a name, a line of what is so, and it opens */
/**
 * A LINK FOR EDITORS, NO SIGN-IN (the owner, 23 Nov 2026: "How to copy this as a link and send to someone? Manal wants
 * this to send to editors as she has made notes on it … we need a public available link … this is not a client
 * portal"). One press copies a link to a read-only page with the shoot brief, the board when there is one, and every
 * comment. It is the team's own plan, so the row says who it is for; "Switch off" makes the page go dark.
 */
function TeamLinkRow({ batchId, has }: { batchId: string; has: boolean }) {
  const [on, setOn] = useState(has)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  /** the link, shown to be copied by hand when the browser would not copy it */
  const [shown, setShown] = useState<string | null>(null)
  const copy = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/batches/${batchId}/team-link`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) throw new Error(json.error ?? 'The link could not be made')
      setOn(true)
      try {
        await navigator.clipboard.writeText(String(json.url))
        setCopied(true)
        setShown(null)
        toast.success('Link copied. Anyone with it can read the shoot plan, the board and the comments.')
        window.setTimeout(() => setCopied(false), 2500)
      } catch {
        setShown(String(json.url))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The link could not be made')
    }
    setBusy(false)
  }
  const stop = async () => {
    if (busy) return
    setBusy(true)
    const res = await fetch(`/api/production/batches/${batchId}/team-link`, { method: 'DELETE' }).catch(() => null)
    if (res?.ok) { setOn(false); setShown(null); toast.success('Link switched off. It no longer opens.') }
    else toast.error('That did not go through. Try again.')
    setBusy(false)
  }
  return (
    <div className="flex flex-col gap-2 border-b border-border py-2" data-team-link>
      {/* the name and the button on one line, what it is underneath: three across squeezed the words into a ribbon */}
      <div className="flex min-h-12 items-center justify-between gap-3">
        <span className="text-[13px] font-semibold">Link for editors</span>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void copy()}
          className="h-11 shrink-0 rounded-full px-4 text-[13px] font-semibold">
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground">The shoot plan, the board and the comments, with no sign-in. Not for the client.</p>
      {shown && (
        <input readOnly value={shown} aria-label="The link, to copy" onFocus={e => e.currentTarget.select()} autoFocus
          className="h-11 w-full rounded-inner border border-border bg-background px-3 text-[13px]" />
      )}
      {on && (
        <button type="button" disabled={busy} onClick={() => void stop()}
          className="-my-1 inline-flex min-h-11 w-fit items-center text-[12px] font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Switch the link off
        </button>
      )}
    </div>
  )
}

function Row({ label, line, onClick, alert = false, last = false }: { label: string; line: string; onClick: () => void; alert?: boolean; last?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 py-2 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue ${last ? '' : 'border-b border-border'}`}>
      <span className="w-[84px] shrink-0 text-[13px] font-semibold">{label}</span>
      <span className={`min-w-0 flex-1 text-[13px] ${alert ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        {alert && <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent-amber align-middle" />}
        {line}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

function Popup({ open, onClose, title, words, children }: { open: boolean; onClose: () => void; title: string; words: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-popover sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{words}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
