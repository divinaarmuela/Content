/**
 * WHAT EACH CHANNEL DID WITH A PIECE, FOR THE CLIENT — pure.
 *
 * The team's Posts page reads the per-channel record on a publish job
 * (`post-outcome-core`). The client's card used to say "Live." for a post
 * that went out on Instagram and was refused on TikTok, and "Live." for a
 * draft handed to TikTok's inbox (the owner, 10 Sep 2026: "make sure show
 * what's scheduled and published on the portal"). This turns the same
 * record into the client's lines: which network, what kind, booked for
 * when / went out when / did not go out / handed over as a draft, and the
 * live link. Never the provider's reason — that is the team's to act on.
 */

import { DRAFT_KIND, outcomesForJob, type OutcomeJob, type PlatformOutcome } from './post-outcome-core'
import { networkName } from './publish-core'

export type PortalChannelLine = {
  platform: string
  /** "Instagram" */
  network: string
  /** "Reel", "Trial Reel", "Video", "Feed post" … */
  kind: string
  state: 'scheduled' | 'published' | 'failed' | 'pending' | 'draft'
  /** ISO — the booked time, or when it went out */
  at: string | null
  url: string | null
}

/** One line per channel of the newest job on the piece, worst first so a
 *  refused channel is never hidden under a green one. */
export function portalChannelLines(jobs: readonly OutcomeJob[]): PortalChannelLine[] {
  const newest = [...jobs].sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]
  if (!newest) return []
  const rank: Record<PortalChannelLine['state'], number> = { failed: 0, pending: 1, scheduled: 2, draft: 3, published: 4 }
  return outcomesForJob(newest)
    .map(lineOf)
    .filter((l): l is PortalChannelLine => l !== null)
    .sort((a, b) => rank[a.state] - rank[b.state] || a.network.localeCompare(b.network))
}

function lineOf(o: PlatformOutcome): PortalChannelLine | null {
  const state: PortalChannelLine['state'] | null =
    o.kind === DRAFT_KIND ? 'draft'
    : o.status === 'published' ? 'published'
    : o.status === 'failed' ? 'failed'
    : o.status === 'scheduled' || o.status === 'queued' ? 'scheduled'
    : o.status === 'pending' ? 'pending'
    : null
  if (!state) return null
  return {
    platform: o.platform,
    network: networkName(o.platform),
    kind: o.kind === DRAFT_KIND ? 'Draft' : o.kind,
    state,
    at: o.at ?? null,
    url: o.url ?? null,
  }
}

/** The words beside a channel, in the client's clock (`when` already formatted). */
export function portalChannelWords(line: PortalChannelLine, when: string | null): string {
  switch (line.state) {
    case 'published': return when ? `went out ${when}` : 'went out'
    case 'scheduled': return when ? `going out ${when}` : 'booked in'
    case 'pending': return 'going out now'
    case 'failed': return 'did not go out — we are on it'
    case 'draft': return 'handed to the account as a draft, live once they post it'
  }
}
