import { fmt } from '../../lib/client-report-core'
import { CHART_COLOURS, CHART_PREVIOUS, niceMax, short, type Part } from '../../lib/report-charts-core'

/**
 * THE REPORT'S CHARTS, DRAWN (the owner, 19 Nov 2026). Plain SVG, no chart library: these are printed, and a drawing
 * with a fixed shape prints the same on every machine (the page's interactive charts size themselves to the window,
 * which a hidden print view does not have). Each chart says its numbers in words as well as in colour.
 */
const INK = '#1b1b1b', MUTED = '#6b7280', GRID = '#E5E7EB'
const FONT = 'inherit'

/** VIEWS EACH DAY — one line, its peak named */
export function DailyLine({ daily, what = 'Views' }: { daily: { date: string; views: number }[]; what?: string }) {
  const W = 680, H = 190, L = 40, R = 12, T = 18, B = 24
  if (daily.length < 2) return null
  const top = niceMax(Math.max(...daily.map(d => d.views)))
  const x = (i: number) => L + (i / (daily.length - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const line = daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.views).toFixed(1)}`).join(' ')
  const peak = daily.reduce((best, d, i) => (d.views > daily[best].views ? i : best), 0)
  const dayOf = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const ticks = [0, Math.round((daily.length - 1) / 4), Math.round((daily.length - 1) / 2), Math.round(((daily.length - 1) * 3) / 4), daily.length - 1]
  // the peak's label stays inside the drawing
  const labelX = Math.min(W - R - 4, Math.max(L + 4, x(peak)))
  const anchor = x(peak) > W - 140 ? 'end' : x(peak) < L + 100 ? 'start' : 'middle'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${what} each day. The highest day was ${dayOf(daily[peak].date)} with ${fmt(daily[peak].views)}.`} style={{ display: 'block', fontFamily: FONT }}>
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} stroke={GRID} strokeWidth={1} />
          <text x={L - 6} y={y(top * f) + 3} textAnchor="end" fontSize={9} fill={MUTED}>{short(top * f)}</text>
        </g>
      ))}
      <path d={`${line} L${x(daily.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`} fill={CHART_COLOURS[0]} fillOpacity={0.12} />
      <path d={line} fill="none" stroke={CHART_COLOURS[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {ticks.map(i => <text key={i} x={x(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'} fontSize={9} fill={MUTED}>{dayOf(daily[i].date)}</text>)}
      <circle cx={x(peak)} cy={y(daily[peak].views)} r={4} fill={CHART_COLOURS[0]} stroke="#fff" strokeWidth={2} />
      <text x={labelX} y={Math.max(10, y(daily[peak].views) - 8)} textAnchor={anchor} fontSize={10} fontWeight={700} fill={INK}>{fmt(daily[peak].views)} on {dayOf(daily[peak].date)}</text>
    </svg>
  )
}

/** THIS MONTH BESIDE LAST MONTH — a pair of bars for each number, each pair on its own scale (views and interactions
 *  are not the same size of thing, so they never share one) */
export function CompareBars({ rows }: { rows: { label: string; now: number | null; was: number | null }[] }) {
  const live = rows.filter(r => r.now != null && r.was != null) as { label: string; now: number; was: number }[]
  if (!live.length) return null
  const W = 330, ROW = 46, T = 22, BAR = 11, L = 4, MAXW = 210
  const H = T + live.length * ROW
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={live.map(r => `${r.label}: ${fmt(r.now)} this month, ${fmt(r.was)} last month`).join('. ')} style={{ display: 'block', fontFamily: FONT }}>
      <rect x={L} y={3} width={9} height={9} rx={2} fill={CHART_COLOURS[0]} /><text x={L + 13} y={11} fontSize={9} fill={MUTED}>This month</text>
      <rect x={L + 76} y={3} width={9} height={9} rx={2} fill={CHART_PREVIOUS} /><text x={L + 89} y={11} fontSize={9} fill={MUTED}>Last month</text>
      {live.map((r, i) => {
        const top = Math.max(r.now, r.was, 1), y0 = T + i * ROW
        const w = (v: number) => Math.max(2, (v / top) * MAXW)
        return (
          <g key={r.label}>
            <text x={L} y={y0 + 10} fontSize={10} fontWeight={700} fill={INK}>{r.label}</text>
            <rect x={L} y={y0 + 15} width={w(r.now)} height={BAR} rx={3} fill={CHART_COLOURS[0]} />
            <text x={L + w(r.now) + 5} y={y0 + 24} fontSize={9.5} fontWeight={700} fill={INK}>{fmt(r.now)}</text>
            <rect x={L} y={y0 + 15 + BAR + 2} width={w(r.was)} height={BAR} rx={3} fill={CHART_PREVIOUS} />
            <text x={L + w(r.was) + 5} y={y0 + 24 + BAR + 2} fontSize={9.5} fill={MUTED}>{fmt(r.was)}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** ONE WHOLE, SPLIT — a single bar cut into its parts, with each part's name, number and share written under it */
export function SplitBar({ parts, unit }: { parts: Part[]; unit?: string }) {
  if (!parts.length) return null
  const W = 330, L = 4, BAR = 18, T = 4, ROW = 17
  const H = T + BAR + 12 + parts.length * ROW
  const full = W - L * 2, GAP = 2
  let at = L
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={parts.map(p => `${p.label} ${p.pct}%`).join(', ')} style={{ display: 'block', fontFamily: FONT }}>
      {parts.map((p, i) => {
        const w = Math.max(3, (p.pct / 100) * (full - GAP * (parts.length - 1)))
        const x0 = at
        at += w + GAP
        return <rect key={p.label} x={x0} y={T} width={w} height={BAR} rx={3} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
      })}
      {parts.map((p, i) => {
        const y0 = T + BAR + 12 + i * ROW
        return (
          <g key={p.label}>
            <rect x={L} y={y0} width={9} height={9} rx={2} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
            <text x={L + 14} y={y0 + 8.5} fontSize={10} fill={INK}><tspan fontWeight={700}>{p.pct}%</tspan> {p.label}</text>
            {unit && <text x={W - L} y={y0 + 8.5} textAnchor="end" fontSize={9.5} fill={MUTED}>{fmt(p.value)} {unit}</text>}
          </g>
        )
      })}
    </svg>
  )
}
