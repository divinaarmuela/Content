import { describe, expect, it } from 'vitest'
import {
  BOARD_ICONS, CANVAS_COLOURS, CANVAS_EXTENT, COLUMN_HEADER, COLUMN_PAD, DEFAULT_SIZE, DEFAULT_VIEW,
  GRID, MIN_SIZE, ZOOM_MAX, ZOOM_MIN,
  breadcrumbs, canvasToScreen, carryStack, clampSize, colourOf, columnUnder, commentCountLabel,
  commentsFor, countInside, countLabel, defaultLinkLabel, descendantBoardIds, drawOrder, fitAll,
  iconOf, isSafeUrl, itemBoardId, itemsInColumn, keyboardNudge, linkService, moveTo, nextZ,
  placeNew, plainText, resizeTo, sanitizeRichText, screenToCanvas, snap, stackInColumn,
  validateBoard, validateComment, validateItem, validatePatch, viewCentre, visibleCanvasComments,
  whenLabel, zoomAt, zoomLabel,
  type CanvasItem,
} from '../app/lib/board-canvas-core'

/**
 * The canvas's rules, tested without a browser. What matters most: a
 * resize can never collapse an item, a colour that stopped existing never
 * leaves a note unreadable, a heading keeps the width it was dragged to, a
 * client's comment never reaches an editor, and a pasted script is not a
 * link.
 */

const item = (over: Partial<CanvasItem> = {}): CanvasItem => ({
  id: 'i1', board_id: 'b1', kind: 'note', x: 0, y: 0, w: 288, h: 176, z: 1,
  colour: null, text: '', url: null, label: null, child_board_id: null, column_title: null,
  parent_item_id: null, ...over,
})

/* ── grid and sizes ─────────────────────────────────────────────────────── */

describe('the grid', () => {
  it('snaps lightly', () => {
    expect(snap(0)).toBe(0)
    expect(snap(7)).toBe(0)
    expect(snap(9)).toBe(GRID)
    expect(snap(GRID * 3 + 1)).toBe(GRID * 3)
  })
  it('keeps a moved item on the canvas', () => {
    expect(moveTo({ x: -40, y: -3 })).toEqual({ x: 0, y: 0 })
    expect(moveTo({ x: 33, y: 47 })).toEqual({ x: 32, y: 48 })
    expect(moveTo({ x: 1e9, y: 5 }).x).toBe(CANVAS_EXTENT)
  })
})

describe('sizes', () => {
  it('clamps a resize below the minimum', () => {
    for (const kind of Object.keys(MIN_SIZE) as (keyof typeof MIN_SIZE)[]) {
      expect(clampSize(kind, { w: 1, h: 1 })).toEqual(MIN_SIZE[kind])
      expect(resizeTo(kind, { w: 0, h: -50 })).toEqual(MIN_SIZE[kind])
    }
  })
  it('keeps the width a heading was dragged to', () => {
    expect(resizeTo('heading', { w: 1200, h: 64 })).toEqual({ w: 1200, h: 64 })
    expect(resizeTo('heading', { w: 1205, h: 64 }).w).toBe(1200)
  })
  it('remembers a note, image and column size the person chose', () => {
    expect(resizeTo('note', { w: 400, h: 320 })).toEqual({ w: 400, h: 320 })
    expect(resizeTo('image', { w: 640, h: 480 })).toEqual({ w: 640, h: 480 })
    expect(resizeTo('column', { w: 352, h: 800 })).toEqual({ w: 352, h: 800 })
  })
  it('never exceeds the canvas', () => {
    expect(resizeTo('note', { w: 1e9, h: 1e9 })).toEqual({ w: CANVAS_EXTENT, h: CANVAS_EXTENT })
  })
  it('gives every kind a default no smaller than its minimum', () => {
    for (const kind of Object.keys(DEFAULT_SIZE) as (keyof typeof DEFAULT_SIZE)[]) {
      expect(DEFAULT_SIZE[kind].w).toBeGreaterThanOrEqual(MIN_SIZE[kind].w)
      expect(DEFAULT_SIZE[kind].h).toBeGreaterThanOrEqual(MIN_SIZE[kind].h)
    }
  })
})

describe('the keyboard', () => {
  it('moves a selected item by one grid step, five with shift', () => {
    expect(keyboardNudge('ArrowRight', false)).toEqual({ x: GRID, y: 0 })
    expect(keyboardNudge('ArrowUp', true)).toEqual({ x: 0, y: -GRID * 5 })
    expect(keyboardNudge('Enter', false)).toBeNull()
  })
})

/* ── colour and icon ────────────────────────────────────────────────────── */

describe('colour', () => {
  it('is a small swatch row of tokens, never a hex', () => {
    expect(CANVAS_COLOURS.length).toBeLessThanOrEqual(8)
    for (const c of CANVAS_COLOURS) expect(c).not.toMatch(/#|rgb/)
  })
  it('falls back to the kind\'s default for an unknown token', () => {
    expect(colourOf('note', '#ff0000')).toBe('surface')
    expect(colourOf('heading', 'olive')).toBe('paper')
    expect(colourOf('board', undefined)).toBe('blue')
    expect(colourOf('note', 'amber')).toBe('amber')
  })
  it('falls back to a folder for an unknown icon', () => {
    expect(iconOf('🔥')).toBe('folder')
    expect(iconOf('camera')).toBe('camera')
    expect(BOARD_ICONS).toContain('folder')
  })
})

/* ── z and placement ───────────────────────────────────────────────────── */

describe('placing', () => {
  it('puts a new item on top, snapped, at its default size', () => {
    const placed = placeNew('note', { x: 101, y: 99 }, [{ z: 3 }, { z: 9 }])
    expect(placed).toEqual({ x: 96, y: 96, ...DEFAULT_SIZE.note, z: 10 })
    expect(nextZ([])).toBe(1)
  })
  it('draws columns under everything else, then by z', () => {
    const order = drawOrder([
      item({ id: 'a', z: 5 }), item({ id: 'col', kind: 'column', z: 9 }), item({ id: 'b', z: 2 }),
    ]).map(i => i.id)
    expect(order).toEqual(['col', 'b', 'a'])
  })
})

/* ── pan and zoom ──────────────────────────────────────────────────────── */

describe('pan and zoom', () => {
  it('round-trips a point', () => {
    const view = { panX: 40, panY: -20, zoom: 1.5 }
    const p = { x: 123, y: 456 }
    const back = screenToCanvas(view, canvasToScreen(view, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })
  it('zooms about the cursor so the thing under it stays put', () => {
    const view = { panX: 0, panY: 0, zoom: 1 }
    const at = { x: 200, y: 100 }
    const under = screenToCanvas(view, at)
    const zoomed = zoomAt(view, 1.5, at)
    const after = screenToCanvas(zoomed, at)
    expect(after.x).toBeCloseTo(under.x)
    expect(after.y).toBeCloseTo(under.y)
    expect(zoomed.zoom).toBe(1.5)
  })
  it('stops at the limits and does not drift when it does', () => {
    const atMax = { panX: 10, panY: 10, zoom: ZOOM_MAX }
    expect(zoomAt(atMax, 2, { x: 0, y: 0 })).toBe(atMax)
    expect(zoomAt({ ...DEFAULT_VIEW, zoom: ZOOM_MIN }, 0.5, { x: 0, y: 0 }).zoom).toBe(ZOOM_MIN)
    expect(zoomLabel(0.75)).toBe('75%')
  })
  it('centres a button-made item in front of the person', () => {
    const c = viewCentre({ panX: -100, panY: 0, zoom: 2 }, { w: 800, h: 600 })
    expect(c).toEqual({ x: 250, y: 150 })
  })
  it('fits everything on screen and never closer than 1:1', () => {
    expect(fitAll([], { w: 800, h: 600 })).toEqual(DEFAULT_VIEW)
    const v = fitAll([{ x: 0, y: 0, w: 4000, h: 200 }], { w: 800, h: 600 })
    expect(v.zoom).toBeLessThan(1)
    expect(v.zoom).toBeGreaterThanOrEqual(ZOOM_MIN)
    const small = fitAll([{ x: 100, y: 100, w: 100, h: 100 }], { w: 800, h: 600 })
    expect(small.zoom).toBe(1)
    // centred
    expect(canvasToScreen(small, { x: 150, y: 150 })).toEqual({ x: 400, y: 300 })
  })
})

/* ── columns ───────────────────────────────────────────────────────────── */

describe('columns', () => {
  const col = item({ id: 'col', kind: 'column', x: 100, y: 100, w: 320, h: 480, z: 1, column_title: 'Shoot Day 1' })
  it('finds the column an item was dropped on by its centre', () => {
    expect(columnUnder(item({ x: 120, y: 200 }), [col])?.id).toBe('col')
    expect(columnUnder(item({ x: 900, y: 200 }), [col])).toBeNull()
    expect(columnUnder({ ...col }, [col])).toBeNull()
  })
  it('the topmost column wins where two overlap', () => {
    const top = item({ ...col, id: 'top', z: 5 })
    expect(columnUnder(item({ x: 120, y: 200 }), [col, top])?.id).toBe('top')
  })
  it('stacks members under the title and grows the column to hold them', () => {
    const a = item({ id: 'a', parent_item_id: 'col', h: 176, y: 500 })
    const b = item({ id: 'b', parent_item_id: 'col', h: 176, y: 300 })
    const members = itemsInColumn(col, [a, b, item({ id: 'free' })])
    expect(members.map(m => m.id)).toEqual(['b', 'a'])
    const laid = stackInColumn(col, members)
    expect(laid.items[0]).toMatchObject({ id: 'b', x: 100 + COLUMN_PAD, y: 100 + COLUMN_HEADER, w: 320 - COLUMN_PAD * 2 })
    expect(laid.items[1]).toMatchObject({ id: 'a', y: 100 + COLUMN_HEADER + 176 + 12 })
    expect(laid.column.h).toBeUndefined()
    const tall = stackInColumn(col, [a, b, item({ id: 'c', parent_item_id: 'col', h: 400 })])
    expect(tall.column.h).toBeGreaterThan(480)
  })
  it('writes nothing when the stack is already right', () => {
    const a = item({ id: 'a', parent_item_id: 'col', x: 100 + COLUMN_PAD, y: 100 + COLUMN_HEADER, w: 320 - COLUMN_PAD * 2 })
    expect(stackInColumn(col, [a]).items).toEqual([])
  })
  it('carries its stack when the column moves', () => {
    const a = item({ id: 'a', parent_item_id: 'col', x: 112, y: 156 })
    expect(carryStack(col, { x: 200, y: 100 }, [a])).toEqual([{ id: 'a', x: 212, y: 156 }])
    expect(carryStack(col, { x: 100, y: 100 }, [a])).toEqual([])
  })
})

/* ── counts and breadcrumbs ────────────────────────────────────────────── */

describe('what a board holds', () => {
  const items = [
    item({ id: '1', board_id: 'b' }), item({ id: '2', board_id: 'b', kind: 'image' }),
    item({ id: '3', board_id: 'b', kind: 'board' }), item({ id: '4', board_id: 'b', kind: 'column' }),
    item({ id: '5', board_id: 'other' }),
  ]
  it('counts cards and boards one level down, and not columns', () => {
    expect(countInside('b', items)).toEqual({ cards: 2, boards: 1 })
  })
  it('says it in the tile\'s words', () => {
    expect(countLabel({ cards: 39, boards: 0 })).toBe('39 cards')
    expect(countLabel({ cards: 0, boards: 3 })).toBe('3 boards')
    expect(countLabel({ cards: 1, boards: 1 })).toBe('1 card · 1 board')
    expect(countLabel({ cards: 0, boards: 0 })).toBe('Empty')
  })
})

describe('breadcrumbs', () => {
  const boards = [
    { id: 'root', name: 'Golf Day', parent_board_id: null },
    { id: 'mid', name: 'Concepts', parent_board_id: 'root' },
    { id: 'leaf', name: 'Models', parent_board_id: 'mid' },
    { id: 'loopA', name: 'A', parent_board_id: 'loopB' },
    { id: 'loopB', name: 'B', parent_board_id: 'loopA' },
  ]
  it('walks root first to this board last', () => {
    expect(breadcrumbs('leaf', boards).map(c => c.name)).toEqual(['Golf Day', 'Concepts', 'Models'])
    expect(breadcrumbs('root', boards).map(c => c.name)).toEqual(['Golf Day'])
  })
  it('survives a cycle and an unknown board', () => {
    expect(breadcrumbs('loopA', boards).map(c => c.id)).toEqual(['loopB', 'loopA'])
    expect(breadcrumbs('nope', boards)).toEqual([])
  })
  it('knows everything under a board, at any depth', () => {
    expect(descendantBoardIds('root', boards)).toEqual(['mid', 'leaf'])
    expect(descendantBoardIds('leaf', boards)).toEqual([])
  })
})

/* ── links ─────────────────────────────────────────────────────────────── */

describe('links', () => {
  it('accepts http(s) and nothing else', () => {
    expect(isSafeUrl('https://drive.google.com/file/d/abc/view')).toBe(true)
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('data:text/html,hi')).toBe(false)
    expect(isSafeUrl('not a url')).toBe(false)
    expect(isSafeUrl(42)).toBe(false)
  })
  it('names the service a pasted link belongs to', () => {
    expect(linkService('https://drive.google.com/drive/folders/x')).toBe('drive')
    expect(linkService('https://docs.google.com/document/d/x')).toBe('drive')
    expect(linkService('https://www.dropbox.com/s/x/file.mov')).toBe('dropbox')
    expect(linkService('https://example.com/x')).toBe('other')
    expect(defaultLinkLabel('https://www.dropbox.com/s/x')).toBe('Dropbox')
    expect(defaultLinkLabel('https://www.example.com/x')).toBe('example.com')
  })
})

/* ── rich text ─────────────────────────────────────────────────────────── */

describe('a note\'s rich text', () => {
  it('keeps a heading, bold, bullets and a highlight', () => {
    const html = '<h3>Location</h3><p>We go to <b>Albert Park</b></p><ul><li><mark>Decided</mark></li></ul>'
    expect(sanitizeRichText(html)).toBe(html)
  })
  it('drops scripts, attributes and unknown tags but keeps their words', () => {
    expect(sanitizeRichText('<script>alert(1)</script><p onclick="x()">hi</p><a href="x">there</a>'))
      .toBe('alert(1)<p>hi</p>there')
  })
  it('closes what was left open and escapes loose angle brackets', () => {
    expect(sanitizeRichText('<b>bold <i>both')).toBe('<b>bold <i>both</i></b>')
    expect(sanitizeRichText('1 < 2 and 3 > 2')).toBe('1 &lt; 2 and 3 &gt; 2')
    expect(sanitizeRichText('</b>stray')).toBe('stray')
  })
  it('reads back as plain words', () => {
    expect(plainText('<h3>Title</h3><ul><li>one</li><li>two</li></ul>')).toBe('Title\none\ntwo')
  })
})

/* ── validation ────────────────────────────────────────────────────────── */

describe('a new item', () => {
  it('refuses an unknown kind in plain words', () => {
    const r = validateItem({ kind: 'sticker' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Pick what to add/)
  })
  it('snaps, sizes and colours a note', () => {
    const r = validateItem({ kind: 'note', x: 13, y: 21, w: 10, h: 10, colour: '#fff', text: '<b>hi</b><script>x</script>' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.item).toMatchObject({ x: 16, y: 16, ...MIN_SIZE.note, colour: 'surface', text: '<b>hi</b>x' })
  })
  it('keeps the size and colour the person chose', () => {
    const r = validateItem({ kind: 'heading', w: 1400, h: 80, colour: 'green', text: 'SHOOT CONCEPTS' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.item).toMatchObject({ w: 1408, h: 80, colour: 'green', text: 'SHOOT CONCEPTS' })
  })
  it('uses the default position when none is given', () => {
    const r = validateItem({ kind: 'note' }, { x: 300, y: 300 })
    expect(r.ok && r.item.x).toBe(304)
  })
  it('needs words for a heading and a title for a column', () => {
    expect(validateItem({ kind: 'heading', text: '  ' })).toMatchObject({ ok: false, reason: 'Give the heading some words' })
    expect(validateItem({ kind: 'column' })).toMatchObject({ ok: false, reason: 'Give the column a title' })
    const c = validateItem({ kind: 'column', column_title: 'Day 1', parent_item_id: 'other' })
    expect(c.ok && c.item.parent_item_id).toBeNull()
  })
  it('needs a real link, and labels it when nobody did', () => {
    expect(validateItem({ kind: 'link', url: 'javascript:x' })).toMatchObject({ ok: false })
    const r = validateItem({ kind: 'link', url: 'https://drive.google.com/x' })
    expect(r.ok && r.item.label).toBe('Google Drive')
    const named = validateItem({ kind: 'link', url: 'https://drive.google.com/x', label: 'Raw footage' })
    expect(named.ok && named.item.label).toBe('Raw footage')
    expect(validateItem({ kind: 'image', url: 'ftp://x' })).toMatchObject({ ok: false })
  })
  it('needs a board behind a tile', () => {
    expect(validateItem({ kind: 'board' })).toMatchObject({ ok: false, reason: 'That board does not exist yet' })
    expect(validateItem({ kind: 'board', child_board_id: 'b-2' })).toMatchObject({ ok: true })
    expect(validateItem({ kind: 'board', child_board_id: 'has/slash' })).toMatchObject({ ok: false })
  })
})

describe('a change to an item', () => {
  const note = item()
  it('snaps and clamps a move and a resize', () => {
    expect(validatePatch(note, { x: 33, y: -5 })).toEqual({ ok: true, patch: { x: 32, y: 0 } })
    expect(validatePatch(note, { w: 5, h: 5 })).toEqual({ ok: true, patch: MIN_SIZE.note })
  })
  it('falls back for an unknown colour and clears a null one', () => {
    expect(validatePatch(note, { colour: 'neon' })).toEqual({ ok: true, patch: { colour: 'surface' } })
    expect(validatePatch(note, { colour: null })).toEqual({ ok: true, patch: { colour: null } })
  })
  it('never lets a kind take a field it does not have', () => {
    expect(validatePatch(note, { url: 'https://x.com' })).toMatchObject({ ok: false })
    expect(validatePatch(item({ kind: 'image', url: 'https://a' }), { text: 'x' })).toMatchObject({ ok: false })
    expect(validatePatch(item({ kind: 'column', column_title: 'a' }), { parent_item_id: 'c' })).toMatchObject({ ok: false })
  })
  it('sanitises a note and refuses an empty heading', () => {
    expect(validatePatch(note, { text: '<img src=x onerror=1>hi' })).toEqual({ ok: true, patch: { text: 'hi' } })
    expect(validatePatch(item({ kind: 'heading', text: 'A' }), { text: '' })).toMatchObject({ ok: false })
  })
  it('gives a link its default label back when the label is cleared', () => {
    const link = item({ kind: 'link', url: 'https://www.dropbox.com/s/x', label: 'Edit' })
    expect(validatePatch(link, { label: '' })).toEqual({ ok: true, patch: { label: 'Dropbox' } })
  })
  it('says when there is nothing to do', () => {
    expect(validatePatch(note, {})).toMatchObject({ ok: false, reason: 'Nothing to change' })
  })
})

describe('a board', () => {
  it('needs a name, and forgives an unknown icon or colour', () => {
    expect(validateBoard({ name: ' ' })).toMatchObject({ ok: false, reason: 'Give the board a name' })
    expect(validateBoard({ name: 'Models', icon: 'nope', colour: '#123' }))
      .toEqual({ ok: true, name: 'Models', icon: 'folder', colour: 'blue' })
    expect(validateBoard({ name: 'Models', icon: 'camera', colour: 'amber' }))
      .toMatchObject({ icon: 'camera', colour: 'amber' })
  })
  it('has exactly one id for the board behind a card', () => {
    expect(itemBoardId('abc')).toBe('item-abc')
  })
})

/* ── comments ──────────────────────────────────────────────────────────── */

describe('comments on an item', () => {
  const rows = [
    { id: 'c1', item_id: 'i1', author_role: 'client', created_at: '2026-09-06T02:00:00Z' },
    { id: 'c2', item_id: 'i1', author_role: 'editor', created_at: '2026-09-06T01:00:00Z' },
    { id: 'c3', item_id: 'i2', author_role: 'account_manager', created_at: '2026-09-06T03:00:00Z' },
  ]
  it('reach the account manager whole', () => {
    expect(visibleCanvasComments('account_manager', rows).map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(visibleCanvasComments('super_admin', rows)).toHaveLength(3)
  })
  it('never show a client\'s words to an editor or a scheduler', () => {
    expect(visibleCanvasComments('editor', rows).map(c => c.id)).toEqual(['c2', 'c3'])
    expect(visibleCanvasComments('scheduler', rows).map(c => c.id)).toEqual(['c2', 'c3'])
  })
  it('show a client only what clients wrote', () => {
    expect(visibleCanvasComments('client', rows).map(c => c.id)).toEqual(['c1'])
  })
  it('belong to one item, oldest first', () => {
    expect(commentsFor('i1', rows).map(c => c.id)).toEqual(['c2', 'c1'])
  })
  it('are refused empty', () => {
    expect(validateComment('  ')).toMatchObject({ ok: false, reason: 'Write the comment first' })
    expect(validateComment(' fine ')).toEqual({ ok: true, body: 'fine' })
  })
  it('say how many, and when', () => {
    expect(commentCountLabel(0)).toBe('')
    expect(commentCountLabel(1)).toBe('1 comment')
    expect(commentCountLabel(3)).toBe('3 comments')
    const now = new Date('2026-09-06T10:00:00Z')
    expect(whenLabel('2026-09-06T09:59:50Z', now)).toBe('just now')
    expect(whenLabel('2026-09-06T09:30:00Z', now)).toBe('30 min ago')
    expect(whenLabel('2026-09-06T07:00:00Z', now)).toBe('3 hours ago')
    expect(whenLabel('2026-09-04T10:00:00Z', now)).toBe('2 days ago')
    expect(whenLabel('garbage', now)).toBe('')
  })
})
