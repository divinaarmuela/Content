import type { PortalIntakeForm } from '../../lib/intake-portal-core'
import { SectionHeading } from './PortalSections'

/**
 * The client's own intake answers, read-only, in the portal's editorial voice
 * (ink/cream, mono kickers, hairline rules — the same --p-* tokens every other
 * portal section uses). One titled block per toggled-on form, every question
 * and answer, unanswered greyed. Purely presentational: no hooks, no I/O, no
 * actions — the portal is read-only and this never edits anything.
 */

const surface: React.CSSProperties = {
  background: 'var(--p-surface, #ffffff)',
  border: '1px solid var(--p-border, #e4e4e7)',
}

export function PortalIntakeView({ forms }: { forms: PortalIntakeForm[] }) {
  if (forms.length === 0) return null
  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      {forms.map(form => (
        <div key={form.id} className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <SectionHeading count={form.total > 0 ? form.answered : undefined}>
              {form.title}
            </SectionHeading>
            <p className="text-xs opacity-60">
              Your answers, exactly as you sent them. This is a read-only copy —
              to change anything, just let us know.
            </p>
          </div>

          {form.sections.map((section, i) => (
            <section key={section.id} className="rounded-xl p-5" style={surface}>
              <div className="mb-4 flex items-baseline gap-3">
                <span
                  className="font-mono text-xs tabular-nums opacity-40"
                  style={{ fontFamily: 'var(--p-mono-font, monospace)' }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3
                  className="text-sm font-semibold"
                  style={{ fontFamily: 'var(--p-heading-font, inherit)' }}
                >
                  {section.title}
                </h3>
              </div>

              <dl className="flex flex-col gap-5">
                {section.rows.map(row => (
                  <div key={row.id}>
                    <dt className="text-xs opacity-55">{row.label}</dt>
                    <dd
                      className={
                        'mt-1 whitespace-pre-wrap text-sm leading-relaxed ' +
                        (row.answered ? '' : 'italic opacity-40')
                      }
                    >
                      {row.answered ? row.text : 'Not answered'}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ))}
    </div>
  )
}
