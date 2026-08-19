/**
 * Pure sender-identity helpers — no I/O, unit-tested.
 *
 * Every workflow email is transported through the one authenticated Gmail
 * account (hello@), because that is the only address Gmail will actually put
 * on the wire: SMTP rewrites any other From address, and DMARC would junk a
 * forged one anyway (half the team is on personal Gmail, which we could never
 * legitimately send as). What Gmail DOES honour is the display name and
 * Reply-To — so a notification reads as coming from the person who acted, and
 * replying opens a draft to that person, not to the shared inbox.
 */

/** "Manal Rizwan · MD Media" — or plain "MD Media" when nobody acted. */
export function senderName(actorName?: string | null): string {
  const name = actorName?.trim()
  if (!name) return 'MD Media'
  // quotes/newlines have no business in a display name — strip, don't escape
  const clean = name.replace(/["\r\n<>]/g, '').slice(0, 60).trim()
  return clean ? `${clean} · MD Media` : 'MD Media'
}

/** Full RFC 5322 From header value for nodemailer/MailComposer. */
export function fromHeader(fromAddress: string, actorName?: string | null): string {
  return `${senderName(actorName)} <${fromAddress}>`
}

/**
 * Per-person sender alias on OUR domain — how a notification gets a personal
 * From address for someone who signs in with a personal Gmail. Nobody can
 * send as gmail.com (DMARC), but we can mint "manal.rizwan@mdmmarketing.com.au"
 * on the domain we verified with Resend, with Reply-To carrying the real
 * inbox. Deterministic from the name so the address is stable across sends.
 */
export function actorAlias(
  domain: string,
  actorName?: string | null,
  actorEmail?: string | null,
): string | null {
  if (!domain) return null
  // already on our domain? use the real address — it IS the person
  const email = actorEmail?.trim().toLowerCase()
  if (email?.endsWith(`@${domain.toLowerCase()}`)) return email

  const fromName = (actorName ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip diacritics left by NFKD
    .replace(/[^a-z0-9]+/g, '.')       // spaces & punctuation → dots
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40)
  if (fromName) return `${fromName}@${domain}`

  // no usable name — fall back to their address's local part
  const local = email?.split('@')[0]?.replace(/[^a-z0-9.]+/g, '.').replace(/^\.+|\.+$/g, '')
  return local ? `${local}@${domain}` : null
}

/** Reply-To only when the actor has a usable address that is not the
 *  transport address itself (replying "to hello@" is the default anyway). */
export function replyToFor(actorEmail?: string | null, fromAddress?: string): string | undefined {
  const email = actorEmail?.trim().toLowerCase()
  if (!email || !email.includes('@')) return undefined
  if (fromAddress && email === fromAddress.trim().toLowerCase()) return undefined
  // never invite replies to an undeliverable test account
  if (email.endsWith('.invalid')) return undefined
  return email
}
