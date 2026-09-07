'use client'

import { useId } from 'react'
import { sparkPath, type SparkPoint } from '../lib/post-performance-core'

/**
 * A sparkline: one line, the last thirty days, no axes.
 *
 * Inline SVG in `currentColor`, so it takes the ink of wherever it sits — the
 * card in light or dark, the portal in the client's colours, a board card on
 * its ink tint — without a palette of its own. The line is the accent, the
 * fill beneath it the same hue at a whisper, the last point a dot: the three
 * marks a stat tile's trend is made of. Two points or fewer draws a flat
 * line rather than nothing, because "nothing" reads as broken.
 */
export default function Sparkline({
  points, width = 120, height = 28, label, className = '',
}: {
  points: SparkPoint[] | number[]
  width?: number
  height?: number
  /** what the reader is looking at — read out, never drawn */
  label: string
  className?: string
}) {
  const id = useId()
  const values: (SparkPoint | number)[] = points.length >= 2 ? points
    : points.length === 1 ? [points[0], points[0]]
    : [0, 0]
  const { line, area, last } = sparkPath(values, width, height)
  const empty = points.length === 0
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className={`block max-w-full overflow-visible ${empty ? 'opacity-40' : ''} ${className}`}
      style={{ color: 'inherit' }}
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-fill)`} stroke="none" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last && !empty && (
        <circle cx={last.x} cy={last.y} r="3" fill="currentColor" />
      )}
    </svg>
  )
}
