import { parseServiceCopy } from '../../lib/booking-core'

/**
 * A service description rendered as the sections it actually is —
 * "WHAT'S INCLUDED", "WHAT YOU RECEIVE", "OPTIONAL ADD ONS" — instead of one
 * grey wall of text. The copy stays a plain editable field; the structure is
 * derived, so nobody edits HTML to change a bullet.
 *
 * Sizes are in `em`, relative to the wrapper, so one prop scales the whole
 * block. /book keeps the 14px it always had; the events page, whose headings
 * run to 4.6rem, can ask for something that doesn't read as fine print on a
 * large monitor.
 */
export default function ServiceCopy({ copy, compact, headingFont, size }: {
  copy: string | null
  compact?: boolean
  /** the page's own mono face — /book and /events set different ones */
  headingFont?: string
  /** base type size; anything CSS accepts, including clamp() */
  size?: string
}) {
  const blocks = parseServiceCopy(copy)
  if (blocks.length === 0) return null
  const mono = headingFont ?? 'var(--font-sometype), monospace'

  return (
    <div className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-3'}`}
      style={{ fontSize: size ?? '0.875rem' }}>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return (
            <p key={i} className="uppercase tracking-[0.18em]"
              style={{ opacity: 0.5, fontFamily: mono, fontSize: '0.72em' }}>
              {b.text}
            </p>
          )
        }
        if (b.kind === 'bullets') {
          return (
            // reset on the element: /events is outside .dbx, so Tailwind's
            // preflight never runs there and the browser adds its own discs
            <ul key={i} className="flex flex-col gap-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2 leading-relaxed" style={{ opacity: 0.85 }}>
                  <span aria-hidden style={{ opacity: 0.4 }}>—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="leading-relaxed" style={{ opacity: 0.8 }}>{b.text}</p>
        )
      })}
    </div>
  )
}
