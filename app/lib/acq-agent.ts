import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { table } from '@/lib/db'
import type { Client, Prospect as ProspectRow, ProspectEvent, SocialAccount } from '@/lib/db-types'
import { fetchMessage, listRecentMessageIds, type Mailbox } from './gmail'
import { availableMailboxes } from './email-lead'
import { getPublisher } from './publisher'
import { takeClaimLock } from './claim-lock'
import { encodeKey } from '@/lib/db'
import { acqStageByKey, cleanHandle, replyPoints, type AcqEvent, type AcqEventKind, type Prospect } from './acquisition-core'
import { logAcqEvent, recordCallBooked, recordReply } from './acquisition'
import {
  AGENT_SYSTEM, STRANGER_SYSTEM, agentPrompt, decideFinding, findingKey, newEvidence, strangerIsLead, strangerLockKey, strangerPrompt,
  type AgentFinding, type Evidence, type StrangerVerdict,
} from './acq-agent-core'
import { peopleNamed, tellPeople } from './acquisition'
import { escapeHtml } from './mailer'

/**
 * THE ACQUISITION AGENT — the server half (acq-agent-core.ts has the rules).
 *
 * HOW IT RUNS ONLINE. There is no process left running: the app is on Vercel,
 * where nothing lives between requests. Inngest — the scheduler the inbox
 * scanner already uses — calls the app every 30 minutes, and again the moment
 * something asks for a look (a person's "Check now", and later a webhook for
 * a new DM). Each call is one pass: gather, compare, decide, write, stop.
 *
 *   gather   mail to and from the prospect in every scanned inbox (one Gmail
 *            search per inbox), and the Instagram DM thread with their handle
 *            on the accounts connected under MD Media's own client
 *   compare  drop what a timeline line already carries (rule 1)
 *   decide   the model reads the rest beside the timeline; decideFinding
 *            says record, ask or ignore (rules 2 and 3)
 *   write    through the SAME functions a person's press uses — recordReply,
 *            recordCallBooked — so the stage, the reminders and the owner's
 *            email follow exactly as they do by hand
 */

const Findings = z.object({
  findings: z.array(z.object({
    evidence_id: z.string(),
    kind: z.string(),
    at: z.string().describe('ISO date-time the event happened, or empty to use the message time'),
    summary: z.string(),
    confidence: z.number().min(0).max(1),
    already_known: z.boolean(),
  })),
})

/** Sonnet by decision (21 Sep 2026): few calls, real consequences. ACQ_AGENT_MODEL overrides without a deploy of code. */
const agentModel = () => process.env.ACQ_AGENT_MODEL || 'claude-sonnet-5'
const AGENT: { id: string; name: string } = { id: 'agent', name: 'Acquisition agent' }
const LOOKBACK_DAYS = 45
const PER_INBOX = 8

type P = ProspectRow & Prospect
type Ev = ProspectEvent & AcqEvent & { evidence_id?: string | null }

/* ── gather ────────────────────────────────────────────────────────────── */

const FREE = /@(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|bigpond|proton|protonmail|aol)\./i

function mailTerm(p: P): string | null {
  const email = String(p.email ?? '').trim().toLowerCase()
  if (email) return email
  try {
    const host = new URL(String(p.website ?? '')).hostname.toLowerCase().replace(/^www\./, '')
    return host && !FREE.test(`@${host}`) ? host : null
  } catch { return null }
}

async function emailEvidence(p: P, boxes: readonly Mailbox[]): Promise<Evidence[]> {
  const term = mailTerm(p)
  if (!term) return []
  const out: Evidence[] = []
  for (const box of boxes) {
    try {
      const ids = await listRecentMessageIds(box, `(from:${term} OR to:${term} OR cc:${term}) newer_than:${LOOKBACK_DAYS}d -in:draft -in:trash -in:spam -in:chats`, PER_INBOX)
      for (const id of ids) {
        const m = await fetchMessage(box, id)
        if (m.autoSubmitted && m.autoSubmitted.toLowerCase() !== 'no') continue
        const theirs = m.fromEmail.toLowerCase() === term || m.fromEmail.toLowerCase().endsWith(`@${term}`) || m.fromEmail.toLowerCase().endsWith(`.${term}`)
        out.push({
          id: `email:${m.messageId || `${box.email}:${m.id}`}`, source: 'email', at: m.receivedAt, direction: theirs ? 'in' : 'out',
          from: m.fromEmail, to: m.recipients.join(', ') || box.email, subject: m.subject, text: m.body,
        })
      }
    } catch (e) { console.error('[acq-agent] could not read', box.email, 'for', p.business, e) }
  }
  return out
}

/** the accounts connected under MD Media's OWN client — every one of them, so a second handle is one more connection, not code */
export async function ownAccountIds(): Promise<string[]> {
  const wanted = process.env.ACQ_OWN_CLIENT_ID
  const own = wanted ? [{ id: wanted }] : await table<Client>('clients').list({ where: c => /^md\s*media$/i.test(String(c.name ?? '').trim()) })
  const ids = new Set(own.map(c => c.id))
  const accounts = await table<SocialAccount>('social_accounts').list({ where: a => !!a.client_id && ids.has(a.client_id) })
  return accounts.map(a => a.provider_account_id).filter((x): x is string => !!x)
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {})
const listIn = (raw: unknown, key: string): unknown[] => Array.isArray(raw) ? raw : Array.isArray(rec(raw)[key]) ? rec(raw)[key] as unknown[] : Array.isArray(rec(raw).data) ? rec(raw).data as unknown[] : []
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

export type OwnThreads = { handle: string; conversationId: string; accountId: string; ours: string }[]

/** one read of the DM inbox per run, kept to our own accounts */
export async function ownThreads(): Promise<OwnThreads> {
  const mine = new Set(await ownAccountIds())
  if (mine.size === 0) return []
  const raw = await getPublisher().listConversations()
  const out: OwnThreads = []
  for (const item of listIn(raw, 'conversations')) {
    const c = rec(item)
    const accountId = str(c.accountId)
    const handle = (cleanHandle(str(c.participantUsername) || str(rec(c.participant).username)) ?? '').toLowerCase()
    if (!handle || !mine.has(accountId) || !str(c.id)) continue
    out.push({ handle, conversationId: str(c.id), accountId, ours: str(c.accountUsername) })
  }
  return out
}

async function instagramEvidence(p: P, threads: OwnThreads): Promise<Evidence[]> {
  const handle = (cleanHandle(String(p.instagram ?? '')) ?? '').toLowerCase()
  if (!handle) return []
  const out: Evidence[] = []
  for (const t of threads.filter(x => x.handle === handle)) {
    try {
      const raw = await getPublisher().conversationMessages(t.conversationId, t.accountId)
      for (const item of listIn(raw, 'messages')) {
        const m = rec(item)
        const id = str(m.id)
        const text = str(m.message) || str(m.text)
        if (!id || !text) continue
        const outgoing = m.isFromMe === true || ['outgoing', 'sent', 'outbound'].includes(str(m.direction))
        out.push({
          id: `ig:${id}`, source: 'instagram', at: str(m.createdAt) || str(m.sentAt) || null, direction: outgoing ? 'out' : 'in',
          from: outgoing ? `@${t.ours || 'mdmedia'}` : `@${handle}`, to: outgoing ? `@${handle}` : `@${t.ours || 'mdmedia'}`, text,
        })
      }
    } catch (e) { console.error('[acq-agent] could not read the DM thread for', p.business, e) }
  }
  return out
}

/* ── decide and write ──────────────────────────────────────────────────── */

export type AgentRun = { prospect_id: string; business: string; gathered: number; fresh: number; recorded: number; asked: number; ignored: number; error?: string }

const anthropic = new Anthropic()

async function ask(p: P, events: Ev[], evidence: Evidence[]): Promise<AgentFinding[]> {
  const res = await anthropic.messages.parse({
    model: agentModel(), max_tokens: 2000, system: AGENT_SYSTEM,
    messages: [{ role: 'user', content: agentPrompt(p, events, evidence) }],
    output_config: { format: zodOutputFormat(Findings) },
  })
  return (res.parsed_output?.findings ?? []) as AgentFinding[]
}

export async function runAgentForProspect(p: P, ctx: { boxes: readonly Mailbox[]; threads: OwnThreads }): Promise<AgentRun> {
  const run: AgentRun = { prospect_id: p.id, business: p.business, gathered: 0, fresh: 0, recorded: 0, asked: 0, ignored: 0 }
  const prospects = table<ProspectRow>('prospects')
  try {
    const events = await table<ProspectEvent>('prospect_events').list({ where: e => e.prospect_id === p.id }) as Ev[]
    const gathered = [...await emailEvidence(p, ctx.boxes), ...await instagramEvidence(p, ctx.threads)]
    run.gathered = gathered.length
    const fresh = newEvidence(gathered, events).slice(-20)
    run.fresh = fresh.length
    if (fresh.length > 0) {
      const findings = await ask(p, events, fresh)
      let current = p
      for (const f of findings) {
        const { verdict, why } = decideFinding(f, fresh)
        if (verdict === 'ignore') { run.ignored++; continue }
        // one line per thing said about one message, however many runs overlap
        const lock = await takeClaimLock(`acq_agent__${encodeKey(findingKey(p.id, f))}`, 'agent')
        if (!lock.ok) { run.ignored++; continue }
        const ev = fresh.find(e => e.id === f.evidence_id)!
        const at = f.at && !Number.isNaN(Date.parse(f.at)) ? new Date(f.at).toISOString() : ev.at ?? undefined
        const detail = `${f.summary} — from ${ev.source === 'email' ? `an email (${ev.from}${ev.subject ? `, “${ev.subject.slice(0, 80)}”` : ''})` : `an Instagram DM (${ev.from})`} · ${Math.round(f.confidence * 100)}% sure${verdict === 'ask' ? ` · asked because ${why}` : ''}`
        const extra = { evidenceId: ev.id, confidence: f.confidence }
        if (verdict === 'ask') {
          await logAcqEvent({ prospectId: p.id, kind: f.kind as AcqEventKind, source: 'agent', detail, at, confirmed: false, ...extra })
          run.asked++
        } else if (f.kind === 'reply') {
          await recordReply(AGENT, current, detail, { source: 'agent', at, points: replyPoints(current), ...extra })
          current = { ...current, replied_at: current.replied_at ?? at ?? new Date().toISOString() }
          run.recorded++
        } else if (f.kind === 'call_booked') {
          await recordCallBooked(AGENT, current, null, detail, { source: 'agent', ...extra })
          run.recorded++
        } else {
          // a record of what happened; the stage stays a person's to move (every stage has data only they can give)
          await logAcqEvent({ prospectId: p.id, kind: f.kind as AcqEventKind, source: 'agent', detail, at, ...extra })
          run.recorded++
        }
      }
    }
    await prospects.update(p.id, { agent_checked_at: new Date().toISOString() } as never)
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e)
    console.error('[acq-agent] failed for', p.business, e)
  }
  return run
}

/** the context one pass shares: the inboxes and the DM threads are read once, not once per prospect */
export async function agentContext(): Promise<{ boxes: Mailbox[]; threads: OwnThreads }> {
  const boxes = await availableMailboxes().catch(() => [] as Mailbox[])
  const threads = await ownThreads().catch(e => { console.error('[acq-agent] the DM inbox could not be read:', e); return [] as OwnThreads })
  return { boxes, threads }
}

/** the prospects due a look: open ones, the longest-unchecked first */
export async function prospectsDue(limit = 25): Promise<P[]> {
  const all = await table<ProspectRow>('prospects').list() as P[]
  return all
    .filter(p => acqStageByKey(p.stage).key !== 'handoff' && (!!p.email || !!p.instagram || !!p.website))
    .sort((a, b) => String(a.agent_checked_at ?? '').localeCompare(String(b.agent_checked_at ?? '')))
    .slice(0, limit)
}

/* ── an incoming DM, the moment it lands (the Zernio webhook → Inngest) ─── */

const Stranger = z.object({
  is_potential_client: z.boolean(), confidence: z.number().min(0).max(1),
  business: z.string(), contact_name: z.string(), wants: z.string(), reasoning: z.string(),
})

export type DmOutcome =
  | { kind: 'not_ours' } | { kind: 'known'; prospect_id: string; run: AgentRun }
  | { kind: 'a_client_account' } | { kind: 'already_looked' } | { kind: 'empty_thread' }
  | { kind: 'not_a_lead'; confidence: number; reasoning: string }
  | { kind: 'lead_made'; prospect_id: string; business: string }

export async function onOwnDm(input: { accountId: string; conversationId: string | null; username: string; name: string | null }): Promise<DmOutcome> {
  if (!(await ownAccountIds()).includes(input.accountId)) return { kind: 'not_ours' }
  const handle = (cleanHandle(input.username) ?? '').toLowerCase()
  if (!handle) return { kind: 'empty_thread' }

  // SOMEONE ON THE BOARD: the ordinary pass, for them, now
  const all = await table<ProspectRow>('prospects').list() as P[]
  const known = all.find(p => (cleanHandle(String(p.instagram ?? '')) ?? '').toLowerCase() === handle)
  if (known) return { kind: 'known', prospect_id: known.id, run: await runAgentForProspect(known, await agentContext()) }

  // one of our clients' own accounts writing to us is client business, not a lead
  const accounts = await table<SocialAccount>('social_accounts').list()
  if (accounts.some(a => String(a.username ?? '').toLowerCase().replace(/^@/, '') === handle)) return { kind: 'a_client_account' }

  const lock = await takeClaimLock(`acq_dm__${encodeKey(strangerLockKey(handle, new Date().toISOString()))}`, 'agent')
  if (!lock.ok) return { kind: 'already_looked' }

  const threads = (await ownThreads()).filter(t => t.handle === handle && (!input.conversationId || t.conversationId === input.conversationId))
  const messages = await instagramEvidence({ instagram: handle, business: handle } as P, threads.length ? threads : await ownThreads())
  const incoming = messages.filter(m => m.direction === 'in')
  if (incoming.length === 0) return { kind: 'empty_thread' }

  const res = await anthropic.messages.parse({
    model: agentModel(), max_tokens: 800, system: STRANGER_SYSTEM,
    messages: [{ role: 'user', content: strangerPrompt(handle, input.name, messages.slice(-30)) }],
    output_config: { format: zodOutputFormat(Stranger) },
  })
  const v = res.parsed_output as StrangerVerdict | null
  if (!v || !strangerIsLead(v)) return { kind: 'not_a_lead', confidence: v?.confidence ?? 0, reasoning: v?.reasoning ?? 'no answer' }

  const now = new Date().toISOString()
  const first = incoming[0], last = incoming[incoming.length - 1]
  const business = v.business.trim() || input.name || `@${handle}`
  const made = await table<ProspectRow>('prospects').insert({
    business: business.slice(0, 160), instagram: handle, contact_name: v.contact_name.trim() || input.name || null,
    source: 'organic_social', source_detail: 'Instagram DM — found by the agent', stage: 'engaged', stage_entered_at: now,
    replied_at: first.at ?? now, next_action: 'Reply to their DM', notes: `What they asked for: ${v.wants.trim() || '—'}\nWhy the agent thinks they are a potential client (${Math.round(v.confidence * 100)}% sure): ${v.reasoning.trim()}`.slice(0, 2000),
    created_at: now, updated_at: now,
  } as never) as P
  await logAcqEvent({ prospectId: made.id, kind: 'added', source: 'agent', detail: `Found by the agent in the Instagram DMs of @${threads[0]?.ours || 'mdmedia'} — ${v.reasoning.trim()}`, confidence: v.confidence })
  await logAcqEvent({ prospectId: made.id, kind: 'reply', source: 'agent', at: last.at ?? now, evidenceId: last.id, confidence: v.confidence, detail: `They wrote to us first: “${last.text.replace(/\s+/g, ' ').trim().slice(0, 300)}”` })
  try {
    await tellPeople(await peopleNamed(['Joy']), AGENT, made, {
      event: 'acq_dm_lead', subject: `New lead from an Instagram DM: ${business}`, button: 'Open the lead',
      html: `<p><strong>@${escapeHtml(handle)}</strong> wrote to MD Media on Instagram and looks like a potential client.</p><p><strong>What they asked for:</strong> ${escapeHtml(v.wants.trim() || '—')}</p><p><strong>What happens next:</strong> reply to them in the Inbox — you write it. If this is not a lead, delete it from the pipeline.</p>`,
    })
  } catch (e) { console.error('[acq-agent] could not tell Joy about a DM lead:', e) }
  return { kind: 'lead_made', prospect_id: made.id, business }
}
