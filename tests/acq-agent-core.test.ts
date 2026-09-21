import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ACT_FROM, agentPrompt, decideFinding, findingKey, isOpenFinding, newEvidence, type AgentFinding, type Evidence } from '../app/lib/acq-agent-core'
import { scoreOf } from '../app/lib/acquisition-core'

const ev = (id: string, direction: 'in' | 'out' = 'in'): Evidence => ({ id, source: 'email', at: '2026-09-21T01:00:00Z', direction, from: 'sam@kode.com.au', to: 'hello@mdmmarketing.com.au', subject: 'Re: your audit', text: 'Thanks, keen to chat.' })
const f = (over: Partial<AgentFinding> = {}): AgentFinding => ({ evidence_id: 'email:1', kind: 'reply', summary: 'Sam replied and wants to talk.', confidence: 0.95, already_known: false, ...over })

describe('the acquisition agent decides (21 Sep 2026)', () => {
  it('new or old is decided in code first: evidence a timeline line already carries is never shown again', () => {
    const fresh = newEvidence([ev('email:1'), ev('email:2'), ev('email:2')], [{ id: 'e', prospect_id: 'p', kind: 'reply', at: 'x', evidence_id: 'email:1' }])
    expect(fresh.map(e => e.id)).toEqual(['email:2'])
  })

  it('the model proposes, the code disposes', () => {
    const given = [ev('email:1'), ev('email:9', 'out')]
    expect(decideFinding(f(), given).verdict).toBe('record')
    expect(decideFinding(f({ evidence_id: 'email:404' }), given).verdict).toBe('ignore')     // evidence it was never given
    expect(decideFinding(f({ kind: 'make_client' }), given).verdict).toBe('ignore')          // not a kind it may record
    expect(decideFinding(f({ already_known: true }), given).verdict).toBe('ignore')
    expect(decideFinding(f({ confidence: 0.4 }), given).verdict).toBe('ignore')
    expect(decideFinding(f({ confidence: ACT_FROM - 0.01 }), given).verdict).toBe('ask')     // likely, not certain
    expect(decideFinding(f({ evidence_id: 'email:9' }), given).verdict).toBe('ask')          // a "reply" read out of OUR message
    expect(decideFinding(f({ evidence_id: 'email:9', kind: 'follow_up' }), given).verdict).toBe('record')
  })

  it('what makes or ends a client waits for a person, however sure the model is', () => {
    for (const kind of ['deposit_paid', 'signed', 'not_interested']) expect(decideFinding(f({ kind, confidence: 0.99 }), [ev('email:1')]).verdict).toBe('ask')
    // …and a finding waiting on a person is worth nothing on the score
    expect(scoreOf([{ id: 'a', prospect_id: 'p', kind: 'deposit_paid', at: 'x', points: 40, confirmed: false }])).toBe(0)
    expect(isOpenFinding({ confirmed: false })).toBe(true)
    expect(isOpenFinding({ confirmed: false, dismissed_at: 'x' })).toBe(false)
    expect(isOpenFinding({ confirmed: true })).toBe(false)
  })

  it('one line per thing said about one message; the prompt carries the timeline and only what it is given', () => {
    expect(findingKey('p1', f())).toBe('p1__reply__email:1')
    const prompt = agentPrompt({ business: 'Kode', stage: 'outreach', email: 'sam@kode.com.au', instagram: 'kode' }, [{ id: 'e', prospect_id: 'p', kind: 'outreach_sent', at: '2026-09-18T00:00:00Z', detail: 'DM sent' }], [ev('email:1')])
    expect(prompt).toContain('TIMELINE SO FAR\n- 2026-09-18T00:00 outreach_sent: DM sent')
    expect(prompt).toContain('### evidence_id: email:1')
  })

  it('it writes through the same functions a person’s press uses, locks each finding, and a person answers inside a claim', () => {
    const src = readFileSync('app/lib/acq-agent.ts', 'utf8')
    expect(src).toContain("const lock = await takeClaimLock(`acq_agent__${encodeKey(findingKey(p.id, f))}`, 'agent')")
    expect(src).toContain("await recordReply(AGENT, current, detail, { source: 'agent', at, points: replyPoints(current), ...extra })")
    expect(src).toContain("await logAcqEvent({ prospectId: p.id, kind: f.kind as AcqEventKind, source: 'agent', detail, at, confirmed: false, ...extra })")
    const answer = readFileSync('app/api/leads/acquisition/[id]/events/[eventId]/route.ts', 'utf8')
    expect(answer).toContain('if (!cur || cur.prospect_id !== id || !isOpenFinding(cur)) return null')
    expect(readFileSync('app/inngest/functions.ts', 'utf8')).toContain("triggers: [{ cron: 'TZ=Australia/Melbourne */30 6-22 * * *' }, { event: 'app/acquisition.agent.requested' }],")
  })

  it('NOTHING THE AGENT WRITES EVER REACHES A PROSPECT (the owner, 21 Sep 2026: "nothing should reply as an AI to the inboxes"): it reads, it never sends', () => {
    for (const file of ['app/lib/acq-agent.ts', 'app/lib/acq-agent-core.ts']) {
      const src = readFileSync(file, 'utf8')
      for (const sender of ['sendConversationMessage', 'replyToComment', 'privateReply', 'sendMail', 'smtp', '/messages/send', 'gmail.send']) expect(src).not.toContain(sender)
    }
    // the only DM and comment senders in the app take a person's typed message from a request
    expect(readFileSync('app/api/social/messages/route.ts', 'utf8')).toContain("const message = String(body.message ?? '').trim()")
  })
})
