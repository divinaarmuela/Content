'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { roleLabel } from '../../lib/identity-core'
import type { ClientRow, Filters, PersonRow } from '../../lib/people-filter-core'

/**
 * THE TWO FILTERS ABOVE A BOARD: which client, and whose cards.
 *
 * The same two controls on Post approval, Editor and Shoots, in the same
 * order, drawn with the same rounded Select the Schedule page's client
 * picker uses — a third dropdown style would be one more thing to learn.
 * The People list is exactly the people on the visible cards, each with
 * their initials, their role in the team's word, and how many cards they
 * hold, so the answer to "who is doing what" is on the list before anyone
 * picks. "Everyone" and "All clients" put it back; "Show all" clears both
 * in one press.
 */

const ALL = 'all'
const EVERYONE = 'everyone'

export function BoardFilters({ clients, people, value, onClient, onPerson, onClear }: {
  clients: readonly ClientRow[]
  people: readonly PersonRow[]
  value: Filters
  onClient: (id: string | null) => void
  onPerson: (id: string | null) => void
  onClear: () => void
}) {
  const narrowed = value.client !== null || value.person !== null
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Narrow the board">
      <Select value={value.client ?? ALL} onValueChange={v => onClient(v === ALL ? null : v)}>
        <SelectTrigger className="h-11 w-48 rounded-full border-border bg-surface px-4 text-[13px] font-semibold" aria-label="Which client">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL} className="min-h-11">All clients</SelectItem>
          {clients.map(c => (
            <SelectItem key={c.id} value={c.id} className="min-h-11">
              <span className="flex items-center gap-2">
                <span>{c.name}</span>
                <span className="text-[12px] text-muted-foreground">{c.count}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {people.length > 0 && <Select value={value.person ?? EVERYONE} onValueChange={v => onPerson(v === EVERYONE ? null : v)}>
        <SelectTrigger className="h-11 w-56 rounded-full border-border bg-surface px-4 text-[13px] font-semibold" aria-label="Whose cards">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EVERYONE} className="min-h-11">Everyone</SelectItem>
          {people.map(p => (
            <SelectItem key={p.id} value={p.id} className="min-h-11">
              <span className="flex items-center gap-2.5">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-[11px] font-bold">
                  {p.initials}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate">{p.name}</span>
                  {p.role && <span className="text-[12px] font-normal text-muted-foreground">{roleLabel(p.role)}</span>}
                </span>
                <span className="ml-1 text-[12px] text-muted-foreground">{p.count}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>}

      {narrowed && (
        <Button variant="outline" size="sm" onClick={onClear}
          className="h-11 rounded-full border-border bg-surface px-4 text-[13px] font-semibold">
          <X className="h-3.5 w-3.5" aria-hidden /> Show all
        </Button>
      )}
    </div>
  )
}
