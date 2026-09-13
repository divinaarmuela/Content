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

  it('an editor and a scheduler read EVERY team note on a card they can open (the owner, 14 Sep 2026)', () => {
    // "I'm the AM, I typed hi Akmal — the editor got the notification but did
    // not see the comment": a team note tags nobody, and it is still theirs
    const rows = [c('1', AM), c('2', AM2), c('3', AM, { assigned_to: EDITOR }), c('4', EDITOR, { parent_id: '3' })]
    expect(visibleComments('editor', EDITOR, rows).map(r => r.id)).toEqual(['1', '2', '3', '4'])
    expect(visibleComments('scheduler', SCHEDULER, rows).map(r => r.id)).toEqual(['1', '2', '3', '4'])
  })

  it('client rows never reach an editor or scheduler, even tagged', () => {
    const rows = [c('1', AM, { visibility: 'client', assigned_to: EDITOR })]
    expect(visibleComments('editor', EDITOR, rows)).toEqual([])
    expect(visibleComments('scheduler', SCHEDULER, rows)).toEqual([])
  })

  it('only the client’s own rows are kept from the working roles', () => {
    const rows = [c('1', AM), c('2', AM2, { parent_id: '1' }), c('3', AM, { visibility: 'client' })]
    expect(visibleComments('editor', EDITOR, rows).map(r => r.id)).toEqual(['1', '2'])
    expect(visibleComments('scheduler', SCHEDULER, rows).map(r => r.id)).toEqual(['1', '2'])
  })
})
