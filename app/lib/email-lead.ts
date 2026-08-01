import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { supabase } from '@/lib/supabase'
import { autoIngestLead } from './lead-enrichment'
import { prefilterSkipReason } from './gmail-core'
import {
  listRecentMessageIds, fetchMessage, getMailboxes,
  type InboxMessage, type Mailbox,
} from './gmail'
import { listConnectedMailboxes } from './clerk-gmail'

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

/** Scan every available mailbox: the shared ones configured in env, plus
 *  every team member who has connected their Google account through Clerk.
 *  Each is independent — a failure in one (revoked token, API hiccup) never
 *  stops the others. De-duplicated by address. */
export async function scanInbox(): Promise<ScanResult> {
  const result: ScanResult = {
    scanned: 0, claimed: 0, leads_created: 0, skipped: 0, errors: 0, mailboxes: [],
  }
  const configured = getMailboxes()
  const connected = await listConnectedMailboxes()
  const seen = new Set(configured.map(m => m.email))
  const mailboxes = [...configured, ...connected.filter(m => !seen.has(m.email))]
  if (mailboxes.length === 0) throw new Error('No mailbox available to scan')

  for (const box of mailboxes) {
    result.mailboxes.push(box.email)
    try {
      await scanOneMailbox(box, result)
    } catch (e) {
      result.errors++
      console.error(`mailbox scan failed for ${box.email}:`, e)
    }
  }
  return result
}

async function scanOneMailbox(box: Mailbox, result: ScanResult): Promise<void> {
  const mailbox = box.email
  const ownDomain = mailbox.split('@')[1] ?? 'mdmmarketing.com.au'

  const ids = await listRecentMessageIds(box)
  result.scanned += ids.length

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
    if (!claimed) continue // already processed by an earlier/concurrent scan
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
      if (skip) {
        await supabase.from('email_ingest_log')
          .update({ status: 'skipped', reasoning: skip }).eq('id', claimed.id)
        result.skipped++
        continue
      }

      // 3. classify with Haiku
      const c = await classify(msg)
      if (!c) throw new Error('Classification returned no parseable output')

      if (!c.is_lead || c.confidence < 0.6) {
        await supabase.from('email_ingest_log').update({
          status: 'not_a_lead', is_lead: c.is_lead, confidence: c.confidence, reasoning: c.reasoning,
        }).eq('id', claimed.id)
        result.skipped++
        continue
      }

      // 4. duplicate guard — same sender already a recent lead?
      const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      const { data: existing } = await supabase
        .from('leads').select('id').ilike('email', msg.fromEmail).gte('created_at', monthAgo)
        .limit(1).maybeSingle()
      if (existing) {
        await supabase.from('email_ingest_log').update({
          status: 'skipped', is_lead: true, confidence: c.confidence,
          reasoning: 'sender already has a recent lead', lead_id: existing.id,
        }).eq('id', claimed.id)
        result.skipped++
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

      // 6. feed the existing prospect pipeline (verified-company → client)
      void autoIngestLead(lead).catch(e => console.error('auto-ingest from email error:', e))
    } catch (e) {
      result.errors++
      await supabase.from('email_ingest_log').update({
        status: 'error', error: e instanceof Error ? e.message.slice(0, 1000) : String(e),
      }).eq('id', claimed.id)
    }
  }
}
