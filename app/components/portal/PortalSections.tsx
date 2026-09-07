'use client'

import { useEffect, useState } from 'react'
import type { PortalItem } from '../../lib/portal-data'
import { amPhrase } from '../../lib/portal-words'
import {
  METRICS_PENDING_LINE, compactCount, metricCells, metricsPending, updatedAgo,
} from '../../lib/post-analytics-core'
import { portalFollowersLine } from '../../lib/post-performance-core'
import Sparkline from '../Sparkline'

/**
 * The client portal's small shared pieces — a section heading, a published
 * post's numbers, the help line. Themed by CSS variables (--p-accent,
 * --p-accent-ink, --p-border, --p-mono-font) so the share-link portal and
 * the signed-in portal read the same.
 *
 * The old review cards, the second "final post" approval and the monthly
 * quota tiles used to live here. They are gone on purpose: one approval, on
 * the card, no note ever required — and no quotas on the client's page.
 */

export function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2
          className="text-xs uppercase tracking-[0.14em]"
          style={{ fontFamily: 'var(--p-mono-font, var(--p-heading-font, inherit))' }}
        >
          {children}
        </h2>
        {typeof count === 'number' && count > 0 && (
          <span
            className="px-1.5 py-0.5 font-mono text-[10px] tabular-nums"
            style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}
          >
            {String(count).padStart(2, '0')}
          </span>
        )}
      </div>
      <div className="h-0.5 w-full origin-left" style={{ background: 'var(--p-border, #e4e4e7)' }} />
    </div>
  )
}

/**
 * How a published post is doing — Views · Likes · Comments · Shares · Saves.
 *
 * Only the figures the platform actually reported appear: a missing metric is
 * a metric that platform does not publish (Reels have no impressions, stills
 * have no plays), and printing "0 saves" for it would be a number the client
 * would try to explain. Nothing yet, or the provider still syncing, gets one
 * honest sentence instead.
 */
export function PostMetricsRow({ item }: { item: PortalItem }) {
  const m = item.metrics
  const cells = metricCells(m)
  if (metricsPending(m)) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-wider opacity-40">
        {METRICS_PENDING_LINE}
      </p>
    )
  }
  const perf = m?.performance ?? null
  const followers = portalFollowersLine(perf?.followers ?? null)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {/* the one number the client asked for first: did anyone interact */}
        {perf && perf.interactions !== null && (
          <span className="flex items-baseline gap-1">
            <span className="font-mono text-xs tabular-nums">{compactCount(perf.interactions)}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider opacity-45">
              {perf.interactions === 1 ? 'interaction' : 'interactions'}
            </span>
          </span>
        )}
        {cells.map(c => (
          <span key={c.key} className="flex items-baseline gap-1">
            <span className="font-mono text-xs tabular-nums">{compactCount(c.value)}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider opacity-45">{c.label}</span>
          </span>
        ))}
      </div>
      {/* how the account moved, and how the post grew: one line, one graph */}
      {(followers || (perf && perf.spark.length > 1)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {perf && perf.spark.length > 1 && (
            <span style={{ color: 'var(--p-accent, currentColor)' }}>
              <Sparkline points={perf.spark} width={96} height={22} label="Interactions, day by day" />
            </span>
          )}
          {followers && (
            <span className="font-mono text-[10px] uppercase tracking-wider">{followers}</span>
          )}
        </div>
      )}
      {/* a figure with no age on it invites the reader to think it is live */}
      {m?.synced_at && (
        <span className="font-mono text-[9px] uppercase tracking-wider opacity-35" suppressHydrationWarning>
          <UpdatedAgo iso={m.synced_at} />
        </span>
      )}
    </div>
  )
}

/** Rendered on the client after mount: "12 min ago" computed on the server
 *  and again in the browser is two different sentences a minute apart, and
 *  React calls that a hydration error. */
function UpdatedAgo({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => setText(updatedAgo(iso))
    tick()
    const t = setInterval(tick, 60_000)
    return () => clearInterval(t)
  }, [iso])
  return <>{text ?? ''}</>
}

export function PortalHelpLine({ amName, className = '' }: { amName?: string | null; className?: string }) {
  return (
    <p className={`text-xs opacity-60 ${className}`}>
      Questions? Contact {amPhrase(amName)}{' '}or{' '}
      <a href="mailto:contact@mdmmarketing.com.au" className="portal-tap underline underline-offset-2">
        contact@mdmmarketing.com.au
      </a>
      .
    </p>
  )
}
