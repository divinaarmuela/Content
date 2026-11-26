'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * ONE CHOICE FROM A SHORT LIST, in the dashboard's own dropdown (the owner, 26 Nov 2026: "dropdowns are native
 * dropdowns" — the browser's grey list, on pages where everything else is the dashboard's look). A thin wrapper so a
 * page says what the choices are and nothing about how a dropdown is built.
 */
export default function Pick<T extends string>({ label, value, onChange, options, placeholder, disabled, className }: {
  /** what is being chosen — read out, and shown above the box by the page */
  label: string
  /** '' = nothing chosen yet (the placeholder shows) */
  value: T | ''
  onChange: (value: T) => void
  options: readonly { value: T; label: string }[]
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <Select value={value || undefined} onValueChange={v => onChange(v as T)} disabled={disabled}>
      <SelectTrigger aria-label={label} className={`h-11 w-full rounded-inner border-border bg-surface px-3 text-[14px] ${className ?? ''}`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="bg-popover">
        {options.map(o => <SelectItem key={o.value} value={o.value} className="min-h-11 text-[14px]">{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
