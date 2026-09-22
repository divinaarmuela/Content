/**
 * TRACKED LINKS — the pure half (the acquisition blueprint, §8 "UTM /
 * tracking": a Loom or audit click is +15 intent points, and "a researched
 * business is not a lead until it replies, clicks, books or submits").
 *
 * A prospect's three links — the private Loom or audit, the public audit
 * post, the booking or CTA — are sent through the app's own address,
 * `/go/<prospect>/<kind>`. The route records the click on the prospect and
 * sends the person on. Nothing here does I/O; the route reads these rules.
 */

import type { Prospect } from './acquisition-core'

export const TRACKED_KINDS = ['loom', 'post', 'cta'] as const
export type TrackedKind = (typeof TRACKED_KINDS)[number]

export function isTrackedKind(v: unknown): v is TrackedKind {
  return (TRACKED_KINDS as readonly string[]).includes(String(v))
}

/** the prospect's row id as it appears in an address: the shape only, never a path character (trap 9) */
export function isProspectId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v)
}

export function trackedPath(prospectId: string, kind: TrackedKind): string {
  return `/go/${encodeURIComponent(prospectId)}/${kind}`
}

/** the address a person pastes into the DM or email */
export function trackedLink(origin: string, prospectId: string, kind: TrackedKind): string {
  return `${String(origin ?? '').replace(/\/+$/, '')}${trackedPath(prospectId, kind)}`
}

/** which of the prospect's links this kind stands for, when it is a real web address */
export function destinationFor(p: Pick<Prospect, 'loom_url' | 'post_url' | 'cta_url'>, kind: TrackedKind): string | null {
  const raw = kind === 'loom' ? p.loom_url : kind === 'post' ? p.post_url : p.cta_url
  const url = String(raw ?? '').trim()
  return /^https?:\/\/\S+$/i.test(url) ? url : null
}

export const TRACKED_WORDS: Record<TrackedKind, { label: string; click: string }> = {
  loom: { label: 'Loom or audit', click: 'Opened the Loom or audit link' },
  post: { label: 'Audit post', click: 'Opened the public audit post' },
  cta: { label: 'Booking or CTA', click: 'Opened the booking or CTA link' },
}

/**
 * THE POINTS: the first click a prospect ever makes is the intent signal
 * (+15, the blueprint's Loom click). A second look is still worth knowing
 * about — it goes on the timeline — but it is not a second signal.
 */
export function clickPoints(priorClicks: number): number {
  return priorClicks > 0 ? 0 : 15
}

export function clickDetail(kind: TrackedKind, priorClicks: number): string {
  return priorClicks > 0 ? `${TRACKED_WORDS[kind].click} · again` : TRACKED_WORDS[kind].click
}

/**
 * THE MESSENGERS LOOK FIRST. Instagram, Facebook, WhatsApp, LinkedIn, Slack
 * and the rest fetch a link the moment it is sent, to draw a preview — that
 * fetch is not the prospect. It is sent on without a mark on the timeline.
 */
const PREVIEW_BOTS = /facebookexternalhit|facebot|instagram|whatsapp|linkedinbot|twitterbot|slackbot|slack-imgproxy|telegrambot|discordbot|skypeuripreview|applebot|googlebot|bingbot|pinterestbot|redditbot|snapchat|viber|line\/|preview/i
export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? '')
  return ua.length === 0 || PREVIEW_BOTS.test(ua)
}

/** UTM on the way out, only where the destination carries none of its own */
export function withUtm(url: string, campaign: string): string {
  try {
    const u = new URL(url)
    if ([...u.searchParams.keys()].some(k => k.toLowerCase().startsWith('utm_'))) return url
    u.searchParams.set('utm_source', 'mdmedia')
    u.searchParams.set('utm_medium', 'outreach')
    u.searchParams.set('utm_campaign', campaign.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'prospect')
    return u.toString()
  } catch {
    return url
  }
}
