import 'server-only'
import { table } from '@/lib/db'
import type { Client, ClientContact } from '@/lib/db-types'
import { notify, renderEmail, escapeHtml, type NotifyResult } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { clientRecipients, pickRecipients, type ClientRecipient } from './client-recipients-core'
import { accountManagerName } from './portal-data'
import { roundOutcomeWords } from './post-notify-core'
import { onePortal, onePortalPath, type PortalTab } from './one-portal-core'
import { loadOnePortal } from './one-portal-page'
import { loadPortalForms } from './one-portal-forms'
import { NO_REPLY_DOMAIN } from './one-portal-send'

/**
 * NOTIFY THE CLIENT (the owner, 2 Oct 2026: "for every page a notify client button with the link … currently we just
 * put it but no notification is sending out"). Putting a card on the portal emails nobody — the client email rule;
 * this is the deliberate press: the client's own addresses, picked by a person, get one email with the link to THAT
 * page of their one portal. The page must be one the client can open right now (checked against the portal itself),
 * so nobody is ever sent a link to a 404. From MD Media's no-reply address, like Send the preview.
 */

export type NotifyTab = Extract<PortalTab, 'editing' | 'designing' | 'shoot' | 'boards' | 'forms'>
export const NOTIFY_TABS: readonly NotifyTab[] = ['editing', 'designing', 'shoot', 'boards', 'forms']

/** what the email says, by the page it points at */
export function notifyWords(tab: NotifyTab, title: string, clientName: string): { subject: string; heading: string; line: string; cta: string } {
  switch (tab) {
    case 'editing': return { subject: `Ready for your review: ${title}`, heading: 'Your edit is ready', line: `"${title}" is on your portal. Watch each video, approve the ones you are happy with, and tell us what to change on the rest.`, cta: 'Review the videos' }
    case 'designing': return { subject: `Ready for your review: ${title}`, heading: 'Your designs are ready', line: `"${title}" is on your portal. Approve each design, or tell us what to change.`, cta: 'Review the designs' }
    case 'shoot': return { subject: `Your shoot plan: ${title}`, heading: 'Your shoot plan', line: `The plan for "${title}" is on your portal. Have a look, approve it, or ask for a change.`, cta: 'Open the plan' }
    case 'boards': return { subject: `A board for you: ${title}`, heading: 'A board from MD Media', line: `"${title}" is on your portal. Leave a comment on any card.`, cta: 'Open the board' }
    case 'forms': return { subject: `A few questions for you: ${title}`, heading: 'A few questions for you', line: `"${title}" is on your portal — fill it in when you have a moment; it saves as you go.`, cta: 'Open the form' }
  }
  return { subject: `An update from MD Media for ${clientName}`, heading: 'An update', line: '', cta: 'Open your portal' }
}

/** the page's own address on the one portal — a form opens by its own parameter */
export function notifyPath(token: string, tab: NotifyTab, id: string): string {
  return tab === 'forms' ? `${onePortalPath(token, 'forms')}&form=${encodeURIComponent(id)}` : onePortalPath(token, tab, id)
}

type Loaded = { ok: true; client: Client; recipients: ClientRecipient[]; title: string; link: string } | { ok: false; status: number; error: string }

/** the client, who may be emailed, and the page — only if the client can open it on their portal now */
export async function loadNotify(clientId: string, tab: unknown, id: unknown): Promise<Loaded> {
  if (!NOTIFY_TABS.includes(tab as NotifyTab)) return { ok: false, status: 400, error: 'That is not a page of the portal' }
  const pageId = String(id ?? '')
  if (!pageId) return { ok: false, status: 400, error: 'Which page? Nothing was named' }
  const [client, contacts] = await Promise.all([
    table<Client>('clients').get(clientId).catch(() => null),
    table<ClientContact>('client_contacts').list({ by: { client_id: clientId } }).catch(() => [] as ClientContact[]),
  ])
  if (!client) return { ok: false, status: 404, error: 'This client was not found' }
  const token = typeof client.share_token === 'string' ? client.share_token.trim() : ''
  if (!token) return { ok: false, status: 409, error: 'This client has no portal link yet — make one on the client first' }
  if (!onePortal(client)) return { ok: false, status: 409, error: 'This client is not on the one portal yet' }
  const page = await loadOnePortal(token)
  if (!page) return { ok: false, status: 409, error: 'The client’s portal could not be read — try again' }
  const t = tab as NotifyTab
  let title: string | null = null
  if (t === 'editing') title = page.editing.find(c => c.id === pageId)?.title ?? null
  if (t === 'designing') title = page.designing.find(c => c.id === pageId)?.title ?? null
  if (t === 'shoot') title = page.shoots.find(c => c.id === pageId)?.title ?? null
  if (t === 'boards') title = page.boards.find(b => b.id === pageId)?.name ?? null
  if (t === 'forms') title = (await loadPortalForms(client.id, page.scope, client.timezone || 'Australia/Melbourne')).find(f => f.id === pageId && f.kind !== 'proposal')?.title ?? null
  if (!title) return { ok: false, status: 409, error: 'This is not on the client’s portal yet — they could not open it. Put it there first.' }
  return { ok: true, client, recipients: clientRecipients(client, contacts), title, link: `${DASHBOARD_URL}${notifyPath(token, t, pageId)}` }
}

export async function sendNotify(input: { clientId: string; tab: unknown; id: unknown; emails: unknown; note?: string | null; pressedBy: { id: string; name?: string | null } }): Promise<
  { ok: true; delivered: string[]; message: string; link: string } | { ok: false; status: number; error: string }
> {
  const page = await loadNotify(input.clientId, input.tab, input.id)
  if (!page.ok) return page
  const picked = pickRecipients(input.emails, page.recipients)
  if (!picked.ok) return { ok: false, status: 400, error: picked.error }
  if (picked.emails.length === 0) return { ok: false, status: 400, error: 'Tick at least one person to email' }
  const words = notifyWords(input.tab as NotifyTab, page.title, page.client.name)
  const am = await accountManagerName(page.client.id).catch(() => null)
  const note = String(input.note ?? '').trim().slice(0, 1000)
  const stamp = new Date().toISOString()
  const results: { email: string; result: NotifyResult | 'failed' }[] = []
  for (const email of picked.emails) {
    const who = page.recipients.find(r => r.email === email)
    const hello = who && who.name !== email ? who.name.split(' ')[0] : page.client.name
    const body = [
      `<p>Hi ${escapeHtml(hello)},</p>`,
      `<p>${escapeHtml(words.line)}</p>`,
      ...(note ? [`<p>${escapeHtml(note)}</p>`] : []),
      `<p style="color:#71717a">This email comes from a no-reply address — answer on your portal${am ? `, or ask ${escapeHtml(am)}, your account manager` : ''}.</p>`,
    ].join('')
    const result = await notify({
      eventType: `one_portal_notify_${String(input.tab)}`,
      entityType: 'client',
      // a press may be repeated (a new stamp) — each is its own email
      entityId: `${page.client.id}#notify#${String(input.id)}#${stamp}`,
      recipientEmail: email,
      toClient: true,
      deliberateClientSend: true,
      actorName: 'MD Media',
      actorEmail: null,
      replyTo: `no-reply@${NO_REPLY_DOMAIN()}`,
      subject: words.subject,
      bodyHtml: renderEmail(escapeHtml(words.heading), body, words.cta, page.link),
      clientId: page.client.id,
    }).catch(() => 'failed' as const)
    results.push({ email, result })
  }
  const delivered = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)
  return { ok: true, delivered, message: roundOutcomeWords(results as never), link: page.link }
}
