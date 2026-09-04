/**
 * AUTOMATIC FILING TO GOOGLE DRIVE IS OFF.
 *
 * The owner's ruling, in as many words: "remove any auto upload feature to the
 * drive — disabled". The HQ folder is the agency's real archive — years of
 * client folders, shared with clients, a bookkeeper and two freelance editors —
 * and an app that files into it on its own is an app quietly rearranging
 * somebody else's filing cabinet. So it does not.
 *
 * What that leaves is the honest version of the integration:
 *
 *  • Files go to Drive when a PERSON puts them there, on the Files page —
 *    upload, new folder, move, rename, each one confirmed. Those live in
 *    `gdrive-files.ts` and `app/api/drive/**`, which do not import this module
 *    and are deliberately unaffected: an explicit action is not "automatic
 *    filing", it is a person pressing a button.
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

/** The sentence the Integrations card and the Files page show. One wording,
 *  one place, so the card and the docs cannot drift apart. */
export const AUTO_FILING_NOTE =
  'Automatic filing to Drive is off. Files go to Drive only when someone '
  + 'uploads them on the Files page.'
