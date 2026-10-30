import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sanitiseTodoPatch } from '../app/lib/todo-core'

// 30 Oct 2026, Abby: "Can we add these add start date on due date? So they can have flexibility within xx to xx day"
// — and the owner: "why is the button black" (the picked day was the ink colour)

describe('a to-do’s start date', () => {
  it('is a date, may be cleared, and never comes after the due date', () => {
    expect(sanitiseTodoPatch({ start_date: '2026-11-02', due_date: '2026-11-05' })).toEqual({ ok: true, patch: { start_date: '2026-11-02', due_date: '2026-11-05' } })
    expect(sanitiseTodoPatch({ start_date: null })).toEqual({ ok: true, patch: { start_date: null } })
    expect(sanitiseTodoPatch({ start_date: 'soon' }).ok).toBe(false)
    expect(sanitiseTodoPatch({ start_date: '2026-11-06', due_date: '2026-11-05' }).ok).toBe(false)
  })
  it('the picker offers it, shades the days between, and marks picked days blue, not black', () => {
    const src = readFileSync('app/dashboard/todos/DuePicker.tsx', 'utf8')
    expect(src).toContain('+ Add start date')
    expect(src).toContain("between ? 'rounded-none bg-tint-blue'")
    expect(src).toContain("picked ? 'bg-accent-blue font-semibold text-white'")
    expect(src).not.toContain("picked ? 'bg-foreground font-semibold text-background'")
  })
})
