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
export function connectLinkPath(token: string, networks: readonly Platform[]): string {
  const picked = CONNECTABLE.filter(p => networks.includes(p))
  const q = picked.length > 0 && picked.length < CONNECTABLE.length
    ? `?networks=${picked.join(',')}`
    : ''
  return `/connect/${encodeURIComponent(token)}${q}`
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
