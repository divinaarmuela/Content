import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { linkParts } from '../app/lib/todo-core'

describe("links in a to-do's description and comments are links (20 Oct 2026)", () => {
  it('finds https, http and www addresses, and leaves the words around them', () => {
    expect(linkParts('See https://drive.google.com/x/abc for the edit')).toEqual([
      { text: 'See ' }, { text: 'https://drive.google.com/x/abc', href: 'https://drive.google.com/x/abc' }, { text: ' for the edit' },
    ])
    expect(linkParts('www.canva.com/design/1')).toEqual([{ text: 'www.canva.com/design/1', href: 'https://www.canva.com/design/1' }])
  })

  it("the sentence's full stop or bracket is not part of the address", () => {
    expect(linkParts('Brief here: https://milanote.com/b.')[1]).toEqual({ text: 'https://milanote.com/b', href: 'https://milanote.com/b' })
    expect(linkParts('(https://asana.com/t/1)')[1].href).toBe('https://asana.com/t/1')
  })

  it('plain words stay words', () => {
    expect(linkParts('No link here')).toEqual([{ text: 'No link here' }])
  })

  it('the description and the comments draw them, opening in a new tab without starting an edit', () => {
    const panel = readFileSync('app/dashboard/todos/TodoPanel.tsx', 'utf8')
    expect(panel).toContain('target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}')
    expect(panel).toMatch(/<Linked key=\{i\} text=\{sp\.text\} \/>/)
  })
})
