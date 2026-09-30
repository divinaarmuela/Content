import { describe, expect, it } from 'vitest'
import { AUTO_PREFIX, crmCounts, crmFilter, readAutomationTouches, withAutomationTouches, type CrmRow } from '../app/lib/people-crm-core'

// the owner, 29–30 Sep 2026: "tracking data in the followers page … which trigger, clicked" · "there is no CRM part
// for the automation data". The shapes below are Zernio's, copied from the 100M test automation's live log.
const ACCOUNT = '6aa8a054726ebfe037ee7def'
const LIST = { automations: [
  { id: 'a1', accountId: ACCOUNT, postTitle: 'E2E Reel', keywords: ['LINK'] },
  { id: 'other', accountId: 'someone-else', postTitle: 'Not ours', keywords: ['X'] },
] }
const LOGS = { a1: { logs: [
  { commenterName: 'crestlineconsultants', commentText: 'LINK', status: 'sent', error: null, clickedAt: '2026-09-29T08:53:24.502Z', clickCount: 2, createdAt: '2026-09-29T08:50:47.328Z' },
  { commenterName: 'lxuuryybuilds', commentText: 'Link', status: 'skipped', error: 'Already sent DM to this commenter', clickedAt: null, clickCount: 0, createdAt: '2026-09-29T08:49:48.404Z' },
  { commenterName: 'yusuf.munshi.52035', commentText: 'MDTEST7421', status: 'failed', error: 'Permission denied.', clickedAt: null, clickCount: 0, createdAt: '2026-09-29T12:07:33.218Z' },
] }, other: { logs: [{ commenterName: 'nope', commentText: 'X', status: 'sent', createdAt: '2026-09-29T01:00:00Z' }] } }

const existing: CrmRow = {
  key: 'crestlineconsultants', username: 'crestlineconsultants', full_name: 'Crestline', profile_pic: null,
  profile_href: 'x', inbox_href: '/dashboard/social/inbox?who=crestlineconsultants', status: 'follower', from_post: null,
  first_seen: '2026-09-20', last_active: '2026-09-20', likes: 0, comments: 0, dmed: false, following: true, md_lead: null,
  auto_dms: 0, auto_clicks: 0, timeline: [{ what: 'Started following', detail: null, day: '2026-09-20', href: null, link: null, tone: 'strong' }],
}

describe('automation touches on the People page', () => {
  const touches = readAutomationTouches(LIST, LOGS, new Set([ACCOUNT]))
  it('reads only this client’s automations, one touch per logged comment', () => {
    expect(touches.map(t => t.username)).toEqual(['crestlineconsultants', 'lxuuryybuilds', 'yusuf.munshi.52035'])
    expect(touches[0]).toMatchObject({ outcome: 'sent', clicks: 2, post: 'E2E Reel', keyword: 'LINK' })
  })
  const rows = withAutomationTouches([existing], touches)
  const crest = rows.find(r => r.key === 'crestlineconsultants')!
  it('adds the comment, the DM and the clicks to the person already on the list', () => {
    expect(crest.auto_dms).toBe(1)
    expect(crest.auto_clicks).toBe(2)
    expect(crest.timeline.map(e => e.what)).toEqual([
      `${AUTO_PREFIX}clicked the button ×2`, `${AUTO_PREFIX}DM sent`, `${AUTO_PREFIX}commented “LINK”`, 'Started following',
    ])
    expect(crest.last_active).toBe('2026-09-29')
    expect(crest.timeline.find(e => e.what === `${AUTO_PREFIX}DM sent`)?.link).toBe('View DM')
  })
  it('a commenter not seen before gets a row; a failure says why; a skip is not a DM', () => {
    const yusuf = rows.find(r => r.key === 'yusuf.munshi.52035')!
    expect(yusuf.timeline.find(e => e.what === `${AUTO_PREFIX}DM failed`)?.detail).toBe('Permission denied.')
    expect(yusuf.auto_dms).toBe(0)
    expect(rows.find(r => r.key === 'lxuuryybuilds')!.auto_dms).toBe(0)
  })
  it('the filter and the counts see them; nothing claims "read" per person', () => {
    expect(crmFilter(rows, 'automation').map(r => r.key).sort()).toEqual(['crestlineconsultants', 'lxuuryybuilds', 'yusuf.munshi.52035'])
    expect(crmCounts(rows)).toMatchObject({ auto_dms: 1, auto_clicked: 1 })
    expect(JSON.stringify(rows)).not.toMatch(/read|delivered/i)
  })
})
