'use client'

import { useEffect, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { BULLET, bulletBoxValue, storedBullets } from '../../../../lib/bullet-core'

/**
 * A BOX THAT WRITES BULLET POINTS (the owner, 15 Sep 2026: "make the script
 * and talking points bullet points — currently the box is just a box").
 *
 * One point per line. Every line wears its bullet while it is typed; Enter
 * starts the next point; what is SAVED is the plain lines, no markers
 * (bullet-core.storedBullets), so the PDF, the editor's card, the read-only
 * plan and the email all draw the same points their own way.
 */
export default function BulletArea({ value, placeholder, rows = 3, onSave, disabled = false }: {
  value: string | null | undefined
  placeholder: string
  rows?: number
  /** the plain lines, one point per line — called on blur when they changed */
  onSave: (stored: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(() => bulletBoxValue(value))
  // a live row arriving from elsewhere redraws the box — not while typing
  useEffect(() => { setText(bulletBoxValue(value)) }, [value])

  return (
    <Textarea
      value={text}
      rows={rows}
      placeholder={`${BULLET} ${placeholder}`}
      aria-label={placeholder}
      disabled={disabled}
      className="min-h-11 text-[15px]"
      onChange={e => setText(bulletBoxValue(e.target.value))}
      onKeyDown={e => {
        if (e.key !== 'Enter' || e.shiftKey) return
        e.preventDefault()
        const el = e.currentTarget
        const at = el.selectionStart ?? text.length
        const next = `${text.slice(0, at)}\n${BULLET} ${text.slice(at)}`
        setText(next)
        // the cursor lands on the fresh point, after its bullet
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = at + 3 })
      }}
      onBlur={() => {
        const stored = storedBullets(text)
        if (stored !== storedBullets(value)) onSave(stored)
      }}
    />
  )
}
