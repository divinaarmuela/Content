/**
 * LINKTREE — the pure half (the owner, 21 Sep 2026: "I want the linktree …
 * set it up on the social channels").
 *
 * WHAT WAS CHECKED BEFORE A LINE WAS WRITTEN (21 Sep 2026, against Linktree's
 * own servers, not a blog):
 *  - Linktree publishes NO public REST API and NO way to create a profile or
 *    an account from outside. The profile is made on linktr.ee, by hand.
 *  - It does run an official server for agents at https://mcp.linktr.ee/mcp
 *    (streamable HTTP, protocol 2025-03-26), behind OAuth 2 with PKCE. Its
 *    own docs (https://mcp.linktr.ee/docs) list 30 tools that MANAGE a
 *    profile the signed-in person can already reach: links, social icons,
 *    appearance, analytics, workspaces. "Cannot create new profiles."
 *  - Its authorization server allows dynamic client registration. This app
 *    registered itself once, as a public client (no secret, PKCE), bound to
 *    the production callback below. The id is not a secret.
 *  - A tool is reached with a scope named after it: `mcp:<tool>`.
 *
 * So: a manager connects a client's Linktree from Social channels, picks the
 * profile, and the dashboard then reads its links and numbers and edits the
 * links. No I/O here.
 */

export const LINKTREE_MCP_URL = 'https://mcp.linktr.ee/mcp'
export const LINKTREE_AUTH_METADATA_URL = 'https://mcp.linktr.ee/.well-known/oauth-authorization-server'
export const LINKTREE_PROTOCOL = '2025-03-26'
export const LINKTREE_CALLBACK_PATH = '/api/production/linktree/callback'

/** the public client this app registered with Linktree on 21 Sep 2026 — an id, not a secret; `LINKTREE_CLIENT_ID` overrides it */
export const LINKTREE_CLIENT_ID_DEFAULT = 'UDMyQUNWcHVkazhNTmZ0bXBmMUxSMXBXNWs4czpUUEEzSmNUNHJlSVZqMDBZRlhHSHdVRWxuc1JJVjQj'

/** the tools this app calls — and so the scopes it asks for, nothing wider */
export const LINKTREE_TOOLS = [
  'list_accessible_profiles', 'get_account', 'get_links', 'add_link', 'update_link', 'reorder_link', 'delete_link',
  'get_account_analytics', 'get_top_links',
] as const
export type LinktreeTool = typeof LINKTREE_TOOLS[number]

export function linktreeScopes(): string {
  return LINKTREE_TOOLS.map(t => `mcp:${t}`).join(' ')
}

export type LinktreeProfile = { username: string; displayName: string | null; profileUrl: string | null; isEditable: boolean }
export type LinktreeLink = { id: number; title: string; url: string; active: boolean }
export type LinktreeNumbers = { views: number | null; clicks: number | null; ctr: number | null; from: string; to: string }

/** the sign-in address a manager is sent to */
export function linktreeAuthorizeUrl(input: {
  authorizationEndpoint: string; clientId: string; redirectUri: string; state: string; codeChallenge: string
}): string {
  const u = new URL(input.authorizationEndpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', input.clientId)
  u.searchParams.set('redirect_uri', input.redirectUri)
  u.searchParams.set('state', input.state)
  u.searchParams.set('code_challenge', input.codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('scope', linktreeScopes())
  u.searchParams.set('resource', LINKTREE_MCP_URL)
  return u.toString()
}

/**
 * What a tool call gave back. A tool answers with `structuredContent`, or
 * with text blocks whose text is usually JSON; `isError` marks a refusal,
 * and its text is the reason ("UPGRADE_REQUIRED", "RATE_LIMITED", …).
 */
export function parseToolResult(result: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  const r = (result ?? {}) as { isError?: unknown; structuredContent?: unknown; content?: unknown }
  const texts = Array.isArray(r.content)
    ? r.content.filter(c => c && typeof c === 'object' && (c as { type?: unknown }).type === 'text').map(c => String((c as { text?: unknown }).text ?? ''))
    : []
  if (r.isError === true) return { ok: false, error: texts.join(' ').trim().slice(0, 400) || 'Linktree refused that' }
  if (r.structuredContent !== undefined && r.structuredContent !== null) return { ok: true, data: r.structuredContent }
  for (const t of texts) {
    try { return { ok: true, data: JSON.parse(t) } } catch { /* plain words — keep looking */ }
  }
  return { ok: true, data: texts.length > 0 ? { text: texts.join('\n') } : null }
}

/** the first array found under any of the usual names — tool outputs wrap their lists differently */
function listUnder(data: unknown, names: readonly string[]): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const n of names) {
      const v = (data as Record<string, unknown>)[n]
      if (Array.isArray(v)) return v
    }
  }
  return []
}

export function profilesFrom(data: unknown): LinktreeProfile[] {
  return listUnder(data, ['profiles', 'accounts', 'items', 'results', 'data'])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map(p => ({
      username: String(p.username ?? '').trim(),
      displayName: typeof p.displayName === 'string' && p.displayName.trim() ? p.displayName.trim() : null,
      profileUrl: typeof p.profileUrl === 'string' && p.profileUrl.trim() ? p.profileUrl.trim() : null,
      isEditable: p.isEditable !== false,
    }))
    .filter(p => p.username.length > 0)
}

export function linksFrom(data: unknown): LinktreeLink[] {
  return listUnder(data, ['links', 'items', 'results', 'data'])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map(l => ({
      id: Number(l.id),
      title: String(l.title ?? '').trim(),
      url: String(l.url ?? '').trim(),
      active: l.active !== false,
    }))
    .filter(l => Number.isFinite(l.id) && l.url.length > 0)
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function numbersFrom(data: unknown, from: string, to: string): LinktreeNumbers {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const totals = (d.totals && typeof d.totals === 'object' ? d.totals : d) as Record<string, unknown>
  return { views: num(totals.views), clicks: num(totals.clicks), ctr: num(totals.ctr ?? totals.clickThroughRate), from, to }
}

/** the last 28 days, as the two dates the analytics tool asks for */
export function analyticsWindow(nowMs: number): { startDate: string; endDate: string } {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { startDate: day(nowMs - 27 * 86_400_000), endDate: day(nowMs) }
}

/** a link a person typed: a real http(s) address and a title that fits */
export function cleanLinkInput(raw: { title?: unknown; url?: unknown }): { ok: true; title: string; url: string } | { ok: false; error: string } {
  const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  let url = String(raw.url ?? '').trim()
  if (!url) return { ok: false, error: 'Paste the address the link goes to' }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const u = new URL(url)
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error('not a web address')
    return { ok: true, title, url: u.toString() }
  } catch {
    return { ok: false, error: 'That does not look like a web address' }
  }
}

/** Linktree's refusals, in the team's words */
export function linktreeErrorWords(raw: string): string {
  const t = String(raw ?? '')
  if (/UPGRADE_REQUIRED/i.test(t)) return 'That needs a paid Linktree plan on this profile'
  if (/RATE_LIMITED/i.test(t)) return 'Linktree asked us to slow down — try again in a minute'
  if (/UNAUTHORI[SZ]ED|invalid_token|401/i.test(t)) return 'The Linktree sign-in has lapsed — connect it again'
  if (/NOT_FOUND/i.test(t)) return 'Linktree could not find that — it may have been removed there'
  if (/PROFILE_REQUIRED/i.test(t)) return 'Pick which Linktree profile this client uses'
  return t.slice(0, 200) || 'Linktree did not answer'
}

/** editing links and connecting is a manager's; looking is anyone's on the team */
export function mayManageLinktree(viewer: { role: string } | null | undefined): boolean {
  return viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
}
