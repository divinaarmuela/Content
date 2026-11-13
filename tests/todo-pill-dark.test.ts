import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/** TO-DOS: a coloured pill's words must be readable on the dark theme (the owner's screenshot, 13 Nov 2026). */
describe('To-dos field pill', () => {
  const src = readFileSync('app/dashboard/todos/TodoFields.tsx', 'utf8')
  it('takes the theme ink for its words, never a fixed dark colour', () => {
    expect(src).toContain('leading-5 text-foreground"')
    expect(src).not.toMatch(/color: '#1e1f21'/)
  })
  it('a link in a task’s description is a light blue on the dark theme', () => {
    const panel = readFileSync('app/dashboard/todos/TodoPanel.tsx', 'utf8')
    expect(panel).toContain('hover:text-accent-blue dark:text-[#8FB2FF] dark:hover:text-[#B8CEFF]')
  })
})
