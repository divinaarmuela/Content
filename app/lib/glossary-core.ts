/**
 * The words this app invented, defined once.
 *
 * The dashboard has roughly thirty words that mean something specific here and
 * nothing anywhere else — "shoot plan", "wrapped", "intake". Until now the only
 * way to learn one was to ask a colleague, and the only in-app help was `title=`
 * attributes, which do nothing on a phone.
 *
 * So: one map, read by <HelpHint term="…" /> (a `?` that opens a popover on
 * tap, not on hover). A term is defined here and explained everywhere.
 *
 * Pure data — no React, no I/O — so the copy can be swept by tests.
 */

export type GlossaryTerm = {
  /** the word as it appears on screen */
  title: string
  /** one or two sentences. No jargon inside a jargon definition. */
  body: string
}

export const GLOSSARY = {
  shoot: {
    title: 'Shoot',
    body: 'One filming day and everything planned for it — the date, the location, and every item that comes out of it. The database still calls this a "batch"; same thing.',
  },
  shoot_plan: {
    title: 'Shoot plan',
    body: 'The concept, shot list and references the client signs off before we film. Older parts of the app call this a "brief task".',
  },
  item: {
    title: 'Item',
    body: 'One piece of content — a single reel, carousel, story or graphic — followed from first cut all the way to going live.',
  },
  approved_for_scheduling: {
    title: 'Needs a posting date',
    body: 'Signed off by the client. Nothing goes live until someone gives it a platform and a posting time.',
  },
  drafting: {
    title: 'Drafting',
    body: 'Work has started but nothing has been sent for review yet. Often nothing has been uploaded either — an item sits here from the moment it is created.',
  },
  wrapped: {
    title: 'Wrapped',
    body: 'The shoot is closed out and everything promised from it has been delivered. You can still cut new items from its footage later.',
  },
  deliverable: {
    title: 'Deliverable',
    body: 'One thing promised in the client’s monthly agreement — for example "5 reels a month". The Overview counts what is still owed.',
  },
  intake: {
    title: 'Intake',
    body: 'The onboarding questionnaire we send a new client. Their answers become the starting brief for all their work.',
  },
} as const satisfies Record<string, GlossaryTerm>

export type GlossaryKey = keyof typeof GLOSSARY

export const GLOSSARY_KEYS = Object.keys(GLOSSARY) as GlossaryKey[]

export function glossary(key: GlossaryKey): GlossaryTerm {
  return GLOSSARY[key]
}
