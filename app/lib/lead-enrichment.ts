import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail } from './mailer'
import {
  emailDomain, isBusinessDomain, slugify, type IngestLead,
} from './lead-enrichment-core'

/**
 * Auto-ingest: when a lead arrives from a verifiable company, create a
 * 'prospect' client automatically. Verification = business email domain
 * (not a free-mail provider) AND a website actually responding on that
 * domain. Anything unverifiable stays a lead for manual conversion — the
 * client registry only ever gains rows we could confirm exist.
 *
 * Runs fire-and-forget after lead capture; failures never affect the visitor.
 */

/** Try https://domain then https://www.domain; a response (< 500) proves a
 *  live site. 5s cap per attempt so the pipeline can't hang. */
export async function verifyWebsite(domain: string): Promise<string | null> {
  for (const host of [domain, `www.${domain}`]) {
    const url = `https://${host}`
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal })
      clearTimeout(timer)
      if (res.status < 500) return url
    } catch {
      // unreachable on this host — try the next
    }
  }
  return null
}

export async function autoIngestLead(lead: IngestLead): Promise<'created' | 'skipped' | 'exists'> {
  try {
    const domain = emailDomain(lead.email)
    if (!domain || !isBusinessDomain(domain)) return 'skipped' // free-mail → manual judgement

    const website = await verifyWebsite(domain)
    if (!website) return 'skipped' // no live site → not verifiable

    const name = (lead.biz || `${lead.fname} ${lead.lname}`).trim()
    const slug = slugify(name)
    if (!slug) return 'skipped'

    // dedupe against slug, contact email, or same website domain
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .or(`slug.eq.${slug},email.eq.${lead.email},website.ilike.%${domain}%`)
      .limit(1)
      .maybeSingle()
    if (existing) return 'exists'

    const enquiry = [
      `Auto-ingested from website lead — company verified via ${website}`,
      lead.model && `Service interest: ${lead.model}`,
      lead.need && `Needs: ${lead.need}`,
      lead.budget && `Budget: ${lead.budget}`,
      lead.timeline && `Timeline: ${lead.timeline}`,
    ].filter(Boolean).join('\n')

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        name,
        slug,
        contact_name: `${lead.fname} ${lead.lname}`.trim(),
        email: lead.email,
        phone: lead.phone,
        website,
        status: 'prospect',
        source: 'auto_ingest',
        notes: enquiry,
      })
      .select()
      .single()
    if (error) {
      // unique collision from a concurrent ingest = someone else created it — fine
      if (!error.message.includes('duplicate key')) console.error('auto-ingest insert error:', error.message)
      return 'exists'
    }

    // tell the admins — outbox dedupe keys on the lead, so retries can't spam
    const { data: admins } = await supabase
      .from('team_users')
      .select('id, email')
      .eq('role', 'super_admin')
      .eq('active_status', true)
    for (const admin of admins ?? []) {
      await notify({
        eventType: 'prospect_auto_ingested',
        entityType: 'client',
        entityId: client.id,
        recipientId: admin.id,
        recipientEmail: admin.email,
        subject: `New prospect: ${name}`,
        bodyHtml: renderEmail(
          `New prospect: ${name}`,
          `<p>A lead from <strong>${lead.fname} ${lead.lname}</strong> was verified as a company (<a href="${website}">${domain}</a>) and added to Clients as a prospect.</p>`,
          'Open clients',
          `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/dashboard/clients`
        ),
      })
    }
    return 'created'
  } catch (e) {
    console.error('auto-ingest error:', e)
    return 'skipped'
  }
}
