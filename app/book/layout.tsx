import type { Metadata } from 'next'
import { archivo, sometype } from '../components/lama/fonts'

export const metadata: Metadata = {
  title: 'Book with MD Media',
  description: 'Pick a time that suits you.',
  robots: 'noindex, follow',
}

/**
 * The public booking surface. Self-contained ink palette in its own tokens
 * (--bk-*) so it never inherits the marketing site's element styles or the
 * dashboard's .dbx scope — a booking link is often opened on a phone, from
 * an email, by someone who has never seen either.
 */
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${archivo.variable} ${sometype.variable} min-h-screen antialiased`}
      style={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ '--bk-bg': '#0B0B0B', '--bk-ink': '#f9f4eb', '--bk-line': 'rgba(249,244,235,0.18)' } as any),
        background: 'var(--bk-bg)',
        color: 'var(--bk-ink)',
        fontFamily: 'var(--font-archivo), system-ui, sans-serif',
      }}
    >
      {/* The browser's default focus ring is bright blue, which reads as a
          stray line against this palette. Keep a ring — losing it entirely
          strands keyboard users — but paint it in the page's own ink, and
          only for keyboard focus, never on a mouse click. */}
      <style>{`
        .bk-scope :focus { outline: none; }
        .bk-scope :focus-visible {
          outline: 1px solid var(--bk-ink);
          outline-offset: 2px;
        }
        .bk-scope input[type="date"]::-webkit-calendar-picker-indicator,
        .bk-scope input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(1); }
      `}</style>
      <div className="bk-scope mx-auto w-full max-w-2xl px-5 py-12 sm:px-8 sm:py-20">
        <a href="https://www.mdmmarketing.com.au"
          className="text-[11px] uppercase tracking-[0.22em] transition-opacity hover:opacity-60"
          style={{ opacity: 0.5 }}>
          MD Media
        </a>
        <div className="mt-10">{children}</div>
      </div>
    </div>
  )
}
