/**
 * THE CLIENT'S OWN CONNECT LINK — pure.
 *
 * The owner, 9 Sep 2026: "on Social channels create a universal link that I
 * can send to clients … and they can login, essentially … we will pick
 * which platforms we want them to login from, like a checkbox … and then
 * they can sign in from there."
 *
 * So: one page per client, opened by the client with no account of ours,
 * listing the networks the manager ticked, with a Connect button on each
 * that runs the network's own sign-in and lands the account under that
 * client. The credential is the client's portal share token — the same one
 * the portal link already trusts — and the ticked networks travel IN the
 * link, so ticking differently makes a different link and nothing has to
 * be stored to remember a choice.
 *
 * The provider (Zernio) mints a sign-in URL per network from our server;
 * it has no hosted "connect yourself" page of its own, which is why this
 * one exists.
 */

import { PLATFORM_RULES, type Platform } from './publish-core'

/** The networks a client can be asked to connect, in the order they are
 *  drawn — the agency's usual ones first. */
export const CONNECTABLE: readonly Platform[] = [
  'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin',
  'threads', 'twitter', 'pinterest', 'bluesky', 'reddit',
]

export const isConnectable = (p: unknown): p is Platform =>
  typeof p === 'string' && (CONNECTABLE as readonly string[]).includes(p) && p in PLATFORM_RULES

/** The ticked networks, from the link's `networks=` — unknown names dropped,
 *  duplicates folded, the drawing order kept. Nothing ticked means every
 *  network, so an old link with no list still works. */
export function parseNetworks(param: string | null | undefined): Platform[] {
  const asked = String(param ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const picked = CONNECTABLE.filter(p => asked.includes(p))
  return picked.length > 0 ? picked : [...CONNECTABLE]
}

/** The link's path for a client token and the ticked networks. */
/**
 * WHO THE LINK IS FOR (the owner, 15 Sep 2026: "say it's for their business —
 * we send them the link; the other option is the client's personal one").
 * `for=<contact id>` on the link means the accounts connected from it are
 * that person's own; no `for` means the client's official business accounts.
 * The link cannot tell who pressed it, so the manager says so when making it.
 */
export function connectLinkPath(token: string, networks: readonly Platform[], forContact?: string | null, off: readonly OptionalArea[] = []): string {
  const picked = CONNECTABLE.filter(p => networks.includes(p))
  const parts: string[] = []
  if (picked.length > 0 && picked.length < CONNECTABLE.length) parts.push(`networks=${picked.join(',')}`)
  const who = parseFor(forContact)
  if (who) parts.push(`for=${encodeURIComponent(who)}`)
  // WHAT THE CLIENT IS NOT ASKED FOR (16 Oct 2026): only what is switched off travels — a link without it means everything
  const left = OPTIONAL_AREAS.filter(x => off.includes(x))
  if (left.length > 0) parts.push(`off=${left.join(',')}`)
  return `/connect/${encodeURIComponent(token)}${parts.length ? `?${parts.join('&')}` : ''}`
}

/**
 * WHAT A CONNECTION LETS US DO, ON OR OFF, PER CONNECT LINK (the owner, 16 Oct 2026: "does our link include toggling on
 * and off for message inbox?" → "why don't you add all"). Zernio asks a network for every permission it supports unless
 * `scopes` names fewer areas (docs.zernio.com/guides/connecting-accounts; the areas per network are on its platform pages).
 * Posting is never optional — a connection that cannot post is no connection. It is decided at sign-in: switching an
 * area back on later means the client connects again with it ticked.
 *
 * Instagram and Facebook only: those are the networks whose areas are documented; Zernio refuses an area a network
 * does not have, so nothing is guessed for the others (they keep asking for everything, as before).
 */
export const OPTIONAL_AREAS = ['analytics', 'comments', 'messaging', 'ads'] as const
export type OptionalArea = (typeof OPTIONAL_AREAS)[number]

/** the areas each network has at Zernio (posting first, always asked for) */
export const AREAS_OF: Partial<Record<string, readonly ('posting' | OptionalArea)[]>> = {
  instagram: ['posting', 'analytics', 'comments', 'messaging'],
  facebook: ['posting', 'analytics', 'comments', 'messaging', 'ads'],
}

/** the words the panel shows for each area: what it gives us, and what is lost without it */
export const AREA_WORDS: Record<OptionalArea, { label: string; on: string; off: string; networks: string }> = {
  analytics: { label: 'Stats', networks: 'Instagram, Facebook', on: 'Views, reach and follower numbers for the portal and reports.', off: 'No numbers on the portal or in reports for this account.' },
  comments: { label: 'Comments', networks: 'Instagram, Facebook', on: 'Read and answer comments; first comments and comment-to-DM automations work.', off: 'No comments in our Inbox, no first comment on posts, and comment automations will not run.' },
  messaging: { label: 'Message inbox', networks: 'Instagram, Facebook', on: 'Their DMs show in our Inbox.', off: 'Their DMs will not reach us.' },
  ads: { label: 'Ads', networks: 'Facebook', on: 'Ads, lead forms and the paid-partnership label.', off: 'No ads features for this account.' },
}

/** the switched-off areas a link carries: `off=comments,messaging`; the first link of all, `inbox=0`, still means messaging off */
export function parseOff(raw: unknown, legacyInbox?: unknown): OptionalArea[] {
  const list = (typeof raw === 'string' ? raw : '').split(',').map(x => x.trim().toLowerCase())
  const off = OPTIONAL_AREAS.filter(x => list.includes(x))
  const s = typeof legacyInbox === 'string' ? legacyInbox.trim().toLowerCase() : ''
  if ((legacyInbox === 0 || legacyInbox === false || s === '0' || s === 'off' || s === 'false') && !off.includes('messaging')) off.push('messaging')
  return OPTIONAL_AREAS.filter(x => off.includes(x))
}

/** The areas Zernio is asked for: null (everything, as before) unless something this network has is switched off. */
export function scopesFor(platform: string, off: readonly OptionalArea[]): string | null {
  const areas = AREAS_OF[platform]
  if (!areas || !areas.some(a => (off as readonly string[]).includes(a))) return null
  return areas.filter(a => a === 'posting' || !(off as readonly string[]).includes(a)).join(',')
}

/** The `for=` on a link: one contact id, or null for the business. Only the
 *  characters an id can hold, so nothing else rides in on it. */
export function parseFor(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s && s !== 'company' && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null
}

/** A share token as the portal accepts it — a UUID, nothing else. */
export const isShareToken = (t: unknown): t is string =>
  typeof t === 'string' && /^[0-9a-f-]{36}$/i.test(t)

/** An account as the client's page sees it: which network, whose handle,
 *  and how its connection is doing — never a provider id or token. */
export type ConnectedAccount = {
  platform: string
  username?: string | null
  name?: string | null
  /** the check said its token has expired: a Reconnect belongs here */
  reconnect?: boolean
  /** …or that it runs out soon (TikTok and LinkedIn end a connection after
   *  a year whatever happens): a Reconnect belongs here too, quieter */
  soon?: boolean
  /** the check's own sentence about it, for the page to show */
  reason?: string | null
}

export type NetworkState =
  | { connected: true; who: string; reconnect: boolean; soon: boolean; reason: string | null }
  | { connected: false }

/** What the page says a network is doing. A connected network whose token
 *  has run out is "connected, needs reconnecting" — the same link the
 *  client used to connect is the one they use to reconnect (the owner, 9
 *  Sep 2026: "what if the connection is getting lost, how are we going to
 *  reconnect it again"). */
export function networkState(connected: readonly ConnectedAccount[], platform: Platform): NetworkState {
  const mine = connected.filter(a => a.platform === platform)
  if (mine.length === 0) return { connected: false }
  const who = mine.map(a => a.username || a.name || '').filter(Boolean).join(', ')
  const reconnect = mine.some(a => a.reconnect === true)
  const soon = !reconnect && mine.some(a => a.soon === true)
  const reason = mine.find(a => (reconnect ? a.reconnect : a.soon) && a.reason)?.reason ?? null
  return { connected: true, who: who || 'connected', reconnect, soon, reason }
}

/**
 * What the page says when the network sent the client back with an error
 * instead of an account — they pressed Cancel, or the network refused.
 * The network's own code is kept out of the sentence; it means nothing to
 * a client, and the fix is the same either way: try again.
 */
export function returnErrorWords(error: string | null | undefined, label: string): string | null {
  const e = String(error ?? '').trim().toLowerCase()
  if (!e) return null
  if (e.includes('denied') || e.includes('cancel')) {
    return `The ${label} sign-in was cancelled and nothing was connected. Press Connect to try again.`
  }
  return `${label} did not finish connecting and nothing was changed. Press Connect to try again. If it keeps happening, reply to the email you got this link in.`
}
