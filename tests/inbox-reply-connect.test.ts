import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mailboxReach, mailboxSummaries } from '../app/lib/acq-scanning-core'
import { MAILBOX_CANNOT_SEND, NOBODY_TO_REPLY_TO, replyDraft } from '../app/lib/acq-conversation-core'
import { INBOX_SCOPES } from '../app/lib/inbox-connect'
import { GMAIL_SEND_SCOPE, mailboxCanSend, rawEmail } from '../app/lib/gmail'

/**
 * ONE WAY TO CONNECT, READ AND REPLY (the owner, 23 Sep 2026: "so its easily
 * connected again same way currently its all over the places", "is there a
 * way to reply it from here too?").
 */
describe('connect once, read and reply', () => {
  it('the connect flow asks for read and send together, and keeps what Google granted', () => {
    expect(INBOX_SCOPES).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send')
    const src = readFileSync('app/lib/inbox-connect.ts', 'utf8')
    expect(src).toContain('scope: INBOX_SCOPES,')
    expect(src).toContain("scopes: String(token.scope ?? '').trim() || null,")
    expect(readFileSync('docs/schema-history/inbox_reply_scopes.sql', 'utf8')).toContain('alter table scan_mailboxes add column if not exists scopes text;')
  })

  it('a mailbox may send only when its token carries gmail.send', () => {
    expect(mailboxCanSend({ scopes: `https://www.googleapis.com/auth/gmail.readonly ${GMAIL_SEND_SCOPE}` })).toBe(true)
    expect(mailboxCanSend({ scopes: 'https://www.googleapis.com/auth/gmail.readonly' })).toBe(false)
    expect(mailboxCanSend({ delegated: true })).toBe(false)
    expect(mailboxCanSend({ refreshToken: 'x' })).toBe(false)
  })

  it('the Scanning page says each mailbox’s reach and offers the one press that widens it', () => {
    expect(mailboxReach({ enabled: true, source: 'self', can_send: true })).toEqual({ words: 'Reads and replies', tone: 'green', reconnect: false })
    expect(mailboxReach({ enabled: true, source: 'self', can_send: false })).toMatchObject({ words: 'Reads only — reconnect to allow replies', reconnect: true })
    expect(mailboxReach({ enabled: true, source: 'shared', can_send: false }).reconnect).toBe(true)
    expect(mailboxReach({ enabled: false, source: 'self', can_send: true })).toMatchObject({ words: 'Switched off', reconnect: false })
    const s = mailboxSummaries([{ email: 'Tech@mdmmarketing.com.au', source: 'self', can_send: true }], [], '2026-09-23T02:00:00.000Z')
    expect(s[0]).toMatchObject({ email: 'tech@mdmmarketing.com.au', source: 'self', can_send: true })
    const view = readFileSync('app/dashboard/leads/acquisition/ScanningView.tsx', 'utf8')
    expect(view).toContain('href={`/api/inbox/connect?from=scanning&mailbox=${encodeURIComponent(m.email)}`}')
    expect(view).toContain('Connect for replies</a>')
    const connect = readFileSync('app/api/inbox/connect/route.ts', 'utf8')
    expect(connect).toContain("if (from === 'acquisition' || from === 'scanning') {")
    expect(readFileSync('app/api/inbox/connect/callback/route.ts', 'utf8')).toContain("const base = fromScanning ? '/dashboard/leads/acquisition/scanning?' : fromAcquisition ? '/dashboard/leads/acquisition?' : `${SETTINGS}&`")
  })

  it('a reply goes to the last message from outside, in its thread, as a normal email', () => {
    const thread = [
      { id: 'm1', threadId: 't1', messageId: '<a@x>', references: '', fromEmail: 'lucy@ausvenueco.com.au', subject: 'Reels for three venues', at: '2026-09-21T01:00:00.000Z' },
      { id: 'm2', threadId: 't1', messageId: '<b@x>', references: '<a@x>', fromEmail: 'martin@mdmmarketing.com.au', subject: 'Re: Reels for three venues', at: '2026-09-21T02:00:00.000Z' },
    ]
    expect(replyDraft(thread, 'x')).toEqual({ to: 'lucy@ausvenueco.com.au', subject: 'Re: Reels for three venues', threadId: 't1', inReplyTo: '<a@x>', references: '<a@x>' })
    expect(replyDraft([thread[1]], 'x')).toBeNull()
    const raw = Buffer.from(rawEmail({ from: 'hello@mdmmarketing.com.au', to: 'lucy@ausvenueco.com.au', subject: 'Re: Reels', text: 'Hi Lucy', inReplyTo: '<a@x>' }).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    expect(raw).toContain('From: hello@mdmmarketing.com.au\r\nTo: lucy@ausvenueco.com.au\r\nSubject: Re: Reels\r\nIn-Reply-To: <a@x>\r\n')
    expect(raw.endsWith('\r\n\r\nHi Lucy')).toBe(true)
    expect(NOBODY_TO_REPLY_TO).toContain('nobody to reply to')
    expect(MAILBOX_CANNOT_SEND('hello@mdmmarketing.com.au')).toContain('Connect for replies')
  })

  it('the route sends only on POST, only from a mailbox that may, and never without a person', () => {
    const route = readFileSync('app/api/leads/acquisition/scanning/[id]/route.ts', 'utf8')
    expect(route).toContain("const user = await requireRole('scheduler')")
    expect(route).toContain('if (!mailboxCanSend(t.box)) return NextResponse.json({ error: MAILBOX_CANNOT_SEND(t.box.email) }, { status: 409 })')
    expect(route).toContain('const sent = await sendReply(t.box, {')
    expect(route.split('sendReply(').length).toBe(2)
    // the only send in gmail.ts is the reply; the agent still has none
    expect(readFileSync('app/lib/acq-agent.ts', 'utf8')).not.toContain('sendReply(')
    const page = readFileSync('app/dashboard/leads/acquisition/scanning/[id]/ConversationPage.tsx', 'utf8')
    expect(page).toContain('Nothing is ever sent for you — only what you press Send on.')
  })
})

describe('a reply never goes to a machine, and goes where the sender asked', () => {
  it('prefers Reply-To, and refuses newsletters, no-reply addresses and auto-submitted mail', async () => {
    const { replyDraft, replyRefusal } = await import('../app/lib/acq-conversation-core')
    const lucy = { id: 'm1', threadId: 't', messageId: '<a@x>', fromEmail: 'lucy@ausvenueco.com.au', replyTo: 'lucy.b@ausvenueco.com.au', subject: 'Reels', at: '2026-09-21T01:00:00.000Z' }
    expect(replyDraft([lucy], 'x')?.to).toBe('lucy.b@ausvenueco.com.au')
    expect(replyRefusal([lucy])).toBeNull()
    // seen live, 23 Sep 2026: a reply to a Cloudflare newsletter bounced with "550 5.7.1 relaying denied"
    const cf = { id: 'm2', fromEmail: 'em@em1.cloudflare.com', listUnsubscribe: '<https://x/unsub>', subject: 'Connect 2026', at: '2026-09-23T01:00:00.000Z' }
    expect(replyRefusal([cf])).toBe('This came from an automated sender (em@em1.cloudflare.com) — a reply would only bounce. There is nobody at that address.')
    expect(replyRefusal([{ id: 'm3', fromEmail: 'no-reply@vercel.com', subject: 's', at: '2026-09-23T01:00:00.000Z' }])).toContain('automated sender')
    expect(replyRefusal([{ id: 'm4', fromEmail: 'sam@x.com', autoSubmitted: 'auto-replied', subject: 's', at: '2026-09-23T01:00:00.000Z' }])).toContain('automated sender')
    expect(replyRefusal([{ id: 'm5', fromEmail: 'martin@mdmmarketing.com.au', subject: 's', at: '2026-09-23T01:00:00.000Z' }])).toBe('Every message in this thread is ours — there is nobody to reply to.')
    const route = readFileSync('app/api/leads/acquisition/scanning/[id]/route.ts', 'utf8')
    expect(route).toContain('const why = replyRefusal(t.thread)')
    expect(route).toContain('if (why) return NextResponse.json({ error: why }, { status: 409 })')
  })
})

describe('a signature under every reply (the owner, 23 Sep 2026)', () => {
  it('goes under the words in text after the -- line and in html dimmed, and is kept per mailbox from Settings', async () => {
    const { withSignatureText, signatureHtml, cleanSignature, SIGNATURE_MAX } = await import('../app/lib/acq-conversation-core')
    expect(withSignatureText('Hi Lucy,\nthanks.', 'Renee Yap\nMarketing Manager')).toBe('Hi Lucy,\nthanks.\n\n-- \nRenee Yap\nMarketing Manager')
    expect(withSignatureText('Hi', null)).toBe('Hi')
    expect(signatureHtml('Renee Yap\nhttps://www.linkedin.com/company/mdmedia-marketing/ <b>')).toBe('<div class="mdm-signature" style="margin-top:1.5em;color:#666;font-size:13px;line-height:1.5">Renee Yap<br><a href="https://www.linkedin.com/company/mdmedia-marketing/">https://www.linkedin.com/company/mdmedia-marketing/</a> &lt;b&gt;</div>')
    expect(signatureHtml('')).toBe('')
    expect(cleanSignature('  hi \r\n there ')).toBe('hi \n there')
    expect(cleanSignature('')).toBeNull()
    expect(cleanSignature('x'.repeat(SIGNATURE_MAX + 5))?.length).toBe(SIGNATURE_MAX)
    expect(readFileSync('docs/schema-history/inbox_signature.sql', 'utf8')).toContain('alter table scan_mailboxes add column if not exists signature text;')
    const route = readFileSync('app/api/leads/acquisition/scanning/[id]/route.ts', 'utf8')
    expect(route).toContain('text: withSignatureText(text, signature), html: replyHtml(text) + signatureHtml(signature)')
    const settings = readFileSync('app/api/ingest/settings/route.ts', 'utf8')
    expect(settings).toContain("if (typeof body?.mailbox === 'string' && 'signature' in body) {")
    expect(settings).toContain('await setMailboxSignature(body.mailbox, cleanSignature(body.signature), admin.email)')
    expect(readFileSync('app/dashboard/settings/ScannerSettings.tsx', 'utf8')).toContain('Save signature')
    expect(readFileSync('app/dashboard/leads/acquisition/scanning/[id]/ConversationPage.tsx', 'utf8')).toContain('aria-label="Signature">{data.signature}</pre>')
  })
})

describe('the acquisition emails can be paused for a test (the owner, 23 Sep 2026)', () => {
  it('one switch, read by the one place every acquisition email goes through', async () => {
    const { normaliseSettings, DEFAULT_SCAN_SETTINGS } = await import('../app/lib/scan-core')
    expect(DEFAULT_SCAN_SETTINGS.acq_notifications_paused).toBe(false)
    expect(normaliseSettings({ acq_notifications_paused: true }).acq_notifications_paused).toBe(true)
    expect(normaliseSettings({}).acq_notifications_paused).toBe(false)
    const acq = readFileSync('app/lib/acquisition.ts', 'utf8')
    expect(acq).toContain("if ((await getScanSettings().catch(() => null))?.acq_notifications_paused) {")
    expect(acq.match(/notify(/g)?.length ?? 0).toBe(1)
    expect(acq).not.toContain('sendSystemEmail(')
    expect(readFileSync('app/lib/acq-agent.ts', 'utf8')).not.toMatch(/notify(|sendSystemEmail(/)
    expect(readFileSync('app/dashboard/settings/ScannerSettings.tsx', 'utf8')).toContain('Pause acquisition emails')
  })
})

describe('the signature Gmail already has comes first (the owner, 23 Sep 2026: "maybe this")', () => {
  it('reads it with the permission every mailbox already has, and falls back to the typed one', async () => {
    const { pickSignature } = await import('../app/lib/acq-conversation-core')
    const { stripHtml } = await import('../app/lib/gmail-core')
    const g = pickSignature('<div><b>Renee Yap</b><br>Marketing Manager</div>', 'typed', stripHtml)
    expect(g).toEqual({ html: '<div class="mdm-signature" style="margin-top:1.5em"><div><b>Renee Yap</b><br>Marketing Manager</div></div>', text: 'Renee Yap\nMarketing Manager', source: 'gmail' })
    expect(pickSignature('', 'Renee Yap', stripHtml)).toMatchObject({ text: 'Renee Yap', source: 'settings' })
    expect(pickSignature(null, null, stripHtml)).toBeNull()
    const gmail = readFileSync('app/lib/gmail.ts', 'utf8')
    expect(gmail).toContain("gmailGet<{ sendAs?: { sendAsEmail?: string; isPrimary?: boolean; signature?: string }[] }>(mailbox, 'settings/sendAs')")
    // no new scope: sendAs.list is readable with gmail.readonly (Google's reference, read 23 Sep 2026)
    const { INBOX_SCOPES } = await import('../app/lib/inbox-connect')
    expect(INBOX_SCOPES).not.toContain('gmail.settings')
    const route = readFileSync('app/api/leads/acquisition/scanning/[id]/route.ts', 'utf8')
    expect(route).toContain('const [gmail, typed] = await Promise.all([fetchGmailSignature(box), mailboxSignature(box.email).catch(() => null)])')
    expect(route).toContain("text: withSignatureText(text, sig?.text ?? null), html: replyHtml(text) + (sig?.html ?? '')")
  })
})
