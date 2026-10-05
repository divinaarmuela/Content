/**
 * A TEXT BOX AS TALL AS ITS WORDS — WITHOUT MOVING THE PAGE (5 Oct 2026, the shoot brief's scripts: a paste or a
 * keystroke in a script box threw the page back up, and the person had to scroll down to find the box again).
 *
 * The usual way to size a box to its words is `height: auto`, read `scrollHeight`, set it. For that instant the box
 * collapses to a few lines, the page gets shorter, and the browser — quite correctly — pulls the scroll position up
 * to fit; setting the height back does not put the scroll back. And the scripts editor did it to EVERY box on EVERY
 * keystroke.
 *
 * So: a box whose words overflow is simply made taller (no collapse, nothing moves). Only a box that might need to
 * get SHORTER is collapsed and measured, and every scrolling ancestor — and the window — is put back exactly where
 * it was, in the same tick, before anything is painted.
 */
export function growTextarea(el: HTMLTextAreaElement): void {
  // more words than room: grow, the cheap and still way
  if (el.scrollHeight > el.clientHeight + 1) { el.style.height = `${el.scrollHeight}px`; return }
  // nothing was ever sized, or words were taken out: measure from collapsed, then put every scroller back
  const held: [HTMLElement, number][] = []
  for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight) held.push([p, p.scrollTop])
  const y = typeof window !== 'undefined' ? window.scrollY : 0
  const before = el.style.height
  el.style.height = 'auto'
  const need = `${el.scrollHeight}px`
  el.style.height = need
  if (need === before) { /* same height: still restore, the collapse may have moved things */ }
  for (const [node, top] of held) if (node.scrollTop !== top) node.scrollTop = top
  if (typeof window !== 'undefined' && window.scrollY !== y) window.scrollTo(window.scrollX, y)
}
