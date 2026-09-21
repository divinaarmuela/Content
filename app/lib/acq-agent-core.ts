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

/* ── A STRANGER IN THE DMS (21 Sep 2026) ───────────────────────────────────
 * The owner: "is it able to identify a potential client using AI even if we
 * receive data from the DM only?" Yes — a DM thread is often all there is: a
 * handle, a display name and what they wrote. The model reads the thread and
 * says whether this is a business that might buy from a marketing agency, and
 * the code decides what that is worth:
 *
 *   sure (0.75+)   a prospect is made at New lead / Engaged — they wrote to
 *                  us, which is the blueprint's definition of a lead — marked
 *                  "found by the agent", and Joy is told. A wrong one is one
 *                  press to delete.
 *   anything less  nothing is made. A creator asking for a collab, a supplier
 *                  selling to us, a job seeker, a friend, spam: not a lead.
 *
 * One look per handle per day, so a chatty thread is not re-read on every
 * message; a handle that is one of OUR clients' own accounts is never looked at.
 */
export const STRANGER_FROM = 0.75

export const STRANGER_SYSTEM =
  'You screen Instagram direct messages sent to MD Media, a Melbourne marketing agency (content production, social media management, branding, paid ads, personal brands). ' +
  'You are given one DM thread with someone who is not yet in the CRM. Decide whether they are a POTENTIAL CLIENT: a business, or a person with a business or personal brand, showing interest in the agency\'s services, pricing, availability or work. ' +
  'NOT potential clients: creators or models asking to collaborate or be featured, suppliers and agencies selling TO MD Media, job and internship seekers, friends and family, fans reacting to a post, giveaways, spam and scams. ' +
  'Use only what the thread says. business is the business name if stated or evident from the handle or display name, else empty. wants is what they asked for, in their own words where possible. ' +
  'confidence is 0 to 1; 0.9+ only when they plainly ask about working with the agency.'

export type StrangerVerdict = { is_potential_client: boolean; confidence: number; business: string; contact_name: string; wants: string; reasoning: string }

export function strangerIsLead(v: StrangerVerdict): boolean {
  return v.is_potential_client === true && Number(v.confidence) >= STRANGER_FROM
}

/** one look per handle per day */
export function strangerLockKey(handle: string, dayIso: string): string {
  return `${handle.toLowerCase()}__${dayIso.slice(0, 10)}`
}

export function strangerPrompt(handle: string, name: string | null, messages: readonly Evidence[]): string {
  const lines = messages.map(m => `[${m.at ?? '?'}] ${m.direction === 'in' ? `@${handle}` : 'MD Media'}: ${m.text.replace(/\s+/g, ' ').trim().slice(0, 600)}`).join('\n')
  return `HANDLE: @${handle}\nDISPLAY NAME: ${name ?? '—'}\n\nTHREAD (oldest first)\n${lines}`
}

/* ── THE AGENT RESEARCHES THE BUSINESS (21 Sep 2026) ───────────────────────
 * The owner, on the first lead the agent made: "our AI didn't do a research
 * of the company". It found Crestline Consultants in the DMs and knew nothing
 * about them. Research is the blueprint's FIRST stage (§7: tier, website,
 * socials, notes, weakness tags; §10: observed gaps, audit angle) and Manal's
 * job — so the agent does the looking-up and leaves the judging to her:
 *
 *   it SEARCHES the web for the business and reads what it finds;
 *   it FILLS ONLY WHAT IS EMPTY — a tier, an industry, a website, an audit
 *     angle a person typed is never overwritten;
 *   the write-up goes on the timeline as a note WITH ITS SOURCES, so every
 *     claim can be checked;
 *   "strong fit" (+10) and "weak presence" (+5) are the blueprint's points
 *     for Manal's classification — the agent only PROPOSES them, as findings
 *     a person confirms.
 * What it could not find it says it could not find. It never invents a
 * website, a name or a number.
 */
export type Research = {
  found: boolean
  summary: string
  what_they_do: string
  industry: string
  /** 1 service-based · 2 clinics and beauty · 3 construction, trades, hospitality · 4 ecommerce · 0 unsure */
  tier: number
  website: string
  location: string
  contact_name: string
  weaknesses: string[]
  audit_angle: string
  fit: 'strong' | 'possible' | 'poor' | 'unknown'
  confidence: number
  sources: string[]
}

export const RESEARCH_SYSTEM =
  'You research a business for MD Media, a Melbourne marketing agency (content production, social media management, branding, paid ads, personal brands), before anyone contacts them. ' +
  'Use web search to find the business: its website, what it sells, where it is, who runs it, and the state of its website and social presence. Search the name, the Instagram handle, and the name with "Melbourne" or "Australia". ' +
  'Be strict about identity: many businesses share a name. Only report facts from pages that are clearly THIS business (the same handle, the same location, a link between them). If you cannot tell which one it is, say so and set found to false. ' +
  'Never invent a website, a person or a number. What you could not find, leave empty. ' +
  'Then say, for a marketing agency: what is weak or missing in how they present themselves (each a short phrase, only what you actually saw), and one audit angle — the single most useful thing to show them in a short audit video. ' +
  'Tier: 1 service-based (finance, property, advisers, consultants, investors), 2 clinics and beauty, 3 construction, trades and hospitality, 4 ecommerce, 0 unsure. ' +
  'Fit: strong (a real operating business in a tier, with a visible gap the agency fixes), possible, poor (tiny, inactive, not a business, or outside what the agency does), unknown.'

export function researchPrompt(p: { business: string; instagram?: string | null; website?: string | null; email?: string | null; contact_name?: string | null; notes?: string | null }, extra: { followerCount?: number | null } = {}): string {
  return [
    `BUSINESS: ${p.business}`,
    p.instagram ? `INSTAGRAM: @${p.instagram} (https://www.instagram.com/${p.instagram}/)${typeof extra.followerCount === 'number' ? ` — ${extra.followerCount} followers` : ''}` : null,
    p.website ? `WEBSITE GIVEN: ${p.website}` : null,
    p.email ? `EMAIL: ${p.email}` : null,
    p.contact_name ? `CONTACT: ${p.contact_name}` : null,
    p.notes ? `WHAT WE KNOW SO FAR:\n${String(p.notes).slice(0, 800)}` : null,
  ].filter(Boolean).join('\n')
}

const httpUrl = (s: string): string | null => { try { const u = new URL(/^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim()}`); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : null } catch { return null } }

/** rule: fill only what is empty; a person's entry always stands */
export function researchPatch(p: { tier?: number | null; industry?: string | null; website?: string | null; audit_angle?: string | null; contact_name?: string | null; weakness_tags?: unknown }, r: Research): Record<string, unknown> {
  if (!r.found) return {}
  const out: Record<string, unknown> = {}
  const empty = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
  if (empty(p.tier) && [1, 2, 3, 4].includes(Number(r.tier)) && r.confidence >= 0.6) out.tier = Number(r.tier)
  if (empty(p.industry) && r.industry.trim()) out.industry = r.industry.trim().slice(0, 120)
  if (empty(p.website) && r.website.trim()) { const u = httpUrl(r.website); if (u) out.website = u }
  if (empty(p.audit_angle) && r.audit_angle.trim()) out.audit_angle = r.audit_angle.trim().slice(0, 500)
  if (empty(p.contact_name) && r.contact_name.trim()) out.contact_name = r.contact_name.trim().slice(0, 120)
  const had = Array.isArray(p.weakness_tags) ? p.weakness_tags.filter(Boolean) : []
  const tags = r.weaknesses.map(w => String(w).trim().slice(0, 60)).filter(Boolean).slice(0, 6)
  if (had.length === 0 && tags.length > 0) out.weakness_tags = tags
  return out
}

/** "1 Followers, 0 Following, 0 Posts - … from Crestline Consultants (@crestlineconsultants)" out of the page's preview tags */
export function publicMetaFrom(html: string): string | null {
  const m = /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i.exec(html) ?? /<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i.exec(html)
  if (!m) return null
  const text = m[1].replace(/&#0*64;/g, '@').replace(/&#x2022;/gi, '•').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
  return /Followers/i.test(text) ? text.slice(0, 300) : null
}

/** a page as a visitor reads it: title, description, headings, then the words; and how to reach them */
export function pageTextFrom(html: string): string {
  const pick = (re: RegExp) => { const m = re.exec(html); return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '' }
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const desc = pick(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)
  const heads = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 25)
  const emails = [...new Set((html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).filter(e => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e)))].slice(0, 5)
  const socials = [...new Set((html.match(/https?:\/\/(?:www\.)?(?:instagram|facebook|linkedin|tiktok|youtube)\.com\/[^\s"'<>)]+/gi) ?? []))].slice(0, 8)
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  return [
    title && `TITLE: ${title}`, desc && `DESCRIPTION: ${desc}`, heads.length && `HEADINGS: ${heads.join(' | ')}`,
    emails.length && `EMAILS ON THE PAGE: ${emails.join(', ')}`, socials.length && `SOCIAL LINKS: ${socials.join(' ')}`, `TEXT: ${body.slice(0, 3500)}`,
  ].filter(Boolean).join('\n')
}

/** only a public web address is ever fetched: http(s), a real hostname, never an IP, localhost or an internal name */
export function safePublicUrl(raw: string): string | null {
  const u = httpUrl(raw)
  if (!u) return null
  const host = new URL(u).hostname.toLowerCase()
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || /\.(local|internal|lan|home|corp)$/.test(host)) return null
  return u
}

/** the note on the timeline: what was found, and where — so it can be checked */
export function researchNote(r: Research): string {
  if (!r.found) return `The agent looked this business up and could not be sure which business it is${r.summary ? `: ${r.summary}` : '.'} Nothing was filled in.`
  const lines = [
    r.summary.trim(),
    r.what_they_do.trim() ? `What they do: ${r.what_they_do.trim()}` : '',
    r.location.trim() ? `Where: ${r.location.trim()}` : '',
    r.weaknesses.length ? `What looks weak: ${r.weaknesses.join('; ')}` : '',
    r.audit_angle.trim() ? `Audit angle: ${r.audit_angle.trim()}` : '',
    `Fit: ${r.fit} · ${Math.round(r.confidence * 100)}% sure`,
    r.sources.length ? `Sources: ${r.sources.slice(0, 6).join(' · ')}` : 'Sources: none it could cite',
  ]
  return lines.filter(Boolean).join('\n').slice(0, 1900)
}
