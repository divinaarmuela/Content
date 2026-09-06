/**
 * Pure production-workflow state machine — no imports, fully unit-testable.
 * Encodes doc 1's status funnel (§4), transition permissions (§5, §10), and
 * client-visible label translation. The server engine (workflow.ts) executes
 * these rules; nothing else in the codebase decides what moves where.
 */
import { roleSatisfies, type Role } from './identity-core'

export const ITEM_STATUSES = [
  'draft_uploaded', 'internal_review', 'revision_required', 'revision_complete',
  'client_review', 'client_changes_requested', 'approved_for_scheduling',
  'scheduled', 'published',
] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

/** Extra evidence a transition needs before it is legal. */
export type TransitionRequirement = 'reviewable_asset' | 'schedule_entry' | 'live_url'

type TransitionRule = {
  /** who may perform it (super_admin always may, checked separately) */
  roles: Role[]
  requires?: TransitionRequirement
  /** human label for buttons/logs */
  label: string
  /** the same move, said the way a particular hat experiences it — an account
   *  manager clicking "Approve" on the client's behalf is LOGGING the client's
   *  approval, not giving one */
  labelFor?: Partial<Record<Role, string>>
  /**
   * A move the APP makes, never a button.
   *
   * The machine may perform it and the History records it under this label,
   * but no surface ever OFFERS it: it exists because something else happened
   * (a version was saved), not because anyone decided to move the item. Listing
   * it beside real decisions would invite a click for a reason only the app
   * knows about, so `availableTransitions*` filter it out everywhere.
   */
  auto?: true
}

/** The funnel. Key: from-status → to-status → rule. Anything absent is illegal. */
export const TRANSITIONS: Partial<Record<ItemStatus, Partial<Record<ItemStatus, TransitionRule>>>> = {
  draft_uploaded: {
    internal_review: { roles: ['editor', 'account_manager'], requires: 'reviewable_asset', label: 'Submit for review' },
  },
  internal_review: {
    // one name for one action, on all three overlays: the button that sends
    // work back for changes is "Ask for changes", never the assignee's name
    revision_required: { roles: ['account_manager'], label: 'Ask for changes' },
    client_review: { roles: ['account_manager'], label: 'Send to client' },
    approved_for_scheduling: { roles: ['account_manager'], label: 'Approve without client' },
  },
  revision_required: {
    revision_complete: { roles: ['editor'], requires: 'reviewable_asset', label: 'Revisions done' },
  },
  revision_complete: {
    client_review: { roles: ['account_manager'], label: 'Looks good — send to client' },
    revision_required: { roles: ['account_manager'], label: 'Ask for more changes' },
    approved_for_scheduling: { roles: ['account_manager'], label: 'Approve without client' },
  },
  client_review: {
    // A NEW VERSION LANDED WHILE THE CLIENT WAS LOOKING AT THE OLD ONE.
    //
    // The portal shows the latest client-facing version, so saving v2 on an
    // item that is with the client puts v2 in front of them with nobody
    // having checked it. The item comes back for the manager's check instead,
    // and their review card disappears until it is sent again.
    //
    // `auto`: nobody presses this. The versions endpoint performs it as the
    // version's author — who wears the editor hat on the item they just
    // uploaded to — and an account manager saving a fix does the same.
    // client_changes_requested is deliberately NOT given the same edge: a new
    // version there is exactly what the client asked for.
    internal_review: {
      roles: ['editor', 'account_manager'],
      label: "New version — back for the manager's check",
      auto: true,
    },
    client_changes_requested: {
      roles: ['client', 'account_manager'], label: 'Ask for changes',
      labelFor: { account_manager: "Log the client's changes" },
    },
    approved_for_scheduling: {
      // plain "Approve" beside "Waiting for the client to approve" reads as
      // though YOU are approving — for the team it is a record of what the
      // client said, and it has to say so
      roles: ['client', 'account_manager'], label: 'Approve',
      labelFor: { account_manager: "Log the client's approval" },
    },
  },
  client_changes_requested: {
    revision_required: { roles: ['account_manager'], label: 'Send for revision' },
    // the small-fix path: the manager corrected it on the spot — straight
    // back to the client, no assignment ceremony for a one-word change
    client_review: { roles: ['account_manager'], label: 'No edit needed — resend' },
  },
  approved_for_scheduling: {
    scheduled: { roles: ['scheduler'], requires: 'schedule_entry', label: 'Mark scheduled' },
    // MEDIA THE CLIENT HAS NOT SEEN LANDED ON AN APPROVED PIECE.
    //
    // The Schedule composer lets a file be brought in from Google Drive or
    // uploaded straight into a post. That file is saved as a new version, and
    // the client's yes was given to the old one — so the piece goes back to
    // them rather than a post going out with media nobody signed off. Same
    // shape as the `client_review → internal_review` edge above: `auto`, so
    // it is the app's move and never a button anybody presses.
    client_review: {
      roles: ['editor', 'account_manager', 'scheduler'],
      label: 'New media — back to the client',
      auto: true,
    },
  },
  scheduled: {
    published: { roles: ['scheduler'], requires: 'live_url', label: 'Mark published' },
  },
}

/** Client-visible status labels (doc 1 §4 — internal churn reads as one calm state). */
export const CLIENT_LABELS: Record<ItemStatus, string> = {
  draft_uploaded: 'In production',
  internal_review: 'In production',
  revision_required: 'In production',
  revision_complete: 'In production',
  client_review: 'Needs your review',
  client_changes_requested: 'Changes in progress',
  approved_for_scheduling: 'Approved',
  // one word for one pile: to a client, everything past their approval is
  // approved. The posting time is a DATE on the card, not a second status.
  scheduled: 'Approved',
  published: 'Published',
}

/** Statuses whose items a client may see at all (everything — but only with
 *  the client label); statuses a client may INTERACT with are narrower. */
export const CLIENT_ACTIONABLE: ItemStatus[] = ['client_review']

/** Statuses visible in the scheduler's queue — nothing earlier ever appears. */
export const SCHEDULER_STATUSES: ItemStatus[] = ['approved_for_scheduling', 'scheduled', 'published']

/** What each stage is CALLED on screen — plain words, never the raw status. */
export const STATUS_LABELS: Record<ItemStatus, string> = {
  // THE BOARD'S WORDS, and nobody else's. A stage is called one thing on the
  // board chip, the card page badge, the Overview rows and in emails: the
  // column names (Draft · Internal check · With client · Ready to post ·
  // Posted) and the action names ("Ready for checking", "Booked in",
  // "Posted"). A second vocabulary is how the team got confused.
  draft_uploaded: 'Draft',
  internal_review: 'Ready for checking',
  revision_required: 'Being changed',
  revision_complete: 'Changes made — check again',
  client_review: 'With client',
  client_changes_requested: 'Client wants changes',
  // NOT "Approved": beside "Signed off. Needs a posting time." that read as
  // finished, and the word already meant four different things across the
  // app. The column's own name says what is left to do.
  approved_for_scheduling: 'Ready to post',
  scheduled: 'Booked in',
  published: 'Posted',
}

/** One sentence explaining what the stage MEANS, for anyone who is new. */
export const STATUS_MEANING: Record<ItemStatus, string> = {
  draft_uploaded: 'The editor is working on the first cut.',
  internal_review: 'Waiting for an account manager to check it.',
  revision_required: 'Changes were asked for; the editor is making them.',
  revision_complete: 'The changes are in; an account manager needs to look again.',
  client_review: 'Waiting for the client to approve or ask for changes.',
  client_changes_requested: 'An account manager decides: send it for revision, or fix it and resend.',
  approved_for_scheduling: 'Signed off. Needs a posting time.',
  scheduled: 'Posting time is set; waiting to go live.',
  published: 'Live. Nothing left to do.',
}

/** Whose move it is at each stage — the hat, not the person. */
export const STATUS_TURN: Record<ItemStatus, Role | null> = {
  draft_uploaded: 'editor',
  internal_review: 'account_manager',
  revision_required: 'editor',
  revision_complete: 'account_manager',
  client_review: 'client',
  client_changes_requested: 'account_manager',
  approved_for_scheduling: 'scheduler',
  scheduled: 'scheduler',
  published: null,
}

/** The fields of an item that decide which hats a viewer wears on it. */
export type ActingItem = { owner_id?: string | null; scheduler_ids?: unknown }

/** scheduler_ids as it is meant: a list of user ids. Anything else is none. */
export function schedulerIdsOf(item: { scheduler_ids?: unknown }): string[] {
  return Array.isArray(item.scheduler_ids) ? item.scheduler_ids.map(String) : []
}

/**
 * The hats a viewer wears ON THIS ITEM.
 *
 * The one rule: editing and scheduling are ASSIGNMENT hats, not job titles.
 * Being an editor does not let you act on someone else's item; being handed
 * an item does let you act on it, whatever your title. Account manager is the
 * exception — reviewing IS the job, and it is not per-item.
 */
export function actingRoles(viewer: { id: string; role: Role }, item: ActingItem): Role[] {
  if (viewer.role === 'client') return ['client']
  if (viewer.role === 'super_admin') return ['super_admin']

  const roles: Role[] = []
  if (viewer.role === 'account_manager') roles.push('account_manager')

  const owner = item.owner_id
  // the open pool for an unowned item is editors and AMs; a scheduler picking
  // up someone else's draft is not a thing
  if (owner === viewer.id || (!owner && roleSatisfies(viewer.role, 'editor'))) roles.push('editor')

  const ids = schedulerIdsOf(item)
  // handed the item = the hat, whatever the title; nobody handed it = the
  // schedulers can pick it up
  if (ids.includes(viewer.id) || (ids.length === 0 && viewer.role === 'scheduler')) roles.push('scheduler')

  const order: Role[] = ['account_manager', 'editor', 'scheduler']
  return order.filter(r => roles.includes(r))
}

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; reason: string }

/** Is `from → to` legal for someone wearing ANY of these hats? super_admin may
 *  perform any defined transition (doc: admin can override statuses) but never
 *  an undefined one. */
export function checkTransitionAs(
  roles: readonly Role[], from: ItemStatus, to: ItemStatus,
  opts?: {
    /** this IS the app's own move, not a person pressing something. Without
     *  it an `auto` edge is refused outright — `auto` used to mean only "do
     *  not OFFER this", which left the edge reachable through the ordinary
     *  transition API by anyone whose hat matched, on items (an internal
     *  task, a shoot brief) whose vocabulary has no words for it. */
    auto?: boolean
  },
): TransitionCheck {
  const rule = TRANSITIONS[from]?.[to]
  if (!rule) return { ok: false, reason: `No transition from ${from} to ${to}` }
  if (rule.auto && !opts?.auto) {
    return { ok: false, reason: `"${rule.label}" is something the app does, not something to press` }
  }
  if (roles.includes('super_admin')) return { ok: true, rule }
  if (!rule.roles.some(r => roles.includes(r))) {
    return { ok: false, reason: `${roles.join('/') || 'nobody'} may not perform "${rule.label}"` }
  }
  return { ok: true, rule }
}

/** The label a rule wears for these hats. The client's own words win when the
 *  viewer IS the client; otherwise the first hat with wording of its own. */
function labelFor(rule: TransitionRule, roles: readonly Role[]): string {
  if (!rule.labelFor) return rule.label
  if (roles.includes('client') && rule.labelFor.client) return rule.labelFor.client
  for (const r of roles) {
    const l = rule.labelFor[r]
    if (l) return l
  }
  // a super admin acting on the team's side of a client decision is doing the
  // account manager's job — actingRoles collapses them to ['super_admin'], so
  // without this they were the one person shown the raw "Approve"
  if (roles.includes('super_admin') && rule.labelFor.account_manager) {
    return rule.labelFor.account_manager
  }
  return rule.label
}

/** Transitions available to these hats from a given status (for buttons). */
export function availableTransitionsAs(
  roles: readonly Role[], from: ItemStatus,
): { to: ItemStatus; label: string; requires?: TransitionRequirement }[] {
  const outs = TRANSITIONS[from] ?? {}
  return (Object.entries(outs) as [ItemStatus, TransitionRule][])
    // an `auto` edge is the app's move, not an offer — never a button, not
    // even for a super admin
    .filter(([, rule]) => !rule.auto)
    .filter(([, rule]) => roles.includes('super_admin') || rule.roles.some(r => roles.includes(r)))
    .map(([to, rule]) => ({ to, label: labelFor(rule, roles), requires: rule.requires }))
}

/** The to-statuses a surface may OFFER from here: every edge except the app's
 *  own automatic ones. The task and brief vocabularies walk the funnel
 *  themselves, and must not offer what the asset funnel does not. */
export function offeredTransitionsFrom(from: ItemStatus): ItemStatus[] {
  const outs = TRANSITIONS[from] ?? {}
  return (Object.entries(outs) as [ItemStatus, TransitionRule][])
    .filter(([, rule]) => !rule.auto)
    .map(([to]) => to)
}

/** Single-hat wrappers — the shape the rest of the app already speaks. */
export function checkTransition(role: Role, from: ItemStatus, to: ItemStatus): TransitionCheck {
  return checkTransitionAs([role], from, to)
}

export function availableTransitions(role: Role, from: ItemStatus): { to: ItemStatus; label: string; requires?: TransitionRequirement }[] {
  return availableTransitionsAs([role], from)
}

/** The one move that IS the point at each stage — everything else is a detour. */
export const PRIMARY_ACTION: Partial<Record<ItemStatus, ItemStatus>> = {
  draft_uploaded: 'internal_review',
  internal_review: 'client_review',
  revision_required: 'revision_complete',
  revision_complete: 'client_review',
  client_review: 'approved_for_scheduling',
  client_changes_requested: 'revision_required',
  approved_for_scheduling: 'scheduled',
  scheduled: 'published',
}

export type Presented = { to: ItemStatus; label: string }

/**
 * Split the legal moves into one obvious button and the rest.
 *
 * A screen full of equal-weight buttons makes every move look like a decision.
 * Only the person whose turn it is gets a primary; everyone else gets choices
 * they may take, none of them urged.
 */
export function presentTransitions(
  roles: readonly Role[],
  from: ItemStatus,
  transitions: Presented[],
  ctx: {
    clientApprovalRequired: boolean
    /** whoseTurn().mine, when the caller has it. A super admin MAY act on
     *  everything, so the role check below says "yes" on every item and drew a
     *  filled primary button beside a header reading "Waiting on someone else".
     *  Passing the same answer whoseTurn gives keeps the two in step. */
    viewerHoldsTurn?: boolean
  },
  /** whose turn each status is. A brief hands over to nobody at the end — its
   *  surfaces pass BRIEF_STATUS_TURN so the account manager who must book the
   *  shoot gets the button, instead of a scheduler who will never come. */
  turns: Record<ItemStatus, Role | null> = STATUS_TURN,
): { primary: Presented | null; secondary: Presented[] } {
  // NOTE: the owner-reviewing-their-own-work case used to relabel this
  // "Send back to myself", which read as a note-to-self rather than the
  // reject button it is. One name for one action; the dialog says who it
  // reaches.
  const visible = transitions
    .filter(t => !(t.to === 'approved_for_scheduling' && from !== 'client_review' && ctx.clientApprovalRequired))

  const turn = turns[from]
  const holdsTurn = ctx.viewerHoldsTurn !== undefined
    ? ctx.viewerHoldsTurn
    : roles.includes('super_admin') || (turn !== null && roles.includes(turn))
  const wanted = PRIMARY_ACTION[from]
  const primary = holdsTurn && wanted ? visible.find(t => t.to === wanted) ?? null : null

  return { primary, secondary: visible.filter(t => t !== primary) }
}

/**
 * Whose move is it, is it mine, and is the seat empty? `turns` is the same
 * optional vocabulary presentTransitions takes — a brief hands the last two
 * stages to nobody, so its surfaces pass BRIEF_STATUS_TURN and stop reporting
 * an empty scheduler seat on a shoot that no scheduler will ever touch.
 *
 * `mine` is a question about the WORK, not about permission. A super admin MAY
 * act on everything, and answering "yes, yours" on every card told them
 * nothing — a board of forty items, forty "Your turn" chips, no signal. So the
 * super admin is asked the same question as everybody else: reviewing is their
 * job wherever it lands, but an edit or a post is theirs only when the item
 * actually names them. What they may DO is unchanged — checkTransition still
 * lets them do anything.
 */
export function whoseTurn(
  status: ItemStatus, item: ActingItem, viewer: { id: string; role: Role },
  turns: Record<ItemStatus, Role | null> = STATUS_TURN,
): { hat: Role | null; mine: boolean; unassigned: boolean } {
  const hat = turns[status]
  const mine = hat === null ? false
    : viewer.role === 'super_admin'
      ? hat === 'account_manager'
        || (hat === 'editor' && item.owner_id === viewer.id)
        || (hat === 'scheduler' && schedulerIdsOf(item).includes(viewer.id))
      : actingRoles(viewer, item).includes(hat)
  const unassigned = hat === 'editor'
    ? !item.owner_id
    : hat === 'scheduler'
      ? schedulerIdsOf(item).length === 0
      : false
  return { hat, mine, unassigned }
}

/**
 * A version can be submitted when there is something to review: the file
 * itself, uploaded here, or a link to it.
 *
 * The master-file link used to be required alongside. That rule came from an
 * era when the cut lived in someone's Dropbox and we only ever held a pointer
 * to it — the app now takes the upload itself, and demanding a second link to
 * the same footage blocked the ordinary path: upload the export, press submit.
 * The master link is still there for anyone who wants to record where the
 * full-quality original is filed; it is no longer a gate. (The column is still
 * called dropbox_url because renaming a live column is a migration, not a
 * comment.)
 */
export function versionSatisfiesSubmission(v: { file_url?: string; drive_url?: string; dropbox_url?: string }): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = []
  if (!v.file_url?.trim() && !v.drive_url?.trim()) missing.push('an uploaded file or a review link')
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

/**
 * What the CLIENT is told when a piece arrives on their desk, which depends
 * on how it got there.
 *
 * A piece coming back from `approved_for_scheduling` is not a first review —
 * they already said yes to it once. Telling them "it is ready for your
 * review" again, with no hint that anything changed, is how somebody
 * re-approves without looking.
 */
export function clientArrivalLine(from: ItemStatus): string {
  return from === 'approved_for_scheduling'
    ? 'New media was added — please take a look.'
    : 'It is ready for your review.'
}

/** Notification fan-out per transition (doc 1 §10 trigger map). The server
 *  resolves audiences to concrete people. */
/** `creator` is whoever raised the card (`assigned_by`). They hear about
 *  anything the CLIENT does to it, because they are the person who will be
 *  asked about it — owner's rule, 6 Sep 2026. */
export type Audience = 'account_managers' | 'owner_editor' | 'schedulers' | 'client_users' | 'assigned_schedulers' | 'creator'
export const TRANSITION_NOTIFICATIONS: Partial<Record<`${ItemStatus}>${ItemStatus}`, Audience[]>> = {
  // 'owner_editor' is the item's OWNER whatever their role (anyone can carry a
  // task) — every move an item makes reaches the person assigned to it, and
  // never anyone merely of the same role. The actor is always skipped, so an
  // owner acting on their own item is not self-notified.
  'draft_uploaded>internal_review': ['account_managers'],
  'internal_review>revision_required': ['owner_editor'],
  'revision_required>revision_complete': ['account_managers'],
  'revision_complete>revision_required': ['owner_editor'],
  'internal_review>client_review': ['client_users', 'account_managers', 'owner_editor'],
  'revision_complete>client_review': ['client_users', 'account_managers', 'owner_editor'],
  'client_review>client_changes_requested': ['account_managers', 'creator'], // NEVER the editor directly
  // a new cut pulled the piece back off the client's desk: the manager has to
  // know there is something to check, and the CLIENT must not be told that the
  // thing they were reviewing has been taken away and re-made. They see it in
  // the portal as "In production", which is all it is.
  'client_review>internal_review': ['account_managers'],
  // media the client has never seen landed on a piece they had already
  // approved, so the piece went back to them. Silence here was the whole
  // failure mode: the scheduler saw one sentence in the composer, nobody else
  // heard anything, and the post sat unsendable until somebody opened the
  // board days later. Same three audiences as every other route into
  // client_review.
  'approved_for_scheduling>client_review': ['client_users', 'account_managers', 'owner_editor'],
  'client_changes_requested>revision_required': ['owner_editor'],
  'client_changes_requested>client_review': ['client_users', 'account_managers', 'owner_editor'],
  // approving prefers the people the approver picked, then the item's own
  // scheduler_ids. Only when nobody at all has been named does the approval
  // reach every scheduler — an open queue has to be announced to somebody.
  'client_review>approved_for_scheduling': ['account_managers', 'owner_editor', 'assigned_schedulers', 'creator'],
  'internal_review>approved_for_scheduling': ['account_managers', 'owner_editor', 'assigned_schedulers'],
  'revision_complete>approved_for_scheduling': ['account_managers', 'owner_editor', 'assigned_schedulers'],
  'approved_for_scheduling>scheduled': ['account_managers', 'owner_editor'],
  'scheduled>published': ['account_managers', 'owner_editor', 'assigned_schedulers'],
}
