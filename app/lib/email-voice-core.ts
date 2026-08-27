import { STATUS_MEANING, STATUS_TURN, type ItemStatus } from './workflow-core'
import type { Role } from './identity-core'

/**
 * Emails written to the person reading them.
 *
 * Every workflow email used to be written in the SENDER's voice, from the
 * button the sender pressed: `Ask for changes: Winter Reel 3` arrives in an
 * editor's inbox and reads as an instruction — "you must ask for changes" —
 * when it means the opposite. `Approve without client: X` and `Log the
 * client's approval: X` are worse. The body was a state diff, "moved from
 * Drafting to Being revised by Manal", which never said what the recipient
 * had to do, or by when, with the due date sitting right there in scope.
 *
 * The machinery to fix it was already in workflow-core and never used by a
 * single email: STATUS_TURN knows whose move it is, STATUS_MEANING says what
 * the stage means in a sentence. This module is the join.
 *
 * Pure — no I/O, no HTML chrome. workflow.ts renders what it returns.
 */

/** One CTA for the whole product. There were seven. */
export const OPEN_ITEM_CTA = 'Open the item'

/**
 * The subject when the destination stage is the RECIPIENT's move — written as
 * the thing they have to do, with the item named first so it is recognisable
 * in a crowded inbox.
 */
const TURN_SUBJECT: Partial<Record<ItemStatus, (title: string) => string>> = {
  internal_review: t => `${t} needs your review`,
  revision_required: t => `${t} needs changes`,
  revision_complete: t => `${t} is fixed — check it again`,
  client_review: t => `${t} is ready for you to look at`,
  client_changes_requested: t => `The client asked for changes on ${t}`,
  approved_for_scheduling: t => `${t} needs a posting date`,
  scheduled: t => `${t} is scheduled`,
  published: t => `${t} is live`,
}

/**
 * The subject line for a transition email.
 *
 * `recipientRole` is the hat the recipient wears. When the new stage is their
 * move they get the imperative; when it is not, they get a neutral status
 * line — never an instruction addressed to somebody else.
 */
export function transitionSubject(opts: {
  title: string
  to: ItemStatus
  /** what this stage is CALLED in this item's own vocabulary */
  stageLabel: string
  recipientRole: Role | null
  /** override for shoot plans and internal tasks, whose turns differ */
  turns?: Record<ItemStatus, Role | null>
}): string {
  const turns = opts.turns ?? STATUS_TURN
  const yours = opts.recipientRole !== null && turns[opts.to] === opts.recipientRole
  const shape = TURN_SUBJECT[opts.to]
  if (yours && shape) return shape(opts.title)
  return `${opts.title} — now ${opts.stageLabel}`
}

/**
 * The "what happens next" line. Not the state diff — the next real move, so
 * somebody who is not the next person still knows what they are waiting for.
 */
export function whatHappensNext(to: ItemStatus): string {
  return STATUS_MEANING[to]
}

/** "Due Friday 12 September" — never an ISO date in an email. */
export function longDate(iso: string | null | undefined, tz = 'Australia/Melbourne'): string | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
    }).format(d)
  } catch {
    return null
  }
}

/**
 * The footer every workflow email carries, so a person who did not expect the
 * mail knows why they got it and that replying works.
 */
export const EMAIL_FOOTER =
  'You’re getting this because you’re on this piece of work. Reply to this email if something looks wrong — a real person reads it.'
