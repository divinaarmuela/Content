import 'server-only'
import { table } from '@/lib/db'
import { encodeKey } from '@/lib/db-types'
import type { Client, InboxTouch as InboxTouchRow, SocialAccount } from '@/lib/db-types'
import {
  canonicalAccount, foldTouches, nextTouch, touchHandle, touchesFromComments, touchesFromConversations,
  type InboxTouch, type TouchSeen,
} from './people-analytics-core'

/**
 * A NOTE OF WHO HAS BEEN IN THE INBOX.
 *
 * The Inbox stores nothing: it reads conversations and comments live from the
 * publisher on every load, draws them and forgets them. That is fine for
 * answering somebody, and useless for the question the People table asks —
 * "did this follower also reach out?" — because there is nothing to join
 * against.
 *
 * So this writes the smallest possible note beside the answers the Inbox has
 * ALREADY fetched for its own reasons: a handle, a name, whether it was a
 * comment or a DM, and when they were last seen. NOTHING HERE FETCHES
 * ANYTHING. No message text and no comment body is kept — the words belong to
 * the Inbox, and a table of people needs only the fact that words happened.
 *
 * What it therefore catches, honestly:
 *
 *   • every DM thread, every time anybody opens the Inbox's Direct messages
 *     tab — the conversation list names its participants, so one load records
 *     everyone in it;
 *   • the comments on a post, when somebody opens that post's thread. A post
 *     nobody has opened has commenters we have not noted here (though the
 *     daily interactor read still knows they commented — that is the "What
 *     they did" column, not this one).
 *
 * A blank "Reached out" cell means "not seen in the Inbox", never "never
 * wrote". The page says so in words.
 */

const touches = () => table<InboxTouchRow>('inbox_touches')

export function touchId(accountId: string, username: string): string {
  return `${encodeKey(accountId)}:${encodeKey(touchHandle(username))}`
}

/**
 * The account a touch is recorded under, and its client, for every connected account — and every handle
 * that is ours. ONE HANDLE, ONE ROW (29 Sep 2026): the same Instagram account connected twice under two
 * clients made Zernio deliver one comment twice, once per connection, and each became its own row. A
 * touch on either connection is now recorded under the preferred one (`canonicalAccount`), so both
 * deliveries land on the same row, on the real client's People page.
 */
async function accountMap(): Promise<{ homeOf: Map<string, { account_id: string; client_id: string | null }>; ours: string[] }> {
  const [accounts, clients] = await Promise.all([
    table<SocialAccount>('social_accounts').list().catch(() => [] as SocialAccount[]),
    table<Client>('clients').list().catch(() => [] as Client[]),
  ])
  const byId = new Map(clients.map(c => [c.id, c]))
  const clientOf = (id: string) => byId.get(id) as { name?: string | null; status?: string | null } | undefined
  const homeOf = new Map<string, { account_id: string; client_id: string | null }>()
  for (const a of accounts) {
    const home = canonicalAccount(accounts, a.provider_account_id, clientOf) ?? a
    homeOf.set(a.provider_account_id, { account_id: home.provider_account_id, client_id: home.client_id })
  }
  return { homeOf, ours: accounts.map(a => a.username).filter((u): u is string => !!u) }
}

/**
 * Record what a live Inbox answer just named. Failures are swallowed: this is
 * a note taken on the side of somebody reading their Inbox, and it must never
 * be the reason their Inbox fails to load.
 */
export async function recordTouches(seen: readonly TouchSeen[], now: Date = new Date()): Promise<number> {
  const folded = foldTouches(seen)
  if (folded.length === 0) return 0
  const stamp = now.toISOString()
  const { homeOf } = await accountMap()
  let written = 0
  for (const t of folded) {
    if (!t.account_id) continue
    const home = homeOf.get(t.account_id)
    const accountId = home?.account_id ?? t.account_id
    const id = touchId(accountId, t.username)
    try {
      const prev = await touches().get(id)
      const next = nextTouch(prev, t, stamp)
      if (prev && prev.last_at === next.last_at && prev.kind === next.kind) continue
      await touches().upsert({
        id,
        account_id: accountId,
        client_id: home?.client_id ?? prev?.client_id ?? null,
        username: touchHandle(t.username),
        name: next.name,
        kind: next.kind,
        first_at: next.first_at,
        last_at: next.last_at,
        conversation_id: t.conversation_id ?? prev?.conversation_id ?? null,
        post_id: t.post_id ?? prev?.post_id ?? null,
      })
      written++
    } catch {
      // one person failing to be noted is not worth failing a page load over
    }
  }
  return written
}

/** the DM list the Inbox just loaded */
export async function noteConversations(raw: unknown): Promise<void> {
  try {
    await recordTouches(touchesFromConversations(raw))
  } catch { /* a note, never a blocker */ }
}

/** the comments on one post, as the Inbox just loaded them */
export async function noteComments(raw: unknown, ctx: { accountId: string | null; postId: string | null }): Promise<void> {
  try {
    const { ours } = await accountMap()
    await recordTouches(touchesFromComments(raw, { ...ctx, ours }))
  } catch { /* a note, never a blocker */ }
}

/** everybody noted for one client, in the shape the join wants */
export async function inboxTouchesFor(clientId: string): Promise<InboxTouch[]> {
  const rows = await touches().list({ where: r => r.client_id === clientId }).catch(() => [] as InboxTouchRow[])
  return rows.map(r => ({
    username: r.username,
    name: r.name ?? null,
    kind: r.kind === 'comment' || r.kind === 'both' ? r.kind : 'message',
    last_at: r.last_at,
    first_at: r.first_at ?? null,
  }))
}
