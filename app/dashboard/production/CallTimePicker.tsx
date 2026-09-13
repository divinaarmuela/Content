'use client'

import { useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCallTime, parseCallTime, type CallTimeParts } from '../../lib/shoot-sop-core'

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = [0, 15, 30, 45]

/**
 * Call time as three picks — hour, minute, am/pm — saved as the same
 * "7:30 am" text the plan always carried (the owner, 13 Sep 2026: "instead
 * of typing use a nice shadcn time picker"). An older value that is not a
 * time is shown as the placeholder until a pick replaces it.
 */
export default function CallTimePicker({ value, onSave, disabled }: {
  value: string | null | undefined
  onSave: (text: string) => void
  disabled?: boolean
}) {
  const parts = useMemo(() => parseCallTime(value), [value])
  const pick = (next: Partial<CallTimeParts>) => {
    const base: CallTimeParts = parts ?? { hour: 7, minute: 30, period: 'am' }
    onSave(formatCallTime({ ...base, ...next }))
  }
  // tight: the chevron must never sit on the number (the owner, 13 Sep 2026)
  const trigger = 'h-11 w-full min-w-0 gap-1 px-2.5 text-[15px] font-normal [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0'
  return (
    <div className="grid grid-cols-[minmax(64px,1fr)_minmax(72px,1fr)_minmax(72px,1fr)] gap-1.5" role="group" aria-label="Call time">
      <Select value={parts ? String(parts.hour) : ''} onValueChange={v => v && pick({ hour: Number(v) })} disabled={disabled}>
        <SelectTrigger className={trigger} aria-label="Hour"><SelectValue placeholder="7" /></SelectTrigger>
        <SelectContent>{HOURS.map(h => <SelectItem key={h} value={String(h)}>{h}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={parts ? String(parts.minute) : ''} onValueChange={v => v && pick({ minute: Number(v) })} disabled={disabled}>
        <SelectTrigger className={trigger} aria-label="Minutes"><SelectValue placeholder="30" /></SelectTrigger>
        <SelectContent>
          {[...new Set([...MINUTES, ...(parts ? [parts.minute] : [])])].sort((a, b) => a - b).map(m => (
            <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={parts?.period ?? ''} onValueChange={v => (v === 'am' || v === 'pm') && pick({ period: v })} disabled={disabled}>
        <SelectTrigger className={trigger} aria-label="am or pm"><SelectValue placeholder="am" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="am">am</SelectItem>
          <SelectItem value="pm">pm</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
