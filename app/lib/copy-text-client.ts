'use client'

/**
 * COPY TEXT THAT IS NOT READY YET (Karly, 22 Sep 2026: "clicking 'copy portal
 * link' and it's not copying").
 *
 * The browser lets a page write the clipboard only inside the press. Two
 * buttons on the shoot page fetched first — the client's link from the
 * server, the plan's details after a pending save — and by the time the
 * text arrived, Safari had let go of the press and refused the write; the
 * words then said "could not copy" over a link that was fine. A promise-
 * valued ClipboardItem is the browser's own answer: the write is claimed
 * inside the press and the text follows. Where that is not supported, the
 * plain write is tried once the text is in (Chrome keeps the press alive
 * for a few seconds). When neither lands, the caller is told, and shows the
 * text so a person can select it.
 */
export async function copyText(pending: string | Promise<string>): Promise<boolean> {
  const text = Promise.resolve(pending)
  try {
    const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (Item && navigator.clipboard?.write) {
      const blob = text.then(t => new Blob([t], { type: 'text/plain' }))
      await navigator.clipboard.write([new Item({ 'text/plain': blob as unknown as Blob })])
      return true
    }
  } catch { /* fall through to the plain write */ }
  try {
    await navigator.clipboard.writeText(await text)
    return true
  } catch {
    return false
  }
}
