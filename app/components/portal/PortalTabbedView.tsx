'use client'

import { useState } from 'react'
import { PortalIntakeView } from './PortalIntake'
import type { PortalIntakeForm } from '../../lib/intake-portal-core'

/**
 * The portal's optional tab bar. When a client has ≥1 intake form toggled on,
 * the portal grows two tabs — "Overview" (everything it shows today) and "Your
 * intake" (their read-only answers). When nothing is toggled on it renders the
 * overview alone, no tab bar, so the portal is byte-for-byte what it is today.
 *
 * The overview is passed in as `children` — it stays server-rendered in the
 * share-link portal — and this only decides which of the two is on screen.
 */
export default function PortalTabbedView({ intake, children, themeStyle }: {
  intake: PortalIntakeForm[]
  children: React.ReactNode
  /** --p-* token overrides for the tab bar and intake view ONLY — the
   *  logged-in portal passes its dashboard tokens here so the tab and answers
   *  follow light/dark, while the overview `children` are left untouched so
   *  they stay byte-for-byte what they are today. The share-link portal omits
   *  it and inherits the portal theme from its ancestor. */
  themeStyle?: React.CSSProperties
}) {
  const [tab, setTab] = useState<'overview' | 'intake'>('overview')
  if (intake.length === 0) return <>{children}</>

  const tabClass = (active: boolean) =>
    'portal-tap px-4 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors ' +
    (active ? '' : 'opacity-45 hover:opacity-80')

  return (
    <div className="flex flex-col">
      <div
        role="tablist"
        aria-label="Portal sections"
        className="flex items-center gap-1 px-5 pt-6 sm:px-10"
        style={{ fontFamily: 'var(--p-mono-font, monospace)', ...themeStyle }}
      >
        {([['overview', 'Overview'], ['intake', 'Your intake']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={tabClass(tab === key)}
            style={tab === key ? {
              borderBottom: '2px solid var(--p-accent, #18181b)',
              color: 'var(--p-ink, inherit)',
            } : { borderBottom: '2px solid transparent' }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* keep the overview mounted but hidden so switching back is instant and
          its scroll position survives; the intake view mounts only when picked */}
      <div hidden={tab !== 'overview'}>{children}</div>
      {tab === 'intake' && (
        <div className="px-5 py-10 sm:px-10 sm:py-14" style={themeStyle}>
          <PortalIntakeView forms={intake} />
        </div>
      )}
    </div>
  )
}
