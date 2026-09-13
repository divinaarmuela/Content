'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

/**
 * TYPE THE CLIENT'S NAME (the owner, 13 Sep 2026: "easily allow me to type
 * the client name instead of a dropdown"). One box: type a few letters, the
 * matching clients appear under it, click one or press Enter for the first.
 * The picked name stays in the box; clearing it un-picks.
 */
export default function ClientTypeahead({
  clients, value, onChange, placeholder = 'Type the client’s name…', id,
}: {
  clients: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  id?: string
}) {
  const listId = useId()
  const picked = clients.find(c => c.id === value) ?? null
  const [text, setText] = useState(picked?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement | null>(null)

  // the box follows the pick made elsewhere (a preset, a reset on close)
  useEffect(() => { setText(picked?.name ?? '') }, [picked?.name, value])

  const q = text.trim().toLowerCase()
  const matches = (q && (!picked || picked.name.toLowerCase() !== q)
    ? clients.filter(c => c.name.toLowerCase().includes(q))
    : clients
  ).slice(0, 8)

  const pick = (c: { id: string; name: string }) => {
    onChange(c.id); setText(c.name); setOpen(false)
  }

  // a click outside closes the list without un-picking
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div ref={box} className="relative min-w-0" data-client-typeahead>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => {
          const v = e.target.value
          setText(v); setOpen(true); setActive(0)
          // the words no longer name the picked client: nothing is picked
          if (picked && v.trim().toLowerCase() !== picked.name.toLowerCase()) onChange('')
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { if (open && matches[active]) { e.preventDefault(); pick(matches[active]) } }
          else if (e.key === 'Escape') { setOpen(false) }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-tile border border-border bg-popover p-1 shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-[13px] text-muted-foreground">No client called “{text.trim()}” — check the Clients page.</li>
          )}
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={c.id === value}>
              <button
                type="button"
                className={`flex w-full items-center rounded-md px-3 py-2 text-left text-[15px] hover:bg-foreground/[0.06] ${
                  i === active ? 'bg-foreground/[0.06]' : ''
                } ${c.id === value ? 'font-semibold' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
