/**
 * Columns `database.rules.json` declares `.indexOn` for, mirrored exactly.
 * RTDB's REST/web-SDK API rejects an orderBy/equalTo query on any other
 * field with a 400 ("Index not defined") — pushing an arbitrary `by` key
 * down as a query would work against a fake in tests and break in
 * production the moment a real database enforces its rules.
 *
 * No imports, no `server-only`: both the server module (`lib/db.ts`) and the
 * browser module (`lib/db-client.ts`) need this set, and only one of those
 * two is allowed to import `server-only`.
 */
export const INDEXED_COLUMNS: ReadonlySet<string> = new Set([
  'client_id', 'status', 'batch_id', 'owner_id', 'team_user_id', 'created_at',
  'scheduled_for', 'due_date', 'item_id', 'email', 'token', 'updated_at', 'board_id',
])

/**
 * Pick the one `by` key (if any) that is safe to push down as an
 * orderBy/equalTo query: the first key whose value is non-null and is a
 * declared indexed column. Every other key — including a null-valued
 * indexed key, which `equalTo` can't usefully express — must be filtered in
 * memory after reading the whole node. Shared by `lib/db.ts`'s `readAll`
 * and `lib/db-client.ts`'s `useTable`/`useRow` so server and browser reads
 * push down identically.
 */
export function pickPushdown<T extends object>(by: T | undefined | null): { key: string; value: unknown } | null {
  if (!by) return null
  for (const [key, value] of Object.entries(by)) {
    if (value != null && INDEXED_COLUMNS.has(key)) return { key, value }
  }
  return null
}
