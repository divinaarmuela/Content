/**
 * AUTOMATIC FILING TO GOOGLE DRIVE IS OFF.
 *
 * The owner's ruling, in as many words: "remove any auto upload feature to the
 * drive — disabled". The HQ folder is the agency's real archive — years of
 * client folders, shared with clients, a bookkeeper and two freelance editors —
 * and an app that files into it on its own is an app quietly rearranging
 * somebody else's filing cabinet. So it does not.
 *
 * The owner then went further, and this module is where that lives too: **the
 * dashboard makes no writes to Google Drive at all.** Not automatic ones, not
 * confirmed ones, not on the Files page. Their words: "didn't I tell you there
 * should be no writes… this feature is supposed to just pick a file that they
 * wanna post." Drive is the agency's filing cabinet and the dashboard is a
 * window onto it.
 *
 * What that leaves is the honest version of the integration:
 *
 *  • The Files page READS. Browse, search, previews, "Open in Drive",
 *    Download. There is no Upload, no New folder, no Move, no Rename, no
 *    Share — not disabled buttons, not hidden buttons: they are not on the
 *    page, and a file dropped on it does nothing.
 *  • The Schedule composer's Google Drive tab is a PICKER. A picked file is
 *    copied into our own storage and becomes a version the client approves. It
 *    is never copied back to Drive — it is already there.
 *  • Everything else that used to happen behind the user's back — mirroring a
 *    version, making a shoot or brief folder, renaming one when the date is
 *    set, filing brand documents and monthly-form uploads, syncing team
 *    members onto the folder, the half-hourly sweep — checks
 *    `autoFilingEnabled()` first and returns a logged skip.
 *
 * ── The switch ──
 *
 * One environment variable, read here and nowhere else: `DRIVE_AUTO_FILING=1`
 * turns automatic filing back on. There is deliberately no UI for it. Turning
 * it on is a decision somebody makes once, in Vercel's environment settings,
 * with the never-touch rule in mind — not a toggle anybody can flip while
 * looking at a folder listing.
 *
 * Read at call time rather than at module load, so a test can set it around
 * one case and the rest of the suite still runs with filing off.
 *
 * Pure: no I/O, no imports, no `server-only`. It is read from server modules
 * and from tests, and there is nothing in it worth mocking.
 */

/** The one flag. `'1'` and nothing else — an unset, empty, `'0'`, `'true'` or
 *  misspelt value all mean off, because the safe reading of an ambiguous
 *  answer is "do not write to the agency's Drive". */
export const DRIVE_AUTO_FILING = 'DRIVE_AUTO_FILING'

/** Is the app allowed to file to Drive without being asked? Almost always no. */
export function autoFilingEnabled(): boolean {
  return process.env[DRIVE_AUTO_FILING] === '1'
}

/** The line every skipped path logs, so one grep finds all of them. */
export const AUTO_FILING_OFF = '[gdrive] automatic filing is off'

/**
 * The guard, as one line at the top of a function that would write to Drive.
 *
 * ```ts
 * if (skipAutoFiling('mirror a version')) return
 * ```
 *
 * Returns `true` when the caller must do nothing — and says so in the log,
 * naming the path, because "no file appeared in Drive" is otherwise
 * indistinguishable from a broken token, a revoked consent or a silent crash.
 * Logged once per label per process: a shoot drop is two hundred files, and
 * two hundred identical lines is how a real error gets buried.
 */
const logged = new Set<string>()

export function skipAutoFiling(label: string): boolean {
  if (autoFilingEnabled()) return false
  if (!logged.has(label)) {
    logged.add(label)
    console.log(`${AUTO_FILING_OFF} — skipped: ${label}`)
  }
  return true
}

/** Tests only: forget what has been logged, so a case can assert on the line. */
export function resetAutoFilingLog(): void {
  logged.clear()
}

/* ── the second switch: writes from the Files page ─────────────────────── */

/**
 * `DRIVE_PAGE_WRITES=1` puts the write half of the Files page back.
 *
 * The code for it is not deleted — new folder, move, rename, share and the
 * resumable upload are all still there, still confirm-gated, still contained
 * inside the picked HQ folder, and still tested. What is gone is any way to
 * reach it: the routes refuse before they read anything, and the page does not
 * draw the controls at all.
 *
 * Kept rather than deleted for one reason. Deleting it would mean rebuilding
 * it — badly, in a hurry, without the confirm gate or the containment check —
 * the first time somebody asks for uploads back. A switched-off feature that
 * has been reviewed is worth more than a feature that has to be reinvented.
 *
 * Two switches rather than one, because they are two different questions.
 * `DRIVE_AUTO_FILING` is "may the app file things nobody asked it to file";
 * this is "may a person file something on purpose". Turning the second on does
 * not turn the first on.
 *
 * Read at call time, like the other one, and deliberately with no UI.
 */
export const DRIVE_PAGE_WRITES = 'DRIVE_PAGE_WRITES'

export function pageWritesEnabled(): boolean {
  return process.env[DRIVE_PAGE_WRITES] === '1'
}

/** What a write route answers while the switch is off. A person never sees
 *  this — there is no control that sends the request — so it is written for
 *  whoever is holding a network tab wondering why. */
export const READ_ONLY_NOTE = 'Drive is read-only from the dashboard'

/**
 * The guard, as the first line of every route that would write to Drive.
 *
 * ```ts
 * const refusal = readOnlyRefusal()
 * if (refusal) return NextResponse.json({ error: refusal }, { status: 403 })
 * ```
 *
 * FIRST, before the role check and before the body is read: the cheapest
 * possible refusal, and one that cannot be reordered past by accident.
 */
export function readOnlyRefusal(): string | null {
  return pageWritesEnabled() ? null : READ_ONLY_NOTE
}

/** The sentence the Integrations card and the Files page show. One wording,
 *  one place, so the card and the docs cannot drift apart. */
export const AUTO_FILING_NOTE =
  'The dashboard only reads Google Drive. Nothing here uploads, moves, renames '
  + 'or deletes anything in it — Files shows you what is there, and the '
  + 'Schedule composer picks from it.'
