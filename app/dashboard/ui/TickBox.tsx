'use client'

import { Check } from 'lucide-react'

/**
 * ONE TICK BOX, THE SAME EVERYWHERE (the owner, 15 Sep 2026, a screenshot
 * of the shoot page: "the checkboxes are the default design, and one big
 * and one small"). The browser's own box is hidden but still does the work
 * — keyboard, screen reader, the label's click — and the drawn box beside
 * it wears the dashboard's look at one size.
 */
export default function TickBox({ checked, onChange, disabled = false, label, className = '' }: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** the words for a screen reader when the box has no visible label of its own */
  label?: string
  className?: string
}) {
  return (
    <span className={`relative inline-flex h-5 w-5 shrink-0 ${className}`}>
      <input
        type="checkbox"
        className="peer absolute inset-0 h-5 w-5 cursor-pointer opacity-0 disabled:cursor-default"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={e => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-[6px] border-2 border-border bg-surface text-background transition-colors peer-checked:border-foreground peer-checked:bg-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent-blue/40 peer-disabled:opacity-50 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    </span>
  )
}
