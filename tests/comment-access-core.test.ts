import { describe, expect, it } from 'vitest'
import { visibleComments, type VisibilityComment } from '../app/lib/comment-access-core'

const AM = 'am-1'
const AM2 = 'am-2'
const EDITOR = 'editor-1'
const SCHEDULER = 'sched-1'

const c = (
  id: string,
  author_id: string | null,
  extra: Partial<VisibilityComment> = {},
): VisibilityComment => ({
  id, author_id, visibility: 'internal', assigned_to: null, parent_id: null, ...extra,
})

describe('visibleComments', () => {
  it('a client sees only client-visible rows', () => {
    const rows = [c('1', AM), c('2', AM, { visibility: 'client' })]
    expect(visibleComments('client', 'client-1', rows).map(r => r.id)).toEqual(['2'])
  })

  it('managers and super admins see the whole record', () => {
    const rows = [c('1', AM), c('2', EDITOR), c('3', AM, { visibility: 'client' })]
    expect(visibleComments('account_manager', AM, rows)).toHaveLength(3)
    expect(visibleComments('super_admin', 'sa-1', rows)).toHaveLength(3)
  })

  it('an editor sees a comment tagged to them', () => {
    const rows = [c('1', AM, { assigned_to: EDITOR }), c('2', AM)]
    expect(visibleComments('editor', EDITOR, rows).map(r => r.id)).toEqual(['1'])
  })

  it('an editor never sees manager-to-manager chat', () => {
    // the classic leak: the AM who assigned the job muses to another manager
    const rows = [c('1', AM), c('2', AM2), c('3', AM, { assigned_to: EDITOR })]
    expect(visibleComments('editor', EDITOR, rows).map(r => r.id)).toEqual(['3'])
  })

  it('keeps the whole conversation once the viewer is in it', () => {
    const rows = [
      c('1', AM, { assigned_to: EDITOR }),   // tagged in
      c('2', EDITOR, { parent_id: '1' }),    // their reply
      c('3', AM, { parent_id: '1' }),        // manager's untagged reply — still theirs to read
      c('4', AM2),                           // unrelated thread
    ]
    expect(visibleComments('editor', EDITOR, rows).map(r => r.id)).toEqual(['1', '2', '3'])
  })

  it('a reply the viewer wrote pulls in the rest of that thread', () => {
    const rows = [
      c('1', AM),                             // root they were never tagged in…
      c('2', SCHEDULER, { parent_id: '1' }),  // …but answered
      c('3', AM, { parent_id: '1' }),
      c('4', AM2),
    ]
    expect(visibleComments('scheduler', SCHEDULER, rows).map(r => r.id)).toEqual(['1', '2', '3'])
  })

  it('client rows never reach an editor or scheduler, even tagged', () => {
    const rows = [c('1', AM, { visibility: 'client', assigned_to: EDITOR })]
    expect(visibleComments('editor', EDITOR, rows)).toEqual([])
    expect(visibleComments('scheduler', SCHEDULER, rows)).toEqual([])
  })

  it('an untouched thread stays invisible to both working roles', () => {
    const rows = [c('1', AM), c('2', AM2, { parent_id: '1' })]
    expect(visibleComments('editor', EDITOR, rows)).toEqual([])
    expect(visibleComments('scheduler', SCHEDULER, rows)).toEqual([])
  })
})
