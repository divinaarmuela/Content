'use client'

import { useEffect, useRef } from 'react'
import { Bold, Heading2, Highlighter, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sanitizeRichText } from '@/app/lib/board-canvas-core'

/**
 * A note's words: a heading, bold, bullets and a highlight — what the
 * owner's own board uses, and no more. The editor is the browser's own
 * contentEditable with four buttons over it; what it produces is passed
 * through `sanitizeRichText` on the way out, so only those tags are ever
 * stored, whatever a paste brought in.
 */

function wrapSelectionInMark() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  // already highlighted: take the mark off
  const anchor = range.commonAncestorContainer
  const existing = (anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement)?.closest('mark')
  if (existing) {
    const parent = existing.parentNode
    if (!parent) return
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing)
    parent.removeChild(existing)
    return
  }
  const mark = document.createElement('mark')
  try {
    range.surroundContents(mark)
  } catch {
    // the selection crosses an element boundary: lift the contents out and
    // wrap what came out
    mark.appendChild(range.extractContents())
    range.insertNode(mark)
  }
  sel.removeAllRanges()
  const after = document.createRange()
  after.selectNodeContents(mark)
  sel.addRange(after)
}

export default function NoteEditor({ html, onCommit, onClose, className }: {
  html: string
  onCommit: (html: string) => void
  onClose: () => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef(html)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html
    el.focus()
    // caret at the end, where a person expects to carry on
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = () => {
    const el = ref.current
    if (!el) return
    const clean = sanitizeRichText(el.innerHTML)
    if (clean !== last.current) { last.current = clean; onCommit(clean) }
  }

  const run = (cmd: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
  }

  const tools: { label: string; icon: React.ReactNode; act: () => void }[] = [
    { label: 'Heading', icon: <Heading2 className="h-4 w-4" />, act: () => run('formatBlock', 'h3') },
    { label: 'Bold', icon: <Bold className="h-4 w-4" />, act: () => run('bold') },
    { label: 'Bullets', icon: <List className="h-4 w-4" />, act: () => run('insertUnorderedList') },
    { label: 'Highlight', icon: <Highlighter className="h-4 w-4" />, act: () => { ref.current?.focus(); wrapSelectionInMark() } },
  ]

  return (
    <div className={cn('flex h-full flex-col', className)} data-no-drag>
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/60 px-1 py-0.5">
        {tools.map(t => (
          <button
            key={t.label}
            type="button"
            title={t.label}
            aria-label={t.label}
            className="inline-flex h-9 w-9 items-center justify-center rounded-tile hover:bg-foreground/[0.06] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            onMouseDown={e => e.preventDefault()}
            onClick={t.act}
          >
            {t.icon}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto inline-flex h-9 items-center rounded-full px-3 text-[12px] font-semibold hover:bg-foreground/[0.06] [@media(pointer:coarse)]:h-11"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { commit(); onClose() }}
        >
          Done
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Note"
        className="canvas-note min-h-0 flex-1 overflow-auto px-3 py-2 text-[14px] leading-[1.45] outline-none"
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); commit(); onClose() }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); run('bold') }
          e.stopPropagation()
        }}
        onPaste={e => {
          // plain words only: a paste from a doc brings fonts and colours the
          // note is not allowed to keep
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
        }}
      />
    </div>
  )
}
