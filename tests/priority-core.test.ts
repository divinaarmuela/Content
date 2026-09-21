import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PRIORITIES, PRIORITY_LABELS, isPriority, priorityChip, priorityChoice, priorityOf, priorityWords } from '../app/lib/priority-core'
import { NO_FILTERS, applyFilters, hasFilters } from '../app/lib/people-filter-core'

describe('a card’s priority (21 Sep 2026)', () => {
  it('is one of four words, Normal by default, and only High and Urgent wear a chip', () => {
    expect(PRIORITIES).toEqual(['low', 'normal', 'high', 'urgent'])
    expect(PRIORITY_LABELS.urgent).toBe('Urgent')
    expect(priorityOf({})).toBe('normal')
    expect(priorityOf({ priority: 'high' })).toBe('high')
    expect(priorityOf({ priority: 'asap' })).toBe('normal')
    expect(isPriority('low')).toBe(true)
    expect(isPriority('ASAP')).toBe(false)
    expect(priorityChoice('urgent')).toBe('urgent')
    expect(priorityChoice('x')).toBeNull()
    expect(priorityChip({ priority: 'urgent' })).toEqual({ label: 'Urgent', tone: 'red' })
    expect(priorityChip({ priority: 'high' })).toEqual({ label: 'High priority', tone: 'amber' })
    expect(priorityChip({ priority: 'normal' })).toBeNull()
    expect(priorityChip({ priority: 'low' })).toBeNull()
    expect(priorityWords('high')).toBe('at high priority')
  })
  it('the boards filter by it, beside the client, the person, the files and the version', () => {
    const cards = [{ id: 'a', priority: 'urgent' }, { id: 'b' }, { id: 'c', priority: 'low' }]
    expect(NO_FILTERS.priority).toBeNull()
    expect(applyFilters(cards, { ...NO_FILTERS, priority: 'urgent' }).map(c => c.id)).toEqual(['a'])
    expect(applyFilters(cards, { ...NO_FILTERS, priority: 'normal' }).map(c => c.id)).toEqual(['b'])
    expect(hasFilters({ ...NO_FILTERS, priority: 'low' })).toBe(true)
    const filters = readFileSync('app/dashboard/board/BoardFilters.tsx', 'utf8')
    expect(filters).toContain('<SelectItem value={ANY} className="min-h-11">Any priority</SelectItem>')
    for (const f of ['app/dashboard/editor/page.tsx', 'app/dashboard/designer/page.tsx']) expect(readFileSync(f, 'utf8')).toContain('onPriority={filter.setPriority}')
  })
  it('it is set on the New card window and the card’s edit form, kept to the four words on the server, and worn on the card — folded or not, beside the made date', () => {
    expect(readFileSync('app/dashboard/board/BoardDialogs.tsx', 'utf8')).toContain('<Label htmlFor="new-priority">Priority</Label>')
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain("brief: eBrief.trim() || null, priority: ePriority }")
    expect(readFileSync('app/api/production/items/[id]/route.ts', 'utf8')).toContain("if ('priority' in patch) patch.priority = isPriority(patch.priority) ? patch.priority : 'normal'")
    expect(readFileSync('app/api/production/items/route.ts', 'utf8')).toContain("priority: isPriority(it.priority) ? it.priority : 'normal',")
    const card = readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')
    expect(card).toContain('{lines.made && <Chip tone="muted">{lines.made}</Chip>}')
    expect(card).toContain('{priorityChip(card) && <Chip tone={priorityChip(card)!.tone}>{priorityChip(card)!.label}</Chip>}')
  })
})
