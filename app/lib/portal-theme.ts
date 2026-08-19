/**
 * Pure brand→theme derivation for the client portal — no I/O, unit-tested.
 *
 * A client's portal should wear THEIR brand: background from their lightest
 * brand colour, accent from their strongest, headings in their typeface.
 * Scanned guidelines are messy, so every choice is contrast-guarded — a
 * palette that would produce unreadable text falls back to safe neutrals
 * while keeping whatever brand parts ARE usable.
 */

export type PortalTheme = {
  /** page background */
  bg: string
  /** primary text on bg */
  ink: string
  /** card surface */
  surface: string
  /** hairline borders */
  border: string
  /** the one brand accent (buttons, active chips, highlights) */
  accent: string
  /** text ON the accent */
  accentInk: string
  /** heading font stack ('' = inherit default) */
  headingFont: string
  /** body font stack ('' = inherit default) */
  bodyFont: string
  /** Google Fonts families worth requesting (may 404 harmlessly for non-Google faces) */
  fontFamilies: string[]
  /** true when any real brand colour was used */
  branded: boolean
}

const HEX = /^#?([0-9a-f]{6})$/i

export function parseHex(value?: string | null): [number, number, number] | null {
  const m = value?.trim().match(HEX)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

/** WCAG contrast ratio between two hex colours (1 … 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return 1
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Rough chroma: how far from grey a colour sits (0…255). */
function chroma(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  return Math.max(...rgb) - Math.min(...rgb)
}

type BrandColor = { name?: string; hex?: string; usage?: string }
type BrandFont = { family: string; usage?: string }

const DEFAULT: PortalTheme = {
  bg: '#fafafa',
  ink: '#18181b',
  surface: '#ffffff',
  border: '#e4e4e7',
  accent: '#18181b',
  accentInk: '#ffffff',
  headingFont: '',
  bodyFont: '',
  fontFamilies: [],
  branded: false,
}

/** Mix a hex colour toward white (t 0..1). */
export function tint(hex: string, t: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const mix = rgb.map(c => Math.round(c + (255 - c) * t))
  return `#${mix.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

export function pickPortalTheme(profile?: {
  colors?: BrandColor[]
  fonts?: BrandFont[]
} | null): PortalTheme {
  if (!profile) return DEFAULT
  const colors = (profile.colors ?? [])
    .map(c => ({ ...c, hex: c.hex?.trim() }))
    .filter(c => parseHex(c.hex))
  const fonts = (profile.fonts ?? []).filter(f => f.family?.trim())

  const theme: PortalTheme = { ...DEFAULT, fontFamilies: [] }

  // ── background: a stated background colour, else the lightest usable one ──
  const byUsage = (re: RegExp) => colors.find(c => re.test(`${c.usage ?? ''} ${c.name ?? ''}`.toLowerCase()))
  const bgCandidate =
    byUsage(/background|base|paper|ivory|cream|linen|off.?white/) ??
    [...colors].sort((a, b) => (luminance(b.hex!) ?? 0) - (luminance(a.hex!) ?? 0))[0]
  if (bgCandidate && (luminance(bgCandidate.hex!) ?? 0) > 0.7) {
    theme.bg = bgCandidate.hex!
    theme.surface = '#ffffff'
    theme.border = tint(bgCandidate.hex!, -0)
    theme.branded = true
  }
  // ink must read on bg — dark text on light grounds; refuse dark themes
  // rather than risk an unreadable scan artefact
  if (contrast(theme.ink, theme.bg) < 4.5) {
    theme.bg = DEFAULT.bg
    theme.surface = DEFAULT.surface
  }
  // borders: a whisper of the bg's hue
  theme.border = contrast('#e4e4e7', theme.surface) >= 1 ? '#e4e4e7' : DEFAULT.border

  // ── accent: the strongest non-background colour that can carry a button ──
  const accentCandidates = colors
    .filter(c => c.hex !== theme.bg)
    .filter(c => !/background|paper|ivory|cream|linen|off.?white/.test(`${c.usage ?? ''} ${c.name ?? ''}`.toLowerCase()))
    .sort((a, b) => {
      // prefer explicitly "primary/accent/brand" colours, then chromatic ones
      const score = (c: BrandColor) =>
        (/primary|accent|brand|main|highlight/.test(`${c.usage ?? ''} ${c.name ?? ''}`.toLowerCase()) ? 1000 : 0) +
        chroma(c.hex!)
      return score(b) - score(a)
    })
  for (const c of accentCandidates) {
    if (contrast(c.hex!, theme.bg) >= 2.2) {
      theme.accent = c.hex!
      theme.branded = true
      break
    }
  }
  theme.accentInk = contrast('#ffffff', theme.accent) >= 3 ? '#ffffff' : '#18181b'

  // ── type: first font is the display face, second (or first) the body ──
  if (fonts.length > 0) {
    const heading = fonts[0].family.trim()
    const body = (fonts[1]?.family ?? fonts[0].family).trim()
    theme.headingFont = `'${heading}', Georgia, 'Times New Roman', serif`
    theme.bodyFont = `'${body}', 'Helvetica Neue', Helvetica, Arial, sans-serif`
    theme.fontFamilies = [...new Set([heading, body])]
    theme.branded = true
  }

  return theme
}

/** Google Fonts stylesheet URL for the theme's families (safe to request —
 *  unknown families simply return nothing and the fallback stacks hold). */
export function googleFontsHref(families: string[]): string | null {
  if (families.length === 0) return null
  const parts = families
    .slice(0, 2)
    .map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`
}
