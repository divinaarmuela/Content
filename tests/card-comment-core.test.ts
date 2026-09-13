import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cardPathForRole, noteAudience, noteSubject } from '../app/lib/card-comment-core'

/**
 * CARD COMMENTS, BOTH WAYS (13 Sep 2026). The owner: "make sure every chat
 * place in the editor card reply's the AM gets the notification and editor
 * scheduler gets notification. currently there is no same tab chat for
 * editor." The rule as built: a team note on a card reaches its holder(s),
 * the client's account managers and the super admin who created the card,
 * never the author, never twice — and the link opens the board that person
 * actually has.
 */

describe('the audience of a note on a card', () => {
  it('an editor writes → the AMs and the super-admin creator hear, not the editor', () => {
    expect(noteAudience({
      authorId: 'ed', ownerId: 'ed', schedulerIds: [], managerIds: ['am1', 'am2'],
      creatorId: 'sa', creatorIsSuperAdmin: true, taggedIds: [],
    })).toEqual(['am1', 'am2', 'sa'])
  })

  it('an AM writes → the editor holding the card and the schedulers hear, not the AM', () => {
    expect(noteAudience({
      authorId: 'am1', ownerId: 'ed', schedulerIds: ['sc'], managerIds: ['am1'],
      creatorId: 'am1', creatorIsSuperAdmin: false,
    })).toEqual(['ed', 'sc'])
  })

  it('somebody already tagged is not told twice; the creator only counts when a super admin', () => {
    expect(noteAudience({
      authorId: 'ed', ownerId: 'ed', managerIds: ['am1'], taggedIds: ['am1'],
      creatorId: 'gen', creatorIsSuperAdmin: false,
    })).toEqual([])
  })

  it('never repeats an id', () => {
    expect(noteAudience({ authorId: 'x', ownerId: 'sc', schedulerIds: ['sc'], managerIds: ['sc'] })).toEqual(['sc'])
  })
})

describe('the link opens the board that role has', () => {
  it('editor → the Editor board; everyone else → the Post approval board', () => {
    expect(cardPathForRole('editor', 'c1')).toBe('/dashboard/editor?card=c1')
    for (const r of ['scheduler', 'account_manager', 'super_admin', 'quality_checker', 'general', undefined]) {
      expect(cardPathForRole(r, 'c1')).toBe('/dashboard/scheduler?card=c1')
    }
  })

  it('nobody is sent to the retired full-card page any more', () => {
    for (const p of ['app/api/production/items/[id]/comments/route.ts', 'app/lib/comment-tags.ts']) {
      const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
      expect(src).not.toMatch(/dashboard\/production\/\$\{/)
      expect(src).not.toMatch(/itemPath\(/)
    }
  })
})

describe('the subject says who wrote what', () => {
  it('quotes the note, cut at 120 characters', () => {
    expect(noteSubject('Karly', 'Reel 3', 'can you trim the intro')).toBe('Karly wrote on Reel 3: “can you trim the intro”')
    expect(noteSubject('Karly', 'Reel 3', 'x'.repeat(200))).toMatch(/x{120}…”$/)
  })
})

describe('the editor drawer and the board card carry the thread (source pins)', () => {
  it('the editor drawer has a Comments section that writes to the account manager', () => {
    const src = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    // ONE comments section, drawn by the same component on both drawers (the
    // owner, 13 Sep 2026: "make them the same UI")
    expect(src).toMatch(/<CardSaid/)
    expect(readFileSync('app/dashboard/board/PostApprovalDetail.tsx', 'utf8')).toMatch(/<CardSaid/)
    expect(readFileSync('app/dashboard/board/CardSaid.tsx', 'utf8')).toMatch(/What was said/)
    expect(src).toMatch(/visibleComments\(/)
    expect(src).toMatch(/\/api\/production\/items\/\$\{item\.id\}\/comments/)
    expect(src).toMatch(/assigned_to: first\.id/)
    expect(src).toMatch(/Write to the account manager/)
  })

  it('the board card shows "New for you" when a note is open for the viewer', () => {
    const src = readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')
    expect(src).toMatch(/my_open_task === true/)
    expect(src).toMatch(/New for you/)
  })
})
