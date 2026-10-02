import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formLinkTarget, formOpen, formRows } from '../app/lib/one-portal-forms-core'

/* ── the Shoot brief tab's forms (2 Oct 2026: "maybe all this links should redirect to their one portal") ── */

const day = (iso: string) => iso.slice(0, 10)

describe('which forms the tab lists', () => {
  it('an intake form or monthly update the team sent and the client has not submitted; never a draft', () => {
    expect(formOpen('sent')).toBe(true)
    expect(formOpen('in_progress')).toBe(true)
    expect(formOpen('draft')).toBe(false)
    expect(formOpen('submitted')).toBe(false)
  })
  it('lists waiting rows first, says what each asks, and drops a cancelled proposal', () => {
    const rows = formRows(
      [{ id: 'i1', title: 'Shoot questions', status: 'in_progress', sent_at: '2026-09-01' }, { id: 'i2', status: 'draft' }, { id: 'i3', status: 'submitted' }],
      [{ id: 'm1', status: 'sent', sent_at: '2026-09-10' }],
      [
        { id: 'p1', title: 'October shoot', status: 'pending', starts_at: '2026-10-20T00:00:00Z', created_at: '2026-09-20' },
        { id: 'p2', title: 'Old date', status: 'cancelled', created_at: '2026-09-21' },
        { id: 'p3', title: 'September shoot', status: 'accepted', starts_at: '2026-09-05T00:00:00Z', created_at: '2026-08-01' },
      ],
      day,
    )
    expect(rows.map(r => r.id)).toEqual(['p1', 'm1', 'i1', 'p3'])
    expect(rows.find(r => r.id === 'p1')).toMatchObject({ waiting: true, line: '2026-10-20 · Can you do this date?' })
    expect(rows.find(r => r.id === 'p3')).toMatchObject({ waiting: false, done: true, line: '2026-09-05 · You said yes' })
    expect(rows.find(r => r.id === 'i1')).toMatchObject({ title: 'Shoot questions', line: 'Started — pick up where you left off' })
    expect(rows.find(r => r.id === 'm1')?.title).toBe('Monthly update')
  })
  it('an old link lands on its row', () => {
    expect(formLinkTarget('/portal/t/home', 'intake', 'i1')).toBe('/portal/t/home?tab=forms&form=i1')
    expect(formLinkTarget('/portal/t/home', 'monthly', 'm1')).toBe('/portal/t/home?tab=forms&monthly=m1')
    expect(formLinkTarget('/portal/t/home', 'proposal', 'p1')).toBe('/portal/t/home?tab=shoot&proposal=p1')
  })
})

describe('the old form links send a one-portal client into the one link, and only them', () => {
  it.each([['intake', 'app/intake/[token]/page.tsx'], ['monthly', 'app/monthly/[token]/page.tsx'], ['proposal', 'app/shoot/[token]/page.tsx']])('%s', (kind, file) => {
    const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain(`const moved = await onePortalFormRedirect('${kind}', token)\n  if (moved) redirect(moved)`)
  })
  it('the redirect does nothing for a client not on the one portal', () => {
    expect(readFileSync('app/lib/one-portal-forms.ts', 'utf8')).toContain('if (!client || !onePortal(client) || !home) return null')
  })
  it('the public share link is NOT redirected — it is for anyone holding it, and the portal is the client\'s alone', () => {
    expect(readFileSync('app/share/[token]/page.tsx', 'utf8')).not.toContain('onePortal')
  })
  it('a person\'s own portal lists no forms and opens none', () => {
    const lib = readFileSync('app/lib/one-portal-forms.ts', 'utf8')
    expect(lib).toContain("if (scope.kind !== 'business') return []")
    const page = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
    expect(page).toContain("if (page.scope.kind !== 'business') notFound()")
  })
  it('each full-screen form has the way back to the portal', () => {
    for (const f of ['app/intake/[token]/IntakeForm.tsx', 'app/monthly/[token]/MonthlyForm.tsx', 'app/shoot/[token]/ShootAnswer.tsx']) {
      expect(readFileSync(f, 'utf8')).toContain('← Your portal</a>}')
    }
  })
  it('accepting a date no longer promises an invite nobody sends', () => {
    const src = readFileSync('app/shoot/[token]/ShootAnswer.tsx', 'utf8')
    expect(src).not.toContain('calendar invite is on its way')
  })
})

describe('Forms is its own tab (the owner, 2 Oct 2026: "usually we would have multiple intake forms")', () => {
  const page = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
  it('intake forms and monthly updates list on Forms; shoot dates stay on Shoot brief', () => {
    expect(page).toContain("{tab === 'forms' && <OnePortalList rows={formsTabRows}")
    expect(page).toContain("{tab === 'shoot' && dateRows.length > 0 && <OnePortalList heading=\"Shoot dates\" rows={dateRows} />}")
    expect(page).toContain("if (tab === 'forms' && pick('intake')) {")
  })
  it('no calendar file for the client (the owner, 2 Oct 2026: "we dont need a calendar invite")', () => {
    expect(readFileSync('app/shoot/[token]/ShootAnswer.tsx', 'utf8')).not.toContain('Add to my calendar')
  })
})

describe('a failed Drive hand-in leaves the tray once a later one on the card worked (2 Oct 2026, Justin\'s September Videos)', () => {
  it('the row reads the later hand-in and goes like a finished one', () => {
    const src = readFileSync('app/dashboard/DriveCopyRows.tsx', 'utf8')
    expect(src).toContain("const putRight = handIn?.status === 'failed' && at >= 0 && all.slice(at + 1).some(h => h.status === 'done')")
    expect(src).toContain("const done = handIn?.status === 'done' || putRight")
  })
})
