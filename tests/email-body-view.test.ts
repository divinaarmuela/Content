import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  EMAIL_FRAME_CSS, QUOTE_SELECTORS, bodyView, emailFrameDocument, linkLabel, replyHtml, splitQuoted, tokenise, unwrapParagraphs,
} from '../app/lib/acq-conversation-core'
import { rawEmail } from '../app/lib/gmail'

/**
 * AN EMAIL DRAWN LIKE A MAIL CLIENT DRAWS IT (the owner, 23 Sep 2026: "the
 * lines when replying doesnt layout nicely", "there are links a lot of flaw
 * in the design"; research: Close.com, AdGuard, GitHub's email_reply_parser).
 */
describe('a plain-text email, laid out', () => {
  it('unwraps hard-wrapped lines into paragraphs but keeps short lines, lists and stops', () => {
    const wrapped = 'Hi Martin, I watched the Beauty Blvd rebrand and honestly that complexity is\nwhere most agencies drop the ball.\n\nCheers,\nSankhaja\n\n- one\n- two'
    expect(unwrapParagraphs(wrapped)).toEqual([
      'Hi Martin, I watched the Beauty Blvd rebrand and honestly that complexity is where most agencies drop the ball.',
      'Cheers,\nSankhaja',
      '- one\n- two',
    ])
  })

  it('folds the quoted history away, by "On … wrote:" or a run of > lines', () => {
    expect(splitQuoted('Thanks, sounds good.\n\nOn Mon, 21 Sep 2026 at 11:00, Lucy <lucy@x.com> wrote:\n> earlier\n> words')).toEqual({ own: 'Thanks, sounds good.', quoted: 'On Mon, 21 Sep 2026 at 11:00, Lucy <lucy@x.com> wrote:\n> earlier\n> words' })
    expect(splitQuoted('Just this.')).toEqual({ own: 'Just this.', quoted: null })
    expect(splitQuoted('Reply\n\n> a\n> b\n> c').quoted).toBe('> a\n> b\n> c')
  })

  it('makes links clickable with a short label, in every shape they arrive', () => {
    expect(linkLabel('https://www.loom.com/share/abc123')).toBe('loom.com/share')
    expect(linkLabel('https://calendly.com/')).toBe('calendly.com')
    expect(tokenise('Watch it here <https://www.loom.com/share/abc> today')).toEqual([
      { kind: 'link', href: 'https://www.loom.com/share/abc', label: 'Watch it here' }, { kind: 'text', text: ' today' },
    ])
    expect(tokenise('see https://calendly.com/x/15min.')).toEqual([
      { kind: 'text', text: 'see ' }, { kind: 'link', href: 'https://calendly.com/x/15min', label: 'calendly.com/x' }, { kind: 'text', text: '.' },
    ])
    expect(tokenise('[Book a call](https://calendly.com/x)')).toEqual([{ kind: 'link', href: 'https://calendly.com/x', label: 'Book a call' }])
    expect(tokenise('no links here')).toEqual([{ kind: 'text', text: 'no links here' }])
    const v = bodyView('Hey <https://a.com/b>\n\nOn Mon, 21 Sep 2026, Lucy wrote:\n> q')
    expect(v.paragraphs[0][0]).toEqual({ kind: 'link', href: 'https://a.com/b', label: 'Hey' })
    expect(v.quoted).toBe('On Mon, 21 Sep 2026, Lucy wrote:\n> q')
  })
})

describe('an HTML email, drawn safely', () => {
  it('names every mail client’s quote marker and a frame that runs no script', () => {
    expect(QUOTE_SELECTORS).toContain('.gmail_quote')
    expect(QUOTE_SELECTORS).toContain('blockquote[type="cite"]')
    expect(QUOTE_SELECTORS).toContain('#divRplyFwdMsg')
    const doc = emailFrameDocument('<p>hi</p>')
    expect(doc).toContain("script-src 'none'")
    expect(doc).toContain('<base target="_blank">')
    expect(doc).toContain(EMAIL_FRAME_CSS)
    expect(doc.endsWith('<body><p>hi</p></body></html>')).toBe(true)
    const body = readFileSync('app/dashboard/leads/acquisition/scanning/[id]/EmailBody.tsx', 'utf8')
    expect(body).toContain('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"')
    expect(body).not.toContain('allow-scripts')
    expect(body).toContain('Show earlier messages')
    const client = readFileSync('app/lib/email-html-client.ts', 'utf8')
    expect(client).toContain("const FORBID_TAGS = ['script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'audio', 'video', 'svg', 'math']")
    expect(client).toContain("node.setAttribute('data-blocked-src', data.attrValue)")
  })

  it('a reply goes as text and html so its paragraphs hold everywhere', () => {
    expect(replyHtml('Hi Lucy,\nthanks.\n\nSee https://calendly.com/x <b>')).toBe('<p style="margin:0 0 1em">Hi Lucy,<br>thanks.</p><p style="margin:0 0 1em">See <a href="https://calendly.com/x">https://calendly.com/x</a> &lt;b&gt;</p>')
    const raw = Buffer.from(rawEmail({ from: 'a@x', to: 'b@y', subject: 's', text: 'Hi', html: '<p>Hi</p>' }).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="=_mdm_')
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\nHi\r\n')
    expect(raw).toContain('Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n<p>Hi</p>\r\n')
    expect(readFileSync('app/api/leads/acquisition/scanning/[id]/route.ts', 'utf8')).toContain('html: replyHtml(text)')
  })
})

describe('a signature’s own images, and no broken image ever (research, 23 Sep 2026)', () => {
  it('lists the message’s inline images by Content-ID and puts them into the html; an unresolved one is removed whole', async () => {
    const { inlineImageParts, inlineCidImages, dataUrlFromBase64Url } = await import('../app/lib/gmail-core')
    const payload = { mimeType: 'multipart/related', parts: [
      { mimeType: 'text/html', body: { data: 'x' } },
      { mimeType: 'image/png', filename: 'fb.png', headers: [{ name: 'Content-ID', value: '<ii_fb@x>' }], body: { attachmentId: 'att1', size: 900 } },
      { mimeType: 'image/png', filename: 'li.png', headers: [{ name: 'X-Attachment-Id', value: 'ii_li' }], body: { data: 'AAA_-', size: 5 } },
      { mimeType: 'application/pdf', headers: [{ name: 'Content-ID', value: '<doc@x>' }], body: { attachmentId: 'att2', size: 1 } },
    ] }
    expect(inlineImageParts(payload)).toEqual([
      { cid: 'ii_fb@x', mimeType: 'image/png', attachmentId: 'att1', data: null, size: 900 },
      { cid: 'ii_li', mimeType: 'image/png', attachmentId: null, data: 'AAA_-', size: 5 },
    ])
    expect(dataUrlFromBase64Url('image/png', 'AAA_-')).toBe('data:image/png;base64,AAA/+')
    const html = '<p>hi</p><img src="cid:ii_fb@x" alt="https://facebook.com/x"><img src="cid:missing" alt="gone"><img src="https://a.com/b.png">'
    expect(inlineCidImages(html, new Map([['ii_fb@x', 'data:image/png;base64,AAA']]))).toBe('<p>hi</p><img src="data:image/png;base64,AAA" alt="https://facebook.com/x"><img src="https://a.com/b.png">')
    expect(readFileSync('app/lib/gmail.ts', 'utf8')).toContain('data = (await gmailGet<{ data?: string }>(mailbox, `messages/${messageId}/attachments/${part.attachmentId}`)).data ?? null')
  })
  it('the plain-text signature is split at the -- line and drawn dimmed; the frame keeps signature images small and hides an empty one', async () => {
    const { splitSignature, bodyView, EMAIL_FRAME_CSS, SIGNATURE_SELECTORS } = await import('../app/lib/acq-conversation-core')
    expect(splitSignature('Thanks\n-- \nRenee Yap\nMarketing Manager')).toEqual({ own: 'Thanks', signature: 'Renee Yap\nMarketing Manager' })
    expect(splitSignature('No sig')).toEqual({ own: 'No sig', signature: null })
    expect(bodyView('Thanks\n--\nRenee').signature).toBe('Renee')
    expect(EMAIL_FRAME_CSS).toContain('.mdm-signature img { max-width: 200px !important; max-height: 80px; width: auto; }')
    expect(EMAIL_FRAME_CSS).toContain('img[src=""], img:not([src]) { display: none; }')
    expect(SIGNATURE_SELECTORS).toContain('.gmail_signature')
    const client = readFileSync('app/lib/email-html-client.ts', 'utf8')
    expect(client).toContain('export function dropEmptyImages(html: string): string')
    expect(client).toContain("const ownClean = dropEmptyImages(ownSafe)")
    expect(readFileSync('app/dashboard/leads/acquisition/scanning/[id]/EmailBody.tsx', 'utf8')).toContain('{plain.signature && <pre')
  })
})
