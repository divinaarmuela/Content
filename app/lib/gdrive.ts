import 'server-only'
import { table } from '@/lib/db'
import type { Client, DriveConnection } from '@/lib/db-types'
import { decryptSecret, encryptSecret, credentialsKeyConfigured } from './secret-box'
import {
  forgetGoogleToken, googleAccessToken, inboxClientId, inboxClientSecret,
} from './inbox-connect'
import {
  FOLDER_MIME, escapeQueryValue, folderQuery, folderUrl, normaliseRoot, safeSegment,
} from './gdrive-core'

/**
 * Google Drive for the agency's filing cabinet.
 *
 * ONE connection for the whole team, not one per person: the folder tree is
 * shared, so a second account would fork it. The row is keyed 'team' and the
 * refresh token is encrypted with the same envelope as the calendar and inbox
 * connections.
 *
 * It reuses the **Internal** Google app (inbox-connect.ts) that already backs
 * inbox and calendar connecting, so there are no new environment variables at
 * all — only a redirect URI to register and the Drive API to enable on the
 * Google Cloud project that is already there.
 *
 * ── The scope, and why the app makes its own root folder ──
 *
 * `drive.file` is Google's non-sensitive per-file scope: the app may see and
 * modify only files and folders **it created itself** (or that a user hands it
 * through a picker). That is the whole reason there is a `root_folder_id`
 * column. A folder this app creates stays visible to it forever, so a root we
 * made is a durable anchor — but a "Clients" folder that already existed in
 * the account is invisible to us and always will be. We cannot find it, cannot
 * file into it, and cannot even tell you it is there. So the app creates its
 * OWN root (named by `root_name`, default "Clients") and records the id.
 *
 * The alternative was the full `drive` scope, which would let us adopt an
 * existing folder — at the price of Google's restricted-scope verification,
 * an annual security review, and read/write over every file in the account.
 * Not worth it to skip one folder.
 *
 * ── Shared drives ──
 *
 * Every call passes supportsAllDrives (and includeItemsFromAllDrives when
 * listing), so if the root is ever moved into a Shared Drive the tree keeps
 * working instead of quietly 404ing.
 *
 * Naming and query escaping live in gdrive-core.ts, which has no I/O and is
 * unit-tested; this file is the wrapper that talks to the API.
 */

/**
 * `drive.file` for the folders, plus OpenID for "who did we just connect?".
 *
 * The userinfo endpoint needs `openid` and `email`; `profile` is what supplies
 * a display name. Changing this list needs a re-consent.
 */
export const DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
export const FILES = 'https://www.googleapis.com/drive/v3/files'
/** The upload host is a DIFFERENT origin from the metadata one — posting a
 *  resumable session to www.googleapis.com/drive/v3 silently creates an empty
 *  file instead. */
export const UPLOAD_FILES = 'https://www.googleapis.com/upload/drive/v3/files'

export const NOT_CONFIGURED = 'Google Drive is not configured'

/** Domains that are Google accounts, not Workspace organisations — there is
 *  no domain to share a folder with. */
const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * The Internal app's credentials are present.
 *
 * Every env read is LAZY. Reading credentials at module load turns a missing
 * variable into a failed *build* rather than a failed request (CLAUDE.md
 * trap 7). Never throws.
 */
export function driveConfigured(): boolean {
  return Boolean(inboxClientId() && inboxClientSecret() && credentialsKeyConfigured())
}

export type DriveFailure = {
  ok: false
  reason: 'not_configured' | 'not_connected' | 'exchange_failed' | 'no_refresh_token' | 'api_error'
  message: string
  detail?: string
}
type Ok<T> = { ok: true } & T
export type DriveResult<T> = Ok<T> | DriveFailure

const notConfigured = (): DriveFailure =>
  ({ ok: false, reason: 'not_configured', message: NOT_CONFIGURED })
const notConnected = (): DriveFailure =>
  ({ ok: false, reason: 'not_connected', message: 'Google Drive is not connected' })

// ── the connection row ────────────────────────────────────────────────────

/** ONE connection for the whole team; the row's primary key says so. */
const TEAM = 'team'

/**
 * The single connection row, or null. ONE connection for the whole team, so
 * the row has been keyed 'team' since the first version. An unreadable row
 * means "not connected" rather than a 500.
 */
async function connection(): Promise<DriveConnection | null> {
  try {
    return await table<DriveConnection>('drive_connection').get(TEAM)
  } catch {
    return null
  }
}

/** Write onto the one connection row, opening it the first time. */
async function writeConnection(patch: Partial<DriveConnection>): Promise<void> {
  const rows = table<DriveConnection>('drive_connection')
  if (await rows.get(TEAM)) await rows.update(TEAM, patch)
  else await table('drive_connection').insert({ id: TEAM, ...patch })
}

/** The Workspace domain folders are shared with, or null for a personal
 *  Google account (which has no domain to share with). */
export function sharingDomainFor(email: string | null | undefined): string | null {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1] ?? ''
  if (!domain || PERSONAL_DOMAINS.has(domain)) return null
  return domain
}

export type DriveStatus = {
  configured: boolean
  connected: boolean
  account_email: string | null
  account_name: string | null
  root_name: string
  root_folder_id: string | null
  connected_at: string | null
  connected_by: string | null
  /** How a new folder becomes reachable by the rest of the team. */
  sharing: 'domain' | 'none'
  sharing_domain: string | null
  /** Plain English for the Integrations card, including the last refusal. */
  sharing_note: string | null
  /** The folder a person PICKED with the Google Picker, if they have. */
  root_picked: boolean
  root_folder_name: string | null
  root_owner_email: string | null
  /** The "Clients" folder inside it — what every client folder hangs off. */
  clients_folder_id: string | null
}

/** The last thing Drive said when a domain share was refused. Per-process and
 *  advisory — it explains a card, it is never load-bearing. */
let lastSharingError: string | null = null

/** What the Integrations card renders. Tokens never appear here. */
export async function driveStatus(): Promise<DriveStatus> {
  const configured = driveConfigured()
  const row = configured ? await connection() : null
  const domain = sharingDomainFor(row?.account_email)
  return {
    configured,
    connected: Boolean(row?.refresh_token_encrypted),
    account_email: row?.account_email ?? null,
    account_name: row?.account_name ?? null,
    root_name: normaliseRoot(row?.root_name),
    root_folder_id: row?.root_folder_id ?? null,
    connected_at: row?.connected_at ?? null,
    connected_by: row?.connected_by ?? null,
    sharing: domain ? 'domain' : 'none',
    sharing_domain: domain,
    root_picked: Boolean(row?.root_picked),
    root_folder_name: row?.root_folder_name ?? null,
    root_owner_email: row?.root_owner_email ?? null,
    clients_folder_id: row?.clients_folder_id ?? null,
    sharing_note: !row?.refresh_token_encrypted
      ? null
      : lastSharingError
        ? `Folders are not being shared automatically — Drive said: ${lastSharingError}. Share them by hand, or from the folder's own sharing settings.`
        : domain
          ? `New folders are shared with everyone at ${domain}.`
          : 'This is a personal Google account, so new folders are not shared automatically — grant access per person in Drive.',
  }
}

/** The configured root folder's name, e.g. `Clients`. */
export async function rootName(): Promise<string> {
  return normaliseRoot((await connection())?.root_name)
}

// ── the consent flow ──────────────────────────────────────────────────────

/** Where Google sends them back. Derived from the REQUEST, so both legs of
 *  the flow use the same origin by construction. */
export function driveRedirectUri(req: Request): string {
  return `${new URL(req.url).origin}/api/gdrive/callback`
}

/**
 * Where to send someone to grant access.
 *
 * `access_type=offline` with `prompt=consent` is what forces Google to return
 * a REFRESH token. Without both, a second consent returns only an access
 * token, which expires in an hour and leaves a connection that files one
 * shoot and then silently stops.
 */
export function driveConsentUrl(req: Request, state: string): string {
  return `${AUTHORIZE_URL}?` + new URLSearchParams({
    client_id: inboxClientId(),
    redirect_uri: driveRedirectUri(req),
    response_type: 'code',
    scope: DRIVE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
}

export type DriveAccount = { email: string; name: string; domain: string | null }

/** Who the token belongs to. `hd` is Google's own answer to "which Workspace
 *  domain", which beats parsing the email — but the email is the fallback. */
async function userInfo(token: string): Promise<DriveAccount | null> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const json = await res.json() as { email?: string; name?: string; hd?: string }
  const email = String(json.email ?? '').trim().toLowerCase()
  if (!email) return null
  const hd = String(json.hd ?? '').trim().toLowerCase() || null
  return {
    email,
    name: String(json.name ?? '').trim() || email,
    domain: hd ?? sharingDomainFor(email),
  }
}

/** Exchange the callback code, learn whose account it is, make sure the root
 *  folder exists, and store the connection. */
export async function completeDriveConnect(
  req: Request, code: string, by: string,
): Promise<DriveResult<{ email: string; name: string }>> {
  if (!driveConfigured()) return notConfigured()

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: inboxClientId(),
      client_secret: inboxClientSecret(),
      redirect_uri: driveRedirectUri(req),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    return {
      ok: false, reason: 'exchange_failed',
      message: 'Google refused the sign-in',
      detail: (await res.text()).slice(0, 200),
    }
  }

  const token = await res.json() as { access_token?: string; refresh_token?: string }
  if (!token.refresh_token) {
    return {
      ok: false, reason: 'no_refresh_token',
      message: 'Google did not return a refresh token — the consent must use access_type=offline and prompt=consent',
    }
  }

  const account = token.access_token ? await userInfo(token.access_token) : null

  // the root folder is created with the ACCESS token we already hold, before
  // anything is stored: a connection whose root could not be made is not a
  // connection, and finding that out now beats finding out on the first shoot.
  //
  // A PICKED root is the exception: a person has already said where the filing
  // cabinet is, and making a second one in My Drive would be the app overruling
  // them. Reconnecting keeps the folder they chose.
  const existing = await connection()
  const wantedRoot = normaliseRoot(existing?.root_name)
  let rootId = existing?.root_folder_id ?? null
  if (token.access_token && !existing?.root_picked) {
    const made = await ensureRootFolder(token.access_token, wantedRoot, rootId)
    if (!made.ok) return made
    rootId = made.id
  }

  try {
    await writeConnection({
      account_email: account?.email ?? null,
      account_name: account?.name ?? null,
      refresh_token_encrypted: encryptSecret(token.refresh_token),
      root_name: wantedRoot,
      root_folder_id: rootId,
      connected_at: new Date().toISOString(),
      connected_by: by,
    })
  } catch (e) {
    return {
      ok: false, reason: 'api_error', message: 'Could not save the connection',
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  // a fresh connection invalidates whatever this process had cached
  forgetGoogleToken()
  cachedRootId = null
  lastSharingError = null

  return { ok: true, email: account?.email ?? '', name: account?.name ?? '' }
}

/** Forget the token. The root folder id and the links already stored on
 *  shoots and items survive, so a reconnect picks up where it left off. */
export async function disconnectDrive(): Promise<void> {
  const row = await connection()
  if (row?.refresh_token_encrypted) {
    try { forgetGoogleToken(decryptSecret(row.refresh_token_encrypted)) } catch { forgetGoogleToken() }
  }
  cachedRootId = null
  lastSharingError = null
  await writeConnection({
    refresh_token_encrypted: null,
    connected_at: null,
    connected_by: null,
    account_email: null,
    account_name: null,
  })
}

// ── access tokens ─────────────────────────────────────────────────────────

/**
 * A usable access token, refreshed on demand.
 *
 * Returns a failure rather than throwing, because every caller here is on a
 * best-effort path — a folder that could not be created must never take down
 * the request that created the shoot. The exchange itself is the shared one in
 * inbox-connect.ts, cache included.
 */
export async function accessToken(): Promise<DriveResult<{ token: string }>> {
  if (!driveConfigured()) return notConfigured()

  const row = await connection()
  if (!row?.refresh_token_encrypted) return notConnected()

  let refresh: string
  try {
    refresh = decryptSecret(row.refresh_token_encrypted)
  } catch (e) {
    return {
      ok: false, reason: 'not_connected',
      message: 'The stored Google Drive token could not be read — reconnect Google Drive',
      detail: e instanceof Error ? e.message : undefined,
    }
  }

  try {
    return { ok: true, token: await googleAccessToken(refresh) }
  } catch (e) {
    return {
      ok: false, reason: 'exchange_failed',
      message: 'Google would not refresh the connection — reconnect Google Drive',
      detail: e instanceof Error ? e.message.slice(0, 200) : undefined,
    }
  }
}

// ── the Drive API ─────────────────────────────────────────────────────────

/** Shared-drive support on every single call: if the root is ever moved into
 *  a Shared Drive, nothing here starts 404ing. */
export const ALL_DRIVES = { supportsAllDrives: 'true' }
export const ALL_DRIVES_LIST = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }

export async function driveFetch<T>(
  token: string, url: string, init?: RequestInit,
): Promise<DriveResult<{ data: T }>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    return {
      ok: false, reason: 'api_error',
      message: `Google Drive ${res.status}`,
      detail: (await res.text()).slice(0, 400),
    }
  }
  return { ok: true, data: await res.json() as T }
}

type DriveFile = { id?: string; name?: string }

/** The first folder called `name` directly inside `parentId`, or null. */
async function findFolder(
  token: string, parentId: string, name: string,
): Promise<DriveResult<{ id: string | null }>> {
  const url = `${FILES}?` + new URLSearchParams({
    q: folderQuery(parentId, name),
    fields: 'files(id,name)',
    pageSize: '10',
    ...ALL_DRIVES_LIST,
  })
  const res = await driveFetch<{ files?: DriveFile[] }>(token, url)
  if (!res.ok) return res
  return { ok: true, id: res.data.files?.find(f => f.id)?.id ?? null }
}

async function createFolder(
  token: string, parentId: string, name: string,
): Promise<DriveResult<{ id: string }>> {
  const url = `${FILES}?` + new URLSearchParams({ fields: 'id', ...ALL_DRIVES })
  const res = await driveFetch<DriveFile>(token, url, {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  if (!res.ok) return res
  if (!res.data.id) {
    return { ok: false, reason: 'api_error', message: 'Google Drive created a folder with no id' }
  }
  return { ok: true, id: res.data.id }
}

/**
 * Find the folder, or make it. "Already there" is SUCCESS, not an error:
 * these calls run on every shoot create and every item create, and the whole
 * point is that the tree converges on the right shape.
 *
 * Drive will happily create two sibling folders with the SAME name — it has
 * no unique-name constraint at all — so find-first is not an optimisation
 * here, it is the only thing standing between us and a duplicate tree. Two
 * requests racing on the same missing folder can still both create one; the
 * hooks narrow that further by picking collision-free names up front, and the
 * database writeback is guarded so only one of them is ever recorded.
 */
export async function ensureFolder(
  parentId: string, name: string,
): Promise<DriveResult<{ id: string }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  return ensureFolderWith(auth.token, parentId, name)
}

async function ensureFolderWith(
  token: string, parentId: string, name: string,
): Promise<DriveResult<{ id: string }>> {
  const safe = safeSegment(name)
  const found = await findFolder(token, parentId, safe)
  if (!found.ok) return found
  if (found.id) return { ok: true, id: found.id }
  return createFolder(token, parentId, safe)
}

/** Walk a chain of names from a parent down, creating what is missing.
 *  Returns the id of the LAST folder. */
export async function ensureChain(
  parentId: string, names: string[],
): Promise<DriveResult<{ id: string }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  let id = parentId
  for (const name of names) {
    const made = await ensureFolderWith(auth.token, id, name)
    if (!made.ok) return made
    id = made.id
  }
  return { ok: true, id }
}

/** The folder names directly inside a folder. A folder we cannot read is an
 *  empty list — "nothing to collide with" is the honest answer there. */
export async function listFolderNames(parentId: string): Promise<string[]> {
  const auth = await accessToken()
  if (!auth.ok) return []
  const names: string[] = []
  let pageToken: string | undefined
  // paginate: a client with more than 1000 shoots is not a reason to start
  // silently reusing names
  do {
    const url = `${FILES}?` + new URLSearchParams({
      q: `'${parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id,name)',
      pageSize: '1000',
      ...ALL_DRIVES_LIST,
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await driveFetch<{ files?: DriveFile[]; nextPageToken?: string }>(auth.token, url)
    if (!res.ok) return names
    for (const f of res.data.files ?? []) if (f.name) names.push(safeSegment(f.name))
    pageToken = res.data.nextPageToken
  } while (pageToken)
  return names
}

// ── the root folder ───────────────────────────────────────────────────────

let cachedRootId: string | null = null

/**
 * The app's own root folder, created if it is not there.
 *
 * `'root' in parents` searches My Drive's top level — but under `drive.file`
 * that search can only ever return folders THIS APP made, which is exactly the
 * find-or-create we want: a "Clients" folder the owner made by hand is
 * invisible to us and will not be adopted (or clobbered). If a previously
 * recorded id still resolves, it wins outright — the folder may have been
 * moved or renamed since, and the id is what is true.
 */
async function ensureRootFolder(
  token: string, name: string, knownId: string | null,
): Promise<DriveResult<{ id: string }>> {
  if (knownId) {
    const url = `${FILES}/${encodeURIComponent(knownId)}?` +
      new URLSearchParams({ fields: 'id,trashed', ...ALL_DRIVES })
    const res = await driveFetch<{ id?: string; trashed?: boolean }>(token, url)
    if (res.ok && res.data.id && !res.data.trashed) return { ok: true, id: res.data.id }
    // gone or trashed: fall through and make a new one
  }
  const found = await findFolder(token, 'root', name)
  if (!found.ok) return found
  if (found.id) return { ok: true, id: found.id }
  return createFolder(token, 'root', name)
}

/**
 * The id everything hangs off. Null when Drive is not connected — which is a
 * no-op for every caller, never an error.
 */
export async function rootFolderId(): Promise<string | null> {
  if (cachedRootId) return cachedRootId
  const row = await connection()
  if (!row?.refresh_token_encrypted) return null

  // a picked HQ folder wins outright, and nothing is created from a name:
  // the whole point of picking was that the folder already exists and the app
  // must file INTO it rather than beside it
  if (row.root_picked && row.clients_folder_id) {
    cachedRootId = row.clients_folder_id
    return cachedRootId
  }

  const auth = await accessToken()
  if (!auth.ok) return null

  const made = await ensureRootFolder(auth.token, normaliseRoot(row.root_name), row.root_folder_id)
  if (!made.ok) return null

  if (made.id !== row.root_folder_id) {
    await writeConnection({ root_folder_id: made.id })
  }
  cachedRootId = made.id
  return made.id
}

// ── the folder a person picked ─────────────────────────────

/**
 * What the Picker gave us, and what the review screen needs.
 *
 * `owner_email` is whatever Drive says the folder belongs to; the Picker does
 * not always return it, and a folder inside a Shared Drive has no single
 * owner at all, so it is shown when known and never depended on.
 */
export type PickedRoot = {
  id: string
  name: string
  owner_email: string | null
  picked_at: string | null
  picked_by: string | null
  clients_folder_id: string | null
}

export async function pickedRoot(): Promise<PickedRoot | null> {
  const row = await connection()
  if (!row?.root_picked || !row.root_folder_id) return null
  return {
    id: row.root_folder_id,
    name: row.root_folder_name ?? '',
    owner_email: row.root_owner_email ?? null,
    picked_at: row.root_picked_at ?? null,
    picked_by: row.root_picked_by ?? null,
    clients_folder_id: row.clients_folder_id ?? null,
  }
}

/** What Drive says about one folder, asked with our own token — which is also
 *  the check that the Picker's grant actually landed on this app. */
export async function readFolder(
  folderId: string,
): Promise<DriveResult<{ name: string; ownerEmail: string | null }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(folderId)}?` + new URLSearchParams({
    fields: 'id,name,mimeType,trashed,owners(emailAddress)', ...ALL_DRIVES,
  })
  const res = await driveFetch<{
    name?: string; mimeType?: string; trashed?: boolean
    owners?: { emailAddress?: string }[]
  }>(auth.token, url)
  if (!res.ok) return res
  if (res.data.mimeType !== FOLDER_MIME) {
    return { ok: false, reason: 'api_error', message: 'That is a file, not a folder' }
  }
  if (res.data.trashed) {
    return { ok: false, reason: 'api_error', message: 'That folder is in the bin' }
  }
  return {
    ok: true,
    name: res.data.name ?? '',
    ownerEmail: res.data.owners?.[0]?.emailAddress ?? null,
  }
}

/**
 * Record the folder a person chose in the Picker.
 *
 * The `Clients` subfolder is deliberately NOT resolved here: finding it is a
 * read, creating it is a decision, and the review screen is where that
 * decision is put to a person. Choosing a different folder clears whatever was
 * resolved for the old one, because it belonged to the old one.
 */
export async function savePickedRoot(args: {
  id: string; name: string; ownerEmail: string | null; by: string
}): Promise<void> {
  await writeConnection({
    root_folder_id: args.id,
    root_folder_name: args.name,
    root_owner_email: args.ownerEmail,
    root_picked: true,
    root_picked_at: new Date().toISOString(),
    root_picked_by: args.by,
    clients_folder_id: null,
  })
  cachedRootId = null
}

/** Remember which folder inside the picked root the clients live in. */
export async function saveClientsFolder(id: string): Promise<void> {
  await writeConnection({ clients_folder_id: id })
  cachedRootId = null
}

/** The folders directly inside a folder, with their ids. `listFolderNames`
 *  answers "what names are taken"; this answers "what is actually in there". */
export async function listSubfolders(
  parentId: string,
): Promise<DriveResult<{ folders: { id: string; name: string }[] }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const folders: { id: string; name: string }[] = []
  let pageToken: string | undefined
  do {
    const url = `${FILES}?` + new URLSearchParams({
      q: `'${escapeQueryValue(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id,name)',
      pageSize: '1000',
      orderBy: 'name',
      ...ALL_DRIVES_LIST,
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await driveFetch<{ files?: DriveFile[]; nextPageToken?: string }>(auth.token, url)
    if (!res.ok) return res
    for (const f of res.data.files ?? []) if (f.id && f.name) folders.push({ id: f.id, name: f.name })
    pageToken = res.data.nextPageToken
  } while (pageToken)
  return { ok: true, folders }
}

/** The first folder with this name inside a folder, or null — no creating. */
export async function findSubfolder(
  parentId: string, name: string,
): Promise<DriveResult<{ id: string | null }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  return findFolder(auth.token, parentId, safeSegment(name))
}

/** Make a folder, no questions asked. Used only where a person has already
 *  confirmed they want it. */
export async function createSubfolder(
  parentId: string, name: string,
): Promise<DriveResult<{ id: string }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  return createFolder(auth.token, parentId, safeSegment(name))
}

// ── one client's folder ───────────────────────────────────

/**
 * The folder this client's work lives in — recorded on the client, not
 * guessed from their name.
 *
 * `clients.drive_folder_id` is the truth and is consulted FIRST. That is what
 * makes a folder somebody else made usable at all: it was named by a person
 * years ago and does not have to match the client record for the app to file
 * into it, as long as somebody once said "that is the one".
 *
 * Only when the column is blank does the app fall back to find-or-create by
 * name under the Clients folder, and it writes the id back onto a BLANK column
 * only, so two requests racing cannot end up with two folders recorded.
 */
export async function clientFolderId(
  clientId: string, name: string,
): Promise<string | null> {
  const clients = table<Client>('clients')
  const row = await clients.get(clientId)
  const recorded = String(row?.drive_folder_id ?? '').trim()
  if (recorded) return recorded

  const root = await rootFolderId()
  if (!root) return null
  const made = await ensureFolder(root, name)
  if (!made.ok) return null

  await clients.claim(clientId, cur =>
    cur && !cur.drive_folder_id ? { ...cur, drive_folder_id: made.id } : null)
  return made.id
}

/** A chain of folders BELOW the client's own folder, created as needed. */
export async function ensureClientChain(
  clientId: string, name: string, tail: string[],
): Promise<DriveResult<{ id: string }>> {
  const clientDir = await clientFolderId(clientId, name)
  if (!clientDir) return notConnected()
  if (tail.length === 0) return { ok: true, id: clientDir }
  return ensureChain(clientDir, tail)
}

/** The same, plus the link and the team share — what the mirror wants. */
export async function ensureClientChainWithLink(
  clientId: string, name: string, tail: string[],
): Promise<{ id: string; url: string } | null> {
  const made = await ensureClientChain(clientId, name, tail)
  if (!made.ok) return null
  return { id: made.id, url: await shareWithDomain(made.id) }
}

// ── sharing ───────────────────────────────────────────────────────────────

/**
 * Make a folder reachable by the rest of the agency.
 *
 * A Workspace account can grant the whole DOMAIN writer access, which is
 * exactly right for internal footage: everyone at the agency can open it,
 * nobody outside can, and no link needs to be minted or minded.
 *
 * A personal Google account has no domain — and the fallback is deliberately
 * to grant NOTHING rather than `type: 'anyone'`. An "anyone with the link"
 * writer permission on a client's raw footage is a data leak wearing a
 * convenience costume; a folder only the owner can see is merely inconvenient,
 * and the Integrations card says so in as many words.
 *
 * Returns the folder's URL either way: the link works for whoever does have
 * access, and the folder existing is the part the board depends on.
 */
export async function shareWithDomain(folderId: string): Promise<string> {
  const url = folderUrl(folderId)
  const row = await connection()
  const domain = sharingDomainFor(row?.account_email)
  if (!domain) return url

  const auth = await accessToken()
  if (!auth.ok) return url

  const endpoint = `${FILES}/${encodeURIComponent(folderId)}/permissions?` +
    new URLSearchParams({ fields: 'id', sendNotificationEmail: 'false', ...ALL_DRIVES })
  const res = await driveFetch<{ id?: string }>(auth.token, endpoint, {
    method: 'POST',
    body: JSON.stringify({ type: 'domain', role: 'writer', domain }),
  })
  if (res.ok) {
    lastSharingError = null
  } else {
    // a Workspace that forbids domain sharing, or a domain we guessed wrong:
    // the folder still exists and is still linked, so this is a note on the
    // card, not a failure of the hook
    lastSharingError = (res.detail ?? res.message).slice(0, 160)
    console.error('[gdrive] domain share failed:', res.message, res.detail)
  }
  return url
}

/** Create the folder chain and return its id and link — the pair every hook
 *  wants. Null when Drive is not connected. */
export async function ensureChainWithLink(
  names: string[],
): Promise<{ id: string; url: string } | null> {
  const root = await rootFolderId()
  if (!root) return null
  const made = await ensureChain(root, names)
  if (!made.ok) return null
  return { id: made.id, url: await shareWithDomain(made.id) }
}

/** What a folder is called right now, and what it sits in. Drive is the truth
 *  here: our own guess at the name is exactly the thing being corrected. */
export async function folderInfo(
  folderId: string,
): Promise<{ name: string; parentId: string | null } | null> {
  const auth = await accessToken()
  if (!auth.ok) return null
  const url = `${FILES}/${encodeURIComponent(folderId)}?` +
    new URLSearchParams({ fields: 'id,name,parents,trashed', ...ALL_DRIVES })
  const res = await driveFetch<{ name?: string; parents?: string[]; trashed?: boolean }>(auth.token, url)
  if (!res.ok || res.data.trashed) return null
  return { name: res.data.name ?? '', parentId: res.data.parents?.[0] ?? null }
}

/**
 * Rename a folder in place — `files.update` with a new `name`.
 *
 * In place matters: the id does not change, so every link we have recorded,
 * every file already inside it and every permission on it survive. Moving the
 * contents to a new folder would have broken all three, and a Drive link in a
 * client's inbox is not something we get to invalidate.
 *
 * Returns the name Drive is now using, or null if it would not do it — a
 * folder we cannot rename is a cosmetic problem, never a failed request.
 */
export async function renameFolder(
  folderId: string, name: string,
): Promise<string | null> {
  const safe = safeSegment(name)
  const auth = await accessToken()
  if (!auth.ok) return null
  const url = `${FILES}/${encodeURIComponent(folderId)}?` +
    new URLSearchParams({ fields: 'id,name', ...ALL_DRIVES })
  const res = await driveFetch<DriveFile>(auth.token, url, {
    method: 'PATCH',
    body: JSON.stringify({ name: safe }),
  })
  if (!res.ok) {
    console.error('[gdrive] rename failed:', res.message, res.detail)
    return null
  }
  return res.data.name ?? safe
}

export { folderUrl }
