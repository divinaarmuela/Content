/**
 * SEND A POST TO THE CLIENT FOR APPROVAL — the pure half (the owner, 28 Sep 2026: "for post approval, a feature for
 * super admin or AM to send the posts that need approving to the client: an action Send to client which lists the
 * emails and sends the link to them, for them to view it and approve").
 *
 * Until now "Send to client" only raised a flag the portal reads; nobody told the client, so a post could wait for
 * an answer nobody knew was asked for (Justin Engelke's post, 24 Sep 2026). The client is still never emailed
 * AUTOMATICALLY (the owner, 13 Sep 2026: "never send any email to the client"): this is a person choosing the
 * addresses and pressing Send.
 */

export type ClientRecipient = { email: string; name: string; label: string; primary: boolean }

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/

export function cleanEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  return EMAIL.test(e) ? e : null
}

/** every address this client can be sent to: the client's own, then its people — each once, primary first */
export function clientRecipients(
  client: { name?: string | null; email?: string | null } | null | undefined,
  contacts: readonly { name?: string | null; email?: string | null; role?: string | null; is_primary?: boolean | null }[],
): ClientRecipient[] {
  const out: ClientRecipient[] = []
  const seen = new Set<string>()
  const add = (r: ClientRecipient) => { if (!seen.has(r.email)) { seen.add(r.email); out.push(r) } }
  const own = cleanEmail(client?.email)
  if (own) add({ email: own, name: String(client?.name ?? '').trim() || own, label: 'The business', primary: true })
  const people = [...contacts].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))
  for (const c of people) {
    const e = cleanEmail(c.email)
    if (!e) continue
    const name = String(c.name ?? '').trim() || e
    add({ email: e, name, label: String(c.role ?? '').trim() || (c.is_primary ? 'Main contact' : 'Contact'), primary: !!c.is_primary })
  }
  return out
}

/** what may be sent: only addresses on the client's own list — never an address typed into the request */
export function pickRecipients(requested: unknown, allowed: readonly ClientRecipient[]): { ok: true; emails: string[] } | { ok: false; error: string } {
  if (allowed.length === 0) return { ok: false, error: 'This client has no email address yet — add one on the client first' }
  const list = Array.isArray(requested) ? requested : []
  const known = new Map(allowed.map(r => [r.email, r]))
  const picked = [...new Set(list.map(cleanEmail).filter((e): e is string => !!e))]
  const strangers = picked.filter(e => !known.has(e))
  if (strangers.length > 0) return { ok: false, error: `${strangers.join(', ')} ${strangers.length === 1 ? 'is' : 'are'} not on this client — add them as a contact on the client first` }
  if (picked.length === 0) return { ok: false, error: allowed.length === 0 ? 'This client has no email address yet — add one on the client first' : 'Tick at least one person to send it to' }
  if (picked.length > 20) return { ok: false, error: 'That is a lot of people — send it to 20 at most' }
  return { ok: true, emails: picked }
}

/** the page the client approves on: just this post — its pictures or clips, the caption, Approve or Ask for a change */
export function itemApprovalLink(base: string, shareToken: string, itemId: string): string {
  return `${base.replace(/\/+$/, '')}/portal/${encodeURIComponent(shareToken)}/approve/${encodeURIComponent(itemId)}`
}

/** only a card that is WITH THE CLIENT is sent to them — the Post approval column "With client" */
export const SENDABLE_STATUS = 'client_review'

/** one send per post, per address, per press — the stamp is the press */
export function sendKey(itemId: string, email: string, stamp: string): string {
  return `${itemId}#post-to-client#${email}#${stamp}`
}

/** what the person who pressed Send is told, from what actually happened to each address */
export function sendOutcomeWords(results: readonly { email: string; result: string }[]): string {
  const sent = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)
  const failed = results.filter(r => r.result !== 'sent' && r.result !== 'duplicate').map(r => r.email)
  if (sent.length === 0) return `Nothing was sent — ${failed.join(', ')} could not be emailed. Try again, or send them the link yourself.`
  return `Emailed ${sent.join(', ')} the link to view and approve it.`
    + (failed.length ? ` Could not email ${failed.join(', ')} — send them the link yourself.` : '')
}

/**
 * WHAT IS BEING SENT (the owner, 28 Sep 2026: "now we need to do the send for approval — send to actual clients").
 * Two moments ask the client: the CARD at With client (the edit itself), and the FINAL POST once the edit is
 * approved and a post is waiting on sign-off (its pictures, caption and time). Anything else is not theirs to answer.
 */
export type SendStage = 'card' | 'post' | null
export function sendStage(item: { status?: unknown; posting_approval_state?: unknown }): SendStage {
  const status = String(item.status ?? '')
  if (status === SENDABLE_STATUS) return 'card'
  if (['approved_for_scheduling', 'scheduled'].includes(status) && String(item.posting_approval_state ?? '') === 'pending') return 'post'
  return null
}

/**
 * WHAT WAS ALREADY SENT (the owner, 28 Sep 2026: "since it sent, the post should show emailed to client with a tick —
 * why is it a Send button again"). The send stamps the card; the button then says who was emailed and when, and a
 * second send is a deliberate "Send again". A new round (the card sent back and handed in again, or the post edited
 * and sent for approval again) clears the stamp — see `sentStampFor`.
 */
export type SentStamp = { at: string; to: string[]; stage: 'card' | 'post' }

export function readSentStamp(item: { client_sent?: unknown } | null | undefined): SentStamp | null {
  const v = item?.client_sent as Partial<SentStamp> | undefined
  if (!v || typeof v.at !== 'string' || !Array.isArray(v.to) || v.to.length === 0) return null
  return { at: v.at, to: v.to.map(String), stage: v.stage === 'post' ? 'post' : 'card' }
}

/** the stamp counts only for the moment it was sent in: a card stamp is stale once the card is a post, and the other way */
export function sentForStage(item: { client_sent?: unknown; status?: unknown; posting_approval_state?: unknown }): SentStamp | null {
  const s = readSentStamp(item)
  const stage = sendStage(item)
  return s && stage && s.stage === stage ? s : null
}

export function sentWords(s: SentStamp, tz = 'Australia/Melbourne'): string {
  const when = new Date(s.at).toLocaleString('en-AU', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return `Emailed to ${s.to.join(', ')} · ${when}`
}


/**
 * WHO A POST IS WAITING ON (the owner, 28 Sep 2026: the Schedule List said only "Waiting for approval"). The client,
 * once it has been put to them — with when it was emailed — or the team, while it is an internal sign-off.
 */
export function waitingOnWords(
  item: { posting_client_required?: unknown; client_sent?: unknown; status?: unknown; posting_approval_state?: unknown },
  clientName: string | null | undefined,
  tz = 'Australia/Melbourne',
): string {
  const name = String(clientName ?? '').trim() || 'the client'
  if (item.posting_client_required !== true) return 'Waiting on the team'
  const sent = sentForStage(item as never)
  if (!sent) return `Waiting on ${name} · not emailed yet`
  const when = new Date(sent.at).toLocaleString('en-AU', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return `Waiting on ${name} · emailed ${when}`
}
