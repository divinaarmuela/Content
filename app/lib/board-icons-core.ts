/**
 * MILANOTE'S BOARD ICONS, OURS NOW (the owner, 20 Oct 2026: "i notice these icons are not available in our
 * software?"). The 117 icons the imported Milanote boards use, copied into public/board-icons/milanote/ so a
 * board's icon no longer loads from Milanote's servers, and offered in the board picker beside our own twelve.
 * Pure.
 */

export const MILANOTE_ICON_BASE = '/board-icons/milanote/'

/** every icon in public/board-icons/milanote/, by file name */
export const MILANOTE_ICONS: readonly string[] = [
  '1',
  '360-degrees',
  '4',
  'alarm-exclamation',
  'arrow-pointer',
  'arrow-up-right-dots',
  'asterisk',
  'at',
  'barcode',
  'block-quote',
  'bold',
  'book',
  'book-copy',
  'boombox',
  'bowl-food',
  'bridge',
  'buromobelexperte',
  'calendar-days',
  'calendar-image',
  'chess-board',
  'children',
  'circle-9',
  'circle-heart',
  'cloud-question',
  'clover',
  'comment-arrow-down',
  'couch',
  'cow',
  'creative-commons-sampling-plus',
  'd-and-d',
  'dev',
  'duck',
  'eye-dropper-half',
  'face-holding-back-tears',
  'fedora',
  'file-image',
  'file-import',
  'file-invoice',
  'file-lines',
  'fire',
  'fire-flame-simple',
  'first-order',
  'folder-grid',
  'futbol',
  'game-console-handheld',
  'gem',
  'grid',
  'group-arrows-rotate',
  'hands-holding-circle',
  'head-side-brain',
  'head-side-heart',
  'hockey-mask',
  'hose-reel',
  'industry',
  'lamp',
  'layer-minus',
  'leafy-green',
  'location-arrow',
  'memo-pad',
  'meteor',
  'microphone-lines',
  'microwave',
  'mn-10',
  'mn-calendar-day-friday',
  'mn-calendar-day-thursday',
  'mn-calendar-month-august',
  'mn-calendar-month-december',
  'mn-calendar-month-november',
  'mn-calendar-month-october',
  'mn-calendar-month-september',
  'mobile-screen-button',
  'moped',
  'mountain',
  'object-intersect',
  'objects-column',
  'paintbrush-pencil',
  'patreon',
  'pen-fancy-slash',
  'people-carry-box',
  'people-group',
  'person-arrow-down-to-line',
  'phoenix-framework',
  'popsicle',
  'radiation',
  'rectangles-mixed',
  'road-bridge',
  'rss',
  'shapes',
  'sheet-plastic',
  'sidebar',
  'socks',
  'solar-system',
  'splotch',
  'square-1',
  'square-2',
  'square-3',
  'square-4',
  'square-5',
  'square-user',
  'star',
  'star-shooting',
  'swift',
  't',
  'table-cells',
  'tank-water',
  'thought-bubble',
  'truck-bolt',
  'tv-retro',
  'twitter',
  'ufo',
  'user-chef',
  'user-nurse',
  'user-pilot',
  'v',
  'vent-damper',
  'vine',
  'whale',
]

const OURS = /^\/board-icons\/milanote\/([a-z0-9-]+)\.png$/
const THEIRS = /^https:\/\/static\.milanote\.com\/element-icons\/png\/\d+x\d+\/([a-z0-9-]+)\.png$/i

export const milanoteIconUrl = (name: string) => `${MILANOTE_ICON_BASE}${name}.png`

/** one of our copied icons — the only local address a board card may carry */
export function isOwnIconUrl(url: unknown): url is string {
  return typeof url === 'string' && OURS.test(url) && MILANOTE_ICONS.includes(url.match(OURS)![1])
}

/** a Milanote icon address → our copy of it, when we have one; anything else unchanged */
export function localIconUrl(url: string): string {
  const m = url.match(THEIRS)
  return m && MILANOTE_ICONS.includes(m[1].toLowerCase()) ? milanoteIconUrl(m[1].toLowerCase()) : url
}

/** an icon drawn whole and small (a glyph), not a picture that fills the tile */
export function isGlyphIcon(url: string): boolean {
  return url.includes('/element-icons/') || url.startsWith(MILANOTE_ICON_BASE)
}

/** the picker's words for an icon: "file-invoice" → "file invoice" */
export const iconWords = (name: string) => name.replace(/-/g, ' ')

/** the icons whose name holds every word typed */
export function searchIcons(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return MILANOTE_ICONS.filter(n => words.every(w => iconWords(n).includes(w)))
}
