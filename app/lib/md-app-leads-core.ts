/**
 * MD APP LEADS — the pure half (9 Nov 2026). The Meta card's Leads tab: the client Page's instant forms and the leads
 * people sent through them. Shapes are Meta's Graph API v27 answers:
 *   /{page}/leadgen_forms?fields=id,name,status,leads_count,created_time
 *   /{form}/leads?fields=id,created_time,field_data,ad_name,campaign_name,is_organic
 *     field_data: [{ name: 'full_name', values: ['Ana Lee'] }, { name: 'email', values: [...] }, …]
 */

export type LeadForm = { id: string; name: string; status: string; leads: number | null; created: string | null }
export type Lead = {
  id: string; time: string | null; name: string | null; email: string | null; phone: string | null
  other: { label: string; value: string }[]; source: string
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : Array.isArray((v as any)?.data) ? (v as any).data : [])

/** An archived form is left out (9 Nov 2026): it takes no new leads and only confuses the list. */
export function parseLeadForms(json: unknown): LeadForm[] {
  return arr(json).filter(r => str(r?.id) && r.status !== 'ARCHIVED' && r.status !== 'DELETED').map(r => ({
    id: r.id, name: str(r.name) ?? 'Untitled form', status: str(r.status) ?? 'UNKNOWN',
    leads: Number.isFinite(Number(r.leads_count)) ? Number(r.leads_count) : null, created: str(r.created_time),
  }))
}

const NAME_KEYS = ['full_name', 'name']
const FIRST = ['first_name']; const LAST = ['last_name']
const EMAIL_KEYS = ['email', 'work_email']
const PHONE_KEYS = ['phone_number', 'phone', 'work_phone_number']

/** "what_time_suits_you?" → "What time suits you?" */
export function fieldLabel(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s[0]!.toUpperCase() + s.slice(1) : key
}

/** One lead, newest first in the list. The usual fields are lifted out; every other answer is kept, labelled. */
export function parseLeads(json: unknown): Lead[] {
  return arr(json).filter(r => str(r?.id)).map(r => {
    const fields = new Map<string, string>()
    for (const f of arr(r.field_data)) {
      const k = str(f?.name); const v = Array.isArray(f?.values) ? f.values.filter((x: unknown) => typeof x === 'string').join(', ') : ''
      if (k && v) fields.set(k, v)
    }
    const take = (keys: string[]) => { for (const k of keys) { const v = fields.get(k); if (v) { fields.delete(k); return v } } return null }
    const full = take(NAME_KEYS)
    const first = take(FIRST); const last = take(LAST)
    const name = full ?? ([first, last].filter(Boolean).join(' ') || null)
    const email = take(EMAIL_KEYS); const phone = take(PHONE_KEYS)
    const source = r.is_organic === true ? 'Organic' : str(r.campaign_name) ?? str(r.ad_name) ?? 'Instant form'
    return {
      id: r.id, time: str(r.created_time), name, email, phone, source,
      other: [...fields].map(([k, v]) => ({ label: fieldLabel(k), value: v })),
    }
  }).sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
}
