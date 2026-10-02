/**
 * THE SHOOT BRIEF TAB'S FORMS (the owner, 2 Oct 2026: "maybe all this links should redirect to their one portal").
 * An intake form, a monthly update and a shoot-date proposal each had a link of their own; on the one portal they
 * are rows on the Shoot brief tab and open full screen at a portal address, so the old links can redirect there.
 * Pure: which rows show, their words, and which wait on the client. The server half is one-portal-forms.ts.
 */

export type FormKind = 'intake' | 'monthly' | 'proposal'

/** A row as the tab lists it. `param` + `id` build its address: `?tab=shoot&<param>=<id>`. */
export type PortalFormRow = {
  kind: FormKind
  id: string
  title: string
  line: string
  waiting: boolean
  done: boolean
  /** newest first within the list */
  at: string
}

export const FORM_PARAM: Record<FormKind | 'answers', string> = {
  intake: 'form', monthly: 'monthly', proposal: 'proposal', answers: 'answers',
}

type FormRowIn = { id: string; title?: string | null; status?: string | null; created_at?: string | null; sent_at?: string | null }
type ProposalIn = { id: string; title?: string | null; status?: string | null; created_at?: string | null; starts_at?: string | null }

/** A form the team has sent and the client has not submitted: theirs to fill in. A draft was never sent. */
export function formOpen(status: string | null | undefined): boolean {
  return status === 'sent' || status === 'in_progress'
}

export function formRows(
  intake: readonly FormRowIn[],
  monthly: readonly FormRowIn[],
  proposals: readonly ProposalIn[],
  dayWords: (iso: string) => string,
): PortalFormRow[] {
  const out: PortalFormRow[] = []
  for (const f of intake) {
    if (!formOpen(f.status)) continue
    out.push({
      kind: 'intake', id: f.id, title: (f.title ?? '').trim() || 'Questions for you',
      line: f.status === 'in_progress' ? 'Started — pick up where you left off' : 'A few questions before your shoot',
      waiting: true, done: false, at: String(f.sent_at ?? f.created_at ?? ''),
    })
  }
  for (const f of monthly) {
    if (!formOpen(f.status)) continue
    out.push({
      kind: 'monthly', id: f.id, title: (f.title ?? '').trim() || 'Monthly update',
      line: f.status === 'in_progress' ? 'Started — pick up where you left off' : 'Your monthly update',
      waiting: true, done: false, at: String(f.sent_at ?? f.created_at ?? ''),
    })
  }
  for (const p of proposals) {
    if (p.status === 'cancelled') continue
    const when = p.starts_at ? dayWords(p.starts_at) : null
    const answer = p.status === 'accepted' ? 'You said yes' : p.status === 'declined' ? 'You said no — we will propose another date' : 'Can you do this date?'
    out.push({
      kind: 'proposal', id: p.id, title: (p.title ?? '').trim() || 'A shoot date',
      line: [when, answer].filter(Boolean).join(' · '),
      waiting: p.status === 'pending', done: p.status === 'accepted', at: String(p.created_at ?? ''),
    })
  }
  return out.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.at.localeCompare(a.at))
}

/** Which old link opens which row: `/intake/<token>` → the form, `/monthly/<token>` → the update, `/shoot/<token>` → the proposal. */
export function formLinkTarget(portalHome: string, kind: FormKind, id: string): string {
  return `${portalHome}?tab=shoot&${FORM_PARAM[kind]}=${encodeURIComponent(id)}`
}
