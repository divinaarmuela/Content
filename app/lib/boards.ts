import 'server-only'
import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Board, BoardComment, BoardItem } from '@/lib/db-types'
import { AuthzError, authzErrorResponse, type TeamUser } from './authz'
import { accessibleClientIds, loadItemForUser } from './production-access'
import {
  breadcrumbs, countInside, descendantBoardIds, itemBoardId, itemsInColumn, placeNew,
  stackInColumn, validateBoard, validateItem, validatePatch, visibleCanvasComments,
  type CanvasItem, type Inside, type Point,
} from './board-canvas-core'

/**
 * The canvas's server half: who may open which board, and every write.
 *
 * Reads are scoped by CLIENT through `accessibleClientIds` — the same answer
 * Production, the Schedule and the Files page give to "whose work is this",
 * so a board can never be a way around it. Writes go through `claim()` on
 * the row (trap 11): two people dragging the same note at once both land,
 * last one wins the position, neither one wipes the other's text.
 */

const boards = () => table<Board>('boards')
const items = () => table<BoardItem>('board_items')
const comments = () => table<BoardComment>('board_comments')

const TEAM_ROLES = ['scheduler', 'editor', 'account_manager', 'super_admin']

/* ── access ─────────────────────────────────────────────────────────────── */

export async function assertBoardClient(user: TeamUser, clientId: string): Promise<void> {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) {
    throw new AuthzError('That board belongs to a client who is not one of yours', 403)
  }
}

/** A board this person may open, or a plain-words refusal. */
export async function loadBoardForUser(user: TeamUser, boardId: string): Promise<Board> {
  const board = await boards().get(boardId)
  if (!board) throw new AuthzError('That board is not here any more', 404)
  await assertBoardClient(user, board.client_id)
  return board
}

/** Only the team draws on a canvas; a client comments (see board-comments). */
export function assertTeam(user: TeamUser): void {
  if (!TEAM_ROLES.includes(user.role)) throw new AuthzError('Only the team can change a board', 403)
}

/* ── reading ────────────────────────────────────────────────────────────── */

export type BoardSnapshot = {
  board: Board
  crumbs: { id: string; name: string }[]
  items: BoardItem[]
  comments: BoardComment[]
  /** what each nested board on this canvas holds, by its id */
  inside: Record<string, Inside>
}

/** Everything one canvas needs, scoped and filtered for this viewer. */
export async function boardSnapshot(user: TeamUser, boardId: string): Promise<BoardSnapshot> {
  const board = await loadBoardForUser(user, boardId)
  const [allBoards, rows, thread] = await Promise.all([
    boards().list({ by: { client_id: board.client_id } }),
    items().list({ by: { board_id: boardId } }),
    comments().list({ by: { board_id: boardId } }),
  ])
  const childIds = rows.filter(r => r.kind === 'board' && r.child_board_id).map(r => r.child_board_id as string)
  const inside: Record<string, Inside> = {}
  if (childIds.length) {
    // one read of every item the client has, counted per child — a canvas
    // with thirty tiles is not thirty reads
    const clientBoardIds = new Set(allBoards.map(b => b.id))
    const all = (await items().list({ limit: 5000 })).filter(i => clientBoardIds.has(i.board_id))
    for (const id of childIds) inside[id] = countInside(id, all)
  }
  return {
    board,
    crumbs: breadcrumbs(boardId, allBoards),
    items: rows,
    comments: visibleCanvasComments(user.role, thread),
    inside,
  }
}

/** A client's top-level boards — the ones not inside another and not behind
 *  a card — with what each holds. */
export async function listClientBoards(user: TeamUser, clientId: string): Promise<{ boards: Board[]; inside: Record<string, Inside> }> {
  await assertBoardClient(user, clientId)
  const rows = await boards().list({ by: { client_id: clientId } })
  const top = rows.filter(b => !b.parent_board_id && !b.item_id)
    .sort((a, b) => a.name.localeCompare(b.name))
  const ids = new Set(rows.map(b => b.id))
  const all = (await items().list({ limit: 5000 })).filter(i => ids.has(i.board_id))
  const inside: Record<string, Inside> = {}
  for (const b of top) inside[b.id] = countInside(b.id, all)
  return { boards: top, inside }
}

/* ── boards ─────────────────────────────────────────────────────────────── */

export type NewBoard = {
  client_id: string
  name: unknown
  icon?: unknown
  colour?: unknown
  /** make it inside this board, as a tile at `at` */
  parent_board_id?: string | null
  at?: Point
}

/**
 * One button makes a board. Given a parent, the board is made AND a tile
 * for it is put on the parent's canvas — the tile is how the board is
 * opened, so a board without one would be a board nobody could find.
 */
export async function createBoard(user: TeamUser, input: NewBoard): Promise<{ board: Board; tile: BoardItem | null }> {
  assertTeam(user)
  await assertBoardClient(user, input.client_id)
  const v = validateBoard(input)
  if (!v.ok) throw new AuthzError(v.reason, 400)
  let parent: Board | null = null
  if (input.parent_board_id) {
    parent = await loadBoardForUser(user, input.parent_board_id)
    if (parent.client_id !== input.client_id) throw new AuthzError('A board stays with its client', 400)
  }
  const board = await boards().insert({
    client_id: input.client_id,
    parent_board_id: parent?.id ?? null,
    item_id: null,
    name: v.name, icon: v.icon, colour: v.colour,
    created_by: user.id,
  } as Omit<Board, 'id'>)
  let tile: BoardItem | null = null
  if (parent) {
    const existing = await items().list({ by: { board_id: parent.id } })
    const at = input.at ?? { x: 64, y: 64 }
    const placed = placeNew('board', at, existing)
    tile = await items().insert({
      board_id: parent.id, kind: 'board', ...placed,
      colour: v.colour, text: null, url: null, label: v.name,
      child_board_id: board.id, column_title: null, parent_item_id: null,
      created_by: user.id,
    } as Omit<BoardItem, 'id'>)
  }
  return { board, tile }
}

/**
 * The board behind a piece of work: exactly one, ever. Its id is derived
 * from the item's, and the row is CLAIMED — two people opening the card at
 * the same second both get the same board, and neither gets a duplicate.
 */
export async function boardForItem(user: TeamUser, itemId: string): Promise<Board> {
  const item = await loadItemForUser(user, itemId)
  const id = itemBoardId(item.id)
  const result = await boards().claim(id, current => {
    if (current) return null
    const now = new Date().toISOString()
    return {
      id, client_id: item.client_id, parent_board_id: null, item_id: item.id,
      name: item.title || 'Work board', icon: 'folder', colour: 'blue',
      created_by: user.id, created_at: now, updated_at: now,
    } as Board
  })
  if (result.claimed) return result.row
  if (result.current) return result.current
  throw new AuthzError('The board could not be made — try again', 500)
}

export async function renameBoard(user: TeamUser, boardId: string, patch: { name?: unknown; icon?: unknown; colour?: unknown }): Promise<Board> {
  assertTeam(user)
  const board = await loadBoardForUser(user, boardId)
  const v = validateBoard({ name: patch.name ?? board.name, icon: patch.icon ?? board.icon, colour: patch.colour ?? board.colour })
  if (!v.ok) throw new AuthzError(v.reason, 400)
  const result = await boards().claim(boardId, current => current ? { ...current, name: v.name, icon: v.icon, colour: v.colour } : null)
  if (!result.claimed) throw new AuthzError('That board is not here any more', 404)
  // the tile on the parent canvas carries the same name and colour
  if (board.parent_board_id) {
    const tiles = await items().list({ by: { board_id: board.parent_board_id }, where: r => r.child_board_id === boardId })
    for (const t of tiles) await items().update(t.id, { label: v.name, colour: v.colour })
  }
  return result.row
}

/** A board, everything on it, every board inside it, and the tile that
 *  pointed at it. Account managers and up: this is a lot to lose. */
export async function deleteBoard(user: TeamUser, boardId: string): Promise<void> {
  if (user.role !== 'account_manager' && user.role !== 'super_admin') {
    throw new AuthzError('Ask your account manager to delete a board', 403)
  }
  const board = await loadBoardForUser(user, boardId)
  const all = await boards().list({ by: { client_id: board.client_id } })
  const ids = [boardId, ...descendantBoardIds(boardId, all)]
  for (const id of ids) {
    await items().removeWhere(r => r.board_id === id)
    await comments().removeWhere(r => r.board_id === id)
    await boards().remove(id)
  }
  if (board.parent_board_id) {
    await items().removeWhere(r => r.board_id === board.parent_board_id && r.child_board_id === boardId)
  }
}

/* ── items ──────────────────────────────────────────────────────────────── */

export async function addItem(user: TeamUser, boardId: string, input: Record<string, unknown>): Promise<BoardItem> {
  assertTeam(user)
  const board = await loadBoardForUser(user, boardId)
  if (input.kind === 'board') {
    throw new AuthzError('Make a board with the New board button — it puts the tile here for you', 400)
  }
  const v = validateItem({ kind: input.kind, ...input })
  if (!v.ok) throw new AuthzError(v.reason, 400)
  const existing = await items().list({ by: { board_id: board.id } })
  if (v.item.parent_item_id && !existing.some(i => i.id === v.item.parent_item_id && i.kind === 'column')) {
    v.item.parent_item_id = null
  }
  const z = placeNew(v.item.kind, v.item, existing).z
  const row = await items().insert({
    board_id: board.id, ...v.item, z, created_by: user.id,
  } as Omit<BoardItem, 'id'>)
  if (row.parent_item_id) await restack(row.parent_item_id, board.id)
  return row
}

/**
 * Move, resize, recolour or rewrite one item. The write is a claim on the
 * row: the patch is applied to the row AS IT IS at write time, so a move
 * arriving while somebody else finished typing keeps their words.
 */
export async function patchItem(
  user: TeamUser, boardId: string, itemId: string, patch: Record<string, unknown>,
): Promise<BoardItem> {
  assertTeam(user)
  const board = await loadBoardForUser(user, boardId)
  const before = await items().get(itemId)
  if (!before || before.board_id !== board.id) throw new AuthzError('That item is not on this board any more', 404)
  const v = validatePatch(before as CanvasItem, patch)
  if (!v.ok) throw new AuthzError(v.reason, 400)
  if (v.patch.parent_item_id) {
    const col = await items().get(v.patch.parent_item_id)
    if (!col || col.board_id !== board.id || col.kind !== 'column') v.patch.parent_item_id = null
  }
  const result = await items().claim(itemId, current => {
    if (!current || current.board_id !== board.id) return null
    return { ...current, ...(v.patch as Partial<BoardItem>) }
  })
  if (!result.claimed) throw new AuthzError('That item is not on this board any more', 404)
  const row = result.row
  // moving a column carries its stack; dropping into a column restacks it;
  // leaving one restacks what stayed
  if (row.kind === 'column' && ('x' in v.patch || 'y' in v.patch || 'w' in v.patch)) {
    await restack(row.id, board.id)
  } else {
    if (row.parent_item_id) await restack(row.parent_item_id, board.id)
    if (before.parent_item_id && before.parent_item_id !== row.parent_item_id) await restack(before.parent_item_id, board.id)
  }
  return row
}

/** Lay a column's members out again, writing only what moved. */
async function restack(columnId: string, boardId: string): Promise<void> {
  const rows = await items().list({ by: { board_id: boardId }, fresh: true })
  const column = rows.find(r => r.id === columnId && r.kind === 'column')
  if (!column) return
  const members = itemsInColumn(column, rows as CanvasItem[])
  const laid = stackInColumn(column as CanvasItem, members)
  for (const p of laid.items) {
    const { id, ...rest } = p
    await items().update(id, rest as Partial<BoardItem>)
  }
  if (laid.column.h != null) await items().update(column.id, { h: laid.column.h })
}

/** Take an item off the canvas. A board tile takes its board with it. */
export async function removeItem(user: TeamUser, boardId: string, itemId: string): Promise<void> {
  assertTeam(user)
  const board = await loadBoardForUser(user, boardId)
  const row = await items().get(itemId)
  if (!row || row.board_id !== board.id) return
  if (row.kind === 'board' && row.child_board_id) {
    await deleteBoard(user, row.child_board_id)
    return
  }
  if (row.kind === 'column') {
    // what was in it stays on the canvas, free
    const members = await items().list({ by: { board_id: board.id }, where: r => r.parent_item_id === itemId })
    for (const m of members) await items().update(m.id, { parent_item_id: null })
  }
  await items().remove(itemId)
  await comments().removeWhere(c => c.item_id === itemId)
  if (row.parent_item_id) await restack(row.parent_item_id, board.id)
}

/* ── errors ─────────────────────────────────────────────────────────────── */

export function boardErrorResponse(e: unknown): NextResponse {
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}
