/**
 * Where a shoot's files live — decided here, with no I/O.
 *
 * Naming a folder is the part of the Dropbox integration that has to be
 * RIGHT: the tree is read by people, on phones, on a shoot day, and a name
 * that Dropbox silently rejects means the folder is simply never created and
 * the editor is told nothing. So every character that Dropbox refuses is
 * stripped before the name goes anywhere near the API, and the whole naming
 * scheme is a pure function with tests instead of string concatenation
 * scattered through route handlers.
 *
 * The shape of the tree:
 *
 *     {root}/{Client}/{2026-08 Spring Campaign}/01 Raw
 *                                              /02 Edits/{Reel 01 - Hook}
 *                                              /03 Final
 *     {root}/{Client}/_Tasks/{Rebrand research}
 *     {root}/{Client}/_Brand
 *
 * Numbered prefixes because Dropbox sorts alphabetically and "01 Raw → 02
 * Edits → 03 Final" is the order the work actually happens in. The two
 * underscore folders sort above the dated shoots, which is where a
 * long-lived reference folder belongs.
 */

/** Characters Dropbox refuses in a path component: \ / : ? * " < > | */
const FORBIDDEN = /[\\/:?*"<>|]/g

/** Dropbox rejects control characters too, and they are invisible in a name. */
const CONTROL = /[\u0000-\u001F\u007F]/g

/** A path component is capped so the full path stays well inside Dropbox's limit. */
export const MAX_SEGMENT = 100

/**
 * One safe path component.
 *
 * Forbidden characters are REMOVED rather than replaced with an underscore:
 * "Reel 1/2" becoming "Reel 12" reads better than "Reel 1_2", and a name is
 * for humans. Trailing dots and spaces go too — Dropbox accepts them and then
 * Windows clients cannot sync the folder, which is the worst of both.
 */
export function safeSegment(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(FORBIDDEN, '')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEGMENT)
    // re-trim: the slice can land mid-space, and a trailing dot is a Windows
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
   * inside the client's folder, and saying it twice makes every path longer
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

/** Join path components into an absolute Dropbox path, with no double slashes. */
export function joinPath(...parts: (string | null | undefined)[]): string {
  const segs = parts
    .flatMap(p => String(p ?? '').split('/'))
    .map(s => s.trim())
    .filter(Boolean)
  return `/${segs.join('/')}`
}

/** The root, normalised: `Clients`, `/Clients`, `/Clients/` all mean the same. */
export function normaliseRoot(root: string | null | undefined): string {
  return joinPath(root || 'Clients')
}

export function clientPath(root: string, client: string): string {
  return joinPath(normaliseRoot(root), safeSegment(client))
}

/** `{root}/{Client}/_Brand` — long-lived reference, not tied to any shoot. */
export function brandPath(root: string, client: string): string {
  return joinPath(clientPath(root, client), '_Brand')
}

/** `{root}/{Client}/_Tasks/{Task}` — internal work with no shoot behind it. */
export function taskPath(root: string, client: string, taskFolder: string): string {
  return joinPath(clientPath(root, client), '_Tasks', safeSegment(taskFolder))
}

export type ShootFolders = {
  /** `{root}/{Client}/{Shoot}` */
  shoot: string
  /** `{root}/{Client}/{Shoot}/01 Raw` */
  raw: string
  /** `{root}/{Client}/{Shoot}/02 Edits` */
  edits: string
  /** `{root}/{Client}/{Shoot}/03 Final` */
  final: string
}

/** Every folder a shoot needs, in creation order (parents before children). */
export function shootPaths(root: string, client: string, shootFolder: string): ShootFolders {
  const shoot = joinPath(clientPath(root, client), safeSegment(shootFolder))
  return {
    shoot,
    raw: joinPath(shoot, '01 Raw'),
    edits: joinPath(shoot, '02 Edits'),
    final: joinPath(shoot, '03 Final'),
  }
}

/** `{root}/{Client}/{Shoot}/02 Edits/{Item}` — where one deliverable is cut. */
export function itemPath(
  root: string, client: string, shootFolder: string, itemFolder: string,
): string {
  return joinPath(shootPaths(root, client, shootFolder).edits, safeSegment(itemFolder))
}

/**
 * A name that is not already taken: `Hook test`, then `Hook test (2)`, `(3)`…
 *
 * Two shoots called "Content Day" in the same client folder is normal, not an
 * error, and Dropbox would either refuse the second or silently autorename it
 * to something we did not record. Deciding the suffix HERE means the path we
 * store is the path that exists. Comparison is case-insensitive because
 * Dropbox paths are.
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
