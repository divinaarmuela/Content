import 'server-only'
import { table } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { matchClientFolders, safeSegment } from './gdrive-core'
import {
  createSubfolder, driveConfigured, findSubfolder, listSubfolders, pickedRoot,
  readFolder, saveClientsFolder, savePickedRoot, shareWithDomain,
} from './gdrive'

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
  /** what Apply would do: nothing, link this folder, or make a new one */
  action: 'linked' | 'link' | 'create'
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
  matched: number
  total: number
  to_create: number
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
 * `createClientsFolder` is the one thing here that writes, and only when a
 * person has said yes to the question the previous call asked them.
 */
export async function buildRootPlan(opts?: {
  createClientsFolder?: boolean
}): Promise<RootOk<{ plan: RootPlan }> | RootFailure> {
  if (!driveConfigured()) return fail('Google Drive is not set up yet')
  const root = await pickedRoot()
  if (!root) return fail('Choose the folder first')

  // the Clients folder: recorded, or found by name, or (only on request) made
  let clientsFolderId = root.clients_folder_id
  if (!clientsFolderId) {
    const found = await findSubfolder(root.id, CLIENTS_FOLDER)
    if (!found.ok) return fail(`Google Drive would not list that folder — ${found.message}`)
    clientsFolderId = found.id
    if (!clientsFolderId && opts?.createClientsFolder) {
      const made = await createSubfolder(root.id, CLIENTS_FOLDER)
      if (!made.ok) return fail(`The Clients folder could not be made — ${made.message}`)
      clientsFolderId = made.id
      await shareWithDomain(made.id)
    }
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
          confidence: null, action: 'create' as const,
        })),
        folders: [], extra: [], matched: 0, to_create: clients.length,
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
      action: 'create' as const,
    })),
  ].sort((a, b) => a.client_name.localeCompare(b.client_name))

  return {
    ok: true,
    plan: {
      ...base,
      rows,
      folders,
      extra: plan.extra,
      matched: rows.filter(r => r.action !== 'create').length,
      to_create: rows.filter(r => r.action === 'create').length,
    },
  }
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
 * The write is a claim, not a read-then-write: two people pressing Apply on
 * two screens must not end with one client carrying two folder ids. A row that
 * names a folder overrules whatever was there — a person choosing a folder by
 * hand is the most reliable input this whole feature has.
 */
export async function applyRootPlan(
  rows: ApplyRow[],
): Promise<RootOk<{ result: ApplyResult }> | RootFailure> {
  if (!driveConfigured()) return fail('Google Drive is not set up yet')
  const root = await pickedRoot()
  if (!root) return fail('Choose the folder first')
  if (!root.clients_folder_id) return fail('The Clients folder has not been set up yet')

  const clients = table<Client>('clients')
  const result: ApplyResult = { linked: 0, created: 0, skipped: [] }

  for (const row of rows) {
    const client = await clients.get(row.client_id)
    if (!client) {
      result.skipped.push({ client_id: row.client_id, why: 'that client is no longer there' })
      continue
    }

    let folderId = String(row.folder_id ?? '').trim()
    let made = false
    if (!folderId) {
      if (!row.create) {
        result.skipped.push({ client_id: row.client_id, why: 'no folder chosen' })
        continue
      }
      const create = await createSubfolder(root.clients_folder_id, client.name)
      if (!create.ok) {
        result.skipped.push({ client_id: row.client_id, why: create.message })
        continue
      }
      folderId = create.id
      made = true
      await shareWithDomain(folderId)
    }

    const claimed = await clients.claim(row.client_id, cur =>
      cur ? { ...cur, drive_folder_id: folderId } : null)
    if (!claimed.claimed) {
      result.skipped.push({ client_id: row.client_id, why: 'that client changed while this was saving' })
      continue
    }
    if (made) result.created++
    else result.linked++
  }

  return { ok: true, result }
}
