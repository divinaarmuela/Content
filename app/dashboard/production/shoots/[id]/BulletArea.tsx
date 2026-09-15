'use client'

import { useEffect, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { BULLET, backspaceAtBullet, bulletBoxValue, storedBullets } from '../../../../lib/bullet-core'

/**
 * A BOX THAT WRITES BULLET POINTS (the owner, 15 Sep 2026: "make the script
 * and talking points bullet points — currently the box is just a box").
 *
 * One point per line. Every line wears its bullet while it is typed; Enter
 * starts the next point; Backspace on a bullet deletes the point (the owner,
 * later that day: "when I delete a line the bullet does not get deleted too
 * — this is bad user experience"); what is SAVED is the plain lines, no
 * markers (bullet-core.storedBullets), so the PDF, the editor's card, the
 * read-only plan and the email all draw the same points their own way.
 *
 * The caret stays where the person is typing: the box only rewrites the text
 * when a bullet has to be put on, and moves the caret by exactly as much as
 * the rewrite added.
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

  const place = (el: HTMLTextAreaElement, at: number) => {
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = at })
  }

  return (
    <Textarea
      value={text}
      rows={rows}
      placeholder={`${BULLET} ${placeholder}`}
      aria-label={placeholder}
      disabled={disabled}
      className="min-h-11 text-[15px]"
      onChange={e => {
        const el = e.target
        const raw = el.value
        const at = el.selectionStart ?? raw.length
        const next = bulletBoxValue(raw)
        setText(next)
        // a bullet was put on (or a blank line taken out): keep the caret on
        // the same words by moving it as far as the text around it moved
        if (next !== raw) place(el, Math.max(0, Math.min(next.length, at + (next.length - raw.length))))
      }}
      onKeyDown={e => {
        const el = e.currentTarget
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          const at = el.selectionStart ?? text.length
          const next = `${text.slice(0, at)}\n${BULLET} ${text.slice(at)}`
          setText(next)
          place(el, at + 3)                        // on the fresh point, after its bullet
          return
        }
        if (e.key === 'Backspace' && el.selectionStart === el.selectionEnd) {
          const gone = backspaceAtBullet(text, el.selectionStart ?? 0)
          if (!gone) return
          e.preventDefault()
          setText(gone.text)
          place(el, gone.caret)
        }
      }}
      onBlur={() => {
        const stored = storedBullets(text)
        if (stored !== storedBullets(value)) onSave(stored)
      }}
    />
  )
}
