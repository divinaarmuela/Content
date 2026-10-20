import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { continueBullet, highlightColour, markRuns, toggleBullets, toggleHighlight } from '../app/lib/note-format-core'

const prompts = 'Prompts:\nSite walks\nClient consults\nTraining'

describe("dot points and highlights in a note (Manal, 20 Oct 2026)", () => {
  it('the lines picked become dot points — the whole line, wherever the selection starts and ends', () => {
    const from = prompts.indexOf('walks'), to = prompts.indexOf('Training') + 3
    const r = toggleBullets(prompts, from, to)
    expect(r.text).toBe('Prompts:\n• Site walks\n• Client consults\n• Training')
    expect(r.text.slice(r.start, r.end)).toBe('• Site walks\n• Client consults\n• Training')
  })

  it('pressed again, they are plain lines again; blank lines are left alone', () => {
    expect(toggleBullets('• a\n\n• b', 0, 8).text).toBe('a\n\nb')
    expect(toggleBullets('a\n\nb', 0, 4).text).toBe('• a\n\n• b')
  })

  it('a mix of dotted and plain lines all become dot points', () => {
    expect(toggleBullets('• a\nb', 0, 5).text).toBe('• a\n• b')
  })

  it('Enter on a dot point starts the next; Enter on an empty one ends the list', () => {
    expect(continueBullet('• Site walks', 12)).toEqual({ text: '• Site walks\n• ', caret: 15 })
    expect(continueBullet('• Site walks\n• ', 15)).toEqual({ text: '• Site walks\n', caret: 13 })
    expect(continueBullet('Plain line', 10)).toBeNull()
  })

  it('the words picked are highlighted, and cleared when pressed again', () => {
    const t = 'Jordan will be asked the following prompts'
    const at = t.indexOf('following prompts')
    const on = toggleHighlight(t, at, t.length)
    expect(on.text).toBe('Jordan will be asked the ==following prompts==')
    expect(toggleHighlight(on.text, on.start, on.end).text).toBe(t)
    // picked without its marks, from inside: still cleared
    const inner = on.text.indexOf('following')
    expect(toggleHighlight(on.text, inner, inner + 'following prompts'.length).text).toBe(t)
  })

  it('a highlight across lines marks each line, and leaves a dot point outside it', () => {
    const t = '• Site walks\n• Training'
    expect(toggleHighlight(t, 2, t.length).text).toBe('• ==Site walks==\n• ==Training==')
  })

  it('nothing picked changes nothing; a picked space is not a highlight', () => {
    expect(toggleHighlight('abc', 1, 1).text).toBe('abc')
    expect(toggleHighlight('a b', 1, 2).text).toBe('a b')
  })

  it('the note splits into highlighted and plain words; the highlighter shows on a yellow note too', () => {
    expect(markRuns('a ==b== c')).toEqual([{ text: 'a ', mark: false }, { text: 'b', mark: true }, { text: ' c', mark: false }])
    expect(markRuns('x == y')).toEqual([{ text: 'x == y', mark: false }])
    expect(highlightColour('yellow')).not.toBe(highlightColour('paper'))
  })

  it('the note toolbar has Dot points and Highlight, and the note draws its highlights', () => {
    const canvas = readFileSync('app/dashboard/production/shoots/[id]/BriefCanvas.tsx', 'utf8')
    expect(canvas).toContain('aria-label="Dot points"')
    expect(canvas).toContain('aria-label="Highlight"')
    expect(readFileSync('app/dashboard/production/shoots/[id]/CanvasCard.tsx', 'utf8')).toContain('markRuns(text)')
  })
})
