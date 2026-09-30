import localFont from 'next/font/local'

// SHIPPED WITH THE APP, not fetched from Google at build time (30 Sep 2026: Vercel's builds failed on the Google
// font download — "Module not found … internal/font/google/archivo…" — several times in one evening). Same faces,
// same weights, from the @fontsource packages.
export const archivo = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-300-normal.woff2', weight: '300', style: 'normal' },
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../../node_modules/@fontsource/archivo/files/archivo-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-archivo',
  display: 'swap',
})

export const sometype = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/sometype-mono/files/sometype-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../../node_modules/@fontsource/sometype-mono/files/sometype-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-sometype',
  display: 'swap',
})
