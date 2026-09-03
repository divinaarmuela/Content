import type { CSSProperties } from 'react'

/**
 * Platform marks — the real logos, on their real colours.
 *
 * lucide dropped brand icons, so each mark is drawn here as inline SVG. They
 * used to be letters on a coloured tile ("f", "in", "♪"), which read as a
 * monogram rather than as a logo: at 16px on a post tile nobody recognises a
 * lower-case "f" as Facebook, and "♪" is not TikTok's note. Every page that
 * shows a channel uses this component, so drawing them properly once fixes
 * the calendar, the composer, the channel list, the inbox and the analytics
 * page together.
 *
 * A platform we have no mark for still gets a clean monogram on a neutral
 * tile — an honest placeholder beats a wrong logo.
 */

type Brand = {
  label: string
  /** solid background, or a gradient for the ones that have one */
  background: string
  glyph: GlyphName
  letter?: string
}

type GlyphName =
  | 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'youtube'
  | 'threads' | 'x' | 'pinterest' | 'bluesky' | 'reddit' | 'letter'

export const BRANDS: Record<string, Brand> = {
  instagram: {
    label: 'Instagram',
    background: 'linear-gradient(45deg,#F58529 0%,#DD2A7B 45%,#8134AF 70%,#515BD4 100%)',
    glyph: 'instagram',
  },
  facebook:  { label: 'Facebook',  background: '#1877F2', glyph: 'facebook' },
  tiktok:    { label: 'TikTok',    background: '#010101', glyph: 'tiktok' },
  linkedin:  { label: 'LinkedIn',  background: '#0A66C2', glyph: 'linkedin' },
  youtube:   { label: 'YouTube',   background: '#FF0000', glyph: 'youtube' },
  threads:   { label: 'Threads',   background: '#000000', glyph: 'threads' },
  pinterest: { label: 'Pinterest', background: '#E60023', glyph: 'pinterest' },
  twitter:   { label: 'X',         background: '#000000', glyph: 'x' },
  bluesky:   { label: 'Bluesky',   background: '#0085FF', glyph: 'bluesky' },
  reddit:    { label: 'Reddit',    background: '#FF4500', glyph: 'reddit' },
}

export function brandFor(platform: string): Brand {
  return BRANDS[platform] ?? {
    label: platform.charAt(0).toUpperCase() + platform.slice(1),
    background: '#71717a',
    glyph: 'letter',
    letter: platform.charAt(0).toUpperCase(),
  }
}

/**
 * The marks themselves, each on a 24×24 box and drawn in `currentColor` so
 * one component can put any of them on any plate.
 *
 * Filled paths rather than strokes: a stroked logo at 12px turns into a grey
 * smudge, and these are shown as small as 12px in the activity list.
 */
function Glyph({ name, size, letter }: { name: GlyphName; size: number; letter?: string }) {
  const svg = (children: React.ReactNode, extra?: Record<string, string>) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...extra}>
      {children}
    </svg>
  )

  switch (name) {
    case 'instagram':
      return svg(
        <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.8" y="2.8" width="18.4" height="18.4" rx="5.4" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.5" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
        </g>,
      )

    case 'facebook':
      // the "f" in its circle — the mark, not the letter
      return svg(
        <path d="M13.6 21.9V13.5h2.8l.42-3.26H13.6V8.16c0-.94.26-1.58 1.61-1.58h1.72V3.66a23 23 0 0 0-2.5-.13c-2.48 0-4.18 1.51-4.18 4.3v2.4H7.44v3.27h2.81v8.4z" />,
      )

    case 'tiktok':
      // the note with its offset shadow, as one shape
      return svg(
        <path d="M16.9 2.2h-3.2v13.1a2.62 2.62 0 1 1-1.9-2.52V9.5a5.86 5.86 0 1 0 5.1 5.8V8.9a6.6 6.6 0 0 0 3.9 1.26V6.9a3.83 3.83 0 0 1-3.9-3.6z" />,
      )

    case 'linkedin':
      return svg(
        <g>
          <path d="M7.1 20.4H4.1V9.4h3zM5.6 8.1a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z" />
          <path d="M20.4 20.4h-3v-5.35c0-1.28-.02-2.92-1.78-2.92-1.79 0-2.06 1.39-2.06 2.83v5.44h-3V9.4h2.88v1.5h.04a3.16 3.16 0 0 1 2.84-1.56c3.04 0 3.6 2 3.6 4.6z" />
        </g>,
      )

    case 'youtube':
      // on the red plate the mark IS the play triangle
      return svg(<path d="M9.6 7.9v8.2l7-4.1z" />)

    case 'threads':
      return svg(
        <path d="M12.9 11.2c-2.2-.1-3.8.9-3.8 2.6 0 1.5 1.2 2.4 2.8 2.4 1.9 0 3-1.2 3.2-3.2.6.3.9.9.9 1.7 0 1.9-1.6 3.4-4.1 3.4-3 0-4.9-2.1-4.9-6.1 0-4 1.9-6.1 4.9-6.1 2.1 0 3.5.9 4.2 2.6l1.9-.8C17 5.3 15.1 3.9 12 3.9c-4.3 0-7 2.9-7 8.1s2.7 8.1 7 8.1c3.7 0 6.2-2.4 6.2-5.5 0-1.9-.9-3.3-2.4-4-.4-1.6-1.8-2.6-3.7-2.7-1.5-.1-2.7.5-3.4 1.6l1.6 1c.4-.6 1-.9 1.8-.9 1 0 1.6.5 1.8 1.6zm-.9 3.1c-.7 0-1.1-.3-1.1-.8 0-.6.6-1 1.7-.9h.5c-.1 1.2-.5 1.7-1.1 1.7z" />,
      )

    case 'x':
      return svg(
        <path d="M17.2 3.5h2.9l-6.4 7.3 7.5 9.7h-5.9l-4.6-6-5.3 6H2.5l6.8-7.8L2.1 3.5h6l4.2 5.5zm-1 14.8h1.6L7.9 5.1H6.2z" />,
      )

    case 'pinterest':
      return svg(
        <path d="M12 3a9 9 0 0 0-3.3 17.4c-.08-.73-.15-1.85.03-2.65l1.07-4.53s-.27-.55-.27-1.36c0-1.27.74-2.22 1.66-2.22.78 0 1.16.59 1.16 1.3 0 .79-.5 1.97-.76 3.06-.22.92.46 1.67 1.37 1.67 1.64 0 2.9-1.73 2.9-4.23 0-2.21-1.59-3.76-3.86-3.76-2.63 0-4.17 1.97-4.17 4 0 .79.3 1.64.69 2.1a.28.28 0 0 1 .06.27l-.26 1.05c-.04.17-.14.21-.32.13-1.19-.55-1.93-2.28-1.93-3.68 0-3 2.18-5.75 6.28-5.75 3.3 0 5.86 2.35 5.86 5.49 0 3.28-2.06 5.91-4.93 5.91-.96 0-1.87-.5-2.18-1.1l-.6 2.28c-.21.82-.79 1.85-1.18 2.48A9 9 0 1 0 12 3z" />,
      )

    case 'bluesky':
      // the butterfly, as its two wings
      return svg(
        <path d="M12 10.9C10.8 8.6 7.6 5.2 5 3.7 2.3 2.1 1.3 2.4.8 2.9.1 3.5 0 4.7 0 5.4c0 .7.4 5.5.6 6.3.8 2.6 3.6 3.5 6.1 3.2h.4c-3.8.6-7.1 2-2.7 6.9 4.8 5 6.6-1.1 7.6-4.2 1 3.1 2 9 7.5 4.2 4.1-4 1.1-6.3-2.7-6.9h.4c2.5.3 5.3-.6 6.1-3.2.2-.8.6-5.6.6-6.3 0-.7-.1-1.9-.8-2.5-.5-.5-1.5-.8-4.2.8-2.6 1.5-5.8 4.9-7 7.2z" />,
      )

    case 'reddit':
      return svg(
        <path d="M22 11.8c0-1.2-1-2.2-2.2-2.2-.6 0-1.1.2-1.5.6a10.7 10.7 0 0 0-5.5-1.7l.9-4.2 2.9.6a1.6 1.6 0 1 0 .2-1.4l-3.6-.8a.7.7 0 0 0-.8.5l-1.1 5.3c-2 .1-4 .7-5.6 1.7a2.2 2.2 0 1 0-2.4 3.6 4 4 0 0 0 0 .6c0 3.2 3.7 5.7 8.3 5.7s8.3-2.5 8.3-5.7a4 4 0 0 0 0-.6c.7-.4 1.1-1.1 1.1-2zM7.5 13.4a1.6 1.6 0 1 1 3.2 0 1.6 1.6 0 0 1-3.2 0zm8.9 4.2c-1.1 1.1-3.2 1.2-3.8 1.2-.6 0-2.7-.1-3.8-1.2a.4.4 0 0 1 .6-.6c.7.7 2.2.9 3.2.9s2.5-.2 3.2-.9a.4.4 0 1 1 .6.6zm-.3-2.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z" />,
      )

    default:
      return (
        <span
          style={{ fontSize: size * ((letter?.length ?? 1) > 1 ? 0.6 : 0.82), lineHeight: 1 }}
          className="font-bold"
        >
          {letter}
        </span>
      )
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
  // the mark sits inside the plate with a little air around it
  const inner = Math.round(size * 0.66)

  return (
    <span
      style={style}
      className={`inline-flex shrink-0 items-center justify-center text-white ${className}`}
      title={brand.label}
      aria-label={brand.label}
      role="img"
    >
      <Glyph name={brand.glyph} size={inner} letter={brand.letter} />
    </span>
  )
}
