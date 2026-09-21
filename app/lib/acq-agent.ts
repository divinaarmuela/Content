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
  AGENT_SYSTEM, RESEARCH_SYSTEM, STRANGER_SYSTEM, agentPrompt, contactPatch, profileFromScrape, profileWords, decideFinding, findingKey, newEvidence, pageTextFrom, publicMetaFrom, researchNote, researchPatch, researchPrompt, safePublicUrl, sitesGuessedFromHandle, strangerIsLead, strangerLockKey, strangerPrompt,
  type AgentFinding, type Evidence, type IgProfile, type Research, type StrangerVerdict,
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
  for (const a of accounts) if (a.provider_account_id && a.username) OWN_HANDLES.set(a.provider_account_id, String(a.username).replace(/^@/, ''))
  return accounts.map(a => a.provider_account_id).filter((x): x is string => !!x)
}
/** our own handle per connected account — the conversation list does not carry it (seen live, 21 Sep 2026: the line said "@mdmedia" for @mdmedia._) */
const OWN_HANDLES = new Map<string, string>()

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
    out.push({ handle, conversationId: str(c.id), accountId, ours: str(c.accountUsername) || OWN_HANDLES.get(accountId) || '' })
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
  // …and looked up, so whoever opens it is not starting from a handle and one sentence
  try { const { inngest } = await import('../inngest/client'); await inngest.send({ name: 'app/acquisition.research.requested', data: { prospect_id: made.id } }) } catch (e) { console.error('[acq-agent] could not queue the research:', e) }
  return { kind: 'lead_made', prospect_id: made.id, business }
}

/* ── research (acq-agent-core.ts, "the agent researches the business") ──── */

const ResearchShape = z.object({
  found: z.boolean(), summary: z.string(), what_they_do: z.string(), industry: z.string(),
  tier: z.number(), website: z.string(), location: z.string(), contact_name: z.string(),
  weaknesses: z.array(z.string()), audit_angle: z.string(),
  fit: z.enum(['strong', 'possible', 'poor', 'unknown']), confidence: z.number().min(0).max(1), sources: z.array(z.string()),
})

const FILLED_WORDS: Record<string, string> = { email: 'email', phone: 'phone', tier: 'tier', industry: 'industry', website: 'website', audit_angle: 'audit angle', contact_name: 'contact name', weakness_tags: 'what looks weak' }

export type ResearchRun = { prospect_id: string; found: boolean; filled: string[]; proposed: string[]; searched: boolean; error?: string }

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

/**
 * WHAT INSTAGRAM SHOWS ANYONE about a profile: the name and the three counts,
 * from the page's own preview tags. Checked live on 21 Sep 2026 against
 * @crestlineconsultants — the preview tags answer; Instagram's profile JSON
 * (the bio, the link in bio) answers NOTHING to a server, and Zernio has no
 * "look up another account" call. So the bio is not read from Instagram: the
 * web search finds the business's site, and the site is read instead.
 */
export async function instagramPublicMeta(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.instagram.com/${encodeURIComponent(handle)}/`, { headers: { 'User-Agent': 'facebookexternalhit/1.1' }, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    return publicMetaFrom(await res.text())
  } catch { return null }
}

/** the whole public profile, through ScrapeCreators (acq-agent-core.ts) — null without a key, or when it has no answer */
export async function instagramProfile(handle: string): Promise<IgProfile | null> {
  const key = process.env.SCRAPECREATORS_API_KEY?.trim()
  if (!key) return null
  try {
    const res = await fetch(`https://api.scrapecreators.com/v1/instagram/profile?handle=${encodeURIComponent(handle)}`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(25_000) })
    if (!res.ok) { console.error('[acq-agent] ScrapeCreators answered', res.status, 'for', handle); return null }
    return profileFromScrape(await res.json())
  } catch (e) { console.error('[acq-agent] ScrapeCreators could not be reached:', e); return null }
}

/** the business's own site, as text: what a visitor reads first, and how to reach them */
export async function siteText(url: string): Promise<string | null> {
  const safe = safePublicUrl(url)
  if (!safe) return null
  try {
    const res = await fetch(safe, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    if (!res.ok || !String(res.headers.get('content-type') ?? '').includes('html')) return null
    return pageTextFrom((await res.text()).slice(0, 600_000))
  } catch { return null }
}

export async function researchProspect(p: P): Promise<ResearchRun> {
  const run: ResearchRun = { prospect_id: p.id, found: false, filled: [], proposed: [], searched: false }
  try {
    const handle = (cleanHandle(String(p.instagram ?? '')) ?? '')
    const profile = handle ? await instagramProfile(handle) : null
    const ig = profile ? profileWords(handle, profile) : handle ? await instagramPublicMeta(handle) : null
    // the link in their bio is their site (or a link page that points to it): read it as the site they gave
    const site = p.website ? String(p.website) : profile?.link || ''
    const given = site ? await siteText(site) : null
    // only a handle: its likeliest domains are tried, and what answers is handed over marked as a guess
    let guessed: { url: string; text: string } | null = null
    if (!site && handle) {
      for (const url of sitesGuessedFromHandle(handle)) {
        const text = await siteText(url)
        if (text && text.length > 200) { guessed = { url, text }; break }
      }
    }
    const brief = [researchPrompt(p), ig ? (profile ? ig : `INSTAGRAM SAYS (public page): ${ig}`) : handle ? 'INSTAGRAM: the public page could not be read' : null, given ? `${p.website ? 'THEIR WEBSITE' : 'THE LINK IN THEIR INSTAGRAM BIO'}, READ JUST NOW (${site}):\n${given}` : null,
      guessed ? `A SITE GUESSED FROM THE HANDLE — NOT CONFIRMED TO BE THEIRS (${guessed.url}). Use it only if its own text ties it to this Instagram account:\n${guessed.text}` : null].filter(Boolean).join('\n')
    // 1. LOOK IT UP — the model searches the web itself (Anthropic's server-side web search)
    let findings = ''
    try {
      const looked = await anthropic.messages.create({
        model: agentModel(), max_tokens: 3000, system: RESEARCH_SYSTEM,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] as never,
        messages: [{ role: 'user', content: `${brief}\n\nResearch this business and write up what you found, with the URL beside every fact.` }],
      })
      findings = looked.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim()
      run.searched = looked.content.some(b => String(b.type).includes('web_search'))
    } catch (e) {
      // web search may not be switched on for this API key — say so rather than guess from nothing
      console.error('[acq-agent] web search failed for', p.business, e)
      run.error = `Web search is not available: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`
      await logAcqEvent({ prospectId: p.id, kind: 'note', source: 'agent', detail: `The agent could not research ${p.business}: web search is not available on the AI account. Nothing was filled in.` })
      return run
    }
    // 2. PUT IT IN THE PROSPECT'S SHAPE — a second call that may only use what the first one found
    const shape = async (notes: string): Promise<Research | null> => (await anthropic.messages.parse({
      model: agentModel(), max_tokens: 1500,
      system: 'Turn the research notes into the fields asked for. Use ONLY what the notes and the website text say. Empty string or empty list where they have nothing. sources are the URLs cited. found is false if the business could not be identified.',
      messages: [{ role: 'user', content: `${brief}\n\nRESEARCH NOTES\n${notes || '(nothing found)'}` }],
      output_config: { format: zodOutputFormat(ResearchShape) },
    })).parsed_output as Research | null
    let r = await shape(findings)
    if (!r) throw new Error('The research came back unreadable')
    // 3. THE SEARCH FOUND THEIR SITE — read it ourselves, and let what it says sharpen the write-up
    if (r.found && !given && r.website) {
      const site = await siteText(r.website)
      if (site) r = (await shape(`${findings}\n\nTHEIR WEBSITE, READ JUST NOW (${r.website}):\n${site}`)) ?? r
    }
    run.found = r.found

    const patch = { ...researchPatch(p as never, r), ...contactPatch(p as never, profile) }
    run.filled = Object.keys(patch)
    if (run.filled.length > 0) await table<ProspectRow>('prospects').update(p.id, { ...patch, updated_at: new Date().toISOString() } as never)
    await logAcqEvent({ prospectId: p.id, kind: 'note', source: 'agent', confidence: r.confidence, detail: `Research by the agent${run.filled.length ? ` — filled in: ${run.filled.map(k => FILLED_WORDS[k] ?? k).join(', ')}` : ''}\n${researchNote(r)}` })

    // the blueprint's two research points are Manal's to give: proposed, never taken
    const events = await table<ProspectEvent>('prospect_events').list({ where: e => e.prospect_id === p.id })
    const has = (kind: string) => events.some(e => e.kind === kind && !e.dismissed_at)
    if (r.found && r.fit === 'strong' && !has('fit')) {
      await logAcqEvent({ prospectId: p.id, kind: 'fit', source: 'agent', confirmed: false, confidence: r.confidence, detail: `The agent thinks this is a strong fit for tier ${r.tier || '?'}: ${r.summary.slice(0, 240)}` })
      run.proposed.push('fit')
    }
    if (r.found && r.weaknesses.length > 0 && !has('weak_presence')) {
      await logAcqEvent({ prospectId: p.id, kind: 'weak_presence', source: 'agent', confirmed: false, confidence: r.confidence, detail: `The agent saw: ${r.weaknesses.slice(0, 4).join('; ')}` })
      run.proposed.push('weak_presence')
    }
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e)
    console.error('[acq-agent] research failed for', p.business, e)
  }
  return run
}
