import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeCardActivity, historyLines, type HistoryActivity } from '../app/lib/card-history-core'

/**
 * A CLIP'S TICK ON "WHAT HAPPENED" (the owner, 22 Sep 2026: Laura's eight
 * approvals on The Glass Den's card were in the database and not on the
 * card — "what time", "what version was approved and name of the clip",
 * "ensure there is a hyperlink for that").
 */
const row = (over: Partial<HistoryActivity>): HistoryActivity => ({
  id: 'r1', created_at: '2026-09-22T04:53:54.000Z', action: 'clip_approved', actor_name: 'The Glass Den (client portal)', ...over,
})
const files = [
  { id: 'f_old3', name: 'Glass_Den 3.mov', version: 1 },
  { id: 'f_new3', name: 'Glass_Den 3.mov', version: 2 },
  { id: 'f_why', name: 'GLASS DEN - WHY YOU....mov', version: 2 },
]
const approvals = [{ file_id: 'f_new3', name: 'Glass_Den 3.mov', at: '2026-09-22T04:53:53.900Z' }]
const ctx = { itemId: 'item1', files, approvals }

describe('a clip approved, in the card’s words', () => {
  it('a row written today: who, the clip, the version, and a link to the clip', () => {
    const said = describeCardActivity(row({ new_value: 'f_new3', detail: 'Glass_Den 3.mov approved by Laura (The Glass Den) · Version 2 from 120.158.133.140' }), ctx)!
    expect(said.text).toBe('Laura (The Glass Den) approved Glass_Den 3.mov · Version 2')
    expect(said.href).toBe('/dashboard/editor/item1/video/f_new3?name=Glass_Den%203.mov')
    expect(said.hrefWord).toBe('Open the clip')
  })
  it('an older row, which named the clip only: the file is found among the ticks by name and time, the version from the files, and the address is never shown', () => {
    const said = describeCardActivity(row({ detail: 'Glass_Den 3.mov approved by Laura (The Glass Den) from 120.158.133.140' }), ctx)!
    expect(said.text).toBe('Laura (The Glass Den) approved Glass_Den 3.mov · Version 2')
    expect(said.text).not.toContain('120.158')
    expect(said.href).toBe('/dashboard/editor/item1/video/f_new3?name=Glass_Den%203.mov')
  })
  it('a tick the team made on the client’s behalf, and one taken back', () => {
    expect(describeCardActivity(row({ actor_name: 'Akmal', new_value: 'f_why', detail: "GLASS DEN - WHY YOU....mov marked approved on the client's behalf · Version 2" }), ctx)!.text)
      .toBe("Akmal marked GLASS DEN - WHY YOU....mov approved on the client's behalf · Version 2")
    const undone = describeCardActivity(row({ action: 'clip_unapproved', new_value: 'f_new3', detail: 'Glass_Den 3.mov — approval taken back by Laura from 1.2.3.4' }), ctx)!
    expect(undone.text).toBe('Laura took back the approval on Glass_Den 3.mov · Version 2')
    expect(undone.href).toBe('/dashboard/editor/item1/video/f_new3?name=Glass_Den%203.mov')
  })
  it('without the card at hand it still says who and which clip, with no link to nowhere', () => {
    const said = describeCardActivity(row({ detail: 'Glass_Den 3.mov approved by Laura (The Glass Den) from 1.2.3.4' }))!
    expect(said.text).toBe('Laura (The Glass Den) approved Glass_Den 3.mov')
    expect(said.href).toBeNull()
  })
  it('the list carries the link and its word', () => {
    const lines = historyLines({ activity: [row({ new_value: 'f_new3', detail: 'Glass_Den 3.mov approved by Laura (The Glass Den) · Version 2' })], ...ctx, fmt: s => s })
    expect(lines[0]).toMatchObject({ at: '2026-09-22T04:53:54.000Z', href: '/dashboard/editor/item1/video/f_new3?name=Glass_Den%203.mov', hrefWord: 'Open the clip' })
  })
  it('both routes write the file’s id and the version on the row; both pages hand the card over and draw the link', () => {
    expect(readFileSync('app/api/portal/clip/route.ts', 'utf8')).toContain('newValue: fileId,')
    expect(readFileSync('app/api/production/items/[id]/clip-approval/route.ts', 'utf8')).toContain('newValue: fileId,')
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain('itemId: id, files: finalFilesOf(item as never), approvals: clipApprovalsOf(item as never),')
    expect(drawer).toContain("{l.hrefWord ?? 'Live post'}")
    expect(readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')).toContain("{l.hrefWord ?? 'Live post'}")
  })
})
