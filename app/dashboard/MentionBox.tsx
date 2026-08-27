'use client'

import { useEffect, useRef, useState } from 'react'
import { AtSign } from 'lucide-react'
import {
  filterMentionable, insertMention, mentionQuery, type Mentionable,
} from '../lib/mention-core'

/**
 * A comment box where typing "@" offers the team.
 *
 * Tagging is how a note reaches the person doing the work, and it used to
 * be a dropdown only managers could see. Now anyone who can comment types
 * "@", picks a name, and that person is tagged — the same "@Name" the
 * server reads back out of the text. The "Tag someone" button is the same
 * thing for a thumb: it puts an "@" in the box and opens the list.
 *
 * Suggestions are a real list (arrow keys, Enter, Escape, tap), never a
 * hover-only affordance. Every row is a 44px target.
 */
export default function MentionBox({
  value, onChange, members, placeholder, rows = 2, disabled, onSubmit, id,
}: {
  value: string
  onChange: (v: string) => void
  members: Mentionable[]
  placeholder?: string
  rows?: number
  disabled?: boolean
  /** Ctrl/Cmd+Enter */
  onSubmit?: () => void
  id?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)

  const q = mentionQuery(value, caret)
  const options = q ? filterMentionable(members, q.query) : []
  const open = q !== null && options.length > 0

  // the caret is put back where a chosen name ends, after React has
  // written the new value into the textarea
  useEffect(() => {
    if (pendingCaret === null || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(pendingCaret, pendingCaret)
    setCaret(pendingCaret)
    setPendingCaret(null)
  }, [pendingCaret, value])

  useEffect(() => { setActive(0) }, [q?.query])

  const choose = (m: Mentionable) => {
    if (!q) return
    const next = insertMention(value, q.start, caret, m.name)
    onChange(next.text)
    setPendingCaret(next.caret)
  }

  const tagButton = () => {
    const el = ref.current
    const at = el ? el.selectionStart ?? value.length : value.length
    const needsSpace = at > 0 && !/\s/.test(value[at - 1] ?? '')
    const insert = `${needsSpace ? ' ' : ''}@`
    onChange(value.slice(0, at) + insert + value.slice(at))
    setPendingCaret(at + insert.length)
  }

  return (
    <div className="relative flex flex-col gap-2">
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
        onClick={e => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyUp={e => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) setCaret(e.currentTarget.selectionStart ?? 0)
        }}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit?.(); return }
          if (!open) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % options.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + options.length) % options.length) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(options[active]) }
          else if (e.key === 'Escape') { e.preventDefault(); setCaret(0) }
        }}
        aria-autocomplete="list"
        aria-expanded={open}
        className="w-full resize-y rounded-md border border-zinc-200 bg-transparent p-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
      />
      {open && (
        <ul role="listbox" aria-label="Tag someone"
          className="absolute left-0 top-full z-30 mt-1 w-64 max-w-full overflow-hidden rounded-lg border border-zinc-200 bg-popover shadow-lg dark:border-zinc-700">
          {options.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => choose(m)}
                className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm ${
                  i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                }`}>
                <AtSign className="h-3.5 w-3.5 text-zinc-400" />
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {members.length > 0 && (
        <button type="button" onClick={tagButton} disabled={disabled}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-md px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          <AtSign className="h-3.5 w-3.5" /> Tag someone
        </button>
      )}
    </div>
  )
}
