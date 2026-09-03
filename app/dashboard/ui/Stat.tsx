import { cn } from '@/lib/utils'

/**
 * One big number with a plain-words label under it. Several sit in a row
 * inside a TintCard — "4 waiting on you", "2 due this week".
 *
 * The label is the sentence, not a heading: lower case, no jargon, and it
 * should still make sense read straight after the number.
 */
export default function Stat({
  value, label, className,
}: {
  value: React.ReactNode
  /** lower-case plain words, read as "<value> <label>" */
  label: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-stat-30 tabular-nums tracking-[-0.02em]">{value}</span>
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
    </div>
  )
}
