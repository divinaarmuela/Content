/**
 * THE IMAGE EDITOR'S ARITHMETIC — no canvas, no DOM, no I/O.
 *
 * Everything the editor decides is decided here: where a crop box sits for a
 * preset, how far it may be dragged, what a filter does to a pixel, where the
 * one line of text lands, and — the only rule with a client's approval riding
 * on it — WHICH SAVE this edit is.
 *
 * That last one is the reason this file exists apart from the window that
 * draws it. Cropping is the same picture in a tighter frame, so the client's
 * yes still means what it meant. A filter or a line of text is a DIFFERENT
 * picture, and a yes given to the old one cannot be carried over to it. The
 * button has to say which of the two is about to happen BEFORE it is pressed,
 * and a rule that important does not belong inside a React component where
 * nothing can test it.
 */

export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }

/** No crop may go below this, in source pixels — a two-pixel box is a
 *  mis-drag, never an intention. */
export const MIN_CROP_PX = 16

/** The long side of anything this editor writes out. Bigger than every
 *  platform asks for, small enough that the browser can hold the bitmap. */
export const MAX_EXPORT_PX = 4096

/* ── crop ──────────────────────────────────────────────────────────────── */

export type CropPreset = {
  key: string
  /** what a person reads on the chip */
  label: string
  /** width ÷ height. Null is freehand. */
  ratio: number | null
  /** where this shape is used, in plain words */
  hint: string
}

/**
 * The shapes worth offering, in the order the platforms actually want them.
 *
 * Named for the place they go rather than for their arithmetic: "Story" is
 * what somebody is making, "9:16" is only how it is measured.
 */
export const CROP_PRESETS: readonly CropPreset[] = [
  { key: 'free', label: 'Free', ratio: null, hint: 'Any shape you drag' },
  { key: 'square', label: 'Square', ratio: 1, hint: 'Feed posts' },
  { key: 'portrait', label: 'Tall', ratio: 4 / 5, hint: 'Instagram feed, takes the most room' },
  { key: 'story', label: 'Story', ratio: 9 / 16, hint: 'Stories and reels' },
  { key: 'wide', label: 'Wide', ratio: 16 / 9, hint: 'YouTube and video covers' },
  { key: 'landscape', label: 'Landscape', ratio: 1.91, hint: 'Link previews' },
] as const

export function presetByKey(key: string): CropPreset {
  return CROP_PRESETS.find(p => p.key === key) ?? CROP_PRESETS[0]
}

const whole = (size: Size): Rect => ({
  x: 0, y: 0,
  width: Math.max(1, Math.floor(size.width)),
  height: Math.max(1, Math.floor(size.height)),
})

/**
 * The biggest box of this shape that fits, centred.
 *
 * Centred rather than top-left because a person picking "Story" on a
 * landscape photo means the middle of it — the subject is almost never in the
 * left-hand ninth.
 */
export function cropRectFor(size: Size, ratio: number | null): Rect {
  const box = whole(size)
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return box

  let width = box.width
  let height = Math.round(width / ratio)
  if (height > box.height) {
    height = box.height
    width = Math.round(height * ratio)
  }
  width = Math.max(1, Math.min(box.width, width))
  height = Math.max(1, Math.min(box.height, height))
  return {
    x: Math.round((box.width - width) / 2),
    y: Math.round((box.height - height) / 2),
    width,
    height,
  }
}

/**
 * Put a dragged box back inside the picture.
 *
 * Size first, then position: a box that has been made too big is shrunk to
 * fit before it is pushed back in, so dragging a corner off the edge stops at
 * the edge instead of dragging the whole frame off with it.
 */
export function clampCrop(rect: Rect, size: Size, ratio: number | null = null): Rect {
  const box = whole(size)
  const min = Math.max(1, Math.min(MIN_CROP_PX, box.width, box.height))

  let width = Math.min(box.width, Math.max(min, Math.round(rect.width)))
  let height = Math.min(box.height, Math.max(min, Math.round(rect.height)))

  if (ratio !== null && Number.isFinite(ratio) && ratio > 0) {
    height = Math.round(width / ratio)
    if (height > box.height) {
      height = box.height
      width = Math.round(height * ratio)
    }
    if (width > box.width) {
      width = box.width
      height = Math.round(width / ratio)
    }
    width = Math.max(1, Math.min(box.width, width))
    height = Math.max(1, Math.min(box.height, height))
  }

  const x = Math.min(Math.max(0, Math.round(rect.x)), box.width - width)
  const y = Math.min(Math.max(0, Math.round(rect.y)), box.height - height)
  return { x, y, width, height }
}

/** Nothing was cropped: the box is still the whole picture. */
export function isWholeImage(rect: Rect, size: Size): boolean {
  const box = whole(size)
  return rect.x === 0 && rect.y === 0
    && rect.width === box.width && rect.height === box.height
}

/**
 * What the file is written at.
 *
 * The crop's own pixels, so nothing is invented or thrown away — unless the
 * source is enormous, in which case the long side is brought down to
 * MAX_EXPORT_PX and the shape is kept exactly.
 */
export function exportSize(rect: Rect, max: number = MAX_EXPORT_PX): Size {
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const long = Math.max(width, height)
  if (long <= max) return { width, height }
  const k = max / long
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  }
}

/* ── filters ───────────────────────────────────────────────────────────── */

/**
 * Four sliders, in the words on the labels.
 *
 * Brightness, contrast and saturation are percentages where 100 is "as shot".
 * Warmth runs -100 (cold) to 100 (warm) because there is no percentage of
 * warmth that reads as neutral; zero does.
 */
export type Filters = {
  brightness: number
  contrast: number
  saturation: number
  warmth: number
}

export const NEUTRAL_FILTERS: Filters = {
  brightness: 100, contrast: 100, saturation: 100, warmth: 0,
}

export function readFilters(raw: Partial<Filters> | null | undefined): Filters {
  const n = (v: unknown, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    brightness: clampRange(n(raw?.brightness, 100), 0, 200),
    contrast: clampRange(n(raw?.contrast, 100), 0, 200),
    saturation: clampRange(n(raw?.saturation, 100), 0, 200),
    warmth: clampRange(n(raw?.warmth, 0), -100, 100),
  }
}

export function clampRange(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.min(hi, Math.max(lo, v))
}

export function filtersAreNeutral(f: Filters): boolean {
  return f.brightness === 100 && f.contrast === 100
    && f.saturation === 100 && f.warmth === 0
}

/** A look is nothing but a saved set of the same four sliders — so a person
 *  can nudge one afterwards instead of being stuck with the preset. */
export type Look = { key: string; label: string; filters: Filters }

export const LOOKS: readonly Look[] = [
  { key: 'none', label: 'As shot', filters: NEUTRAL_FILTERS },
  { key: 'bright', label: 'Bright', filters: { brightness: 112, contrast: 104, saturation: 106, warmth: 6 } },
  { key: 'punch', label: 'Punchy', filters: { brightness: 102, contrast: 122, saturation: 124, warmth: 0 } },
  { key: 'warm', label: 'Warm film', filters: { brightness: 104, contrast: 96, saturation: 108, warmth: 34 } },
  { key: 'cool', label: 'Cool', filters: { brightness: 100, contrast: 106, saturation: 96, warmth: -30 } },
  { key: 'fade', label: 'Faded', filters: { brightness: 106, contrast: 84, saturation: 82, warmth: 8 } },
  { key: 'mono', label: 'Black and white', filters: { brightness: 102, contrast: 110, saturation: 0, warmth: 0 } },
] as const

/**
 * A 3×4 colour matrix: [rr rg rb ro, gr gg gb go, br bg bb bo].
 *
 * The offsets are in 0–255, the same scale as the pixels, so applying it is a
 * multiply-and-add per channel and nothing has to be normalised twice.
 *
 * ONE definition of what a slider does, shared by the preview and by the file
 * that is written. The obvious alternative — CSS `filter` for the preview,
 * pixel maths for the export — is two definitions, and they disagree on
 * warmth: what somebody approved on screen would not be what came out.
 */
export type ColourMatrix = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

const IDENTITY: ColourMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/** `a` applied AFTER `b`. */
export function composeMatrix(a: ColourMatrix, b: ColourMatrix): ColourMatrix {
  const out: number[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(
        a[row * 4 + 0] * b[0 * 4 + col]
        + a[row * 4 + 1] * b[1 * 4 + col]
        + a[row * 4 + 2] * b[2 * 4 + col],
      )
    }
    out.push(
      a[row * 4 + 0] * b[3] + a[row * 4 + 1] * b[7] + a[row * 4 + 2] * b[11]
      + a[row * 4 + 3],
    )
  }
  return out as unknown as ColourMatrix
}

/** Rec. 709 luminance — the weights a screen actually uses. */
const LUMA = [0.2126, 0.7152, 0.0722] as const

export function filterMatrix(f: Filters): ColourMatrix {
  const b = clampRange(f.brightness, 0, 200) / 100
  const c = clampRange(f.contrast, 0, 200) / 100
  const s = clampRange(f.saturation, 0, 200) / 100
  const w = clampRange(f.warmth, -100, 100) / 100

  // warmth: red up and blue down together, so the picture turns rather than
  // just getting redder
  const warm: ColourMatrix = [
    1 + 0.2 * w, 0, 0, 0,
    0, 1 + 0.02 * w, 0, 0,
    0, 0, 1 - 0.2 * w, 0,
  ]

  const sat: ColourMatrix = [
    (1 - s) * LUMA[0] + s, (1 - s) * LUMA[1], (1 - s) * LUMA[2], 0,
    (1 - s) * LUMA[0], (1 - s) * LUMA[1] + s, (1 - s) * LUMA[2], 0,
    (1 - s) * LUMA[0], (1 - s) * LUMA[1], (1 - s) * LUMA[2] + s, 0,
  ]

  // contrast pivots on mid grey, then brightness scales the lot
  const k = b * c
  const offset = b * 127.5 * (1 - c)
  const tone: ColourMatrix = [
    k, 0, 0, offset,
    0, k, 0, offset,
    0, 0, k, offset,
  ]

  return composeMatrix(tone, composeMatrix(sat, warm))
}

/** Is this matrix a no-op, to a pixel's worth of tolerance? */
export function matrixIsIdentity(m: ColourMatrix): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-6)
}

/**
 * Run the matrix over RGBA bytes, in place. Alpha is never touched — a
 * transparent PNG corner must stay transparent.
 */
export function applyMatrix(
  data: Uint8ClampedArray | number[], m: ColourMatrix,
): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    data[i] = clamp255(m[0] * r + m[1] * g + m[2] * b + m[3])
    data[i + 1] = clamp255(m[4] * r + m[5] * g + m[6] * b + m[7])
    data[i + 2] = clamp255(m[8] * r + m[9] * g + m[10] * b + m[11])
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/* ── the one line of text ──────────────────────────────────────────────── */

export type TextFont = { key: string; label: string; stack: string }

/** Three, not thirty: a caption on a picture is either the brand's face, a
 *  clean sans, or a serif. */
export const TEXT_FONTS: readonly TextFont[] = [
  { key: 'sans', label: 'Clean', stack: '600 {px}px "Helvetica Neue", Arial, sans-serif' },
  { key: 'serif', label: 'Classic', stack: '600 {px}px Georgia, "Times New Roman", serif' },
  { key: 'mono', label: 'Typewriter', stack: '600 {px}px "Courier New", monospace' },
] as const

export type TextLine = {
  text: string
  font: string
  /** height of the letters as a percentage of the picture's height */
  size: number
  colour: string
  /** where the middle of the line sits, 0–1 across and down */
  x: number
  y: number
}

export const TEXT_SIZE_MIN = 2
export const TEXT_SIZE_MAX = 24

export const EMPTY_TEXT: TextLine = {
  text: '', font: 'sans', size: 8, colour: '#ffffff', x: 0.5, y: 0.85,
}

/** A dragged caption stops at the edge rather than leaving the picture. */
export function clampTextSpot(spot: { x: number; y: number }): { x: number; y: number } {
  const round = (v: number) => Math.round(clampRange(v, 0, 1) * 1000) / 1000
  return { x: round(spot.x), y: round(spot.y) }
}

/** Where the line is drawn, in the pixels of whatever it is drawn on — the
 *  preview canvas and the exported file both ask this, so a caption cannot
 *  land somewhere else in the file than it did on screen. */
export function textLayout(line: TextLine, box: Size): {
  x: number; y: number; fontPx: number; font: string
} {
  const spot = clampTextSpot({ x: line.x, y: line.y })
  const fontPx = Math.max(
    1,
    Math.round(clampRange(line.size, TEXT_SIZE_MIN, TEXT_SIZE_MAX) / 100 * box.height),
  )
  const stack = (TEXT_FONTS.find(f => f.key === line.font) ?? TEXT_FONTS[0]).stack
  return {
    x: Math.round(spot.x * box.width),
    y: Math.round(spot.y * box.height),
    fontPx,
    font: stack.replace('{px}', String(fontPx)),
  }
}

export function hasText(line: TextLine | null | undefined): boolean {
  return Boolean(line && line.text.trim())
}

/* ── which save this is ────────────────────────────────────────────────── */

export type SaveKind = 'none' | 'crop' | 'version'

export type SavePlan = {
  kind: SaveKind
  /** the words ON the button, before it is pressed */
  label: string
  /** the sentence under it, saying what will happen to the approval */
  notice: string
  disabled: boolean
}

/**
 * THE RULE, and the only place it is written.
 *
 * A crop is the same picture in a tighter frame: the client's approval still
 * covers it, the file is written alongside the version it came from, and the
 * button says "Save crop". Anything that changes a pixel's colour or puts a
 * word on top is a new picture; it becomes a new version and the piece goes
 * back to the client — and the button says THAT, in the sentence a scheduler
 * would use, before anybody presses it.
 */
export function saveDecision(edit: {
  cropped: boolean; filtered: boolean; text: boolean
}): SavePlan {
  if (edit.filtered || edit.text) {
    return {
      kind: 'version',
      label: 'Save as new version — needs client approval',
      notice: 'A filter or a caption makes a different picture, so this is saved as a new version and the client is asked to look at it again before the post can go out.',
      disabled: false,
    }
  }
  if (edit.cropped) {
    return {
      kind: 'crop',
      label: 'Save crop',
      notice: 'Same picture, tighter frame — the client’s approval stays as it is.',
      disabled: false,
    }
  }
  return {
    kind: 'none',
    label: 'Save',
    notice: 'Nothing has changed yet.',
    disabled: true,
  }
}

/* ── video ─────────────────────────────────────────────────────────────── */

export type Trim = { start: number; end: number }

/** Under a second is not a clip. */
export const MIN_CLIP_SEC = 1

export function clampTrim(trim: Trim, duration: number): Trim {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0
  if (total <= 0) return { start: 0, end: 0 }
  const shortest = Math.min(MIN_CLIP_SEC, total)
  const start = clampRange(trim.start, 0, Math.max(0, total - shortest))
  const end = clampRange(trim.end, start + shortest, total)
  return { start: round2(start), end: round2(end) }
}

export function wholeClip(duration: number): Trim {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0
  return { start: 0, end: round2(total) }
}

export function trimChanged(trim: Trim, duration: number): boolean {
  const w = wholeClip(duration)
  return Math.abs(trim.start - w.start) > 0.05 || Math.abs(trim.end - w.end) > 0.05
}

/** The cover has to be a frame that is still in the clip. */
export function clampCover(at: number, trim: Trim): number {
  return round2(clampRange(at, trim.start, Math.max(trim.start, trim.end)))
}

/**
 * A video is never re-encoded in the browser — we would be handing the client
 * a worse copy of their own footage. So neither control here rewrites the
 * file, and neither takes the approval away: the cover frame is a still
 * picked out of the video already approved, and the trim marks are an
 * instruction that travels with the post.
 */
export function videoSaveDecision(edit: {
  coverChanged: boolean; trimmed: boolean
}): SavePlan {
  if (!edit.coverChanged && !edit.trimmed) {
    return { kind: 'none', label: 'Save', notice: 'Nothing has changed yet.', disabled: true }
  }
  const parts: string[] = []
  if (edit.coverChanged) parts.push('the cover frame')
  if (edit.trimmed) parts.push('where the clip starts and ends')
  return {
    kind: 'crop',
    label: 'Save',
    notice: `The video itself is untouched, so the client’s approval stays. We save ${parts.join(' and ')} with it.`,
    disabled: false,
  }
}

/** "0:07" / "1:03:20" — the way a person reads a position in a video. */
export function clockOf(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/* ── the file that comes out ───────────────────────────────────────────── */

/**
 * What the derived file is called.
 *
 * Named after the original with a word saying what was done to it, so a
 * folder of them can be read at a glance — "Hero shot — cropped.jpg" rather
 * than another 40-character key nobody can match to anything.
 */
export function derivedName(source: string, what: 'cropped' | 'edited' | 'cover'): string {
  const clean = String(source ?? '').trim() || 'picture'
  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const extension = what === 'cover' ? '.jpg' : (dot > 0 ? clean.slice(dot) : '.jpg')
  const word = what === 'cropped' ? 'cropped' : what === 'cover' ? 'cover' : 'edited'
  return `${stem} — ${word}${extension}`
}

/** JPEG unless the source was a PNG, which is usually a PNG because it has
 *  transparency or flat graphics in it — both of which JPEG ruins. */
export function outputType(sourceUrl: string): { mime: string; quality: number } {
  const clean = String(sourceUrl ?? '').split('?')[0].toLowerCase()
  return clean.endsWith('.png')
    ? { mime: 'image/png', quality: 1 }
    : { mime: 'image/jpeg', quality: 0.92 }
}
