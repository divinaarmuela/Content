import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/** TO-DOS: a coloured pill's words must be readable on the dark theme (the owner's screenshot, 13 Nov 2026). */
describe('To-dos field pill', () => {
  const src = readFileSync('app/dashboard/todos/TodoFields.tsx', 'utf8')
  it('takes the theme ink for its words, never a fixed dark colour', () => {
    expect(src).toContain('leading-5 text-foreground"')
    expect(src).not.toMatch(/color: '#1e1f21'/)
  })
})
