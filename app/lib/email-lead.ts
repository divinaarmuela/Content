import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { supabase } from '@/lib/supabase'
import { inngest } from '../inngest/client'
import { leadsChannel } from '../inngest/channels'
import { autoIngestLead } from './lead-enrichment'
import { prefilterSkipReason } from './gmail-core'
import {
  listRecentMessageIds, fetchMessage, getMailboxes,
  type InboxMessage, type Mailbox,
} from './gmail'
import { listConnectedMailboxes } from './clerk-gmail'
import {
  FatalScanError, fatalApiReason, gmailQuery, blockedReason, type ScanSettings,
} from './scan-core'
import { getScanSettings, enabledMailboxEmails, listSelfConnectedMailboxes } from './scan-settings'

export { FatalScanError, fatalApiReason }

/**
 * Inbox → leads pipeline.
 *
 * Exactly-once by construction: each Gmail message id is CLAIMED via insert
 * into email_ingest_log (unique constraint) before any work happens. Two
 * overlapping scans collide there — the loser skips. Claude Haiku classifies
 * the body; genuine enquiries land in the leads table (source: email_ingest)
 * and flow into the existing prospect auto-ingest.
 */

const Classification = z.object({
  is_lead: z.boolean().describe('True only if this is a genuine business enquiry about marketing/content/branding services'),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().describe('One sentence explaining the decision'),
  fname: z.string().describe('First name of the sender, best effort'),
  lname: z.string().describe('Last name of the sender, or empty'),
  business: z.string().describe('Business/company name, or empty if unknown'),
  phone: z.string().describe('Phone number if present in the email, else empty'),
  service_interest: z.string().describe('Which service they seem interested in, else empty'),
  needs: z.string().describe('Summary of what they are asking for, in their words where possible'),
  budget: z.string().describe('Budget if mentioned, else empty'),
  timeline: z.string().describe('Timeline if mentioned, else empty'),
})
type ClassificationT = z.infer<typeof Classification>

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY

async function classify(msg: InboxMessage): Promise<ClassificationT | null> {
  const response = await anthropic.messages.parse({
    // Haiku by explicit product decision: high volume, low stakes per email,
    // and the extraction task is well within Haiku's range.
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system:
      'You screen the inbox of MD Media, a Melbourne marketing agency (content production, social media, branding, paid ads, personal brands). ' +
      'Decide whether an email is a genuine NEW business enquiry from a potential client. ' +
      'Not leads: newsletters, invoices, vendor pitches selling TO the agency, recruitment, spam, scheduling replies in existing threads, platform notifications. ' +
      'Extract contact details only from what is actually present — never invent values; use empty strings for unknowns.',
    messages: [{
      role: 'user',
      content:
        `From: ${msg.fromName} <${msg.fromEmail}>\n` +
        `Subject: ${msg.subject}\n` +
        `Received: ${msg.receivedAt ?? 'unknown'}\n\n` +
        `${msg.body || '(empty body)'}`,
    }],
    output_config: { format: zodOutputFormat(Classification) },
  })
  return response.parsed_output ?? null
}

export type ScanResult = {
  scanned: number
  claimed: number
  leads_created: number
  skipped: number
  errors: number
  mailboxes: string[]
}

/** What happened to one message. Mirrors email_ingest_log.status, plus
 *  'already_processed' for messages claimed by an earlier scan — those never
 *  reach the log again, but the operator still needs to see they were counted. */
export type MessageOutcome =
  | 'already_processed'
  | 'prefiltered'
  | 'not_a_lead'
  | 'duplicate_sender'
  | 'lead_created'
  | 'needs_review'
  | 'error'

/** Progress events, emitted as the scan runs so the dashboard can show what is
 *  actually happening instead of an opaque spinner. Purely observational —
 *  nothing in the pipeline branches on whether a listener is attached. */
export type ScanEvent =
  | { type: 'start'; mailboxes: string[] }
  | { type: 'mailbox_start'; email: string; index: number; total: number }
  | { type: 'listed'; email: string; count: number }
  | { type: 'message'; email: string; outcome: MessageOutcome; subject?: string; from?: string; reason?: string; confidence?: number }
  | { type: 'mailbox_done'; email: string }
  | { type: 'mailbox_error'; email: string; message: string }
  | { type: 'done'; result: ScanResult }

type Emit = (e: ScanEvent) => void

/** Scan every available mailbox: the shared ones configured in env, plus
 *  every team member who has connected their Google account through Clerk.
 *  Each is independent — a failure in one (revoked token, API hiccup) never
 *  stops the others. De-duplicated by address. */
export async function scanInbox(onEvent?: Emit): Promise<ScanResult> {
  const emit: Emit = onEvent ?? (() => {})
  const settings = await getScanSettings()
  const result: ScanResult = {
    scanned: 0, claimed: 0, leads_created: 0, skipped: 0, errors: 0, mailboxes: [],
  }

  const enabled = new Set(await enabledMailboxEmails())
  const mailboxes = (await availableMailboxes()).filter(m => enabled.has(m.email.toLowerCase()))
  if (mailboxes.length === 0) {
    throw new Error('No mailbox is enabled for scanning — check Settings → Inbox scanner')
  }

  emit({ type: 'start', mailboxes: mailboxes.map(m => m.email) })

  for (const [i, box] of mailboxes.entries()) {
    result.mailboxes.push(box.email)
    emit({ type: 'mailbox_start', email: box.email, index: i + 1, total: mailboxes.length })
    try {
      await scanOneMailbox(box, result, emit, settings)
      emit({ type: 'mailbox_done', email: box.email })
    } catch (e) {
      // an account-level failure affects every mailbox equally — surface it
      // once rather than repeating it per mailbox
      if (e instanceof FatalScanError) throw e
      result.errors++
      const message = e instanceof Error ? e.message : String(e)
      console.error(`mailbox scan failed for ${box.email}:`, e)
      emit({ type: 'mailbox_error', email: box.email, message })
    }
  }
  emit({ type: 'done', result })
  return result
}

/** Every mailbox the scanner has credentials for, de-duplicated by address. */
async function availableMailboxes(): Promise<Mailbox[]> {
  const configured = getMailboxes()
  const self = await listSelfConnectedMailboxes().catch(() => [] as Mailbox[])
  const connected = await listConnectedMailboxes().catch(() => [] as Mailbox[])

  // precedence: env config, then a token its owner granted us, then whatever
  // Clerk still holds. Env wins because it is the one an operator set
  // deliberately; a self-connected token beats Clerk's because it survives
  // sign-in changes.
  const seen = new Set(configured.map(m => m.email.toLowerCase()))
  const out = [...configured]
  for (const m of [...self, ...connected]) {
    const email = m.email.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    out.push(m)
  }
  return out
}

/**
 * Scan exactly one mailbox and record the outcome in scan_runs.
 *
 * This is the unit the scheduler fans out over: each mailbox gets its own
 * invocation, its own timeout and its own retries, so a revoked token on one
 * address cannot starve the others or push the whole pass past the function
 * time limit.
 */
export async function scanSingleMailbox(
  email: string,
  trigger: 'manual' | 'scheduled' | 'event' = 'scheduled',
  onEvent?: Emit
): Promise<ScanResult> {
  const emit: Emit = onEvent ?? (() => {})
  const settings = await getScanSettings()
  const box = (await availableMailboxes()).find(m => m.email.toLowerCase() === email.toLowerCase())
  if (!box) throw new Error(`No credentials available for ${email}`)

  const result: ScanResult = {
    scanned: 0, claimed: 0, leads_created: 0, skipped: 0, errors: 0, mailboxes: [box.email],
  }

  const { data: run } = await supabase
    .from('scan_runs')
    .insert({ mailbox: box.email, trigger, status: 'running' })
    .select('id')
    .maybeSingle()

  const finish = async (status: 'success' | 'error', error?: string) => {
    if (!run) return
    await supabase.from('scan_runs').update({
      status,
      finished_at: new Date().toISOString(),
      scanned: result.scanned, claimed: result.claimed,
      leads_created: result.leads_created, skipped: result.skipped,
      errors: result.errors, error: error?.slice(0, 1000) ?? null,
    }).eq('id', run.id)
  }

  try {
    await scanOneMailbox(box, result, emit, settings)
    await finish('success')
    emit({ type: 'done', result })
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await finish('error', message)
    throw e
  }
}

async function scanOneMailbox(
  box: Mailbox, result: ScanResult, emit: Emit, settings: ScanSettings
): Promise<void> {
  const mailbox = box.email
  const ownDomain = mailbox.split('@')[1] ?? 'mdmmarketing.com.au'

  const ids = await listRecentMessageIds(box, gmailQuery(settings), settings.max_messages)
  result.scanned += ids.length
  emit({ type: 'listed', email: mailbox, count: ids.length })

  for (const id of ids) {
    // 1. claim — the exactly-once gate
    const { data: claimed } = await supabase
      .from('email_ingest_log')
      .upsert(
        { gmail_message_id: id, mailbox, status: 'pending' },
        { onConflict: 'gmail_message_id', ignoreDuplicates: true }
      )
      .select()
      .maybeSingle()
    if (!claimed) {
      // already processed by an earlier/concurrent scan — surface it so a scan
      // that finds nothing new reads as "checked, seen before", not "did nothing"
      emit({ type: 'message', email: mailbox, outcome: 'already_processed' })
      continue
    }
    result.claimed++

    try {
      const msg = await fetchMessage(box, id)
      await supabase.from('email_ingest_log').update({
        from_email: msg.fromEmail,
        subject: msg.subject.slice(0, 500),
        received_at: msg.receivedAt,
      }).eq('id', claimed.id)

      // 2. cheap pre-filter — don't spend a model call on obvious non-leads
      const skip = prefilterSkipReason({
        fromEmail: msg.fromEmail,
        subject: msg.subject,
        ownDomain,
        listUnsubscribe: msg.listUnsubscribe,
        autoSubmitted: msg.autoSubmitted,
      })
      // an admin block list overrides everything, including the model
      const blocked = blockedReason(msg.fromEmail, settings)
      const stop = skip ?? blocked
      if (stop) {
        await supabase.from('email_ingest_log')
          .update({ status: 'skipped', reasoning: stop }).eq('id', claimed.id)
        result.skipped++
        emit({
          type: 'message', email: mailbox, outcome: 'prefiltered',
          subject: msg.subject, from: msg.fromEmail, reason: stop,
        })
        continue
      }

      // rules-only: the model is deliberately out of the loop, so anything
      // surviving the prefilter is parked for a human rather than dropped
      if (settings.rules_only) {
        await supabase.from('email_ingest_log').update({
          status: 'needs_review',
          reasoning: 'Rules-only mode is on — flagged for manual review, not classified',
        }).eq('id', claimed.id)
        result.skipped++
        emit({
          type: 'message', email: mailbox, outcome: 'needs_review',
          subject: msg.subject, from: msg.fromEmail,
          reason: 'Rules-only mode — needs a human decision',
        })
        continue
      }

      // 3. classify with Haiku
      let c: ClassificationT | null
      try {
        c = await classify(msg)
      } catch (e) {
        const fatal = fatalApiReason(e)
        if (fatal) {
          // leave the claim as 'pending' so this message is picked up again
          // once the account issue is resolved — it was never really assessed
          await supabase.from('email_ingest_log').delete().eq('id', claimed.id)
          throw new FatalScanError(fatal)
        }
        throw e
      }
      if (!c) throw new Error('Classification returned no parseable output')

      if (!c.is_lead || c.confidence < settings.min_confidence) {
        await supabase.from('email_ingest_log').update({
          status: 'not_a_lead', is_lead: c.is_lead, confidence: c.confidence, reasoning: c.reasoning,
        }).eq('id', claimed.id)
        result.skipped++
        emit({
          type: 'message', email: mailbox, outcome: 'not_a_lead',
          subject: msg.subject, from: msg.fromEmail,
          reason: c.reasoning, confidence: c.confidence,
        })
        continue
      }

      // 4. duplicate guard — same sender already a recent lead?
      const since = new Date(Date.now() - settings.duplicate_window_days * 24 * 3600 * 1000).toISOString()
      const { data: existing } = settings.duplicate_window_days === 0
        ? { data: null }
        : await supabase
            .from('leads').select('id').ilike('email', msg.fromEmail).gte('created_at', since)
            .limit(1).maybeSingle()
      if (existing) {
        await supabase.from('email_ingest_log').update({
          status: 'skipped', is_lead: true, confidence: c.confidence,
          reasoning: 'sender already has a recent lead', lead_id: existing.id,
        }).eq('id', claimed.id)
        result.skipped++
        emit({
          type: 'message', email: mailbox, outcome: 'duplicate_sender',
          subject: msg.subject, from: msg.fromEmail,
          reason: `This sender already has a lead from the last ${settings.duplicate_window_days} days`,
          confidence: c.confidence,
        })
        continue
      }

      // 5. create the lead
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          fname: c.fname || msg.fromName.split(' ')[0] || msg.fromEmail.split('@')[0],
          lname: c.lname || msg.fromName.split(' ').slice(1).join(' ') || '',
          email: msg.fromEmail,
          phone: c.phone || '',
          biz: c.business || msg.fromEmail.split('@')[1] || '',
          model: c.service_interest || null,
          need: c.needs || `Email enquiry: ${msg.subject}`,
          budget: c.budget || null,
          timeline: c.timeline || null,
          source: 'email_ingest',
        })
        .select()
        .single()
      if (leadErr) throw new Error(leadErr.message)

      await supabase.from('email_ingest_log').update({
        status: 'lead_created', is_lead: true, confidence: c.confidence,
        reasoning: c.reasoning, lead_id: lead.id,
      }).eq('id', claimed.id)
      result.leads_created++
      emit({
        type: 'message', email: mailbox, outcome: 'lead_created',
        subject: msg.subject, from: msg.fromEmail,
        reason: c.reasoning, confidence: c.confidence,
      })

      // Tell any open leads page immediately. `inngest.realtime.publish`, not
      // `step.realtime.publish`: this runs inside the step.run that wraps the
      // whole mailbox scan, and the step form would nest a step in a step.
      // Best-effort — a lead that is saved but unannounced is a refresh away,
      // whereas a publish failure that threw here would lose the scan.
      void inngest.realtime.publish(leadsChannel.created, {
        id: lead.id as string,
        label: [c.business, [c.fname, c.lname].filter(Boolean).join(' ')]
          .filter(Boolean)[0] || msg.fromEmail,
        source: 'email_ingest',
        ts: Date.now(),
      }).catch(e => console.error('realtime publish failed:', e))

      // 6. feed the existing prospect pipeline (verified-company → client)
      void autoIngestLead(lead).catch(e => console.error('auto-ingest from email error:', e))
    } catch (e) {
      if (e instanceof FatalScanError) throw e // account-level: stop the run
      result.errors++
      const message = e instanceof Error ? e.message : String(e)
      await supabase.from('email_ingest_log').update({
        status: 'error', error: message.slice(0, 1000),
      }).eq('id', claimed.id)
      emit({ type: 'message', email: mailbox, outcome: 'error', reason: message })
    }
  }
}
