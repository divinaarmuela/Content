'use client'

import { useId, useState } from 'react'
import type { SparkPoint } from '../../../../lib/post-performance-core'
import { CHART_BOX, chartLabel, dayChart, shortDate } from '../../../../lib/post-page-core'

/**
 * HOW THE POST GREW, day by day.
 *
 * One series — interactions — so there is no legend to read and no second
 * axis to mislead: the number of people who did something, against the
 * calendar, anchored at zero. The geometry is `dayChart`, which is pure and
 * pinned by a test, so both themes draw exactly the same shape and only the
 * ink changes.
 *
 * Inline SVG in `currentColor`: the caller sets the accent (light and dark
 * both resolve it from the palette's tokens), the grid and the axis take the
 * page's own recessive ink, and the numbers are text, never the series
 * colour. Hovering — or arrowing along with a keyboard — reads out one day.
 * A table of the same figures sits under it for anyone the picture does not
 * serve.
 */
export default function DayGraph({ series, days, className = '' }: {
  series: SparkPoint[]
  /** how many days the platform has reported on, for the caption */
  days: number
  className?: string
}) {
  const id = useId()
  const chart = dayChart(series, CHART_BOX)
  const [at, setAt] = useState<number | null>(null)
  const box = chart.box
  const active = at !== null ? chart.points[at] ?? null : null
  const label = chartLabel(days)

  if (chart.points.length === 0) return null

  const pick = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect()
    if (rect.width === 0) return
    const x = ((clientX - rect.left) / rect.width) * box.width
    let best = 0
    for (let i = 1; i < chart.points.length; i++) {
      if (Math.abs(chart.points[i].x - x) < Math.abs(chart.points[best].x - x)) best = i
    }
    setAt(best)
  }

  return (
    <figure className={`flex flex-col gap-2 ${className}`}>
      <svg
        viewBox={`0 0 ${box.width} ${box.height}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        className="block w-full text-accent-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseMove={e => pick(e.clientX, e.currentTarget)}
        onMouseLeave={() => setAt(null)}
        onTouchMove={e => pick(e.touches[0].clientX, e.currentTarget)}
        onTouchEnd={() => setAt(null)}
        onKeyDown={e => {
          if (e.key === 'ArrowRight') { e.preventDefault(); setAt(a => Math.min(chart.points.length - 1, (a ?? -1) + 1)) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); setAt(a => Math.max(0, (a ?? chart.points.length) - 1)) }
          if (e.key === 'Escape') setAt(null)
        }}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.20" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* the grid is recessive — it is scaffolding, not data */}
        {chart.grid.map(g => (
          <g key={g.value}>
            <line
              x1={box.left} x2={box.width - box.right} y1={g.y} y2={g.y}
              className="stroke-border" strokeWidth="1" shapeRendering="crispEdges"
            />
            <text
              x={box.left - 8} y={g.y + 4} textAnchor="end"
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {g.value.toLocaleString('en-AU')}
            </text>
          </g>
        ))}

        <path d={chart.area} fill={`url(#${id}-fill)`} stroke="none" />
        <path
          d={chart.line} fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        />

        {/* the last day is labelled directly; the rest are read on hover */}
        {chart.points.length > 0 && (
          <circle
            cx={chart.points[chart.points.length - 1].x}
            cy={chart.points[chart.points.length - 1].y}
            r="3.5" fill="currentColor"
            className="stroke-background" strokeWidth="2"
          />
        )}

        {active && (
          <g>
            <line
              x1={active.x} x2={active.x} y1={box.top} y2={chart.base}
              className="stroke-foreground/30" strokeWidth="1"
            />
            <circle cx={active.x} cy={active.y} r="4" fill="currentColor"
              className="stroke-background" strokeWidth="2" />
          </g>
        )}

        <text x={box.left} y={box.height - 6} className="fill-muted-foreground text-[11px]">
          {shortDate(chart.first)}
        </text>
        <text x={box.width - box.right} y={box.height - 6} textAnchor="end"
          className="fill-muted-foreground text-[11px]">
          {shortDate(chart.last)}
        </text>
      </svg>

      <figcaption className="flex flex-wrap items-baseline gap-x-2 text-secondary-13 text-muted-foreground">
        <span>{label}</span>
        {active && (
          <span className="font-medium text-foreground" aria-live="polite">
            {shortDate(active.date)} · {active.value.toLocaleString('en-AU')}
          </span>
        )}
      </figcaption>

      <details className="text-secondary-13">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground underline-offset-4 hover:underline md:min-h-0">
          The same figures as a list
        </summary>
        <ul className="mt-1 flex flex-col gap-0.5">
          {chart.points.map(p => (
            <li key={p.date} className="flex gap-3 text-muted-foreground">
              <span className="w-16 shrink-0">{shortDate(p.date)}</span>
              <span className="font-medium tabular-nums text-foreground">{p.value.toLocaleString('en-AU')}</span>
            </li>
          ))}
        </ul>
      </details>
    </figure>
  )
}
