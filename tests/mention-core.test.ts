import { describe, it, expect } from 'vitest'
import {
  extractMentions, filterMentionable, insertMention, mentionQuery, resolveTags,
} from '../app/lib/mention-core'

const team = [
  { id: 'm', name: 'Manal' },
  { id: 'md', name: 'Manal Doe' },
  { id: 'd', name: 'Divina' },
  { id: 'j', name: 'James Chen' },
  { id: 'blank', name: '  ' },
]

describe('extractMentions', () => {
  it('finds a tagged person by display name, case-insensitively', () => {
    expect(extractMentions('can you look @divina', team).map(m => m.id)).toEqual(['d'])
  })

  it('prefers the longest name when one contains another', () => {
    expect(extractMentions('@Manal Doe please', team).map(m => m.id)).toEqual(['md'])
    expect(extractMentions('@Manal please', team).map(m => m.id)).toEqual(['m'])
  })

  it('needs a word boundary — a longer word is not a tag', () => {
    expect(extractMentions('@Divinax', team)).toEqual([])
    expect(extractMentions('mail me@divina.example', team)).toEqual([])
  })

  it('returns each person once, in order of first appearance', () => {
    const out = extractMentions('@James Chen then @Divina, and @james chen again', team)
    expect(out.map(m => m.id)).toEqual(['j', 'd'])
  })

  it('never tags a member with a blank name', () => {
    expect(extractMentions('@   hi', team)).toEqual([])
  })

  it('works with a comma or newline after the name', () => {
    expect(extractMentions('@Divina,\n@James Chen', team).map(m => m.id)).toEqual(['d', 'j'])
  })
})

describe('mentionQuery', () => {
  it('is null with no @', () => {
    expect(mentionQuery('hello', 5)).toBeNull()
  })
  it('opens on a fresh @ and tracks what is typed', () => {
    expect(mentionQuery('hi @', 4)).toEqual({ start: 3, query: '' })
    expect(mentionQuery('hi @Div', 7)).toEqual({ start: 3, query: 'Div' })
  })
  it('allows one space for a surname, closes after a second', () => {
    expect(mentionQuery('@James Ch', 9)).toEqual({ start: 0, query: 'James Ch' })
    expect(mentionQuery('@James Chen can', 15)).toBeNull()
  })
  it('does not treat an email address as a mention', () => {
    expect(mentionQuery('me@div', 6)).toBeNull()
  })
  it('closes on a newline', () => {
    expect(mentionQuery('@Div\n', 5)).toBeNull()
  })
})

describe('filterMentionable', () => {
  it('offers everyone on an empty query, alphabetically', () => {
    expect(filterMentionable(team, '').map(m => m.name)).toEqual(['Divina', 'James Chen', 'Manal', 'Manal Doe'])
  })
  it('ranks name-start matches before word-start before anywhere', () => {
    expect(filterMentionable(team, 'ch').map(m => m.id)).toEqual(['j'])
    expect(filterMentionable(team, 'man').map(m => m.id)).toEqual(['m', 'md'])
  })
  it('respects the limit', () => {
    expect(filterMentionable(team, '', 2)).toHaveLength(2)
  })
})

describe('resolveTags — the one rule the box and the server share', () => {
  it('explicit ids first, then the names in the text, each once, never the author', () => {
    const out = resolveTags('@Divina and @James Chen please', ['j', 'j'], team, 'm')
    expect(out.map(t => t.id)).toEqual(['j', 'd'])
  })
  it('drops the author and anyone not on the roster', () => {
    expect(resolveTags('@Manal look', ['ghost'], team, 'm')).toEqual([])
    expect(resolveTags('@Manal look', [], team, 'd').map(t => t.id)).toEqual(['m'])
  })
  it('tags nobody from plain text', () => {
    expect(resolveTags('no tags here', [], team, 'm')).toEqual([])
  })
})

describe('insertMention', () => {
  it('replaces the partial with the full name and a space, caret after it', () => {
    const out = insertMention('ask @Div about it', 4, 8, 'Divina')
    expect(out.text).toBe('ask @Divina  about it')
    expect(out.caret).toBe('ask @Divina '.length)
  })
})
