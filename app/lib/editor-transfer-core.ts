/**
 * TRANSFERRING THE EDITING JOB (the owner, 15 Sep 2026: "when a card has
 * been created and the footage is in, an AM for that client or a super
 * admin should be able to transfer the editing job — which just moves all
 * the editing data to another editor").
 *
 * The card IS the editing data — the brief, the scripts, the folder to work
 * from, the footage, the versions, the comments — so moving the job is
 * moving the card's holder, and nothing on it is copied or lost. On a card
 * made from a shoot, the shoot's named editor follows, so the footage and
 * plan notices from then on go to the new person.
 *
 * Pure: who may, from which stage, to whom. The route does the writes.
 */
import { ITEM_STATUSES, type ItemStatus } from './workflow-core'

/**
 * AT ANY STAGE (the owner, 21 Sep 2026: "I should be able to transfer it
 * anytime"). It used to stop once the client had the card, on the thought
 * that the editing was over — but a card with the client comes back with
 * changes, and the person who would make them may have left the job. Whoever
 * holds the card is who its next round goes to, so it can always be moved.
 */
export const TRANSFER_STATUSES: readonly ItemStatus[] = ITEM_STATUSES

/** the people who can carry an edit: the editors, and the managers who also
 *  cut (the same three the shoot page offers as the editor) */
export const EDITING_ROLES: readonly string[] = ['editor', 'account_manager', 'super_admin'] as const

export type TransferViewer = {
  id: string
  role: string
  /** the clients an account manager is on; null = unrestricted */
  clientIds?: string[] | null
}

export type TransferableCard = {
  status: string
  client_id: string
  owner_id?: string | null
  adhoc_post?: boolean | null
}

/** Why a transfer is refused — null when it may go ahead. */
export function transferRefusal(viewer: TransferViewer, card: TransferableCard): string | null {
  if (card.adhoc_post === true) return 'This is a post, not an edit — hand it to a scheduler instead'
  if (viewer.role === 'super_admin') return null
  if (viewer.role === 'account_manager') {
    if (viewer.clientIds === null || viewer.clientIds === undefined) return null
    return viewer.clientIds.includes(card.client_id) ? null : 'Only an account manager on this client can transfer its editing'
  }
  return 'Transferring the editing job is for the client’s account manager or a super admin'
}

export function canTransferEditing(viewer: TransferViewer, card: TransferableCard): boolean {
  return transferRefusal(viewer, card) === null
}

/** May this person be handed the edit? */
export function editorRefusal(
  person: { id: string; role: string; active_status?: boolean | null } | null | undefined,
  currentOwnerId: string | null | undefined,
): string | null {
  if (!person || person.active_status === false) return 'Pick a current team member'
  if (!EDITING_ROLES.includes(person.role)) return 'The editing job goes to an editor, or a manager who also cuts'
  if (currentOwnerId && person.id === currentOwnerId) return 'They already have this card'
  return null
}

/** the words the history keeps */
export function transferWords(from: string | null, to: string): string {
  return from ? `editing moved from ${from} to ${to}` : `editing given to ${to}`
}
