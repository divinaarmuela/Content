'use client'

import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fieldDisplay, type TodoFieldDef } from '../../lib/todo-fields-core'

/**
 * A CUSTOM FIELD, AS ASANA SHOWS IT (the owner, 20 Oct 2026: Asana's Priority, Task Progress, Service Line — "make sure
 * it like how the feature does it asana"): a dropdown's value is a coloured pill, set from a list of coloured options;
 * text, a number or a date are written in place. The same control in the list's column and in the task panel.
 */

/** the coloured pill Asana draws for a dropdown's value */
export function FieldPill({ text, colour }: { text: string; colour?: string }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[12px] font-medium leading-5"
      style={colour ? { backgroundColor: `${colour}33`, color: '#1e1f21', boxShadow: `inset 0 0 0 1px ${colour}66` } : undefined}>
      <span aria-hidden className="mr-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colour ?? '#c4c4c4' }} />
      <span className="truncate">{text}</span>
    </span>
  )
}

export function FieldControl({ def, value, editable, onChange, compact = false }: {
  def: TodoFieldDef
  value: unknown
  editable: boolean
  onChange: (value: string | number | null) => void
  /** in a list row: no border until hovered */
  compact?: boolean
}) {
  const shown = fieldDisplay(def, value)
  // A LIST ROW DRAWS A LABEL, NOT A CONTROL, until somebody clicks it (the team, 27 Oct 2026: "the to-do list keeps
  // lagging" — every row drew a full dropdown or text box per custom field, measured at ~1s to draw Everyone's tasks)
  const [live, setLive] = useState(!compact)
  const [draft, setDraft] = useState(value === undefined || value === null ? '' : String(value))
  useEffect(() => { setDraft(value === undefined || value === null ? '' : String(value)) }, [value])
  const box = `h-8 min-w-0 rounded-md border bg-transparent px-2 text-[13px] outline-none ${compact ? 'border-transparent hover:border-border focus:border-foreground/40' : 'border-border'}`

  if (editable && !live) {
    return (
      <button type="button" aria-label={def.name} onClick={e => { e.stopPropagation(); setLive(true) }}
        className="flex h-8 w-full min-w-0 items-center rounded-md border border-transparent px-1.5 text-left text-[13px] hover:border-border">
        {shown ? (def.type === 'select' ? <FieldPill text={shown.text} colour={shown.colour} /> : <span className="truncate">{shown.text}</span>) : <span className="text-muted-foreground">—</span>}
      </button>
    )
  }
  if (def.type === 'select') {
    if (!editable) return shown ? <FieldPill text={shown.text} colour={shown.colour} /> : <span className="text-muted-foreground">—</span>
    return (
      <Select defaultOpen={compact} onOpenChange={o => { if (!o && compact) setLive(false) }}
        value={typeof value === 'string' ? value : '__none'} onValueChange={v => onChange(v === '__none' ? null : v)}>
        <SelectTrigger aria-label={def.name} onClick={e => e.stopPropagation()}
          className={`h-8 w-full min-w-0 justify-start gap-1 rounded-md bg-transparent px-1.5 text-[13px] shadow-none [&>svg]:ml-auto [&>svg]:opacity-0 hover:[&>svg]:opacity-60 ${compact ? 'border-transparent hover:border-border' : 'border-border'}`}>
          <SelectValue placeholder={<span className="text-muted-foreground">—</span>}>
            {shown ? <FieldPill text={shown.text} colour={shown.colour} /> : <span className="text-muted-foreground">—</span>}
          </SelectValue>
        </SelectTrigger>
        <SelectContent onClick={e => e.stopPropagation()}>
          <SelectItem value="__none"><span className="text-muted-foreground">No {def.name.toLowerCase()}</span></SelectItem>
          {(def.options ?? []).map(o => <SelectItem key={o.id} value={o.id}><FieldPill text={o.name} colour={o.colour} /></SelectItem>)}
        </SelectContent>
      </Select>
    )
  }
  if (!editable) return shown ? <span className="truncate text-[13px]">{shown.text}</span> : <span className="text-muted-foreground">—</span>
  const commit = () => {
    const v = draft.trim()
    const cur = value === undefined || value === null ? '' : String(value)
    if (v === cur) return
    onChange(v === '' ? null : def.type === 'number' ? Number(v) : v)
  }
  return (
    <input aria-label={def.name} value={draft} autoFocus={compact} onClick={e => e.stopPropagation()} onChange={e => setDraft(e.target.value)} onBlur={() => { commit(); if (compact) setLive(false) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(value == null ? '' : String(value)); (e.target as HTMLInputElement).blur() } }}
      type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'} placeholder="—" className={`${box} w-full`} />
  )
}
