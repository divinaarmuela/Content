import { completion, normaliseDefinition, type Answers, type TemplateDefinition } from './intake-core'

/**
 * THE DISCOVERY FORM, ON A LEAD (the owner, 20 Nov 2026: "so we still need this??? how about in leads page are we
 * tracking client if they fill it out … how can we keep track"). A potential client is a lead, not a client: the form
 * is made from the lead's own page, with no client record, and the lead shows where it is up to — not sent, sent,
 * opened, started, filled in.
 *
 * Pure: what the page and the list say about a form, from the form's own row.
 */

/**
 * WHO IS EMAILED WHEN A DISCOVERY FORM IS SENT IN (the owner, 20 Nov 2026: "both contact and hello should receive it").
 * Until then it fell to the sending mailbox alone. Each form carries this list from the moment it is started, so it
 * does not depend on the intake forms' own default list.
 */
export const DISCOVERY_NOTIFY_LIVE = ['hello@mdmmarketing.com.au', 'contact@mdmmarketing.com.au'] as const
/** WHILE IT IS BEING TESTED (the owner, 20 Nov 2026: "for now keep akmalashwin23@… for testing … once tested we will
 *  replace it with the two emails"): only the owner's own address. To go live, make this DISCOVERY_NOTIFY_LIVE. */
export const DISCOVERY_NOTIFY: readonly string[] = ['akmalashwin23@gmail.com']

export type DiscoveryRow = {
  id: string; token: string; status?: string | null; definition?: unknown; answers?: unknown
  created_at?: string | null; sent_at?: string | null; first_opened_at?: string | null; submitted_at?: string | null
}

export type DiscoveryStep = 'none' | 'made' | 'sent' | 'opened' | 'started' | 'filled'

/** the same five colours the dashboard's chips use */
export type DiscoveryTone = 'muted' | 'amber' | 'blue' | 'green'

export type DiscoveryState = {
  step: DiscoveryStep
  /** the chip: two or three words */
  label: string
  tone: DiscoveryTone
  /** one plain sentence on what has happened and what to do next */
  line: string
  answered: number
  total: number
}

const NONE: DiscoveryState = {
  step: 'none', label: 'No form yet', tone: 'muted', answered: 0, total: 0,
  line: 'No discovery form has been made for this lead yet.',
}

/** WHERE THE FORM IS UP TO — the furthest thing that has happened wins */
export function discoveryState(form: DiscoveryRow | null | undefined, day: (iso: string) => string = iso => iso.slice(0, 10)): DiscoveryState {
  if (!form) return NONE
  const def = normaliseDefinition(form.definition, 'discovery') as TemplateDefinition
  const { answered, total } = completion(def, (form.answers ?? {}) as Answers)
  const count = `${answered} of ${total} questions answered`
  if (form.status === 'submitted') {
    return { step: 'filled', label: 'Form filled in', tone: 'green', answered, total, line: `They filled it in${form.submitted_at ? ` on ${day(form.submitted_at)}` : ''}: ${count}. Their answers are below.` }
  }
  if (form.status === 'in_progress') {
    return { step: 'started', label: 'Form started', tone: 'blue', answered, total, line: `They have started but not sent it: ${count} so far.` }
  }
  if (form.first_opened_at && form.status === 'sent') {
    return { step: 'opened', label: 'Form opened', tone: 'blue', answered, total, line: `They opened it on ${day(form.first_opened_at)} and have not answered anything yet.` }
  }
  if (form.status === 'sent') {
    return { step: 'sent', label: 'Form sent', tone: 'amber', answered, total, line: `You copied the link${form.sent_at ? ` on ${day(form.sent_at)}` : ''}. They have not opened it yet.` }
  }
  return { step: 'made', label: 'Form not sent', tone: 'muted', answered, total, line: 'The form is ready. Copy its link and send it to them.' }
}

/** each answered question with its answer, in the form's own order, for reading on the lead's page */
export function discoveryAnswers(form: DiscoveryRow): { section: string; rows: { label: string; value: string }[] }[] {
  const def = normaliseDefinition(form.definition, 'discovery') as TemplateDefinition
  const answers = (form.answers ?? {}) as Answers
  const out: { section: string; rows: { label: string; value: string }[] }[] = []
  for (const s of def.sections) {
    const rows: { label: string; value: string }[] = []
    for (const b of s.blocks) {
      if (b.type === 'guidance' || b.type === 'file') continue
      const a = answers[b.id]
      const value = (Array.isArray(a) ? a.join(', ') : String(a ?? '')).trim()
      if (value) rows.push({ label: b.label, value })
    }
    if (rows.length) out.push({ section: s.title, rows })
  }
  return out
}

/** who the form is for, as its page greets them: the business, else the person */
export function leadFormName(lead: { biz?: string | null; fname?: string | null; lname?: string | null } | null | undefined): string {
  const biz = (lead?.biz ?? '').trim()
  if (biz) return biz
  return `${lead?.fname ?? ''} ${lead?.lname ?? ''}`.trim()
}
