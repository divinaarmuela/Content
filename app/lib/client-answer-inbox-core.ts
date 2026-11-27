/**
 * ONE INBOX HEARS EVERY CLIENT ANSWER (pure; tests/client-answer-inbox.test.ts).
 *
 * WHY (the owner, 27 Nov 2026: "any notification if client approve things? … contact needs notification when approved
 * comments etc" — and, asked whether for every client or only some: "yes for every client"). A client's approval,
 * their no and their comments were emailed to the people ON that client — its account managers, the post's scheduler,
 * whoever made or holds the piece. The agency's contact@ login is on no client's team, so it heard none of it (read
 * on the day: Senorita's team was four people, and contact@ was not one).
 *
 * So one address is added to every email that tells the team what a client said: the approval or the no on a post,
 * a comment on a post, a clip or design approved, a comment on a piece, a shoot or a board, and a card the client
 * approved or sent back. It is added to what already goes out — nobody who was told before stops being told — and it
 * is the same email the account managers get, never a second copy to somebody already named.
 *
 * It is a PERSON ON THE TEAM with that address, not a bare address: every notice is logged against a team account and
 * shows on their bell. No active account with the address means nothing is added.
 */

/** the address that hears every client answer; `CLIENT_ANSWER_INBOX` in the environment names another, `off` none */
export const CLIENT_ANSWER_INBOX = 'contact@mdmmarketing.com.au'

export function inboxAddress(env: string | null | undefined): string | null {
  const v = String(env ?? '').trim().toLowerCase()
  if (v === 'off') return null
  return v.includes('@') ? v : CLIENT_ANSWER_INBOX
}

/** the post moves that are the client's own word (post-stage-core, one portal R3, R4, R8) */
export const CLIENT_ANSWER_ACTIONS: readonly string[] = ['client_ok', 'client_ok_book', 'client_not_approved']

type Person = { id: string; email?: string | null; role?: string | null; active_status?: boolean | null }

/** the team account behind the inbox address: active, not a client's login. Null when there is none. */
export function inboxPerson<T extends Person>(people: readonly T[], address: string | null): T | null {
  if (!address) return null
  return people.find(p => p.active_status === true && p.role !== 'client' && String(p.email ?? '').trim().toLowerCase() === address) ?? null
}

/** the people an email goes to, with the inbox's account added once (never twice, and never when it is missing) */
export function withInbox<T extends { id: string }>(recipients: readonly T[], inbox: T | null): T[] {
  return inbox && !recipients.some(r => r.id === inbox.id) ? [...recipients, inbox] : [...recipients]
}
