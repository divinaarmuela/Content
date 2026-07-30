/**
 * Port of Lusion's GoalSectionRanges.
 *
 * Their scroll timeline is NOT a table of normalised constants — it is
 * measured from the real DOM every resize. Two kinds of item:
 *
 *   weight   — share of the "tunnel" span `c`, which is whatever is left of
 *              the section after the card's and laptop's own pixel budgets
 *   pixel    — a real pixel count derived from an element's height
 *
 * Reproducing this removes the hand-fitted phase boundaries: the card and
 * laptop phases automatically take exactly as much scroll as their elements
 * need, and the tunnel divides the remainder by their weights.
 */

export type RangeId =
  | 'blackFrameShow'
  | 'blackFrameIn'
  | 'blackTitle'
  | 'blackTunnel'
  | 'whiteTunnel'
  | 'whiteFrameOut'
  | 'whiteFrameBreak'
  | 'astronautDrop'
  | 'astronautWait'

type Item = { id: RangeId; weight?: number; pixel?: true }

/** their itemList, verbatim */
const ITEMS: Item[] = [
  { id: 'blackFrameShow', pixel: true },
  { id: 'blackFrameIn', weight: 1 },
  { id: 'blackTitle', weight: 5 },
  { id: 'blackTunnel', weight: 12 },
  { id: 'whiteTunnel', weight: 2 },
  { id: 'whiteFrameOut', weight: 1 },
  { id: 'whiteFrameBreak', weight: 1.5 },
  { id: 'astronautDrop', pixel: true },
  { id: 'astronautWait', pixel: true },
]

const TOTAL_WEIGHT = ITEMS.reduce((s, i) => s + (i.weight ?? 0), 0) // 22.5

export type Range = { from: number; to: number; count: number }
export type Ranges = {
  items: Record<RangeId, Range>
  /** total scrollable pixels the sequence occupies */
  total: number
  /** document-space Y at which the sequence starts (their baseY) */
  baseY: number
  /** their getRange(id).ratio — 0..1 within that item */
  ratio: (id: RangeId, offsetY: number) => number
  /** their getRange(a, b).ratio — 0..1 spanning from a's start to b's end */
  span: (a: RangeId, b: RangeId, offsetY: number) => number
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)

/** absolute document rect (their scrollManager.getDomRange) */
function docRange(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const top = r.top + window.scrollY
  return { top, bottom: top + r.height, height: r.height }
}

/**
 * their resize(e, t) — t is the viewport height.
 *
 *   baseY = imgIn.top - viewportHeight
 *   c     = container.bottom - baseY
 *           - (t + imgIn.height) * .5      // the card's own budget
 *           - (t + imgOut.height) * .5     // the laptop's own budget
 */
export function computeRanges(
  container: HTMLElement,
  imgIn: HTMLElement,
  imgOut: HTMLElement,
  footerBottom: number,
  viewportHeight: number,
): Ranges {
  const t = viewportHeight
  const r = docRange(container)
  const n = docRange(imgIn)
  const a = docRange(imgOut)

  const baseY = n.top - t
  const c = r.bottom - baseY - (t + n.height) * 0.5 - (t + a.height) * 0.5

  const pixelCounts: Partial<Record<RangeId, number>> = {
    blackFrameShow: (t + n.height) * 0.5,
    astronautDrop: (t + a.height) * 0.5 + t,
    // their astronautWait spans from the section end to the footer end
    astronautWait: Math.max(0, footerBottom - r.bottom),
  }

  const items = {} as Record<RangeId, Range>
  let total = 0
  for (const it of ITEMS) {
    const count = it.weight != null
      ? Math.max(0, c) * it.weight / TOTAL_WEIGHT
      : pixelCounts[it.id] ?? 0
    items[it.id] = { from: total, count, to: total + count }
    total += count
  }

  const ratio = (id: RangeId, offsetY: number) => {
    const it = items[id]
    return it.count > 0 ? clamp01((offsetY - it.from) / it.count) : offsetY >= it.to ? 1 : 0
  }
  const span = (aId: RangeId, bId: RangeId, offsetY: number) => {
    const from = items[aId].from
    const to = items[bId].to
    return to > from ? clamp01((offsetY - from) / (to - from)) : 0
  }

  return { items, total, baseY, ratio, span }
}
