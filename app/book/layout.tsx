import type { Metadata } from 'next'
import { archivo, sometype } from '../components/lama/fonts'

export const metadata: Metadata = {
  title: 'Book with MD Media',
  description: 'Pick a time that suits you.',
  robots: 'noindex, follow',
}

/**
 * The public booking surface.
 *
 * `dbx` is not decoration: globals.css styles the marketing site with bare
 * element selectors, so Tailwind's preflight is scoped to that class rather
 * than applied globally. Without it a <li> keeps its bullet and every <a>
 * renders browser-blue, underlined, and purple once visited. The client
 * portal wraps itself the same way, for the same reason.
 *
 * The ink palette lives in its own --bk-* tokens so nothing here depends on
 * the marketing site's variables or the dashboard's theme.
 */
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`dbx bk-scope ${archivo.variable} ${sometype.variable} min-h-screen antialiased`}
      style={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ '--bk-bg': '#0B0B0B', '--bk-ink': '#f9f4eb', '--bk-line': 'rgba(249,244,235,0.18)' } as any),
        background: 'var(--bk-bg)',
        color: 'var(--bk-ink)',
        fontFamily: 'var(--font-archivo), system-ui, sans-serif',
      }}
    >
      <style>{`
        /* Links take the page's ink, never the browser's blue/purple. */
        .bk-scope a, .bk-scope a:visited, .bk-scope a:active { color: inherit; text-decoration: none; }
        .bk-scope ul, .bk-scope ol { list-style: none; margin: 0; padding: 0; }
        /* Keep a focus ring — losing it strands keyboard users — but paint
           it in the page's own ink, and only for keyboard focus. */
        .bk-scope :focus { outline: none; }
        .bk-scope :focus-visible { outline: 1px solid var(--bk-ink); outline-offset: 2px; }
        .bk-scope input[type="date"]::-webkit-calendar-picker-indicator,
        .bk-scope input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(1); }
      `}</style>

      <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        {/* the real mark, same file the marketing nav uses — inverted,
            because that logo is dark artwork on a dark page here */}
        <a
          href="https://www.mdmmarketing.com.au"
          className="inline-block transition-opacity hover:opacity-100"
          style={{ opacity: 0.85 }}
          aria-label="MD Media"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-6 w-auto"
            style={{ filter: 'invert(1) brightness(1.6)' }} />
        </a>
        <div className="mt-12">{children}</div>
      </div>
    </div>
  )
}
