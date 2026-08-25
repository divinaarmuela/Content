import { parseServiceCopy } from '../../lib/booking-core'

/**
 * A service description rendered as the sections it actually is —
 * "WHAT'S INCLUDED", "WHAT YOU RECEIVE", "OPTIONAL ADD ONS" — instead of one
 * grey wall of text. The copy stays a plain editable field; the structure is
 * derived, so nobody edits HTML to change a bullet.
 */
export default function ServiceCopy({ copy, compact, headingFont }: {
  copy: string | null
  compact?: boolean
  /** the page's own mono face — /book and /events set different ones */
  headingFont?: string
}) {
  const blocks = parseServiceCopy(copy)
  if (blocks.length === 0) return null
  const mono = headingFont ?? 'var(--font-sometype), monospace'

  return (
    <div className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-3'}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return (
            <p key={i} className="text-[10px] uppercase tracking-[0.18em]"
              style={{ opacity: 0.5, fontFamily: mono }}>
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
                <li key={j} className="flex gap-2 text-sm leading-relaxed" style={{ opacity: 0.85 }}>
                  <span aria-hidden style={{ opacity: 0.4 }}>—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="text-sm leading-relaxed" style={{ opacity: 0.8 }}>{b.text}</p>
        )
      })}
    </div>
  )
}
