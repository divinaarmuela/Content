/**
 * Where a shoot's files live — decided here, with no I/O.
 *
 * Naming a folder is the part of the Drive integration that has to be RIGHT:
 * the tree is read by people, on phones, on a shoot day, and a name that comes
 * out wrong means the editor is looking at a folder they cannot identify. So
 * the whole naming scheme is a pure function with tests instead of string
 * concatenation scattered through route handlers.
 *
 * The shape of the tree:
 *
 *     {root}/{Client}/{2026-08 Spring Campaign}/01 Raw
 *                                              /02 Edits/{Reel 01 - Hook}
 *                                              /03 Final
 *     {root}/{Client}/_No shoot/{Reel 01 - Hook}
 *     {root}/{Client}/_Tasks/{Rebrand research}
 *     {root}/{Client}/_Brand
 *
 * Numbered prefixes because Drive sorts alphabetically and "01 Raw → 02 Edits
 * → 03 Final" is the order the work actually happens in. The underscore
 * prefix does NOT sort those three above the shoots — `_` comes after digits —
 * but it does keep them together in one block at the end of the client folder,
 * away from the dated shoots, which is what actually makes the list readable.
 *
 * A note on the difference from a filesystem: **Drive has no paths.** A folder
 * is an id, and two sibling folders may share a name without Drive minding at
 * all. Nothing here ever pretends a slash-joined string identifies a folder.
 *
 * Since the app was taught to file into the agency's own HQ folder, every walk
 * starts at an ID — the client's folder, recorded on the client — and goes down
 * by name from there. The client's folder may be called anything; it was named
 * by a person years ago. So this module supplies the NAMES of the folders
 * below it (`_Brand`, `_Scheduled`, `01 Raw`) and the rules for making one
 * safe, and gdrive.ts resolves them against a parent id.
 */

/** Drive stores a name as a plain string; only `/` genuinely misleads a
 *  reader (it looks like a folder level that is not there). */
const FORBIDDEN = /[/]/g

/** Control characters are legal and invisible, which is the worst pair. */
const CONTROL = /[\u0000-\u001F\u007F]/g

/** A name is capped so the tree stays readable and the API stays happy. */
export const MAX_SEGMENT = 100

/** The mimeType that makes a Drive file a folder. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** The three fixed folders that group together, apart from the dated shoots. */
export const BRAND_FOLDER = '_Brand'
export const TASKS_FOLDER = '_Tasks'
/** Assets with no shoot behind them — client-sent footage, an ad-hoc edit. */
export const NO_SHOOT_FOLDER = '_No shoot'

/** Approved-and-dated work, filed by the month it goes out. */
export const SCHEDULED_FOLDER = '_Scheduled'

/** What the client sent us, filed by the day it arrived. */
export const FROM_CLIENT_FOLDER = '_From client'

/** A shoot's three working folders, in the order the work happens. */
export const SHOOT_SUBFOLDERS = ['01 Raw', '02 Edits', '03 Final'] as const
export const RAW_FOLDER = SHOOT_SUBFOLDERS[0]
export const EDITS_FOLDER = SHOOT_SUBFOLDERS[1]
export const FINAL_FOLDER = SHOOT_SUBFOLDERS[2]

/**
 * What a shoot-less item's finals folder is called.
 *
 * NOT `03 Final`: the numbered names exist to order the three stages of a
 * shoot, and a shoot-less item has no `01 Raw` or `02 Edits` to be third
 * after. A lone `03 Final` inside `_No shoot/{Item}` would be a number
 * counting nothing.
 */
export const NO_SHOOT_FINAL_FOLDER = 'Final'

/**
 * What a shoot-less item's raw folder is called.
 *
 * `Raw`, not `01 Raw`, for the same reason its finals are `Final`: the numbers
 * order the three stages of a shoot day, and an item with no shoot has no
 * stages to order. What matters is that the footage an editor was GIVEN never
 * shares a folder with the cuts they made from it — which is the mistake this
 * whole target exists to undo.
 */
export const NO_SHOOT_RAW_FOLDER = 'Raw'

/**
 * One safe folder name.
 *
 * Drive accepts nearly everything — : ? * " < > and | are all fine — so this
 * strips only the slash, which reads as a folder level that is not there. The
 * trim still matters, though: a name with a trailing space or dot syncs badly
 * to Windows through Drive for desktop, and a name that is entirely
 * whitespace is unreadable in the UI.
 */
export function safeSegment(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(FORBIDDEN, '')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEGMENT)
    // re-trim: the slice can land mid-space, and a trailing dot is a desktop
    // sync failure waiting to happen
    .replace(/[.\s]+$/, '')
    .trim()
  return cleaned || 'Untitled'
}

/** `YYYY-MM` from an ISO date or timestamp, or null if it is not a date. */
export function monthPrefix(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})/.exec(String(iso).trim())
  if (m) return `${m[1]}-${m[2]}`
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The word for a content type, as it appears in a folder name. */
export const TYPE_WORD: Record<string, string> = {
  reel: 'Reel',
  carousel: 'Carousel',
  static: 'Graphic',
  story: 'Story',
  video: 'Video',
  other: 'Item',
}

export function typeWord(type: string | null | undefined): string {
  return TYPE_WORD[String(type ?? '').toLowerCase()] ?? TYPE_WORD.other
}

export const folderNameFor = {
  /**
   * A shoot folder: `2026-08 Spring Campaign`.
   *
   * The month leads so the client folder sorts chronologically — which is how
   * anyone looking for "the shoot we did in August" actually searches. The
   * shoot date is the truth when it is known; a shoot still being planned
   * falls back to the month the brief was raised, so the folder never appears
   * undated. The client name is NOT repeated here: this folder already sits
   * inside the client's folder, and saying it twice makes every name longer
   * for no information.
   */
  shoot(
    client: string,
    shootTitle: string,
    shootDate: string | null,
    createdAt?: string | null,
  ): string {
    void client
    const prefix = monthPrefix(shootDate) ?? monthPrefix(createdAt)
    const title = safeSegment(shootTitle)
    return prefix ? safeSegment(`${prefix} ${title}`) : title
  },

  /**
   * A deliverable folder: `Reel 01 - Hook test`.
   *
   * The index is padded to two digits so ten items still sort correctly, and
   * it leads with the type so an editor scanning the folder sees what KIND of
   * thing each one is before reading any titles.
   */
  item(type: string | null | undefined, index: number, title: string): string {
    const n = Number.isFinite(index) && index > 0 ? Math.floor(index) : 1
    return safeSegment(`${typeWord(type)} ${String(n).padStart(2, '0')} - ${safeSegment(title)}`)
  },

  /** An internal task folder — no type, no number, just the task. */
  task(title: string): string {
    return safeSegment(title)
  },
}

/** The root folder's NAME, normalised. Drive identifies it by id; this is
 *  only what we call it when we create it, and what the card shows. */
export function normaliseRoot(root: string | null | undefined): string {
  return safeSegment(root || 'Clients')
}

/**
 * A chain of folder names, from the root down. Empty and duplicate-slash
 * noise is dropped so a caller can pass a name straight through.
 */
export function chain(...parts: (string | null | undefined)[]): string[] {
  return parts
    .flatMap(p => String(p ?? '').split('/'))
    .map(s => s.trim())
    .filter(Boolean)
    .map(safeSegment)
}












/** `YYYY-MM-DD` from an ISO date or timestamp, or null if it is not a date. */
export function dayStamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim())
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return null
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-')
}


/**
 * Which folder a client-submitted file belongs in.
 *
 * Read from the intake BLOCK it was uploaded against, not from the file's own
 * name: the block is the question that was asked ("Logo files, brand colours
 * and fonts"), and the question is what says whether the answer is brand
 * material. A file called `logo.png` uploaded against "photos of your
 * premises" is a photo of a sign.
 */
export function intakeFileTarget(
  blockId: string | null | undefined, label?: string | null,
): 'brand' | 'from_client' {
  // underscores and dashes separate words in a block id (`logo_upload`), but
  // a regex word boundary treats `_` as a letter — so they become spaces
  // before anything is matched, or an underscored id would never match
  const haystack = `${String(blockId ?? '')} ${String(label ?? '')}`
    .toLowerCase().replace(/[_-]+/g, ' ')
  return /\b(brand|logo|logos|font|fonts|typeface|guideline|guidelines|style ?guide)\b/.test(haystack)
    ? 'brand'
    : 'from_client'
}

/**
 * What a shoot's folder should be called NOW, when that differs from what it
 * is called — otherwise null.
 *
 * A shoot folder leads with the month so the client folder sorts the way
 * people actually search it. But "Plan a shoot" creates the folder before the
 * date exists, so the name falls back to the month the plan was raised: a
 * September shoot planned in August is filed under `2026-08`, and stays there
 * for the rest of its life unless something puts it right. Locking the date is
 * exactly that moment.
 *
 * The dedupe suffix is carried across. `2026-08 Content Day (2)` is the second
 * Content Day in that folder; renaming it to `2026-09 Content Day` and losing
 * the `(2)` would collide with a folder that is still there.
 */
export function shootFolderRename(
  currentName: string | null | undefined,
  shootTitle: string,
  shootDate: string | null,
  createdAt?: string | null,
): string | null {
  const current = safeSegment(currentName ?? '')
  if (!currentName || current === 'Untitled') return null
  const suffix = /\s\(\d+\)$/.exec(current)?.[0] ?? ''
  const wanted = folderNameFor.shoot('', shootTitle, shootDate, createdAt)
  const next = suffix
    ? safeSegment(`${wanted.slice(0, MAX_SEGMENT - suffix.length).replace(/[.\s]+$/, '')}${suffix}`)
    : wanted
  return next === current ? null : next
}

/** The work kind whose item IS the shoot: the shoot brief. */
export const SHOOT_BRIEF_KIND = 'shoot_brief'

/**
 * Does this kind of work get a folder of its own?
 *
 * Everything does, except the shoot brief. A brief task is not a deliverable
 * sitting beside the shoot — it IS the shoot, riding the item pipeline so it
 * can be reviewed and approved like anything else. Giving it one produced
 * `{Shoot}/02 Edits/{Shoot title}`: an empty folder inside the shoot's own
 * edits bin, named after the shoot, that nothing will ever be filed in and
 * that every editor has to read past. The shoot folder is the brief's folder.
 */
export function kindGetsOwnFolder(kindSlug: string | null | undefined): boolean {
  return String(kindSlug ?? '') !== SHOOT_BRIEF_KIND
}

/** The URL a person opens. The only folder URL form Drive publishes. */
export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

/**
 * A string, escaped for a Drive `q` search term.
 *
 * The docs are explicit: a backslash escapes a backslash and an apostrophe.
 * Getting this wrong does not throw — it silently searches for the WRONG
 * name, which means a duplicate folder every time a client is called
 * "Nathan's". Backslash first, or it would escape its own escapes.
 */
export function escapeQueryValue(value: string): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** `q` for "the folder called <name> directly inside <parentId>". */
export function folderQuery(parentId: string, name: string): string {
  return [
    `'${escapeQueryValue(parentId)}' in parents`,
    `name = '${escapeQueryValue(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ].join(' and ')
}

/**
 * A name that is not already taken: `Hook test`, then `Hook test (2)`, `(3)`…
 *
 * Two shoots called "Content Day" in the same client folder is normal, not an
 * error — and Drive would happily create BOTH, leaving two identical folders
 * and no way for a human to tell which one the link points at. Deciding the
 * suffix here means the folder we create is the folder we can name.
 * Comparison is case-insensitive because people do not distinguish.
 */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const safe = safeSegment(base)
  const used = new Set<string>()
  for (const t of taken) used.add(safeSegment(t).toLowerCase())
  if (!used.has(safe.toLowerCase())) return safe
  for (let n = 2; n < 1000; n++) {
    // the suffix must survive the length cap, so the stem is trimmed to fit
    const suffix = ` (${n})`
    const stem = safe.slice(0, MAX_SEGMENT - suffix.length).replace(/[.\s]+$/, '')
    const candidate = `${stem}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return `${safe.slice(0, MAX_SEGMENT - 14)} (${Date.now() % 100000})`
}

// ── matching client folders that are already in Drive ─────────────────────

/**
 * Words at the END of a business name that say what KIND of company it is,
 * not which one.
 *
 * "Alia Fragrance Pty Ltd" and "Alia Fragrance" are the same client typed by
 * two different people, and the folder in Drive was named by whoever made it
 * first. Only trailing suffixes are dropped, and only whole words: "Ltd" in
 * the middle of a name is part of the name, and "Incline" is not "Inc".
 */
const COMPANY_SUFFIXES = new Set([
  'pty', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'plc', 'corp',
  'corporation', 'co', 'company',
])

/** Apostrophes CLOSE up: "Cecconi's" is one word, "cecconis", not two. */
const APOSTROPHES = /['’`´]/g

/**
 * The comparable form of a folder or client name.
 *
 * Everything a person varies without meaning to is removed: capitals,
 * punctuation, an ampersand written as "and", a doubled space, and the
 * trailing company suffix. What is LEFT is the part that identifies the
 * client, and two names with the same normalised form are the same client.
 *
 * Deliberately not fuzzy: this is the exact half of the match, and being sure
 * matters more here than matching more. The near-misses are handled by
 * `matchClientFolders`, which flags them instead of assuming.
 */
export function normaliseFolderName(raw: string | null | undefined): string {
  let s = String(raw ?? '').toLowerCase()
  s = s.replace(APOSTROPHES, '')
  s = s.replace(/&/g, ' and ')
  s = s.replace(/[^a-z0-9]+/g, ' ').trim()
  let words = s.split(' ').filter(Boolean)
  // a trailing "pty ltd" is two suffixes, so strip until the last word carries
  // meaning — but never strip a name away to nothing ("Co" on its own is the
  // whole client)
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) {
    words = words.slice(0, -1)
  }
  return words.join(' ')
}

/** The tokens two names are compared on. */
function tokens(raw: string): Set<string> {
  return new Set(normaliseFolderName(raw).split(' ').filter(Boolean))
}

/**
 * How much two names share, 0…1 — shared words over the LONGER name.
 *
 * Over the longer one on purpose: "Alia" against "Alia Fragrance Skincare"
 * shares every word of the shorter name and would score 1 on a one-sided
 * measure, which is exactly the wrong answer.
 */
export function nameOverlap(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const t of left) if (right.has(t)) shared++
  return shared / Math.max(left.size, right.size)
}

/** Anything below this is left for a person to decide. */
export const LIKELY_OVERLAP = 0.8

export type NamedFolder = { id: string; name: string }
export type NamedClient = { id: string; name: string }

export type FolderMatch<C extends NamedClient = NamedClient, F extends NamedFolder = NamedFolder> = {
  client: C
  folder: F
  /** 'exact' — the names agree once tidied. 'likely' — close, worth a look. */
  confidence: 'exact' | 'likely'
}

export type FolderMatchPlan<C extends NamedClient = NamedClient, F extends NamedFolder = NamedFolder> = {
  matched: FolderMatch<C, F>[]
  /** clients with no folder — these are the ones that would be created */
  unmatched: C[]
  /** folders in Drive that belong to no client on the list */
  extra: F[]
}

/**
 * Line the clients up against the folders that are already in Drive.
 *
 * Two passes, and the order is the whole design:
 *
 * 1. **Exact** on the normalised name. One folder can only be claimed once,
 *    so a duplicate ("Acme" twice, which Drive allows) leaves the second copy
 *    in `extra` rather than quietly attaching two clients to one folder.
 * 2. **Likely** — 80% of the words shared, and only when ONE folder is that
 *    close. Two folders equally close is an ambiguity, and an ambiguity
 *    resolved by a coin toss is worse than one handed back to a person: the
 *    client stays unmatched and the review screen asks.
 *
 * Pure: it never touches Drive and never creates anything. The caller applies
 * the plan after a person has looked at it.
 */
export function matchClientFolders<C extends NamedClient, F extends NamedFolder>(
  clients: C[], subfolders: F[],
): FolderMatchPlan<C, F> {
  const matched: FolderMatch<C, F>[] = []
  const takenFolders = new Set<string>()
  const remainingClients: C[] = []

  // pass 1 — exact. Built as a queue per normalised name so a second folder
  // with the same name is left over rather than shared.
  const byName = new Map<string, F[]>()
  for (const f of subfolders) {
    const key = normaliseFolderName(f.name)
    if (!key) continue
    const list = byName.get(key)
    if (list) list.push(f)
    else byName.set(key, [f])
  }
  for (const client of clients) {
    const key = normaliseFolderName(client.name)
    const folder = key ? byName.get(key)?.find(f => !takenFolders.has(f.id)) : undefined
    if (folder) {
      takenFolders.add(folder.id)
      matched.push({ client, folder, confidence: 'exact' })
    } else {
      remainingClients.push(client)
    }
  }

  // pass 2 — likely, best pair first across the WHOLE board rather than in
  // client order. Taking them in list order lets the first client to clear the
  // bar walk off with a folder that fits a later client better, and which
  // client that is depends on nothing more meaningful than alphabetical order.
  const pairs = remainingClients
    .flatMap(client => subfolders
      .filter(f => !takenFolders.has(f.id))
      .map(folder => ({ client, folder, score: nameOverlap(client.name, folder.name) })))
    .filter(p => p.score >= LIKELY_OVERLAP)
    .sort((a, b) =>
      b.score - a.score
      || a.client.name.localeCompare(b.client.name)
      || a.folder.name.localeCompare(b.folder.name))

  const matchedClients = new Set<string>()
  // a client (or a folder) wanted equally by two candidates is not a match, it
  // is a question — and a question answered by a coin toss is worse than one
  // put to a person on the review screen
  const undecided = new Set<string>()

  for (const pair of pairs) {
    if (matchedClients.has(pair.client.id) || undecided.has(pair.client.id)) continue
    if (takenFolders.has(pair.folder.id)) continue
    const contested = pairs.some(other =>
      other !== pair
      && other.score === pair.score
      && !takenFolders.has(other.folder.id)
      && !matchedClients.has(other.client.id)
      && (other.client.id === pair.client.id || other.folder.id === pair.folder.id))
    if (contested) {
      undecided.add(pair.client.id)
      continue
    }
    takenFolders.add(pair.folder.id)
    matchedClients.add(pair.client.id)
    matched.push({ client: pair.client, folder: pair.folder, confidence: 'likely' })
  }

  const unmatched = remainingClients.filter(c => !matchedClients.has(c.id))

  return {
    matched,
    unmatched,
    extra: subfolders.filter(f => !takenFolders.has(f.id)),
  }
}
