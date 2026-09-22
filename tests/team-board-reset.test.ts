import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { editChangesContent, isBlankCard } from '../app/lib/team-board-core'

/** WHAT COUNTS AS WORKING ON AN APPROVED BOARD (the owner, 22 Sep 2026: "I accidentally added a blank note"). */
const note = { id: 'n1', kind: 'note', x: 0, y: 0, w: 200, h: 100, z: 1, text: 'Hook: ask strangers', color: 'yellow' }
const post = { id: 'p1', kind: 'mockup', x: 300, y: 0, w: 280, h: 500, z: 2, platform: 'instagram', drive_files: [{ id: 'd1', name: 'a.mov', kind: 'video', mime: 'video/quicktime', key: '' }] }
const board = [note, post]

describe('a blank card is nothing on the board', () => {
  it('a note or label with no words', () => {
    expect(isBlankCard({ id: 'b', kind: 'note', text: '' })).toBe(true)
    expect(isBlankCard({ id: 'b', kind: 'label', text: '   ' })).toBe(true)
    expect(isBlankCard(note)).toBe(false)
    expect(isBlankCard({ id: 'i', kind: 'image', text: '' })).toBe(false)
  })
})

describe('what resets an approval', () => {
  it('not a move, a resize, a restack — or a blank note added and left empty', () => {
    expect(editChangesContent(board, [{ ...note, x: 50, y: 80 }, { ...post, w: 300, h: 540, z: 9 }])).toBe(false)
    expect(editChangesContent(board, [...board, { id: 'woj81z1u', kind: 'note', x: -1316, y: 899, w: 208, h: 120, z: 3, text: '', color: 'yellow' }])).toBe(false)
    expect(editChangesContent(board, board)).toBe(false)
  })
  it('yes: a card with content added, a card removed, words or files changed', () => {
    expect(editChangesContent(board, [...board, { id: 'n2', kind: 'note', x: 0, y: 0, w: 1, h: 1, z: 1, text: 'New idea', color: 'yellow' }])).toBe(true)
    expect(editChangesContent(board, [note])).toBe(true)
    expect(editChangesContent(board, [{ ...note, text: 'Hook: ask nobody' }, post])).toBe(true)
    expect(editChangesContent(board, [note, { ...post, drive_files: [] }])).toBe(true)
    expect(editChangesContent(board, [{ ...note, color: 'blue' }, post])).toBe(true)
  })
  it('the route decides it from the change itself, inside the claim', () => {
    const r = readFileSync('app/api/production/team-boards/[id]/route.ts', 'utf8')
    expect(r).toContain('if (after !== from && editChangesContent(sanitiseCanvasCards((cur as { canvas_cards?: unknown }).canvas_cards) as never[], nextCards as never[])) stage = { status: after }')
  })
})
