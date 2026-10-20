import { describe, expect, it } from 'vitest'
import { applyCanvasOp, sanitiseCanvasCards } from '../app/lib/batch-brief-core'

/** MILANOTE'S KINDS ON THE CANVAS (20 Oct 2026, docs/MILANOTE_MERGE.md) — kept exactly, and safely. */
describe("the canvas holds Milanote's kinds", () => {
  it('keeps a column, a card in it with its order, an exact colour and rich text', () => {
    const cards = sanitiseCanvasCards([
      { id: 'c1', kind: 'column', x: -57, y: 27, w: 300, name: 'Objective', hex: '#96B74A', mn: '1Uabc' },
      { id: 'n1', kind: 'note', x: 0, y: 0, w: 280, col: 'c1', ord: 655360, html: '<p><strong>Goal:</strong> <em>trust</em><script>x</script></p>' },
    ])
    expect(cards[0]).toMatchObject({ kind: 'column', x: -57, y: 27, name: 'Objective', hex: '#96b74a', mn: '1Uabc' })
    expect(cards[1]).toMatchObject({ col: 'c1', ord: 655360, html: '<p><strong>Goal:</strong> <em>trust</em>x</p>' })
  })

  it('keeps a table, a swatch, a file, a document and a board link', () => {
    const cards = sanitiseCanvasCards([
      { id: 't', kind: 'table', x: 0, y: 0, w: 900, rows: [['<p><strong>Phase</strong></p>', 'Timing'], ['1', 'Weeks 1–2']], header: true },
      { id: 's', kind: 'swatch', x: 0, y: 0, w: 150, h: 160, hex: '#d9f10f', name: 'Las Palmas' },
      { id: 'f', kind: 'file', x: 0, y: 0, w: 280, file: { url: 'https://media.mdmmarketing.com.au/a.pdf', name: 'Deck.pdf', size: 123 } },
      { id: 'd', kind: 'document', x: 0, y: 0, w: 280, name: 'Script/Hooks', html: '<p>Opening hook</p>' },
      { id: 'b', kind: 'boardlink', x: 0, y: 0, w: 192, h: 192, target: 'tb_basfoods', name: 'Basfoods' },
      { id: 'bad', kind: 'file', x: 0, y: 0, w: 280, file: { url: 'javascript:alert(1)', name: 'x' } },
    ])
    expect(cards.find(c => c.id === 't')).toMatchObject({ rows: [['<p><strong>Phase</strong></p>', 'Timing'], ['1', 'Weeks 1–2']], header: true })
    expect(cards.find(c => c.id === 's')).toMatchObject({ hex: '#d9f10f', name: 'Las Palmas' })
    expect(cards.find(c => c.id === 'f')?.file).toEqual({ url: 'https://media.mdmmarketing.com.au/a.pdf', name: 'Deck.pdf', size: 123 })
    expect(cards.find(c => c.id === 'd')).toMatchObject({ name: 'Script/Hooks', html: '<p>Opening hook</p>' })
    expect(cards.find(c => c.id === 'b')).toMatchObject({ target: 'tb_basfoods', name: 'Basfoods' })
    expect(cards.find(c => c.id === 'bad')?.file).toBeUndefined()
  })

  it("keeps Milanote's free lines — points, a curve, a label — and still drops a line with no ends", () => {
    const cards = sanitiseCanvasCards([
      { id: 'l1', kind: 'arrow', x: 0, y: 0, w: 120, line: { fx: 0, fy: 0, tx: 205, ty: 0, cx: 100, cy: -40, label: 'leads to', end: 'arrow', weight: 2 } },
      { id: 'l2', kind: 'arrow', x: 0, y: 0, w: 120 },
    ])
    expect(cards.map(c => c.id)).toEqual(['l1'])
    expect(cards[0].line).toEqual({ fx: 0, fy: 0, tx: 205, ty: 0, cx: 100, cy: -40, label: 'leads to', end: 'arrow', weight: 2 })
  })

  it('deleting a column takes its cards; a free line survives its neighbours going', () => {
    const start = [
      { id: 'c1', kind: 'column', x: 0, y: 0, w: 300 },
      { id: 'n1', kind: 'note', x: 0, y: 0, w: 280, col: 'c1', text: 'in it' },
      { id: 'n2', kind: 'note', x: 400, y: 0, w: 280, text: 'free' },
      { id: 'l1', kind: 'arrow', x: 0, y: 0, w: 120, line: { fx: 0, fy: 0, tx: 10, ty: 10 } },
    ]
    expect(applyCanvasOp(start, { remove: ['c1'] }).map(c => c.id).sort()).toEqual(['l1', 'n2'])
  })

  it("holds a client's whole Milanote tree — more than the old 600", () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ id: `n${i}`, kind: 'note', x: i, y: 0, w: 200, text: 'x' }))
    expect(sanitiseCanvasCards(many)).toHaveLength(700)
  })
})
