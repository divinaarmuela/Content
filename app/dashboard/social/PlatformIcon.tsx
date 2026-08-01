import type { CSSProperties } from 'react'

/**
 * Platform marks.
 *
 * lucide dropped brand icons, so these are drawn here. Where a logo is simple
 * enough to reproduce faithfully (Instagram's camera, YouTube's play, X's
 * cross) it is drawn; the rest use a brand-coloured monogram, which reads
 * cleanly at 20px and is honest rather than a bad approximation of a
 * trademarked mark.
 */

type Brand = {
  label: string
  /** solid background, or a gradient for the ones that have one */
  background: string
  glyph: 'instagram' | 'youtube' | 'x' | 'play' | 'letter'
  letter?: string
}

export const BRANDS: Record<string, Brand> = {
  instagram: {
    label: 'Instagram',
    background: 'linear-gradient(45deg,#F58529 0%,#DD2A7B 45%,#8134AF 70%,#515BD4 100%)',
    glyph: 'instagram',
  },
  facebook:  { label: 'Facebook',    background: '#1877F2', glyph: 'letter', letter: 'f' },
  tiktok:    { label: 'TikTok',      background: '#010101', glyph: 'letter', letter: '♪' },
  linkedin:  { label: 'LinkedIn',    background: '#0A66C2', glyph: 'letter', letter: 'in' },
  youtube:   { label: 'YouTube',     background: '#FF0000', glyph: 'youtube' },
  threads:   { label: 'Threads',     background: '#000000', glyph: 'letter', letter: '@' },
  pinterest: { label: 'Pinterest',   background: '#E60023', glyph: 'letter', letter: 'P' },
  twitter:   { label: 'X',           background: '#000000', glyph: 'x' },
  bluesky:   { label: 'Bluesky',     background: '#0085FF', glyph: 'letter', letter: 'B' },
  reddit:    { label: 'Reddit',      background: '#FF4500', glyph: 'letter', letter: 'r' },
}

export function brandFor(platform: string): Brand {
  return BRANDS[platform] ?? {
    label: platform.charAt(0).toUpperCase() + platform.slice(1),
    background: '#71717a',
    glyph: 'letter',
    letter: platform.charAt(0).toUpperCase(),
  }
}

export default function PlatformIcon({
  platform, size = 20, className = '',
}: { platform: string; size?: number; className?: string }) {
  const brand = brandFor(platform)
  const style: CSSProperties = {
    width: size,
    height: size,
    background: brand.background,
    borderRadius: Math.max(4, size * 0.28),
  }
  const inner = Math.round(size * 0.62)

  return (
    <span
      style={style}
      className={`inline-flex shrink-0 items-center justify-center text-white ${className}`}
      title={brand.label}
      aria-label={brand.label}
      role="img"
    >
      {brand.glyph === 'instagram' && (
        <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      )}

      {brand.glyph === 'youtube' && (
        <svg width={inner} height={inner} viewBox="0 0 24 24" fill="currentColor">
          <path d="M9.5 8.4v7.2l6.2-3.6-6.2-3.6Z" />
        </svg>
      )}

      {brand.glyph === 'x' && (
        <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      )}

      {brand.glyph === 'letter' && (
        <span
          style={{ fontSize: size * (brand.letter && brand.letter.length > 1 ? 0.38 : 0.52), lineHeight: 1 }}
          className="font-bold"
        >
          {brand.letter}
        </span>
      )}
    </span>
  )
}
