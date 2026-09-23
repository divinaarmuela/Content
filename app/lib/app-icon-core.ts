/**
 * AN ICON ON THE PHONE (the owner, 23 Sep 2026: "how do i make this into an
 * icon on the phone like an app") — the pure half.
 *
 * Added to a home screen, the dashboard opens with no browser chrome, its own
 * icon and its own name. Two things make that happen: a web manifest (Android
 * and desktop Chrome read it) and an apple-touch-icon plus the Apple meta tags
 * (iOS ignores the manifest for both). The icons are drawn, not stored, so
 * there is no binary in the repo to go stale — see app/icons/[size]/route.tsx.
 *
 * www and app are the same deployment, so the manifest is answered per host:
 * the app host starts at the dashboard, the marketing host at the homepage.
 * No I/O.
 */

/** the sizes the manifest asks for; anything else is refused */
export const ICON_SIZES = [180, 192, 512] as const
export type IconSize = typeof ICON_SIZES[number]

export const INK = '#0A0A0A'
export const CREAM = '#F4F0E6'
export const BLUE = '#0057FF'

export function isIconSize(raw: unknown): raw is IconSize {
  return (ICON_SIZES as readonly number[]).includes(Number(raw))
}

/**
 * Every icon the manifest points at, as a path segment rather than a query.
 *
 * `?maskable=1` looked tidier and silently did not work: the route is
 * prerendered, and a prerendered route ignores the query string, so both
 * addresses returned the same rounded picture and Android would have cropped
 * its corners off (seen on 23 Sep 2026 — the two URLs answered byte for byte
 * the same). A segment is part of the address, so each is built and cached
 * on its own.
 */
export const ICON_PARAMS = ['180', '192', '512', '192-maskable', '512-maskable'] as const

/** the size and shape an address asks for, or null when it is not one we draw */
export function parseIconParam(raw: string | null | undefined): { size: IconSize; maskable: boolean } | null {
  const s = String(raw ?? '')
  const maskable = s.endsWith('-maskable')
  const size = maskable ? s.slice(0, -'-maskable'.length) : s
  return isIconSize(size) ? { size: Number(size) as IconSize, maskable } : null
}

/** the dashboard's own host, where a home-screen icon should open the app and not the marketing site */
export function isAppHost(host: string | null | undefined): boolean {
  return String(host ?? '').toLowerCase().startsWith('app.')
}

export type WebManifest = {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  orientation: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}

/**
 * The manifest for this host. `display: standalone` is what drops the address
 * bar; `scope: /` keeps every link inside the installed app rather than
 * bouncing out to the browser; the maskable copy is the one Android crops into
 * whatever shape the launcher uses, so it carries its own padding.
 */
export function manifestFor(host: string | null | undefined): WebManifest {
  const app = isAppHost(host)
  return {
    name: app ? 'MD Media — Agency OS' : 'MD Media Marketing',
    short_name: 'MD Media',
    description: app
      ? 'The agency dashboard: leads, acquisition, shoots, boards and the posting schedule.'
      : "Melbourne's end-to-end growth agency.",
    start_url: app ? '/dashboard' : '/',
    scope: '/',
    display: 'standalone',
    background_color: INK,
    theme_color: INK,
    orientation: 'portrait',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png' },
      { src: '/icons/192-maskable', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

/** how the mark is laid out at any size: the ink square, the cream MD, the blue slash */
export function iconLayout(size: number, maskable: boolean) {
  // a maskable icon is cropped to a circle by some launchers, so the mark sits inside 80% of the square
  const scale = maskable ? 0.62 : 0.78
  return {
    size,
    fontSize: Math.round(size * 0.34 * (scale / 0.78)),
    padding: Math.round(size * (1 - scale) / 2),
    radius: maskable ? 0 : Math.round(size * 0.22),
    slashWidth: Math.max(2, Math.round(size * 0.045)),
  }
}
