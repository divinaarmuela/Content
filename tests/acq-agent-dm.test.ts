import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { STRANGER_FROM, strangerIsLead, strangerLockKey, strangerPrompt, type Evidence } from '../app/lib/acq-agent-core'
import { parseZernioEvent } from '../app/lib/zernio-webhook-core'

const v = (over = {}) => ({ is_potential_client: true, confidence: 0.9, business: 'Kode Finance', contact_name: 'Sam', wants: 'pricing for reels', reasoning: 'asks about working together', ...over })

describe('an incoming DM wakes the acquisition agent at once (21 Sep 2026)', () => {
  it('the webhook keeps who wrote and which way it went — never the text', () => {
    const { action } = parseZernioEvent({
      id: 'evt_1', event: 'message.received',
      data: {
        message: { id: 'm', conversationId: 'conv_1', platform: 'instagram', direction: 'incoming', text: 'how much for reels?', sender: { id: '1', username: 'kodefinance', name: 'Kode' } },
        conversation: { id: 'conv_1', platformConversationId: 'p', status: 'active', participantUsername: 'kodefinance' },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'instagram', username: 'mdmedia._' },
      },
    } as never) as { action: Record<string, unknown> }
    expect(action).toMatchObject({ kind: 'inbox', accountId: 'acc_1', conversationId: 'conv_1', senderUsername: 'kodefinance', senderName: 'Kode', incoming: true })
    expect(JSON.stringify(action)).not.toContain('how much')
    const hook = readFileSync('app/lib/zernio-webhook.ts', 'utf8')
    expect(hook).toContain("if (action.detail === 'message.received' && action.incoming !== false && action.senderUsername && action.accountId) {")
    expect(hook).toContain("await inngest.send({ name: 'app/acquisition.dm.received',")
  })

  it('a stranger becomes a lead only when the model is sure; one look per handle per day', () => {
    expect(strangerIsLead(v())).toBe(true)
    expect(strangerIsLead(v({ confidence: STRANGER_FROM - 0.01 }))).toBe(false)
    expect(strangerIsLead(v({ is_potential_client: false, confidence: 0.99 }))).toBe(false)
    // one look per NEW message, not per day (23 Sep 2026): the key is the newest incoming message
    expect(strangerLockKey('KodeFinance', 'ig:m_abc')).toBe('kodefinance__ig:m_abc')
    expect(strangerLockKey('KodeFinance', 'ig:m_abc')).not.toBe(strangerLockKey('KodeFinance', 'ig:m_def'))
    const agent = readFileSync('app/lib/acq-agent.ts', 'utf8')
    expect(agent).toContain('strangerLockKey(handle, incoming[incoming.length - 1].id)')
    expect(agent.indexOf('const incoming = messages.filter')).toBeLessThan(agent.indexOf('const lock = await takeClaimLock(`acq_dm__'))
    const msgs: Evidence[] = [{ id: 'ig:1', source: 'instagram', at: '2026-09-21T01:00:00Z', direction: 'in', from: '@kode', to: '@mdmedia._', text: 'Hi, how much for reels?' }]
    expect(strangerPrompt('kode', 'Kode', msgs)).toContain('[2026-09-21T01:00:00Z] @kode: Hi, how much for reels?')
  })

  it('only MD Media’s own accounts, never a client’s own handle, and a known prospect gets the ordinary pass', () => {
    const src = readFileSync('app/lib/acq-agent.ts', 'utf8')
    expect(src).toContain("if (!(await ownAccountIds()).includes(input.accountId)) return { kind: 'not_ours' }")
    expect(src).toContain("if (known) return { kind: 'known', prospect_id: known.id, run: await runAgentForProspect(known, await agentContext()) }")
    expect(src).toContain("return { kind: 'a_client_account' }")
    expect(src).toContain("source: 'organic_social', source_detail: 'Instagram DM — found by the agent', stage: 'engaged'")
    expect(readFileSync('app/inngest/functions.ts', 'utf8')).toContain("triggers: [{ event: 'app/acquisition.dm.received' }],")
  })
})
