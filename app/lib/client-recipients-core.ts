/**
 * WHO A CLIENT SEND MAY GO TO — pure, no I/O, so the server that sends and
 * every page that asks "who gets it" read the same list and the same rule.
 *
 * The server (post-stage, post-notify, the edit's send-to-client route)
 * accepts only addresses on this list — never one typed into the request —
 * and the pages (Post approval's dialogs, the post window) draw and tick from
 * it. One copy, so the page can never offer an address the server refuses.
 */

/** One address a client send may go to: the business's own, then its people. */
export type ClientRecipient = {
  email: string
  name: string
  /** "The business", the contact's role, or "Main contact" / "Contact" */
  label: string
  /** a contact marked primary on the client */
  primary: boolean
  /** the client's own business address (clients.email), not a person on it */
  business: boolean
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/

/** A real address, trimmed and lower-cased — or null. The one check, on the server and the page alike. */
export function cleanEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  return EMAIL.test(e) ? e : null
}

const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** Every address this client can be sent to: the business's own, then its people — each once, primary first. */
export function clientRecipients(
  client: { name?: string | null; email?: string | null } | null | undefined,
  contacts: readonly { name?: string | null; email?: string | null; role?: string | null; is_primary?: boolean | null }[],
): ClientRecipient[] {
  const out: ClientRecipient[] = []
  const seen = new Set<string>()
  const add = (r: ClientRecipient) => { if (!seen.has(r.email)) { seen.add(r.email); out.push(r) } }
  const own = cleanEmail(client?.email)
  if (own) add({ email: own, name: String(client?.name ?? '').trim() || own, label: 'The business', primary: false, business: true })
  for (const c of [...contacts].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))) {
    const e = cleanEmail(c.email)
    if (!e) continue
    add({
      email: e, name: String(c.name ?? '').trim() || e,
      label: String(c.role ?? '').trim() || (c.is_primary ? 'Main contact' : 'Contact'),
      primary: !!c.is_primary, business: false,
    })
  }
  return out
}

/**
 * WHO IS TICKED WHEN A SEND OPENS — one rule for Post approval and the post
 * window: the primary contact(s); with nobody primary, the client's own
 * business address; with no business address, the first on the list.
 */
export function defaultRecipients(list: readonly ClientRecipient[]): string[] {
  const primary = list.filter(r => r.primary).map(r => r.email)
  if (primary.length > 0) return primary
  const business = list.find(r => r.business)
  if (business) return [business.email]
  return list.slice(0, 1).map(r => r.email)
}

/** Only addresses on the client's own list — never one typed into the request. */
export function pickRecipients(requested: unknown, allowed: readonly ClientRecipient[]): { ok: true; emails: string[] } | { ok: false; error: string } {
  if (allowed.length === 0) return { ok: false, error: 'This client has no email address yet. Add one on the client first.' }
  const picked = [...new Set((Array.isArray(requested) ? requested : []).map(cleanEmail).filter((e): e is string => !!e))]
  const known = new Set(allowed.map(r => r.email))
  const strangers = picked.filter(e => !known.has(e))
  if (strangers.length > 0) return { ok: false, error: `${joinNames(strangers)} ${strangers.length === 1 ? 'is' : 'are'} not on this client. Add them as a contact on the client first.` }
  if (picked.length === 0) return { ok: false, error: 'Tick at least one person to send it to.' }
  if (picked.length > 20) return { ok: false, error: 'That is a lot of people. Send it to 20 at most.' }
  return { ok: true, emails: picked }
}
