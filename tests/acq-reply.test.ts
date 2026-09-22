import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanReply, EMAIL_REPLY_NOT_YET, isReplyChannel, nextActionAfterReply, NO_INSTAGRAM_THREAD, replyDetail, threadFor } from '../app/lib/acq-reply-core'

/** REPLYING FROM THE DASHBOARD (the owner, 22 Sep 2026: "no auto reply … but please integrate reply systems from the dashboard"). */
const threads = [
  { handle: 'crestlineconsultants', conversationId: 'c1', accountId: 'a1', ours: 'mdmedia._' },
  { handle: 'other', conversationId: 'c2', accountId: 'a1', ours: 'mdmedia._' },
]

describe('a person’s reply', () => {
  it('goes down the prospect’s own thread, found by their handle however it was typed', () => {
    expect(threadFor(threads, '@CrestlineConsultants')?.conversationId).toBe('c1')
    expect(threadFor(threads, 'https://instagram.com/crestlineconsultants/')?.conversationId).toBe('c1')
    expect(threadFor(threads, 'nobody')).toBeNull()
    expect(threadFor(threads, null)).toBeNull()
  })
  it('is the person’s words, trimmed and bounded, never composed', () => {
    expect(cleanReply('  Hi Sam,\r\nhappy to help  ')).toBe('Hi Sam,\nhappy to help')
    expect(cleanReply('')).toBeNull()
    expect(cleanReply('x'.repeat(2000))!.length).toBe(1000)
    expect(isReplyChannel('instagram')).toBe(true)
    expect(isReplyChannel('sms')).toBe(false)
  })
  it('lands on the timeline as the reply it was, and answers the standing next action', () => {
    expect(replyDetail('instagram', 'mdmedia._', 'Happy to help — when suits?')).toBe('Replied on Instagram as @mdmedia._: “Happy to help — when suits?”')
    expect(replyDetail('email', null, 'ok')).toBe('Replied by email: “ok”')
    expect(nextActionAfterReply('Reply to their DM')).toBeNull()
    expect(nextActionAfterReply('Book the call')).toBe('Book the call')
  })
  it('the route sends only a person’s press, only down the prospect’s thread, and refuses email with the reason', () => {
    const r = readFileSync('app/api/leads/acquisition/[id]/reply/route.ts', 'utf8')
    expect(r).toContain("await requireRole('scheduler')")
    expect(r).toContain("if (body.channel === 'email') return NextResponse.json({ error: EMAIL_REPLY_NOT_YET }, { status: 501 })")
    expect(r).toContain('const thread = threadFor(await ownThreads(), p.instagram)')
    expect(r).toContain('await getPublisher().sendConversationMessage(thread.conversationId, thread.accountId, message)')
    expect(r).toContain("kind: 'follow_up', by: user.id, detail: replyDetail('instagram', thread.ours, message)")
    expect(r).not.toMatch(/anthropic|messages\.parse|model:/)
    expect(NO_INSTAGRAM_THREAD).toContain('A first DM to a stranger goes from the Inbox page')
    expect(EMAIL_REPLY_NOT_YET).toContain('gmail.send')
  })
  it('the sheet has the box, one Send per channel, and says nothing is ever sent for you', () => {
    const s = readFileSync('app/dashboard/leads/acquisition/ProspectSheet.tsx', 'utf8')
    expect(s).toContain("onClick={async () => { if (await reply('instagram', draft.trim())) setDraft('') }}")
    expect(s).toContain('<Button variant="outline" disabled title={EMAIL_REPLY_NOT_YET}')
    expect(s).toContain('Nothing is ever sent for you — only what you press Send on.')
    // the agent itself still never sends anything (acq-agent.ts)
    expect(readFileSync('app/lib/acq-agent.ts', 'utf8')).not.toMatch(/sendConversationMessage|replyToComment|privateReply/)
  })
})
