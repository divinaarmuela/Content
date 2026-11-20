import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DISCOVERY_NOTIFY, DISCOVERY_NOTIFY_LIVE, discoveryAnswers, discoveryState, leadFormName, type DiscoveryRow } from '../app/lib/lead-discovery-core'
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
    expect(discoveryState(form({ status: 'in_progress', answers: { public_name: 'Acme' } }))).toMatchObject({ step: 'started', label: 'Form started', answered: 1, total: 24 })
    expect(discoveryState(form({ status: 'submitted', submitted_at: '2026-11-20T03:00:00Z', answers: { public_name: 'Acme', website: 'acme.com' } }), day))
      .toMatchObject({ step: 'filled', label: 'Form filled in', tone: 'green', answered: 2 })
  })
  it('the team opening their own unsent form is not the lead opening it', () => {
    expect(discoveryState(form({ status: 'draft', first_opened_at: '2026-11-20T02:00:00Z' })).step).toBe('made')
  })
  it('the sentence says what happened and what to do next', () => {
    expect(discoveryState(form()).line).toBe('The form is ready. Copy its link and send it to them.')
    expect(discoveryState(form({ status: 'submitted', submitted_at: 'x', answers: { public_name: 'Acme' } }), day).line).toBe('They filled it in on Fri 20 Nov: 1 of 24 questions answered. Their answers are below.')
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

describe('the form is sent cold, from one link, and makes its own lead', () => {
  const submit = readFileSync('app/api/intake/[token]/submit/route.ts', 'utf8')
  const lib = readFileSync('app/lib/lead-discovery.ts', 'utf8')
  it('opening the link makes nothing; only Begin does', () => {
    expect(readFileSync('app/discovery/page.tsx', 'utf8')).not.toMatch(/startColdDiscovery|table\(/)
    expect(readFileSync('app/discovery/DiscoveryStart.tsx', 'utf8')).toContain("fetch('/api/discovery/start', { method: 'POST' })")
    expect(readFileSync('app/api/discovery/start/route.ts', 'utf8')).toMatch(/export async function POST/)
    expect(readFileSync('app/api/discovery/start/route.ts', 'utf8')).not.toMatch(/export async function GET/)
  })
  it('says who is emailed when one is sent in', () => {
    expect([...DISCOVERY_NOTIFY_LIVE]).toEqual(['hello@mdmmarketing.com.au', 'contact@mdmmarketing.com.au'])
    // while it is being tested: the owner's own address only (to go live, DISCOVERY_NOTIFY becomes the list above)
    expect([...DISCOVERY_NOTIFY]).toEqual(['akmalashwin23@gmail.com'])
    expect(lib).toContain('notify_emails: [...DISCOVERY_NOTIFY]')
  })
  it('the lead is made once, by an id worked out from the form, and only when there is somebody to contact', () => {
    expect(lib).toContain("createHash('sha256').update(`discovery-lead:${form.id}`)")
    expect(lib).toContain(".claim(id, cur => (cur ? null : {")
    expect(lib).toContain("if (!name && !email && !phone && !biz) return null")
    expect(lib).not.toMatch(/'leads'\)\.insert\(/)
  })
  it('sending it in makes the lead, tells the Leads page, and skips the client-only steps', () => {
    expect(submit).toContain('leadFromColdDiscovery(')
    expect(submit).toContain("source: 'discovery_form'")
    // the client-only steps (their files, filling their record) run only when there is a client to run them for
    expect(submit).toMatch(/if \(client\) try \{\s+const labels/)
    expect(submit).toMatch(/if \(client\) try \{\s+await inngest\.send/)
  })
  it('whoever sends it in goes in as a prospect client too, once, and never on top of an existing client', () => {
    expect(submit).toContain('if (cold && lead) client = await clientFromDiscovery(')
    expect(lib).toContain("status: 'prospect', source: 'discovery_form',")
    expect(lib).not.toContain("status: 'active'")
    expect(lib).toContain("createHash('sha256').update(`discovery-client:${form.id}`)")
    // a client with this name or email already: none is made, and the form is not attached to theirs
    expect(lib).toMatch(/if \(taken\) \{[\s\S]{0,400}return null/)
    expect(lib).toContain("title: 'Added to Clients as a prospect'")
  })
  it('the lead’s page shows their answers, the list has the one link to copy, and nothing is made from a lead', () => {
    expect(readFileSync('app/dashboard/leads/[id]/LeadPage.tsx', 'utf8')).toContain('<LeadDiscovery id={id} />')
    expect(readFileSync('app/dashboard/leads/[id]/LeadDiscovery.tsx', 'utf8')).not.toMatch(/method: 'POST'|Make the discovery form/)
    expect(readFileSync('app/dashboard/leads/page.tsx', 'utf8')).toContain('Copy discovery form link')
    expect(readFileSync('app/api/leads/[id]/discovery/route.ts', 'utf8')).not.toMatch(/export async function (POST|PATCH)/)
  })
  it('the timeline says it once: the form’s own line, not a second "came in"', () => {
    const items = buildTimeline({ id: 'l1', created_at: '2026-11-20T00:00:00Z', source: 'discovery_form' }, [{ id: 'e1', at: '2026-11-20T00:00:00Z', kind: 'discovery', title: 'Filled in the discovery form' }], [])
    expect(items.map(i => i.title)).toEqual(['Filled in the discovery form'])
    // a lead whose line was never logged still says where it came from
    expect(buildTimeline({ id: 'l2', created_at: '2026-11-20T00:00:00Z', source: 'discovery_form' }, [], []).map(i => i.title)).toEqual(['Sent in the discovery form'])
  })
})

describe('the discovery form wears its landing page’s look, and a client’s intake form does not', () => {
  const form = readFileSync('app/intake/[token]/IntakeForm.tsx', 'utf8')
  it('the look is behind one switch that is off unless the page turns it on', () => {
    expect(form).toContain('discovery = false,')
    expect(readFileSync('app/intake/[token]/page.tsx', 'utf8')).toContain("discovery={form.template_key === 'discovery'}")
    // the portal's own copy of a client's form never turns it on
    expect(readFileSync('app/portal/[token]/home/page.tsx', 'utf8')).not.toMatch(/<IntakeForm[^>]*discovery/)
  })
  it('the backdrop is drawn only for the discovery form', () => {
    expect(form.match(/<BrandBackdrop/g)).toHaveLength(2)
    expect(form.match(/\{discovery && <BrandBackdrop fixed \/>\}/g)).toHaveLength(2)
  })
  it('a client’s form keeps its own bar, its own welcome, and its own thank-you words', () => {
    expect(form).toContain("discovery ? 'bg-ink/70' : 'bg-ink/95'")
    expect(form).toContain('useState(discovery && definition.sections.length > 1 ? 1 : 0)')
    expect(form).toContain('come back with a shot list and a content plan built around it')
  })
})

describe('the discovery form’s last page, its clean edges, and starting each page at the top', () => {
  const form = readFileSync('app/intake/[token]/IntakeForm.tsx', 'utf8')
  it('the browser’s own button edges and list dots come off only on the discovery form', () => {
    expect(form).toContain("discovery ? 'intake-disc relative' : ''")
    expect(form).toMatch(/\{discovery && <style>\{`:where\(\.intake-disc\)/)
  })
  it('goes to the top of each new page, and never while somebody is typing', () => {
    expect(form).toMatch(/if \(!discovery\) return\s+const el = document\.activeElement/)
    expect(form).toContain("}, [step, status === 'submitted', discovery])")
  })
  it('a client’s form keeps its own last page', () => {
    expect(form).toContain("'flex flex-col divide-y divide-cream/10 border-y border-cream/10'")
    expect(form).toContain("'flex flex-wrap items-center gap-5'")
  })
})
