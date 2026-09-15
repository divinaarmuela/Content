'use client'

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Bold } from 'lucide-react'
import { boldModeToggle, toggleBoldSelection } from '../../../../lib/batch-brief-core'

/**
 * A BOX THAT BOLDS THE WORDS YOU HIGHLIGHT (the owner, 15 Sep 2026: "when I
 * highlight it and then click the toolbar option, the highlight
 * disappears — bad user experience"). Anything pressed outside the box
 * drops the highlight, so the button lives ON the box: the moment words are
 * highlighted a small B appears in the corner; press it, or Cmd/Ctrl+B, and
 * only those words go bold (marked **like this**). Press again to un-bold.
 *
 * The box stays uncontrolled, like the ones it replaces: the words are
 * written into the element and an input event is fired, so whatever the
 * card does on change and on blur happens exactly as before.
 */
type Field = HTMLTextAreaElement | HTMLInputElement

export function applyBold(el: Field) {
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0
  if (start === end) {
    // nothing highlighted: the switch — open a bold run, or step out of one
    const m = boldModeToggle(el.value, start)
    if (m.text !== el.value) { el.value = m.text; el.dispatchEvent(new Event('input', { bubbles: true })) }
    el.setSelectionRange(m.caret, m.caret)
    return
  }
  const r = toggleBoldSelection(el.value, start, end)
  if (r.text === el.value) return
  el.value = r.text
  el.setSelectionRange(r.start, r.end)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const apply = applyBold

function useBoldable<T extends Field>(
  onKeyDown?: React.KeyboardEventHandler<T>, onSelect?: React.ReactEventHandler<T>, onBlur?: React.FocusEventHandler<T>,
) {
  const inner = useRef<T | null>(null)
  const [picked, setPicked] = useState(false)
  const check = useCallback(() => {
    const el = inner.current
    setPicked(!!el && (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0))
  }, [])
  const keyDown: React.KeyboardEventHandler<T> = e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault(); e.stopPropagation()
      apply(e.currentTarget); check()
      return
    }
    onKeyDown?.(e)
  }
  const select: React.ReactEventHandler<T> = e => { check(); onSelect?.(e) }
  const blur: React.FocusEventHandler<T> = e => { setPicked(false); onBlur?.(e) }
  const pill = picked ? (
    <button type="button" aria-label="Bold the highlighted words" title="Bold (Cmd/Ctrl+B)"
      // keep the box focused, so the highlight is still there on the press
      onMouseDown={e => e.preventDefault()}
      onPointerDown={e => e.stopPropagation()}
      onClick={() => { if (inner.current) { apply(inner.current); check() } }}
      className="absolute -top-3 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background shadow">
      <Bold className="h-3.5 w-3.5" aria-hidden />
    </button>
  ) : null
  return { inner, keyDown, select, blur, pill }
}

export const BoldableTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function BoldableTextarea({ onKeyDown, onSelect, onBlur, ...rest }, ref) {
    const { inner, keyDown, select, blur, pill } = useBoldable<HTMLTextAreaElement>(onKeyDown, onSelect, onBlur)
    useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement)
    return (
      <span className="relative block min-w-0 flex-1">
        <textarea {...rest} ref={inner} onKeyDown={keyDown} onSelect={select} onBlur={blur} />
        {pill}
      </span>
    )
  },
)

export const BoldableInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function BoldableInput({ onKeyDown, onSelect, onBlur, ...rest }, ref) {
    const { inner, keyDown, select, blur, pill } = useBoldable<HTMLInputElement>(onKeyDown, onSelect, onBlur)
    useImperativeHandle(ref, () => inner.current as HTMLInputElement)
    return (
      <span className="relative block min-w-0">
        <input {...rest} ref={inner} onKeyDown={keyDown} onSelect={select} onBlur={blur} />
        {pill}
      </span>
    )
  },
)
