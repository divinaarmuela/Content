/**
 * THE ACQUISITION AGENT — the pure half (the owner, 21 Sep 2026: "why can't
 * we have an AI online that runs the data and the timeline and checks if it
 * is new data or old and compares it … like an agent that makes decisions …
 * gathers inbox data, all").
 *
 * What the agent is: on a schedule, for each prospect, the server gathers
 * EVIDENCE — mail to and from them in the scanned inboxes, the Instagram DM
 * thread on MD Media's own account — and hands a model the evidence that is
 * new beside the prospect's timeline as it stands. The model says what
 * happened. THIS file decides what is done with what it says.
 *
 * The three rules, none of them the model's to bend:
 *
 *  1. NEW OR OLD IS DECIDED TWICE. In code first: a piece of evidence already
 *     attached to a timeline line is never shown to the model again. Then by
 *     the model, for what code cannot see — Tuesday's invoice notice and
 *     Wednesday's remittance are one payment — and an "already known" finding
 *     is dropped.
 *  2. THE MODEL PROPOSES, THE CODE DISPOSES. A finding must point at evidence
 *     it was actually given, be of a kind on the list, and clear a confidence
 *     floor. Anything else is ignored, whatever the prose around it says.
 *  3. WHAT MAKES A CLIENT, A PERSON CONFIRMS. A deposit paid, a contract
 *     signed and "not interested" are written as found-but-unconfirmed: worth
 *     nothing on the score and moving nothing until someone presses Confirm.
 *     Everything else above the bar is recorded and acted on.
 *
 * The agent never writes to a prospect. It reads; people write (blueprint §2,
 * "Keep relationship-building human").
 */
import type { AcqEvent, AcqEventKind, Prospect } from './acquisition-core'

export type EvidenceSource = 'email' | 'instagram'

export type Evidence = {
  /** stable across runs and mailboxes: `email:<Message-ID>` or `ig:<message id>` */
  id: string
  source: EvidenceSource
  at: string | null
  /** in = from the prospect to us; out = from us to them */
  direction: 'in' | 'out'
  from: string
  to: string
  subject?: string | null
  text: string
}

/** what the agent may say happened — a subset of the timeline's kinds */
export const AGENT_KINDS = [
  'outreach_sent', 'follow_up', 'reply', 'link_click', 'call_booked', 'call_held',
  'proposal_sent', 'deposit_sent', 'deposit_paid', 'signed', 'not_interested', 'note',
] as const satisfies readonly AcqEventKind[]
export type AgentKind = (typeof AGENT_KINDS)[number]

/** rule 3: these wait for a person */
export const ASK_FIRST: readonly AgentKind[] = ['deposit_paid', 'signed', 'not_interested']

/** below this the finding is ignored; between the two it is asked, not acted on */
export const IGNORE_BELOW = 0.5
export const ACT_FROM = 0.8

export type AgentFinding = {
  evidence_id: string
  kind: string
  /** when it happened, as the evidence says — else the evidence's own time */
  at?: string | null
  summary: string
  confidence: number
  already_known: boolean
}

export type AgentVerdict = 'record' | 'ask' | 'ignore'

export function decideFinding(f: AgentFinding, evidence: readonly Evidence[]): { verdict: AgentVerdict; why: string } {
  if (!evidence.some(e => e.id === f.evidence_id)) return { verdict: 'ignore', why: 'points at evidence it was not given' }
  if (!(AGENT_KINDS as readonly string[]).includes(f.kind)) return { verdict: 'ignore', why: 'not a kind the agent may record' }
  if (f.already_known) return { verdict: 'ignore', why: 'already on the timeline' }
  const c = Number(f.confidence)
  if (!Number.isFinite(c) || c < IGNORE_BELOW) return { verdict: 'ignore', why: 'not sure enough' }
  if ((ASK_FIRST as readonly string[]).includes(f.kind)) return { verdict: 'ask', why: 'a person confirms what makes or ends a client' }
  if (c < ACT_FROM) return { verdict: 'ask', why: 'likely, not certain' }
  // our own outgoing mail is only ever a record of what a person did; an incoming signal must come from them
  const ev = evidence.find(e => e.id === f.evidence_id)!
  const needsIncoming: readonly string[] = ['reply', 'call_booked', 'link_click', 'not_interested']
  if (needsIncoming.includes(f.kind) && ev.direction !== 'in') return { verdict: 'ask', why: 'the signal is theirs, the message is ours' }
  return { verdict: 'record', why: 'new, of a known kind, and sure' }
}

/** rule 1, the code's half: evidence already on a timeline line is old */
export function newEvidence(evidence: readonly Evidence[], events: readonly (AcqEvent & { evidence_id?: string | null })[]): Evidence[] {
  const seen = new Set(events.map(e => e.evidence_id).filter((x): x is string => !!x))
  const once = new Map<string, Evidence>()
  for (const e of evidence) if (!seen.has(e.id) && !once.has(e.id)) once.set(e.id, e)
  return [...once.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
}

/** one lock per thing said about one piece of evidence */
export function findingKey(prospectId: string, f: Pick<AgentFinding, 'evidence_id' | 'kind'>): string {
  return `${prospectId}__${f.kind}__${f.evidence_id}`
}

/** a finding waiting on a person */
export function isOpenFinding(e: { confirmed?: boolean | null; dismissed_at?: string | null; source?: string | null }): boolean {
  return e.confirmed === false && !e.dismissed_at
}

const clip = (s: string | null | undefined, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }

export const AGENT_SYSTEM =
  'You are the acquisition analyst for MD Media, a Melbourne marketing agency. For ONE prospect you are given its timeline as it stands and NEW evidence: emails and Instagram direct messages between the agency and that prospect. ' +
  'Say what each piece of new evidence shows happened, as findings. Rules: ' +
  'Use only the evidence given — never infer an event that no message shows. ' +
  'One finding per real-world event; if two messages show the same event, report it once, on the earliest. ' +
  'If the timeline already records the event (same thing, same day or close), set already_known true. ' +
  'direction "in" is from the prospect, "out" is from the agency. A reply, a booked call, a clicked link and "not interested" are the PROSPECT\'s acts and need an "in" message. ' +
  'Kinds: outreach_sent (the agency\'s first message with the audit), follow_up (a later agency chase), reply (the prospect answered), link_click (they say they watched or opened the audit), call_booked (a time is agreed or a calendar acceptance), call_held (the call happened: a meeting summary or a "great to chat" message), proposal_sent, deposit_sent (an invoice or payment request went to them), deposit_paid (payment confirmed or remittance), signed (agreement completed), not_interested (they declined), note (worth keeping, none of the above). ' +
  'Newsletters, automatic replies and out-of-office messages are not events: return nothing for them. ' +
  'confidence is 0 to 1: 0.9+ only when the message states it plainly. summary is one plain sentence a colleague can check against the message.'

export function agentPrompt(p: Pick<Prospect, 'business' | 'stage'> & { contact_name?: string | null; email?: string | null; instagram?: string | null }, events: readonly AcqEvent[], evidence: readonly Evidence[]): string {
  const timeline = [...events].sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map(e => `- ${String(e.at).slice(0, 16)} ${e.kind}${e.confirmed === false ? ' (unconfirmed)' : ''}: ${clip(e.detail, 160)}`).join('\n') || '- (nothing yet)'
  const items = evidence.map(e =>
    `### evidence_id: ${e.id}\nsource: ${e.source} · direction: ${e.direction} · at: ${e.at ?? 'unknown'}\nfrom: ${e.from}\nto: ${e.to}${e.subject ? `\nsubject: ${clip(e.subject, 200)}` : ''}\n\n${clip(e.text, 1800)}`).join('\n\n')
  return `PROSPECT: ${p.business}${p.contact_name ? ` (contact: ${p.contact_name})` : ''}\nemail: ${p.email ?? '—'} · instagram: ${p.instagram ? `@${p.instagram}` : '—'}\ncurrent stage: ${p.stage}\n\nTIMELINE SO FAR\n${timeline}\n\nNEW EVIDENCE (${evidence.length})\n${items}`
}
