import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ACQ_STAGES, PIPELINE_STAGES, TARGET_STAGES, acqByTier, acqDaysOver, acqFunnel, acqLimitWords, acqMoveRefusal, acqMoveStamps,
  captureState, cleanHandle, eventForMove, prospectForSender, replyPoints, followUpPlan, followUpTasks, isClosedLost, isLeadStage, medianDays, nextAcqStage,
  sanitiseProspectPatch, scoreBand, scoreOf, type AcqEvent, type Prospect,
} from '../app/lib/acquisition-core'
import { canSeePage } from '../app/lib/page-access-core'
import { notificationHref } from '../app/lib/notification-words'

const ev = (kind: string, points: number, extra: Partial<AcqEvent> = {}): AcqEvent => ({ id: kind, prospect_id: 'p', kind, at: '2026-09-20T00:00:00Z', points, ...extra })

describe('the acquisition system (the blueprint read 21 Sep 2026)', () => {
  it('has the blueprint’s eleven stages in order, three before a business is a lead', () => {
    expect(ACQ_STAGES.map(s => s.label)).toEqual([
      'Research target', 'Content prepared', 'Outreach sent', 'New lead / Engaged', 'Qualified / Call booked', 'Discovery held',
      'Proposal sent', 'Deposit sent', 'Deposit paid', 'Contract signed', 'Client handoff',
    ])
    expect(TARGET_STAGES).toEqual(['target', 'content', 'outreach'])
    expect(PIPELINE_STAGES[0]).toBe('engaged')
    expect(isLeadStage('outreach')).toBe(false)
    expect(isLeadStage('engaged')).toBe(true)
    expect(nextAcqStage('deposit_sent')?.key).toBe('deposit_paid')
    expect(nextAcqStage('handoff')).toBeNull()
  })

  it('the score is the sum of the confirmed events, with the blueprint’s points and bands', () => {
    const events = [ev('fit', 10), ev('weak_presence', 5), ev('reply', 20), ev('link_click', 15), ev('call_booked', 30), ev('reminder_opened', 5)]
    expect(scoreOf(events)).toBe(85)
    expect(scoreBand(85).label).toBe('High priority')
    expect(scoreBand(65).label).toBe('Qualified interest')
    expect(scoreBand(30).label).toBe('Warm')
    expect(scoreBand(29).label).toBe('Cold / low signal')
    // a scanner's finding nobody confirmed counts for nothing yet; a delay takes ten off; never below zero
    expect(scoreOf([ev('reply', 20, { confirmed: false })])).toBe(0)
    expect(scoreOf([ev('reply', 20), ev('delayed', -10)])).toBe(10)
    expect(scoreOf([ev('delayed', -10)])).toBe(0)
    expect(isClosedLost([ev('not_interested', 0)])).toBe(true)
  })

  it('a stage is left only when its data is captured, and a move stamps what it means', () => {
    const p: Prospect = { id: 'p', business: 'Kode', stage: 'target' }
    expect(acqMoveRefusal(p)).toBe('Not yet — tier, website or a social handle, what is weak, or the audit angle first.')
    const ready: Prospect = { ...p, tier: 1, instagram: 'kode', audit_angle: 'No reels' }
    expect(acqMoveRefusal(ready)).toBeNull()
    expect(captureState({ ...p, stage: 'proposal', proposal_url: 'https://x.co/p' }).map(x => x.met)).toEqual([true, false])
    expect(acqMoveStamps(p, 'engaged', 'NOW').replied_at).toBe('NOW')
    expect(acqMoveStamps({ ...p, replied_at: 'THEN' }, 'engaged', 'NOW').replied_at).toBeUndefined()
    expect(acqMoveStamps(p, 'proposal', 'NOW').proposal_sent_at).toBe('NOW')
    expect(eventForMove('outreach')).toBe('outreach_sent')
    expect(eventForMove('deposit_paid')).toBe('deposit_paid')
  })

  it('the clock: research waits, content has 3 days, a parked prospect is never late', () => {
    const now = Date.parse('2026-09-21T00:00:00Z')
    expect(acqDaysOver({ stage: 'target', stage_entered_at: '2026-08-01T00:00:00Z' }, now)).toBeNull()
    expect(acqDaysOver({ stage: 'content', stage_entered_at: '2026-09-16T00:00:00Z' }, now)).toBe(2)
    expect(acqLimitWords({ stage: 'content', stage_entered_at: '2026-09-16T00:00:00Z' }, now)).toBe('2 days over')
    expect(acqDaysOver({ stage: 'content', stage_entered_at: '2026-09-16T00:00:00Z', not_now_at: 'x' }, now)).toBeNull()
    expect(acqLimitWords({ stage: 'outreach', dormant_at: 'x' }, now)).toBe('Dormant')
  })

  it('the follow-up: days 0, 1, 3, 5, 7, 14, 21 from the outreach, paused by a reply, a step done when its day is logged', () => {
    const now = Date.parse('2026-09-25T00:00:00Z')
    const plan = followUpPlan({ outreach_at: '2026-09-18T00:00:00Z' }, [ev('follow_up', 0, { detail: 'Day 1 sent — Short reminder', at: '2026-09-19T01:00:00Z' })], now)
    expect(plan.map(s => s.day)).toEqual([0, 1, 3, 5, 7, 14, 21])
    expect(plan[0].done_at).toBe('2026-09-18T00:00:00.000Z')
    expect(plan[1].done_at).toBe('2026-09-19T01:00:00Z')
    expect(plan.filter(s => s.overdue).map(s => s.day)).toEqual([3, 5])
    const replied = followUpPlan({ outreach_at: '2026-09-18T00:00:00Z', replied_at: '2026-09-20T00:00:00Z' }, [], now)
    expect(replied.filter(s => s.overdue)).toHaveLength(0)
    expect(replied.filter(s => s.paused).map(s => s.day)).toEqual([1, 3, 5, 7, 14, 21])
    const tasks = followUpTasks('Kode', '2026-09-18T00:00:00Z')
    expect(tasks.map(t => t.due_date)).toEqual(['2026-09-19', '2026-09-21', '2026-09-23', '2026-09-25', '2026-10-02', '2026-10-09'])
    expect(tasks[0].title).toBe('Day 1 · Short reminder — Kode')
  })

  it('cleans what a person sends: links, handles, dates, money, the lists — and refuses a bad value by name', () => {
    const ok = sanitiseProspectPatch({ business: '  Kode  ', website: 'kodefinance.com.au', instagram: 'https://www.instagram.com/kodefinance/', tier: '1', source: 'referral', deal_value: '4800.456', weakness_tags: ['No reels', '', '  slow site '], nonsense: 'x' })
    expect(ok).toEqual({ ok: true, patch: { business: 'Kode', website: 'https://kodefinance.com.au/', instagram: 'kodefinance', tier: 1, source: 'referral', deal_value: 4800.46, weakness_tags: ['No reels', 'slow site'] } })
    expect(sanitiseProspectPatch({ tier: 9 })).toEqual({ ok: false, error: 'Pick a tier from the list' })
    expect(sanitiseProspectPatch({ source: 'tv' })).toEqual({ ok: false, error: 'Pick a source from the list' })
    expect(sanitiseProspectPatch({ call_at: 'soon' })).toEqual({ ok: false, error: 'The discovery call is not a date' })
    expect(sanitiseProspectPatch({ loom_url: 'javascript:alert(1)' }).ok).toBe(false)
    expect(sanitiseProspectPatch({ business: ' ' })).toEqual({ ok: false, error: 'A prospect needs the business’s name' })
    expect(cleanHandle('@@kode/')).toBe('kode')
  })

  it('the first numbers: the funnel counts who REACHED a stage, by tier, and the median days between milestones', () => {
    const ps: Prospect[] = [
      { id: 'a', business: 'A', stage: 'signed', tier: 1, outreach_at: '2026-09-01T00:00:00Z', replied_at: '2026-09-03T00:00:00Z' },
      { id: 'b', business: 'B', stage: 'outreach', tier: 1, outreach_at: '2026-09-01T00:00:00Z' },
      { id: 'c', business: 'C', stage: 'target', tier: 2 },
    ]
    const f = acqFunnel(ps)
    expect(f.find(x => x.key === 'target')!.reached).toBe(3)
    expect(f.find(x => x.key === 'outreach')!.reached).toBe(2)
    expect(f.find(x => x.key === 'signed')!.reached).toBe(1)
    expect(acqByTier(ps).get(1)).toEqual({ sent: 2, replies: 1, calls: 1, signed: 1 })
    expect(medianDays(ps, 'outreach_at', 'replied_at')).toBe(2)
    expect(medianDays(ps, 'call_at', 'signed_at')).toBeNull()
  })

  it('the inbox knows a prospect: its own address first, then its own domain when only one prospect has it; never a free-mail domain', () => {
    const ps = [
      { id: 'a', stage: 'outreach', email: 'Sam@Kode.com.au', website: 'https://www.kodefinance.com.au/' },
      { id: 'b', stage: 'engaged', email: 'jo@gmail.com', website: null },
      { id: 'c', stage: 'handoff', email: 'old@client.com', website: 'https://client.com' },
      { id: 'd', stage: 'target', email: null, website: 'https://twins.com.au' },
      { id: 'e', stage: 'target', email: null, website: 'https://twins.com.au/about' },
    ]
    expect(prospectForSender(ps, ' sam@kode.com.au ')).toEqual({ prospect: ps[0], by: 'address' })
    expect(prospectForSender(ps, 'accounts@kodefinance.com.au')).toEqual({ prospect: ps[0], by: 'domain' })
    expect(prospectForSender(ps, 'x@mail.kodefinance.com.au')?.by).toBe('domain')
    expect(prospectForSender(ps, 'jo@gmail.com')?.prospect.id).toBe('b')
    expect(prospectForSender(ps, 'someone.else@gmail.com')).toBeNull()
    expect(prospectForSender(ps, 'old@client.com')).toBeNull()      // handed over: client mail, not a reply
    expect(prospectForSender(ps, 'hi@twins.com.au')).toBeNull()     // two prospects on one domain: a person's call
    expect(replyPoints({})).toBe(20)
    expect(replyPoints({ replied_at: '2026-09-20T00:00:00Z' })).toBe(0)
    // one reply is recorded in one place, by the button and the scanner alike; a copy in two mailboxes is one reply
    const scan = readFileSync('app/lib/email-lead.ts', 'utf8')
    expect(scan).toContain("const lock = await takeClaimLock(`acq_reply__${encodeKey(msg.messageId || id)}`, `${mailbox}:${id}`)")
    expect(scan.indexOf('const known = prospectForSender(prospectRows, msg.fromEmail)')).toBeLessThan(scan.indexOf('c = await classify(msg)'))
    expect(readFileSync('app/api/leads/acquisition/[id]/events/route.ts', 'utf8')).toContain('? await recordReply(user, p, detail, { by: user.id })')
  })

  it('sits under Leads as sub-links on Leads’ own permission, and leaves the live Leads page alone', () => {
    expect(canSeePage('super_admin', '/dashboard/leads/acquisition/targets', [])).toBe(canSeePage('super_admin', '/dashboard/leads', []))
    expect(canSeePage('editor', '/dashboard/leads/acquisition', [])).toBe(false)
    expect(canSeePage('editor', '/dashboard/leads/acquisition', ['/dashboard/leads'])).toBe(true)
    expect(notificationHref('prospect', '3b1c2d4e-0000-4000-8000-000000000001#acq_reply#u')).toBe('/dashboard/leads/acquisition?prospect=3b1c2d4e-0000-4000-8000-000000000001')
    const shell = readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')
    expect(shell).toContain("{item.href === '/dashboard/leads' && leadsChildren.map(c => link(c, true))}")
    // the move is decided inside a claim, on the row as it is; a reply moves an outreach target once
    const stage = readFileSync('app/api/leads/acquisition/[id]/stage/route.ts', 'utf8')
    expect(stage).toContain('const result = await prospects.claim(id, ((cur: ProspectRow | null): unknown => {')
    expect(stage).toContain('if (!next || acqMoveRefusal(p)) return null')
    const events = readFileSync('app/lib/acquisition.ts', 'utf8')
    expect(events).toContain("...(atOutreach ? { stage: 'engaged', stage_entered_at: now } : {})")
    // the old pipeline's rules are untouched by this build
    expect(readFileSync('app/lib/pipeline-core.ts', 'utf8')).toContain("| 'walkthrough'  // 5. Walkthrough held")
  })

  it('a booking on the app’s own booking page by a prospect is their discovery call: one line per booking, moved to Qualified / Call booked as §12 asks', () => {
    const src = readFileSync('app/lib/acquisition.ts', 'utf8')
    expect(src).toContain('const lock = await takeClaimLock(`acq_booking__${booking.id}`, p.id)')
    expect(src).toContain("await recordCallBooked({ id: 'scanner', name: 'Booking page' }, p,")
    expect(src).toContain("...(early ? { stage: 'qualified', stage_entered_at: now } : {})")
    // the booking is written first and never fails because of the board
    const booking = readFileSync('app/lib/booking.ts', 'utf8')
    expect(booking).toContain("await import('./acquisition').then(m => m.onBookingMade(made)).catch(() => {})")
  })

  it('the people the blueprint names can open it: Manal (account manager) and Joy (quality checker) hold the four views without holding Leads', () => {
    for (const href of ['/dashboard/leads/acquisition', '/dashboard/leads/acquisition/queue', '/dashboard/leads/acquisition/targets', '/dashboard/leads/acquisition/contacts', '/dashboard/leads/acquisition/reporting']) {
      expect(canSeePage('account_manager', href, [])).toBe(true)
      expect(canSeePage('quality_checker', href, [])).toBe(true)
      expect(canSeePage('editor', href, [])).toBe(false)
      expect(canSeePage('client', href, [])).toBe(false)
    }
    expect(canSeePage('account_manager', '/dashboard/leads', [])).toBe(false)
    expect(canSeePage('quality_checker', '/dashboard/leads', [])).toBe(false)
    // the door asks about the acquisition page itself, not Leads; the sidebar draws the views on their own when Leads is not held
    expect(readFileSync('app/dashboard/layout.tsx', 'utf8')).toContain('const all = [...NAV_MAIN, ...NAV_SOCIAL_CHILDREN, ...NAV_LEADS_CHILDREN, ...NAV_TOOLS]')
    expect(readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')).toContain("const looseAcquisition = group.label === 'General' && !allowed.get('/dashboard/leads') && leadsChildren.length > 0")
  })

  it('every row of the blueprint’s §12 has its prompt: the booked call, the held call, the proposal, the deposit, the handoff', () => {
    const stage = readFileSync('app/api/leads/acquisition/[id]/stage/route.ts', 'utf8')
    for (const [to, fn] of [['discovery', 'onDiscoveryHeld'], ['proposal', 'onProposalSent'], ['deposit_sent', 'onDepositSent']]) expect(stage).toContain(`if (action === 'move' && moved === '${to}') await ${fn}(user, row)`)
    expect(stage).toContain("if (action === 'move' && moved === 'handoff') await onHandoff(user, row,")
    expect(readFileSync('app/api/leads/acquisition/[id]/events/route.ts', 'utf8')).toContain("? await recordCallBooked(user, p, (p as { call_at?: string | null }).call_at ?? null, detail, { by: user.id })")
    // a reminder on To-dos opens the prospect it is about
    expect(readFileSync('app/dashboard/todos/page.tsx', 'utf8')).toContain('/dashboard/leads/acquisition?prospect=')
  })
})
