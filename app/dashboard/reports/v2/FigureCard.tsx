import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { changeOf, figureWords, hasValue, type Figure } from '../../../lib/report-v2/definitions'

/** REPORT V2 — one number with its state: a value, or in words why there is none. No % against a non-value or a 0. */
export default function FigureCard({ label, figure, previous, platformName, note, signed = false }: {
  label: string; figure: Figure; previous?: Figure | null; platformName: string; note?: string | null; signed?: boolean
}) {
  const c = previous ? changeOf(figure, previous) : null
  const isValue = hasValue(figure)
  const tone = figure.state === 'unreadable' ? 'text-accent-red' : 'text-muted-foreground'
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4" data-state={figure.state}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {isValue
        ? <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{signed && figure.value! > 0 ? '+' : ''}{figure.value!.toLocaleString('en-AU')}</span>
        : <span className={`text-[15px] font-medium leading-snug ${tone}`}>{figureWords(figure, platformName)}</span>}
      <span className="flex min-h-5 flex-wrap items-center gap-1 text-[12px]">
        {c && (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${c.up ? 'text-accent-green' : 'text-accent-red'}`}>
            {c.up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}{c.text}
          </span>
        )}
        {previous && <span className="text-muted-foreground">last month: {hasValue(previous) ? previous.value!.toLocaleString('en-AU') : figureWords(previous, platformName).toLowerCase()}</span>}
      </span>
      {note && <span className="text-[12px] leading-snug text-muted-foreground">{note}</span>}
      {figure.source && <span className="text-[11px] leading-snug text-muted-foreground/80" title={figure.source}>Source: {figure.source}</span>}
    </div>
  )
}
