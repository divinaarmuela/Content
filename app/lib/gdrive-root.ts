import 'server-only'
import { table } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { NO_FOLDER_IN_DRIVE, matchClientFolders, normaliseFolderName, safeSegment } from './gdrive-core'
import {
  createSubfolder, driveConfigured, listSubfolders, pickedRoot,
  readFolder, saveClientsFolder, savePickedRoot, shareWithDomain,
} from './gdrive'

/**
 * A Google Drive file id, as Drive writes them. Not a security boundary — the
 * id is escaped everywhere it is used — but a typo'd or half-pasted id becomes
 * a client permanently pointed at nothing, discovered weeks later as "why did
 * that shoot never get a folder". Better to refuse it while a person is still
 * looking at the screen.
 */
export const DRIVE_ID = /^[A-Za-z0-9_-]+$/

/**
 * Pointing the app at the filing cabinet the agency already has.
 *
 * The whole problem in one line: the app uses Google's `drive.file` scope, so
 * it can see only folders it made itself — a folder tree that already exists,
 * with years of client work in it, is invisible to it and always will be. The
 * one door out of that is the Google Picker: when a person picks a folder in
 * the Picker, Google grants THIS app access to that folder, and from then on
 * the app can read it, list it and file into it like any folder it made.
 *
 * So the flow is: a person picks "MD Media HQ" once → the app finds "Clients"
 * inside it → it lines the client list up against the folders that are already
 * there → a person looks at the matches and fixes any that are wrong → apply
 * records a folder id on each client. After that the team simply do their
 * work, and shoots, deliverables and mirrored files land in the folders they
 * have always used.
 *
 * Nothing in here creates a folder before a person has confirmed it. Reading
 * is free; creating a folder in someone's Drive is not, and a "Clients (2)"
 * appearing beside the real one is exactly the mess this replaces.
 */

/** The word for the subfolder that holds one folder per client. */
export const CLIENTS_FOLDER = 'Clients'

export type RootPlanRow = {
  client_id: string
  client_name: string
  /** the folder proposed for this client, if one was found */
  folder_id: string | null
  folder_name: string | null
  /** 'exact' and 'likely' come from the match; 'recorded' means it is settled */
  confidence: 'exact' | 'likely' | 'recorded' | null
  /** what Apply would do: nothing (already recorded), link this folder, or
   *  nothing at all because no folder for this client exists in Drive yet.
   *  There is no "make one" — the app creates nothing in the owner's Drive. */
  action: 'linked' | 'link' | 'none'
}

export type RootPlan = {
  root: { id: string; name: string; owner_email: string | null }
  clients_folder_id: string | null
  /** true when there is no "Clients" folder inside the picked one yet */
  needs_clients_folder: boolean
  rows: RootPlanRow[]
  /** every folder in there, so a person can override a row with any of them */
  folders: { id: string; name: string }[]
  /** folders that belong to no client on the list */
  extra: { id: string; name: string }[]
  /**
   * Clients whose names tidy down to the same thing — "Alia Fragrance" and
   * "Alia Fragrance Pty Ltd". Only one of them can have the folder, and the
   * other would otherwise quietly get a second folder with the same name.
   */
  same_name: { normalised: string; clients: string[] }[]
  matched: number
  total: number
  /** clients with no folder in Drive. A person makes those in Drive, where
   *  they can see what is already in there, and matches them here next time. */
  unmatched: number
}

export type RootFailure = { ok: false; message: string }
export type RootOk<T> = { ok: true } & T

const fail = (message: string): RootFailure => ({ ok: false, message })



/** Clients the folder tree is for. Archived ones are left out: a folder for a
 *  client nobody works with any more is filing for its own sake. */
async function activeClients(): Promise<Client[]> {
  const rows = await table<Client>('clients').list()
  return rows
    .filter(c => String(c.status ?? '').toLowerCase() !== 'archived')
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
}

/**
 * Store the folder somebody picked, after checking we can actually read it.
 *
 * The read is the point: it is the only proof that the Picker's grant reached
 * this app rather than only the browser. A folder we cannot read now is a
 * folder that would fail silently on the first shoot instead.
 */
export async function choosePickedRoot(args: {
  id: string; name?: string | null; by: string
}): Promise<RootOk<{ name: string; owner_email: string | null }> | RootFailure> {
  if (!driveConfigured()) return fail('Google Drive is not set up yet')
  const id = String(args.id ?? '').trim()
  if (!id) return fail('No folder was chosen')
  if (!DRIVE_ID.test(id)) return fail('That is not a Google Drive folder')

  const info = await readFolder(id)
  if (!info.ok) {
    return fail(
      info.reason === 'not_connected'
        ? 'Connect Google Drive first'
        : `That folder could not be opened. Pick it again in the chooser, which is what gives this app access. (${info.message})`,
    )
  }
  const name = info.name || safeSegment(String(args.name ?? '')) || 'Chosen folder'
  await savePickedRoot({ id, name, ownerEmail: info.ownerEmail, by: args.by })
  return { ok: true, name, owner_email: info.ownerEmail }
}

/**
 * What Apply would do, without doing any of it.
 *
 * Nothing in this file writes to Drive any more. It reads the folders that are
 * there and lines them up against the client list; Apply then records the
 * matches on the client rows. The `createClientsFolder` argument is kept so
 * the route's shape does not change under a deployed browser tab, and is
 * ignored — the owner's ruling is that the app makes no folders in their
 * Drive, and "the Clients folder was missing so we made one" is precisely the
 * kind of helpfulness that ends up beside a folder that already existed under
 * a name we did not recognise.
 */
export async function buildRootPlan(opts?: {
  createClientsFolder?: boolean
}): Promise<RootOk<{ plan: RootPlan }> | RootFailure> {
  if (!driveConfigured()) return fail('Google Drive is not set up yet')
  const root = await pickedRoot()
  if (!root) return fail('Choose the folder first')

  // the Clients folder: recorded, or found by name. Never made — see above.
  let clientsFolderId = root.clients_folder_id
  if (!clientsFolderId) {
    const inRoot = await listSubfolders(root.id)
    if (!inRoot.ok) return fail(`Google Drive would not list that folder — ${inRoot.message}`)
    // normalised, so a folder called "clients" or "Clients " is found
    const wanted = normaliseFolderName(CLIENTS_FOLDER)
    clientsFolderId = inRoot.folders.find(f => normaliseFolderName(f.name) === wanted)?.id ?? null
    if (clientsFolderId) await saveClientsFolder(clientsFolderId)
  }

  const clients = await activeClients()
  const base = {
    root: { id: root.id, name: root.name, owner_email: root.owner_email },
    clients_folder_id: clientsFolderId,
    needs_clients_folder: !clientsFolderId,
    total: clients.length,
  }

  if (!clientsFolderId) {
    return {
      ok: true,
      plan: {
        ...base,
        rows: clients.map(c => ({
          client_id: c.id, client_name: c.name, folder_id: null, folder_name: null,
          confidence: null, action: 'none' as const,
        })),
        folders: [], extra: [], same_name: sameName(clients),
        matched: 0, unmatched: clients.length,
      },
    }
  }

  const listed = await listSubfolders(clientsFolderId)
  if (!listed.ok) return fail(`Google Drive would not list the Clients folder — ${listed.message}`)
  const folders = listed.folders
  const nameOf = new Map(folders.map(f => [f.id, f.name]))

  // clients that already have a folder recorded are settled — they are shown,
  // so nothing is hidden, but they are not matched again and their folder is
  // not offered to anybody else
  const settled = clients.filter(c => String(c.drive_folder_id ?? '').trim())
  const spokenFor = new Set(settled.map(c => String(c.drive_folder_id)))
  const open = clients.filter(c => !String(c.drive_folder_id ?? '').trim())

  const plan = matchClientFolders(
    open.map(c => ({ id: c.id, name: c.name })),
    folders.filter(f => !spokenFor.has(f.id)),
  )

  const rows: RootPlanRow[] = [
    ...settled.map(c => ({
      client_id: c.id,
      client_name: c.name,
      folder_id: String(c.drive_folder_id),
      folder_name: nameOf.get(String(c.drive_folder_id)) ?? c.name,
      confidence: 'recorded' as const,
      action: 'linked' as const,
    })),
    ...plan.matched.map(m => ({
      client_id: m.client.id,
      client_name: m.client.name,
      folder_id: m.folder.id,
      folder_name: m.folder.name,
      confidence: m.confidence,
      action: 'link' as const,
    })),
    ...plan.unmatched.map(c => ({
      client_id: c.id,
      client_name: c.name,
      folder_id: null,
      folder_name: null,
      confidence: null,
      action: 'none' as const,
    })),
  ].sort((a, b) => a.client_name.localeCompare(b.client_name))

  return {
    ok: true,
    plan: {
      ...base,
      rows,
      folders,
      extra: plan.extra,
      same_name: sameName(clients),
      matched: rows.filter(r => r.action !== 'none').length,
      unmatched: rows.filter(r => r.action === 'none').length,
    },
  }
}

/** Clients whose tidied names are the same. Two folders with one name in
 *  Drive is legal and unreadable, so it is said out loud instead. */
function sameName(clients: Client[]): { normalised: string; clients: string[] }[] {
  const byName = new Map<string, string[]>()
  for (const c of clients) {
    const key = normaliseFolderName(c.name)
    if (!key) continue
    const list = byName.get(key)
    if (list) list.push(c.name)
    else byName.set(key, [c.name])
  }
  return [...byName]
    .filter(([, names]) => names.length > 1)
    .map(([normalised, names]) => ({ normalised, clients: names }))
}

export type ApplyRow = {
  client_id: string
  /** the folder to attach; omit and set `create` to make a new one */
  folder_id?: string | null
  create?: boolean
}

export type ApplyResult = {
  linked: number
  created: number
  skipped: { client_id: string; why: string }[]
}

/**
 * Attach the folders, and make only the ones that were confirmed.
 *
 * Three rules, each of which the owner's Drive would have paid for:
 *
 * 1. **Idempotent.** Pressing Save twice, or a request that timed out at the
 *    edge and completed on the server, must not leave two "100 Hundred Million
 *    Group" folders in Clients — Drive allows duplicate names without a
 *    murmur. So the create branch re-reads the client, and then looks for an
 *    existing folder by TIDIED name, and only creates when neither answers.
 * 2. **Nothing is guessed at.** A folder id must look like a Drive id and must
 *    be one of the folders actually inside the Clients folder. A pasted id
 *    that points somewhere else in the owner's Drive is refused here rather
 *    than discovered months later.
 * 3. **One folder, one client.** Two clients filing into one folder interleaves
 *    two clients' shoots, brand material and schedules with no warning and no
 *    way to see it afterwards.
 *
 * The write is a claim, not a read-then-write, so two people pressing Save on
 * two screens cannot leave one client carrying two folder ids.
 */
export async function applyRootPlan(
  rows: ApplyRow[],
): Promise<RootOk<{ result: ApplyResult }> | RootFailure> {
  if (!driveConfigured()) return fail('Google Drive is not set up yet')
  const root = await pickedRoot()
  if (!root) return fail('Choose the folder first')
  const clientsFolderId = root.clients_folder_id
  if (!clientsFolderId) return fail('The Clients folder has not been set up yet')

  // one listing for the whole apply: it is both the "is this folder really in
  // there" check and the "has somebody made it already" check
  const listed = await listSubfolders(clientsFolderId)
  if (!listed.ok) {
    return fail(`Google Drive would not list the Clients folder — ${listed.message}`)
  }
  const inside = new Map(listed.folders.map(f => [f.id, f.name]))
  const byTidyName = new Map<string, string>()
  for (const f of listed.folders) {
    const key = normaliseFolderName(f.name)
    if (key && !byTidyName.has(key)) byTidyName.set(key, f.id)
  }

  const clients = table<Client>('clients')
  // Who already holds which folder — a folder cannot be given to two clients.
  //
  // Read ONCE, per request, and deliberately not re-read as the loop writes.
  // It is advisory: the thing that actually decides a client's folder is the
  // per-client `claim` below, onto a blank column only, so two super admins
  // applying at the same moment still cannot give one client two folders. What
  // this map can miss is the rarer, milder case — both of them pointing two
  // DIFFERENT clients at the same folder in the same second. Re-reading every
  // iteration would be a read per client to narrow a window two people would
  // have to hit on purpose, and it would still not close it.
  const held = new Map<string, string>()
  for (const c of await clients.list()) {
    const id = String(c.drive_folder_id ?? '').trim()
    if (id) held.set(id, c.id)
  }

  const result: ApplyResult = { linked: 0, created: 0, skipped: [] }

  for (const row of rows) {
    const client = await clients.get(row.client_id)
    if (!client) {
      result.skipped.push({ client_id: row.client_id, why: 'that client is no longer there' })
      continue
    }

    let folderId = String(row.folder_id ?? '').trim()
    // every folder recorded here already existed in Drive — this file creates
    // none, so there is no other origin to record
    const origin = 'adopted' as const

    if (folderId) {
      if (!DRIVE_ID.test(folderId)) {
        result.skipped.push({ client_id: row.client_id, why: 'that is not a Google Drive folder' })
        continue
      }
      if (!inside.has(folderId)) {
        result.skipped.push({
          client_id: row.client_id,
          why: 'that folder is not inside the Clients folder',
        })
        continue
      }
    } else {
      if (!row.create) {
        result.skipped.push({ client_id: row.client_id, why: 'no folder chosen' })
        continue
      }
      // already done — a second press, or a retry of a request that landed
      const already = String(client.drive_folder_id ?? '').trim()
      if (already) {
        result.skipped.push({ client_id: row.client_id, why: 'that client already has a folder' })
        continue
      }
      // Somebody made it in Drive between loading the plan and pressing Save,
      // and its tidied name matches — adopt it. That is the ONLY way a row
      // with no folder chosen can end up with one: this file creates nothing
      // in the owner's Drive, so a client whose folder does not exist yet
      // stays unmatched and is told what to do about it.
      const adopted = byTidyName.get(normaliseFolderName(client.name))
      if (!adopted) {
        result.skipped.push({ client_id: row.client_id, why: NO_FOLDER_IN_DRIVE })
        continue
      }
      folderId = adopted
    }

    const owner = held.get(folderId)
    if (owner && owner !== row.client_id) {
      result.skipped.push({ client_id: row.client_id, why: 'another client already uses that folder' })
      continue
    }

    const claimed = await clients.claim(row.client_id, cur =>
      cur ? { ...cur, drive_folder_id: folderId, drive_folder_origin: origin } : null)
    if (!claimed.claimed) {
      result.skipped.push({ client_id: row.client_id, why: 'that client changed while this was saving' })
      continue
    }
    const previous = String(client.drive_folder_id ?? '').trim()
    if (previous && previous !== folderId) held.delete(previous)
    held.set(folderId, row.client_id)
    result.linked++
  }

  return { ok: true, result }

}
