import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { discoveryAnswers, discoveryState, leadFormName, type DiscoveryRow } from '../app/lib/lead-discovery-core'
import { buildTimeline } from '../app/lib/lead-timeline-core'
import { templateFor } from '../app/lib/intake-templates'

/**
 * THE DISCOVERY FORM, ON A LEAD (the owner, 20 Nov 2026: "how about in leads page are we tracking client if they fill
 * it out … how can we keep track").
 */
const form = (over: Partial<DiscoveryRow> = {}): DiscoveryRow => ({ id: 'f1', token: 't1', status: 'draft', definition: templateFor('discovery'), answers: {}, ...over })
const day = () => 'Fri 20 Nov'

describe('where a lead’s form is up to', () => {
  it('says each step in order: no form, not sent, sent, opened, started, filled in', () => {
    expect(discoveryState(null).label).toBe('No form yet')
    expect(discoveryState(form()).label).toBe('Form not sent')
    expect(discoveryState(form({ status: 'sent', sent_at: '2026-11-20T01:00:00Z' }), day)).toMatchObject({ step: 'sent', label: 'Form sent', tone: 'amber' })
    expect(discoveryState(form({ status: 'sent', first_opened_at: '2026-11-20T02:00:00Z' }), day)).toMatchObject({ step: 'opened', label: 'Form opened' })
    expect(discoveryState(form({ status: 'in_progress', answers: { public_name: 'Acme' } }))).toMatchObject({ step: 'started', label: 'Form started', answered: 1, total: 21 })
    expect(discoveryState(form({ status: 'submitted', submitted_at: '2026-11-20T03:00:00Z', answers: { public_name: 'Acme', website: 'acme.com' } }), day))
      .toMatchObject({ step: 'filled', label: 'Form filled in', tone: 'green', answered: 2 })
  })
  it('the team opening their own unsent form is not the lead opening it', () => {
    expect(discoveryState(form({ status: 'draft', first_opened_at: '2026-11-20T02:00:00Z' })).step).toBe('made')
  })
  it('the sentence says what happened and what to do next', () => {
    expect(discoveryState(form()).line).toBe('The form is ready. Copy its link and send it to them.')
    expect(discoveryState(form({ status: 'submitted', submitted_at: 'x', answers: { public_name: 'Acme' } }), day).line).toBe('They filled it in on Fri 20 Nov: 1 of 21 questions answered. Their answers are below.')
  })
})

describe('their answers, for reading on the lead’s page', () => {
  it('lists only what was answered, under the form’s own headings, ticks joined', () => {
    const out = discoveryAnswers(form({ answers: { public_name: 'Acme', channels_today: ['SEO', 'PR'], why_now: '   ' } }))
    expect(out).toEqual([
      { section: 'About your business', rows: [{ label: 'What’s your company name?', value: 'Acme' }] },
      { section: 'Current marketing and media', rows: [{ label: 'Which channels are you using today?', value: 'SEO, PR' }] },
    ])
  })
})

describe('who the form greets', () => {
  it('the business, else the person, else nobody', () => {
    expect(leadFormName({ biz: 'Acme', fname: 'Jo', lname: 'Lee' })).toBe('Acme')
    expect(leadFormName({ biz: ' ', fname: 'Jo', lname: 'Lee' })).toBe('Jo Lee')
    expect(leadFormName(null)).toBe('')
  })
})

describe('the lead’s timeline carries the form', () => {
  it('a discovery event keeps its own kind', () => {
    const items = buildTimeline({ id: 'l1', created_at: '2026-11-01T00:00:00Z' }, [{ id: 'e1', at: '2026-11-20T00:00:00Z', kind: 'discovery', title: 'Filled in the discovery form' }], [])
    expect(items.find(i => i.id === 'ev_e1')?.kind).toBe('discovery')
  })
})

describe('a lead’s form never runs the client-only steps', () => {
  const submit = readFileSync('app/api/intake/[token]/submit/route.ts', 'utf8')
  it('no Drive folder and no client record to fill, and its email opens the lead', () => {
    expect(submit).toContain('if (!forLead) try {\n    const labels'.replace('\n', submit.includes('\r\n') ? '\r\n' : '\n'))
    expect(submit).toMatch(/if \(!forLead\) try \{\r?\n\s+await inngest\.send/)
    expect(submit).toContain('/dashboard/leads/${lead!.id}')
  })
  it('the form is one per lead, claimed by an id made from the lead’s own', () => {
    const lib = readFileSync('app/lib/lead-discovery.ts', 'utf8')
    expect(lib).toContain(".claim(id, cur => (cur ? null : {")
    expect(lib).not.toMatch(/intake_forms'\)\.insert\(/)
  })
  it('the lead’s page draws the card, and the list shows where the form is up to', () => {
    expect(readFileSync('app/dashboard/leads/[id]/LeadPage.tsx', 'utf8')).toContain('<LeadDiscovery id={id}')
    expect(readFileSync('app/dashboard/leads/page.tsx', 'utf8')).toContain("fetch('/api/leads/discovery')")
  })
})
