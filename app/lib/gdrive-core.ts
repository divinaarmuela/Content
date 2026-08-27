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
 * all. So this module builds *chains of names* — the walk from the root down —
 * and gdrive.ts resolves each chain to ids, creating what is missing. Nothing
 * here ever pretends a slash-joined string identifies a folder.
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

/** `{root}/{Client}` — everything for one client hangs off this. */
export function clientChain(client: string): string[] {
  return chain(client)
}

/** `{root}/{Client}/_Brand` — long-lived reference, not tied to any shoot. */
export function brandChain(client: string): string[] {
  return chain(client, BRAND_FOLDER)
}

/** `{root}/{Client}/_Tasks/{Task}` — internal work with nothing to shoot. */
export function taskChain(client: string, taskFolder: string): string[] {
  return chain(client, TASKS_FOLDER, taskFolder)
}

/**
 * `{root}/{Client}/_No shoot/{Item}` — a real deliverable with no shoot.
 *
 * Not the same thing as `_Tasks`: this is footage that exists (the client sent
 * it, an old shoot supplied it) being cut into a deliverable, so it belongs
 * beside the shoots rather than among the research jobs.
 */
export function noShootChain(client: string, itemFolder: string): string[] {
  return chain(client, NO_SHOOT_FOLDER, itemFolder)
}

export type ShootChains = {
  /** `{root}/{Client}/{Shoot}` */
  shoot: string[]
  /** `{root}/{Client}/{Shoot}/01 Raw` */
  raw: string[]
  /** `{root}/{Client}/{Shoot}/02 Edits` */
  edits: string[]
  /** `{root}/{Client}/{Shoot}/03 Final` */
  final: string[]
}

/** Every folder a shoot needs, parents before children. */
export function shootChains(client: string, shootFolder: string): ShootChains {
  const shoot = chain(client, shootFolder)
  const [raw, edits, final] = SHOOT_SUBFOLDERS
  return {
    shoot,
    raw: [...shoot, raw],
    edits: [...shoot, edits],
    final: [...shoot, final],
  }
}

/** `{root}/{Client}/{Shoot}/02 Edits/{Item}` — where one deliverable is cut. */
export function itemChain(
  client: string, shootFolder: string, itemFolder: string,
): string[] {
  return [...shootChains(client, shootFolder).edits, safeSegment(itemFolder)]
}

/**
 * `{root}/{Client}/{Shoot}/03 Final` — where the approved cut is archived.
 *
 * The same folder the shoot already has, reached by name rather than by id,
 * so an item approved long after its shoot still lands in the shoot's own
 * finals rather than in a second one.
 */
export function shootFinalChain(client: string, shootFolder: string): string[] {
  return shootChains(client, shootFolder).final
}

/**
 * `{root}/{Client}/{Shoot}/01 Raw` — the footage a shoot produced.
 *
 * Everything shot on the day lands in ONE folder per shoot, not one per
 * deliverable: the same clip is cut into three Reels, and filing it under the
 * first item that happened to claim it hides it from the other two. Reached by
 * name from the root, like the finals, so a raw file attached to an item long
 * after the shoot still lands in that shoot's own raw folder.
 */
export function shootRawChain(client: string, shootFolder: string): string[] {
  return shootChains(client, shootFolder).raw
}

/**
 * `{root}/{Client}/_No shoot/{Item}/Raw` — given footage for a shoot-less item.
 *
 * It hangs off the ITEM's folder for the same reason its finals do: with no
 * shoot to group them, the deliverable is the only grouping there is. What it
 * must NOT be is the item folder itself, which is the editing bench.
 */
export function noShootRawChain(client: string, itemFolder: string): string[] {
  return [...noShootChain(client, itemFolder), NO_SHOOT_RAW_FOLDER]
}

/**
 * `{root}/{Client}/_No shoot/{Item}/Final` — finals for a shoot-less item.
 *
 * It hangs off the ITEM's own folder, not off a client-wide finals bin: with
 * no shoot to group them, the deliverable is the only grouping there is.
 */
export function noShootFinalChain(client: string, itemFolder: string): string[] {
  return [...noShootChain(client, itemFolder), NO_SHOOT_FINAL_FOLDER]
}

/**
 * `{root}/{Client}/_Scheduled/{YYYY-MM}` — what goes out, by the month it
 * goes out in.
 *
 * Deliberately per CLIENT and not per shoot: "what are we posting for them in
 * September" is a question about a client and a month, and answering it from
 * the shoot tree means opening every shoot. A month with nothing scheduled
 * never gets a folder, because nothing is ever copied into it.
 */
export function scheduledChain(client: string, month: string): string[] {
  return chain(client, SCHEDULED_FOLDER, month)
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
 * `{root}/{Client}/_From client/{YYYY-MM-DD}` — what the client sent, by the
 * day it arrived.
 *
 * By DAY rather than by month, and by day rather than by form: a client sends
 * things in bursts — an intake form, then a folder of product photos a week
 * later — and "the stuff they sent on the 14th" is how anyone refers to a
 * burst afterwards. A form id would be accurate and unusable; a month would
 * put three unrelated deliveries in one pile.
 *
 * Brand material is the deliberate exception and goes to `_Brand` instead
 * (see `intakeFileTarget`): a logo is not a delivery, it is a long-lived
 * reference, and hunting for it under the date it happened to arrive is
 * exactly the filing this tree exists to avoid.
 */
export function fromClientChain(client: string, day: string): string[] {
  return chain(client, FROM_CLIENT_FOLDER, day)
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
