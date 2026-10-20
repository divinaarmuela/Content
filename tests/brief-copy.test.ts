import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_COPY, briefCopyFields, copiedWords, copyPartsOf, copyTitle, nothingToCopy } from '../app/lib/brief-copy-core'

const src = {
  objective: 'Introduce the team', description: 'Introduce the team', concept: 'Vogue interviews', location: 'Studio',
  shot_list: [{ id: 's1', text: 'Wide of the room', done: true }], planned_deliverables: [{ id: 'd1', title: '4 reels' }],
  reference_media: [], scripts: [{ id: 'a', title: 'Intro', body: 'Hi' }], script: null, call_time: '9am', talent: 'Martin',
  props_wardrobe: 'Camera', client_availability: 'Tue', editor_priorities: 'Reels first', brief_skipped: ['script'], deliver_only: false,
  canvas_cards: [{ id: 'c1', kind: 'note', x: 0, y: 0, z: 1, w: 200, text: 'hi' }], board_name: 'Moodboard', share_board: true,
  editor_id: 'ed', crew_ids: ['c1', 'c2'],
} as never

describe('duplicating a shoot brief (the owner, 20 Oct 2026)', () => {
  it('starts with the details and the board ticked, the people not', () => {
    expect(DEFAULT_COPY).toEqual({ details: true, board: true, people: false })
  })

  it('the details alone: the plan comes across, the board and the people do not', () => {
    const f = briefCopyFields(src, { details: true, board: false, people: false })
    expect(f).toMatchObject({ objective: 'Introduce the team', location: 'Studio', call_time: '9am', talent: 'Martin', editor_priorities: 'Reels first' })
    expect(f.canvas_cards).toBeUndefined()
    expect(f.editor_id).toBeUndefined()
  })

  it('the board alone: every card, its name and whether the client sees it — no plan text', () => {
    const f = briefCopyFields(src, { details: false, board: true, people: false })
    expect(f).toEqual({ canvas_cards: [{ id: 'c1', kind: 'note', x: 0, y: 0, z: 1, w: 200, text: 'hi' }], board_name: 'Moodboard', share_board: true })
  })

  it('the shot list starts unticked — nothing is filmed yet for the new shoot', () => {
    const f = briefCopyFields(src, { details: true, board: false, people: false })
    expect(f.shot_list).toEqual([{ id: 's1', text: 'Wide of the room', done: false }])
  })

  it('the people only when asked', () => {
    expect(briefCopyFields(src, { details: false, board: false, people: true })).toEqual({ editor_id: 'ed', crew_ids: ['c1', 'c2'] })
  })

  it('never a date, a stamp, the footage or the Drive folder', () => {
    const f = briefCopyFields(src, { details: true, board: true, people: true })
    for (const k of ['shoot_date', 'edit_deadline', 'status', 'acknowledgements', 'brief_shared_at', 'aligned_at', 'go_at', 'footage_url', 'drive_folder_id', 'client_decision', 'plan_reviewed_at']) {
      expect(k in f).toBe(false)
    }
  })

  it('only `true` counts as ticked, and nothing ticked is refused', () => {
    expect(copyPartsOf({ details: 'yes', board: true })).toEqual({ details: false, board: true, people: false })
    expect(nothingToCopy(copyPartsOf(undefined))).toBe(true)
  })

  it('titles itself "Copy of …" unless one was typed, and says what it copied', () => {
    expect(copyTitle('October clinic day')).toBe('Copy of October clinic day')
    expect(copyTitle('October clinic day', '  November clinic day ')).toBe('November clinic day')
    expect(copiedWords({ details: true, board: true, people: false }, 'MD instagram')).toBe('Copied the details and the board from MD instagram')
  })

  it('the create route checks the person may open the brief copied, and that something is ticked', () => {
    const route = readFileSync('app/api/production/batches/route.ts', 'utf8')
    expect(route).toContain('You are not on the client of the shoot plan you are copying')
    expect(route).toContain('nothingToCopy(parts)')
  })
})
