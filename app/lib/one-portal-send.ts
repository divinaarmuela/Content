import 'server-only'
import { table } from '@/lib/db'
import type { Client, ClientContact, ContentItem, SocialPost, TeamUserClient } from '@/lib/db-types'
import { attachOne } from '@/lib/db-join'
import { notify, renderEmail, escapeHtml, type NotifyResult } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { formatWithZone, safeZone } from './timezone-core'
import { clientRecipients, pickRecipients } from './client-recipients-core'
import { accountManagerName } from './portal-data'
import { roundOutcomeWords } from './post-notify-core'
import { readPostState, type PostState } from './post-stage-core'
import { onePortal, onePortalPath, readClientReview, reminderDue } from './one-portal-core'

/**
 * SEND THE PREVIEW (docs/ONE_PORTAL_SPEC.md R12) — the email that tells the client to look at their Scheduling
 * tab: one link, the booked posts not yet answered listed by time. Every booked post is ALWAYS on the tab
 * (R10); this is the nudge, and it marks those posts as asked (`review_asked`), which is what the reminder
 * and the "Not reviewed yet" words read. Also the client REMINDER (R6), worded as one.
 *
 * Deliberate client sends only (the mailer mutes every other client email), to the client's own portal
 * recipients; a test client's email reaches test addresses only (the mailer's guard).
 */

export type PreviewResult =
  | { ok: true; delivered: string[]; asked: number; link: string; message: string }
  | { ok: false; status: number; error: string }

const whenIn = (iso: string | null | undefined, tz: string) => (iso ? formatWithZone(iso, safeZone(tz), 'full') : null)

/** The booked posts the preview is about: booked, and the client has not answered this version. */
export function unansweredBooked(posts: readonly PostState[]): PostState[] {
  return posts
    .filter(p => p.stage === 'booked' && p.sent_version != null)
    .filter(p => { const r = readClientReview(p.client_review); return !r || r.version < (p.sent_version ?? 0) })
    .sort((a, b) => String(a.scheduled_for ?? '').localeCompare(String(b.scheduled_for ?? '')))
}

/** NO-REPLY (the owner, 2 Oct 2026: "send it as no reply"): the portal's emails come from MD Media's no-reply
 *  address; the client answers on their portal, and questions go to their account manager. */
export const NO_REPLY_DOMAIN = () => (process.env.NOTIFY_FROM_DOMAIN ?? 'mdmmarketing.com.au').toLowerCase()

export function previewEmail(input: {
  clientName: string; hello: string; amName?: string | null
  posts: readonly { title: string; when: string | null }[]
  note?: string | null; reminder?: boolean
}): { subject: string; heading: string; lines: string[]; cta: string } {
  const n = input.posts.length
  const subject = input.reminder
    ? `Reminder: ${n === 1 ? 'a post goes out soon' : `${n} posts go out soon`} — have a look`
    : n === 0 ? `Your posting schedule, ${input.clientName}` : `Your next ${n === 1 ? 'post is' : `${n} posts are`} scheduled — have a look`
  const lines = [
    `Hi ${input.hello},`,
    input.reminder
      ? `${n === 1 ? 'This post goes' : 'These posts go'} out soon and ${n === 1 ? 'has' : 'have'} not been looked at yet:`
      : n === 0 ? 'Your posting schedule is up to date on your portal.' : `${n === 1 ? 'Your next post is' : `Your next ${n} posts are`} scheduled. You can see ${n === 1 ? 'it' : 'them'} exactly as ${n === 1 ? 'it' : 'they'} will look:`,
    ...input.posts.slice(0, 12).map(p => `• ${p.title}${p.when ? ` — ${p.when}` : ''}`),
    ...(n > 12 ? [`…and ${n - 12} more on your portal.`] : []),
    ...(input.note?.trim() ? [input.note.trim()] : []),
    'Approve each one, or tell us what to change — anything you say is not approved comes off the schedule straight away. Posts go out at their time unless you say otherwise.',
    `Please don't reply to this email — it is not read. Answer or comment on your portal${input.amName ? `, and for anything else contact ${input.amName}, your account manager` : ''}.`,
    '— MD Media',
  ]
  return { subject, heading: input.reminder ? 'A reminder from MD Media' : 'Your scheduled posts', lines, cta: 'See my scheduled posts' }
}

export async function sendSchedulingPreview(input: {
  clientId: string
  emails: unknown
  pressedBy: { id: string; name?: string | null; email: string }
  note?: string | null
  /** the reminder sweep: worded as a reminder, these posts only */
  reminder?: { post_ids: string[] }
  now?: Date
}): Promise<PreviewResult> {
  const now = input.now ?? new Date()
  const [client, contacts, rows, items] = await Promise.all([
    table<Client>('clients').get(input.clientId).catch(() => null),
    table<ClientContact>('client_contacts').list({ by: { client_id: input.clientId } }).catch(() => [] as ClientContact[]),
    table<SocialPost>('social_posts').list({ where: r => r.client_id === input.clientId && r.stage === 'booked' }),
    table<ContentItem>('content_items').list({ where: r => r.client_id === input.clientId }).catch(() => [] as ContentItem[]),
  ])
  if (!client) return { ok: false, status: 404, error: 'This client was not found.' }
  if (!onePortal(client)) return { ok: false, status: 409, error: 'This client is not on the one portal yet.' }
  const token = typeof client.share_token === 'string' ? client.share_token.trim() : ''
  if (!token) return { ok: false, status: 409, error: 'This client has no portal link yet. Make one on the client first.' }

  const tz = client.timezone || 'Australia/Melbourne'
  const all = rows.map(r => readPostState(r as unknown as Record<string, unknown>)).filter((p): p is PostState => !!p)
  const posts = input.reminder ? all.filter(p => input.reminder!.post_ids.includes(p.id)) : unansweredBooked(all)
  const titleOf = (p: PostState) => String(items.find(i => i.id === p.source_item_id)?.title ?? '').trim() || p.caption.split('\n')[0].slice(0, 60) || 'A post'

  const allowed = clientRecipients(client, contacts)
  const picked = input.reminder ? { ok: true as const, emails: allowed.map(r => r.email) } : pickRecipients(input.emails, allowed)
  if (!picked.ok) return { ok: false, status: 400, error: picked.error }
  if (picked.emails.length === 0) return { ok: false, status: 409, error: 'This client has nobody to send to — add a contact on the client\'s page first.' }

  const amName = await accountManagerName(client.id).catch(() => null)
  const link = `${DASHBOARD_URL}${onePortalPath(token, 'scheduling')}`
  const stamp = now.toISOString()
  const results: { email: string; result: NotifyResult | 'failed' }[] = []
  for (const email of picked.emails) {
    const who = allowed.find(r => r.email === email)
    const hello = who && who.name !== email ? who.name.split(' ')[0] : client.name
    const mail = previewEmail({
      clientName: client.name, hello, amName, note: input.note, reminder: !!input.reminder,
      posts: posts.map(p => ({ title: titleOf(p), when: whenIn(p.scheduled_for, tz) })),
    })
    const result = await notify({
      eventType: input.reminder ? 'one_portal_reminder' : 'one_portal_preview',
      entityType: 'client',
      // a reminder once per post and version; a preview may be pressed again (a new stamp)
      entityId: input.reminder
        ? `${client.id}#reminder#${posts.map(p => `${p.id}v${p.sent_version}`).sort().join(',')}`
        : `${client.id}#preview#${stamp}`,
      recipientEmail: email,
      toClient: true,
      deliberateClientSend: true,
      // from MD Media's no-reply address, replies going nowhere — the portal is where they answer
      actorName: 'MD Media',
      actorEmail: null,
      replyTo: `no-reply@${NO_REPLY_DOMAIN()}`,
      subject: mail.subject,
      bodyHtml: renderEmail(escapeHtml(mail.heading), mail.lines.map(l => `<p>${escapeHtml(l)}</p>`).join(''), mail.cta, link),
    }).catch(() => 'failed' as const)
    results.push({ email, result })
  }
  const delivered = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)

  // the posts the client was asked about — only once something reached them (a failed email asks nobody)
  let asked = 0
  if (delivered.length > 0 && !input.reminder) {
    for (const p of posts) {
      const r = await table<SocialPost>('social_posts').claim(p.id, cur => {
        const c = readPostState(cur as unknown as Record<string, unknown> | null)
        if (!cur || !c || c.stage !== 'booked' || c.sent_version !== p.sent_version) return null
        return { ...cur, review_asked: { version: c.sent_version, at: stamp, by: input.pressedBy.id }, updated_at: stamp } as SocialPost
      }).catch(() => ({ claimed: false }))
      if (r.claimed) asked += 1
    }
  }
  return { ok: true, delivered, asked, link, message: roundOutcomeWords(results as never) }
}

/**
 * THE REMINDER GOES TO THE TEAM, NOT THE CLIENT (the owner, 2 Oct 2026: "make sure nothing [is] sent to client in
 * email now until we click send to client — all will be in [the] portal"). R6 used to email the client on its own
 * 24 h out; nothing reaches a client now unless a person presses Send the preview. So each booked post the client
 * was asked about and has not answered tells the client's account managers, once per post and version, and they
 * decide whether to press Send the preview again. The post itself still goes out (Post anyway) or comes off
 * (Wait for the client) exactly as before.
 */
export async function sendOnePortalReminders(now = new Date()): Promise<{ sent: number }> {
  const clients = await table<Client>('clients').list({ where: c => onePortal(c) })
  let sent = 0
  for (const c of clients) {
    const rows = await table<SocialPost>('social_posts').list({ where: r => r.client_id === c.id && r.stage === 'booked' })
    const due = rows.map(r => readPostState(r as unknown as Record<string, unknown>))
      .filter((p): p is PostState => !!p && reminderDue(p as never, now.getTime()))
    if (due.length === 0) continue
    const managers = await clientManagers(c.id).catch(() => [] as { id: string; email: string }[])
    if (managers.length === 0) continue
    const items = await table<ContentItem>('content_items').list({ where: r => r.client_id === c.id }).catch(() => [] as ContentItem[])
    const tz = c.timezone || 'Australia/Melbourne'
    const words = due.map(p => {
      const title = String(items.find(i => i.id === p.source_item_id)?.title ?? '').trim() || p.caption.split('\n')[0].slice(0, 60) || 'A post'
      return `${title} — ${whenIn(p.scheduled_for, tz) ?? 'no time set'}`
    })
    const subject = `${c.name} has not answered ${due.length === 1 ? 'a booked post' : `${due.length} booked posts`}`
    const link = `${DASHBOARD_URL}/dashboard/social/schedule?clientId=${encodeURIComponent(c.id)}`
    for (const m of managers) {
      const r = await notify({
        eventType: 'one_portal_unanswered',
        entityType: 'client',
        // once per post and version — the same unanswered post is not told twice
        entityId: `${c.id}#unanswered#${due.map(p => `${p.id}v${p.sent_version}`).sort().join(',')}`,
        recipientId: m.id,
        recipientEmail: m.email,
        clientId: c.id,
        subject,
        bodyHtml: renderEmail(escapeHtml(subject),
          `<p>${escapeHtml(c.name)} was sent the preview and has not answered yet:</p>`
          + `<ul>${words.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
          + '<p>Nothing has been emailed to the client. If you want to remind them, press <strong>Send the preview</strong> on the schedule.</p>',
          'Open the schedule', link),
      }).catch(() => 'failed' as const)
      if (r === 'sent') sent += 1
    }
  }
  return { sent }
}

/** The client's account managers (super admins assigned to the client count), active, with an email. */
async function clientManagers(clientId: string): Promise<{ id: string; email: string }[]> {
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } })
  const joined = await attachOne(links, 'team_user_id', 'team_users', ['id', 'email', 'role', 'active_status'])
  return joined
    .map(r => r.team_users as unknown as { id: string; email: string; role: string; active_status: boolean } | null)
    .filter((u): u is { id: string; email: string; role: string; active_status: boolean } =>
      !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status && !!u.email)
    .map(u => ({ id: u.id, email: u.email }))
}
