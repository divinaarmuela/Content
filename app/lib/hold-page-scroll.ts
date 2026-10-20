/**
 * TYPING ON THE BOARD MUST NOT THROW THE PAGE UP (Manal, 20 Oct 2026, on the shoot page's board: "any time I was
 * editing something, it took me back to the top of the page … each letter"; Karly said the same on 16 Sep).
 *
 * A browser keeps the caret in sight after every keystroke by scrolling the page and every box around the text. The
 * board is drawn through a transform (its zoom), which Safari does not take into account there, so it scrolls to
 * where the caret WOULD be at 100% — up the page. Chrome does not do it; it cannot be ruled out in any browser.
 *
 * So while a text box inside the board is typed in, where the page and its scrolling boxes stood just before the
 * keystroke is remembered, and any move UP the page in the moment after it is put straight back. A move DOWN is let
 * through: that is the caret going below the bottom of the screen, which the person wants to follow.
 */

/** a scroll position to put back: it moved up by more than a pixel */
export function jumpedUp(before: number, after: number): boolean {
  return after < before - 1
}

/** how long after a keystroke a jump is still the keystroke's (Safari reveals the caret after the input event) */
export const HOLD_MS = 250

type Held = { node: HTMLElement | null; top: number }

function scrollers(from: HTMLElement): Held[] {
  const out: Held[] = [{ node: null, top: window.scrollY }]
  for (let p = from.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight) out.push({ node: p, top: p.scrollTop })
  }
  return out
}

function putBack(held: Held[]): void {
  for (const h of held) {
    if (h.node === null) {
      if (jumpedUp(h.top, window.scrollY)) window.scrollTo(window.scrollX, h.top)
    } else if (jumpedUp(h.top, h.node.scrollTop)) {
      h.node.scrollTop = h.top
    }
  }
}

const typedIn = (t: EventTarget | null): t is HTMLElement =>
  t instanceof HTMLElement && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)

/** Watch `root` (the board) for typing; returns the function that stops watching. */
export function holdPageScroll(root: HTMLElement): () => void {
  let held: Held[] | null = null
  let until = 0
  let timer: number | null = null

  const remember = (e: Event) => {
    if (!typedIn(e.target)) return
    held = scrollers(e.target)
  }
  const guard = () => { if (held && Date.now() < until) putBack(held) }
  const typed = (e: Event) => {
    if (!held || !typedIn(e.target)) return
    until = Date.now() + HOLD_MS
    guard()
    requestAnimationFrame(guard)
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => { guard(); held = null; timer = null }, HOLD_MS)
  }

  root.addEventListener('keydown', remember, true)
  root.addEventListener('beforeinput', remember, true)
  root.addEventListener('input', typed, true)
  // the page itself, and every box around the board, may be scrolled by the browser after the input event
  window.addEventListener('scroll', guard, true)
  return () => {
    root.removeEventListener('keydown', remember, true)
    root.removeEventListener('beforeinput', remember, true)
    root.removeEventListener('input', typed, true)
    window.removeEventListener('scroll', guard, true)
    if (timer !== null) window.clearTimeout(timer)
  }
}
