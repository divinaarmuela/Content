import { describe, expect, it } from 'vitest'
import { ALL_CLIENTS, NO_CLIENT_FILTER, boardForClient, boardFromSource, clientsWithBoards } from '../app/lib/milanote-briefs-core'

describe("the Boards page's filters (20 Oct 2026)", () => {
  it('where a board came from: all, the team’s own, or from Milanote', () => {
    expect(boardFromSource({ milanote_id: 'x' }, 'milanote')).toBe(true)
    expect(boardFromSource({ milanote_id: 'x' }, 'here')).toBe(false)
    expect(boardFromSource({}, 'here')).toBe(true)
    expect(boardFromSource({}, 'all')).toBe(true)
  })

  it("one client's boards, the team's own, or all", () => {
    expect(boardForClient({ client_id: 'c1' }, 'c1')).toBe(true)
    expect(boardForClient({ client_id: 'c2' }, 'c1')).toBe(false)
    expect(boardForClient({ client_id: null }, NO_CLIENT_FILTER)).toBe(true)
    expect(boardForClient({ client_id: 'c1' }, ALL_CLIENTS)).toBe(true)
  })

  it('the dropdown lists only clients with a board, by name, with how many', () => {
    const boards = [{ client_id: 'b' }, { client_id: 'a' }, { client_id: 'b' }, { client_id: null }]
    const clients = [{ id: 'a', name: 'Luxe' }, { id: 'b', name: 'Basfoods' }, { id: 'c', name: 'Nobody' }]
    expect(clientsWithBoards(boards, clients)).toEqual([{ id: 'b', name: 'Basfoods', count: 2 }, { id: 'a', name: 'Luxe', count: 1 }])
  })
})
