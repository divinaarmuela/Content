/**
 * WHICH SHOOT AND BOARD COMMENTS THE CLIENT MAY SEE (the owner, 22 Sep 2026:
 * "there is a comment on the client portal — that is an internal comment
 * from Divina to Karly; it should not be on the portal … no comments in the
 * shoot plan should be in the client portal").
 *
 * The shoot plan's thread is the TEAM'S: what the team says about the plan
 * — tagged or not — never reaches the portal. What the client sees there
 * is the board: the comments pinned to its cards (theirs, and the team's
 * replies on the same card), and their own words wherever they left them.
 */
type Row = {
  card_id?: string | null
  assigned_to?: string | null
  body?: string | null
  team_users?: { role?: string | null } | null
}

/** a note that tags a colleague is the team talking to itself, wherever it sits */
export function isTeamOnlyComment(c: Pick<Row, 'assigned_to' | 'body'>): boolean {
  if (c.assigned_to) return true
  return /^\s*@\S/.test(String(c.body ?? ''))
}

/** may the client's page draw this row? */
export function clientMaySee(c: Row): boolean {
  if (c.team_users?.role === 'client') return true
  if (!c.card_id) return false
  return !isTeamOnlyComment(c)
}

/** the rows the client's page draws */
export function forTheClient<T extends Row>(rows: readonly T[]): T[] {
  return rows.filter(clientMaySee)
}
