import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { conversationPath, conversationRefusal, conversationView, directionOf } from '../app/lib/acq-conversation-core'

/** ONE SCANNED MESSAGE'S CONVERSATION (the owner, 23 Sep 2026: "just create a page which shows the convo for that") */
describe('a scanned message’s conversation', () => {
  const row = { id: '1cf4bdc4', mailbox: 'hello@mdmmarketing.com.au', from_email: 'sankhaja.h@tryunwir.com', subject: 'Martin, is visibility the real issue atm?', status: 'not_a_lead', reasoning: 'A vendor pitch selling a reporting system to the agency.', confidence: 0.98, gmail_message_id: 'm2' }
  const thread = [
    { id: 'm2', fromName: 'Sankhaja', fromEmail: 'sankhaja.h@tryunwir.com', to: 'hello@mdmmarketing.com.au', at: '2026-09-23T01:40:25.000Z', body: 'Hi Martin, …' },
    { id: 'm1', fromName: 'Martin', fromEmail: 'martin@mdmmarketing.com.au', to: 'sankhaja.h@tryunwir.com', at: '2026-09-20T01:00:00.000Z', body: 'Thanks, not for us.' },
  ]

  it('draws the thread oldest first, marks which way each went and which one the scanner read', () => {
    const v = conversationView(row, thread)
    expect(v.subject).toBe('Martin, is visibility the real issue atm?')
    expect(v.decision).toBe('Read — not a lead · 98% sure')
    expect(v.messages.map(m => [m.id, m.direction, m.scanned])).toEqual([['m1', 'out', false], ['m2', 'in', true]])
    expect(v.messages[0].who).toBe('Martin')
    expect(directionOf('someone@gmail.com')).toBe('in')
    expect(conversationView({ id: 'x', gmail_message_id: 'm9' }, [{ id: 'm9', body: '' }]).messages[0].body).toContain('no text')
  })

  it('refuses in words when the row, the id or the credentials are missing', () => {
    expect(conversationRefusal(null, true)).toBe('That message is not in the scanner’s log.')
    expect(conversationRefusal({ id: 'x', mailbox: 'hello@mdmmarketing.com.au' }, true)).toContain('did not keep the message id')
    expect(conversationRefusal(row, false)).toBe('The scanner has no credentials for hello@mdmmarketing.com.au right now, so the thread cannot be read.')
    expect(conversationRefusal(row, true)).toBeNull()
  })

  it('the Scanning view links each subject to the page; the route reads with the scanner’s credentials and never writes', () => {
    expect(conversationPath('1cf4bdc4')).toBe('/dashboard/leads/acquisition/scanning/1cf4bdc4')
    expect(readFileSync('app/dashboard/leads/acquisition/ScanningView.tsx', 'utf8')).toContain('<Link href={conversationPath(r.id)} className="underline-offset-4 hover:underline">{r.subject}</Link>')
    const route = readFileSync('app/api/leads/acquisition/scanning/[id]/route.ts', 'utf8')
    expect(route).toContain("await requireRole('scheduler')")
    expect(route).toContain('const thread = await fetchThread(box, String(row.gmail_message_id))')
    expect(route).not.toMatch(/\.(insert|update|claim|remove|delete)\(/)
    const gmail = readFileSync('app/lib/gmail.ts', 'utf8')
    expect(gmail).toContain('export async function fetchThread(mailbox: Mailbox, messageId: string): Promise<ThreadMessage[]>')
  })
})
