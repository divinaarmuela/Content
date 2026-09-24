/**
 * A FOLLOWER'S PICTURE, AND WHEN IT DIES (the owner, 24 Sep 2026: "the
 * followers profile image is not showing").
 *
 * Instagram's CDN signs every profile picture with an expiry in the address
 * itself — `oe=<hex seconds>` — and refuses it afterwards. Checked on
 * Justin's list that day: the row seen on 23 Sep answered 200 and expired on
 * 28 Sep; the row last seen on 15 Sep expired on 19 Sep and answered 403.
 * A referrer makes no difference, so this is not hotlink blocking and a
 * proxy would not help: the address is simply dead.
 *
 * The daily look reads the top 100 of a list that is 1,575 long, so most
 * rows keep whatever address they had when they were last near the top, and
 * most of those are past their date. Rather than fire hundreds of requests
 * that will 403 and leave broken pictures, the list reads the date out of
 * the address and draws initials instead. No I/O.
 */

/** the moment this address stops working, from the `oe` the CDN signs into it */
export function pictureExpiry(url: string | null | undefined): Date | null {
  const m = /[?&]oe=([0-9A-Fa-f]{1,12})\b/.exec(String(url ?? ''))
  if (!m) return null
  const seconds = parseInt(m[1], 16)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null
}

/**
 * Is it worth asking for this picture?
 *
 * An address with no expiry in it is worth trying — not every provider signs
 * them. One whose date has passed is not.
 */
export function pictureUsable(url: string | null | undefined, now: Date = new Date()): boolean {
  if (!String(url ?? '').trim()) return false
  const at = pictureExpiry(url)
  return at === null || at.getTime() > now.getTime()
}

/** the letter drawn where a picture would be */
export function initialOf(username: string | null | undefined, fullName?: string | null): string {
  const from = String(fullName ?? '').trim() || String(username ?? '').trim()
  const ch = [...from].find(c => /\p{L}|\p{N}/u.test(c))
  return (ch ?? '?').toUpperCase()
}
