import 'server-only'
import { supabase } from '@/lib/supabase'
import { decryptSecret, encryptSecret } from './secret-box'
import { normaliseRoot, safeSegment } from './dropbox-core'

/**
 * Dropbox for the agency's filing cabinet.
 *
 * ONE connection for the whole team, not one per person: the folder tree is
 * shared, so a second account would fork it. The row is keyed 'team' and the
 * refresh token is encrypted with the same envelope as the calendar and inbox
 * connections.
 *
 * Every env read is LAZY. `app/lib/supabase.ts` already taught this codebase
 * that reading credentials at module load turns a missing variable into a
 * failed *build* rather than a failed request — so DROPBOX_APP_KEY and
 * DROPBOX_APP_SECRET are read inside the functions that need them, and their
 * absence is a clean "not configured" answer that the Integrations card can
 * show. The app builds and runs with Dropbox switched off.
 *
 * Naming and path building live in dropbox-core.ts, which has no I/O and is
 * unit-tested; this file is the wrapper that talks to the API.
 */

/** Every scope the folder work needs. Changing this needs a re-consent. */
export const DROPBOX_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.metadata.write',
  'files.content.read',
  'files.content.write',
  'sharing.read',
  'sharing.write',
].join(' ')

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize'
const RPC = 'https://api.dropboxapi.com/2'

export const NOT_CONFIGURED = 'Dropbox is not configured'

function appKey(): string | null {
  return process.env.DROPBOX_APP_KEY?.trim() || null
}
function appSecret(): string | null {
  return process.env.DROPBOX_APP_SECRET?.trim() || null
}

/** Both halves of the app credentials present. Never throws. */
export function dropboxConfigured(): boolean {
  return Boolean(appKey() && appSecret())
}

export type DropboxFailure = {
  ok: false
  reason: 'not_configured' | 'not_connected' | 'exchange_failed' | 'no_refresh_token' | 'api_error'
  message: string
  detail?: string
}
type Ok<T> = { ok: true } & T
export type DropboxResult<T> = Ok<T> | DropboxFailure

const notConfigured = (): DropboxFailure =>
  ({ ok: false, reason: 'not_configured', message: NOT_CONFIGURED })
const notConnected = (): DropboxFailure =>
  ({ ok: false, reason: 'not_connected', message: 'Dropbox is not connected' })

// ── the connection row ────────────────────────────────────────────────────

type ConnectionRow = {
  account_email: string | null
  account_name: string | null
  refresh_token_encrypted: string | null
  root_path: string | null
  connected_at: string | null
  connected_by: string | null
}

/** The single connection row, or null. A missing TABLE reads as "not
 *  connected" rather than a 500 — the migration may not have been run yet. */
async function connection(): Promise<ConnectionRow | null> {
  try {
    const { data, error } = await supabase
      .from('dropbox_connection')
      .select('account_email, account_name, refresh_token_encrypted, root_path, connected_at, connected_by')
      .eq('id', 'team')
      .maybeSingle()
    if (error) return null
    return (data as ConnectionRow) ?? null
  } catch {
    return null
  }
}

export type DropboxStatus = {
  configured: boolean
  connected: boolean
  account_email: string | null
  account_name: string | null
  root_path: string
  connected_at: string | null
  connected_by: string | null
}

/** What the Integrations card renders. Tokens never appear here. */
export async function dropboxStatus(): Promise<DropboxStatus> {
  const configured = dropboxConfigured()
  const row = configured ? await connection() : null
  return {
    configured,
    connected: Boolean(row?.refresh_token_encrypted),
    account_email: row?.account_email ?? null,
    account_name: row?.account_name ?? null,
    root_path: normaliseRoot(row?.root_path),
    connected_at: row?.connected_at ?? null,
    connected_by: row?.connected_by ?? null,
  }
}

/** The configured root, e.g. `/Clients`. Falls back when not connected. */
export async function rootPath(): Promise<string> {
  return normaliseRoot((await connection())?.root_path)
}

// ── the consent flow ──────────────────────────────────────────────────────

/** Where Dropbox sends them back. */
export function dropboxRedirectUri(req: Request): string {
  return `${new URL(req.url).origin}/api/dropbox/callback`
}

/**
 * Where to send someone to grant access.
 *
 * `token_access_type=offline` is the part that matters: without it Dropbox
 * issues a short-lived access token and NO refresh token, so the connection
 * silently dies four hours later.
 */
export function dropboxConsentUrl(req: Request, state: string): string {
  return `${AUTHORIZE_URL}?` + new URLSearchParams({
    client_id: appKey() ?? '',
    redirect_uri: dropboxRedirectUri(req),
    response_type: 'code',
    token_access_type: 'offline',
    scope: DROPBOX_SCOPES,
    state,
  })
}

type TokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  account_id?: string
}

export type DropboxAccount = { email: string; name: string; isTeam: boolean }

/** Who the token belongs to. `team` present means the account is on a Dropbox
 *  team, which decides whether a shared link may be team-only. */
async function currentAccount(token: string): Promise<DropboxAccount | null> {
  // users/get_current_account takes Void — no body and no Content-Type, which
  // is what the RPC convention asks for.
  const res = await fetch(`${RPC}/users/get_current_account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const json = await res.json() as {
    email?: string
    name?: { display_name?: string }
    team?: unknown
  }
  const email = String(json.email ?? '').trim().toLowerCase()
  if (!email) return null
  return {
    email,
    name: json.name?.display_name?.trim() || email,
    isTeam: Boolean(json.team),
  }
}

/** Exchange the callback code, learn whose account it is, store the token. */
export async function completeDropboxConnect(
  req: Request, code: string, by: string,
): Promise<DropboxResult<{ email: string; name: string }>> {
  const key = appKey(), secret = appSecret()
  if (!key || !secret) return notConfigured()

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: key,
      client_secret: secret,
      redirect_uri: dropboxRedirectUri(req),
    }),
  })
  if (!res.ok) {
    return {
      ok: false, reason: 'exchange_failed',
      message: 'Dropbox refused the sign-in',
      detail: (await res.text()).slice(0, 200),
    }
  }

  const token = await res.json() as TokenResponse
  if (!token.refresh_token) {
    return {
      ok: false, reason: 'no_refresh_token',
      message: 'Dropbox did not return a refresh token — the app must request token_access_type=offline',
    }
  }

  const account = token.access_token ? await currentAccount(token.access_token) : null

  const { error } = await supabase.from('dropbox_connection').upsert({
    id: 'team',
    account_email: account?.email ?? null,
    account_name: account?.name ?? null,
    refresh_token_encrypted: encryptSecret(token.refresh_token),
    connected_at: new Date().toISOString(),
    connected_by: by,
  }, { onConflict: 'id' })
  if (error) {
    return { ok: false, reason: 'api_error', message: 'Could not save the connection', detail: error.message }
  }

  // a fresh connection invalidates whatever this process had cached
  cachedToken = null
  cachedAccount = null

  return { ok: true, email: account?.email ?? '', name: account?.name ?? '' }
}

/** Forget the token. The root path and the folder links already stored on
 *  shoots and items survive, so a reconnect picks up where it left off. */
export async function disconnectDropbox(): Promise<void> {
  cachedToken = null
  cachedAccount = null
  const { error } = await supabase.from('dropbox_connection')
    .update({
      refresh_token_encrypted: null,
      connected_at: null,
      connected_by: null,
      account_email: null,
      account_name: null,
    })
    .eq('id', 'team')
  if (error) throw new Error(error.message)
}

// ── access tokens ─────────────────────────────────────────────────────────

// One cached access token for the lifetime of the process. Dropbox access
// tokens last ~4 hours; refreshing on every call would be a round trip per
// folder created.
let cachedToken: { token: string; expiresAt: number } | null = null
let cachedAccount: DropboxAccount | null = null

/**
 * A usable access token, refreshed on demand.
 *
 * Returns a failure rather than throwing, because every caller here is on a
 * best-effort path — a folder that could not be created must never take down
 * the request that created the shoot.
 */
export async function accessToken(): Promise<DropboxResult<{ token: string }>> {
  const key = appKey(), secret = appSecret()
  if (!key || !secret) return notConfigured()

  // 60s of headroom so a token never expires mid-request
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return { ok: true, token: cachedToken.token }
  }

  const row = await connection()
  if (!row?.refresh_token_encrypted) return notConnected()

  let refresh: string
  try {
    refresh = decryptSecret(row.refresh_token_encrypted)
  } catch (e) {
    return {
      ok: false, reason: 'not_connected',
      message: 'The stored Dropbox token could not be read — reconnect Dropbox',
      detail: e instanceof Error ? e.message : undefined,
    }
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: key,
      client_secret: secret,
    }),
  })
  if (!res.ok) {
    return {
      ok: false, reason: 'exchange_failed',
      message: 'Dropbox would not refresh the connection — reconnect Dropbox',
      detail: (await res.text()).slice(0, 200),
    }
  }
  const json = await res.json() as TokenResponse
  if (!json.access_token) {
    return { ok: false, reason: 'exchange_failed', message: 'Dropbox returned no access token' }
  }
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 14_400) * 1000,
  }
  return { ok: true, token: json.access_token }
}

/** One JSON-RPC call. `null` body means a Void-argument route. */
async function rpc<T>(
  path: string, body: unknown,
): Promise<DropboxResult<{ data: T }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const res = await fetch(`${RPC}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400)
    return { ok: false, reason: 'api_error', message: `Dropbox ${res.status}`, detail }
  }
  return { ok: true, data: await res.json() as T }
}

/** The connected account, fetched once per process. */
export async function dropboxAccount(): Promise<DropboxAccount | null> {
  if (cachedAccount) return cachedAccount
  const auth = await accessToken()
  if (!auth.ok) return null
  cachedAccount = await currentAccount(auth.token)
  return cachedAccount
}

// ── folders ───────────────────────────────────────────────────────────────

/**
 * Make sure a folder exists.
 *
 * "Already there" is SUCCESS, not an error: these calls run on every shoot
 * create and every item create, and the whole point is that the tree
 * converges on the right shape. Dropbox answers a collision with 409 and an
 * error summary starting `path/conflict`, which is exactly the outcome we
 * want, so it is mapped to ok.
 *
 * autorename stays false deliberately — an autorenamed folder is a folder at
 * a path we did not record, which is worse than not creating it at all.
 */
export async function ensureFolder(path: string): Promise<DropboxResult<{ path: string }>> {
  const res = await rpc<{ metadata?: { path_display?: string } }>(
    '/files/create_folder_v2', { path, autorename: false },
  )
  if (res.ok) return { ok: true, path: res.data.metadata?.path_display ?? path }
  // `path/conflict/folder/…` — something is already there, which is the
  // state we were asking for
  if (res.reason === 'api_error' && /path\/conflict/.test(res.detail ?? '')) {
    return { ok: true, path }
  }
  return res
}

/** Create a chain of folders, parents first. The first real failure stops it. */
export async function ensureFolders(paths: string[]): Promise<DropboxResult<{ paths: string[] }>> {
  const made: string[] = []
  for (const p of paths) {
    const res = await ensureFolder(p)
    if (!res.ok) return res
    made.push(res.path)
  }
  return { ok: true, paths: made }
}

/** The names directly inside a folder. A folder that does not exist yet is an
 *  empty list — "nothing to collide with" is the honest answer there. */
export async function listFolderNames(path: string): Promise<string[]> {
  type Entry = { '.tag'?: string; name?: string }
  const res = await rpc<{ entries?: Entry[] }>(
    '/files/list_folder', { path, recursive: false, limit: 2000 },
  )
  if (!res.ok) return []
  return (res.data.entries ?? [])
    .filter(e => e['.tag'] === 'folder')
    .map(e => safeSegment(String(e.name ?? '')))
}

// ── shared links ──────────────────────────────────────────────────────────

/**
 * A link to a folder, minted once and reused.
 *
 * Dropbox refuses to create a second link for the same path
 * (`shared_link_already_exists`), and the docs say so explicitly: list the
 * existing ones instead. So the existing link is asked for FIRST, which is
 * also the cheap path on every call after the first.
 *
 * Visibility: a Dropbox *team* account can restrict a link to the team, which
 * is what internal footage should be. A personal account has no team, so
 * team_only would be rejected — it gets `public` (an unlisted link, only
 * reachable by someone holding the URL). If Dropbox refuses the setting
 * anyway, one retry without a visibility setting takes whatever default the
 * account allows rather than losing the link entirely.
 */
export async function sharedLink(path: string): Promise<string | null> {
  type Link = { url?: string }
  const existing = await rpc<{ links?: Link[] }>(
    '/sharing/list_shared_links', { path, direct_only: true },
  )
  if (existing.ok) {
    const url = (existing.data.links ?? []).find(l => l.url)?.url
    if (url) return url
  }

  const account = await dropboxAccount()
  const visibility = account?.isTeam ? 'team_only' : 'public'

  const created = await rpc<Link>(
    '/sharing/create_shared_link_with_settings',
    { path, settings: { requested_visibility: visibility } },
  )
  if (created.ok && created.data.url) return created.data.url

  if (!created.ok && created.reason === 'api_error') {
    // it was created between the list and the create — read it back
    if (/shared_link_already_exists/.test(created.detail ?? '')) {
      const again = await rpc<{ links?: Link[] }>(
        '/sharing/list_shared_links', { path, direct_only: true },
      )
      if (again.ok) return (again.data.links ?? []).find(l => l.url)?.url ?? null
    }
    // the account would not accept that visibility — take its default
    if (/settings_error/.test(created.detail ?? '')) {
      const plain = await rpc<Link>(
        '/sharing/create_shared_link_with_settings', { path, settings: {} },
      )
      if (plain.ok && plain.data.url) return plain.data.url
    }
  }
  return null
}

/** Create the folder and return its link — the pair every hook wants. */
export async function ensureFolderWithLink(
  path: string,
): Promise<{ path: string; url: string | null } | null> {
  const made = await ensureFolder(path)
  if (!made.ok) return null
  return { path: made.path, url: await sharedLink(made.path) }
}
