import localFont from 'next/font/local'

/** Space Mono, shipped with the app rather than fetched from Google at build time (30 Sep 2026, see lama/fonts.ts) */
export const spaceMono = localFont({
  src: [
    { path: '../../node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/space-mono/files/space-mono-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-space-mono',
  display: 'swap',
})
