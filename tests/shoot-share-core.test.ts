import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isShootShareToken, sharedShoot, shootSharePath, type SharedCommentRow } from '../app/lib/shoot-share-core'

/**
 * A SHOOT'S LINK FOR THE TEAM, NO SIGN-IN (the owner, 23 Nov 2026: "we need a public available link for this … this is
 * not a client portal"). What is pinned: the token's shape, that every comment lands beside what it was made on, and
 * that the page it opens cannot change anything and is not the client's.
 */

const batch = {
  title: 'StretchWorks November Shoot Plan',
  objective: '8 videos for November',
  concept: 'Script 1: desk workers',
  shoot_date: '2026-11-09',
  scripts: [
    { id: 'aaa111', title: 'Sitting all day', body: 'Line one.\n\nLine two.' },
    { id: 'bbb222', title: 'How heavy is your head', body: 'Your head has a natural weight.' },
  ],
  canvas_cards: [],
}

const rows: SharedCommentRow[] = [
  { id: 'c1', body: 'Would prefer not adding in exact numbers', created_at: '2026-10-30T01:08:00Z', anchor_part: 'script:bbb222', anchor_quote: '27 kilos', resolved: true, author_name: 'Stretchworks (client portal)', author_role: 'client' },
  { id: 'c2', body: 'the comments made.', created_at: '2026-10-30T01:30:00Z', author_name: 'Stretchworks (client portal)', author_role: 'client' },
  { id: 'c3', body: 'Understood, changed.', created_at: '2026-11-04T06:29:00Z', parent_id: 'c2', author_name: 'Manal Rizwan', author_role: 'account_manager' },
  { id: 'c4', body: 'Tighten this', created_at: '2026-11-05T00:00:00Z', anchor_part: 'objective', anchor_quote: '8 videos', author_name: 'Manal Rizwan', author_role: 'account_manager' },
]

describe('the link', () => {
  it('is 32 hex characters and nothing else', () => {
    expect(isShootShareToken('0123456789abcdef0123456789abcdef')).toBe(true)
    for (const bad of ['', 'abc', '0123456789ABCDEF0123456789ABCDEF', '0123456789abcdef0123456789abcde/', null, 42]) expect(isShootShareToken(bad)).toBe(false)
  })
  it('opens its own page, not the client portal and not the dashboard', () => {
    expect(shootSharePath('0123456789abcdef0123456789abcdef')).toBe('/shoot-plan/0123456789abcdef0123456789abcdef')
  })
})

describe('what the page holds', () => {
  const s = sharedShoot(batch as never, 'Stretchworks', rows)
  it('the title, the client and the brief', () => {
    expect(s.title).toBe('StretchWorks November Shoot Plan')
    expect(s.client).toBe('Stretchworks')
    expect(s.parts.find(p => p.label === 'Objective')?.value).toBe('8 videos for November')
    expect(s.notes).toBe('Script 1: desk workers')
  })
  it('each script on its own, with the comments made on its words and the words they were made on', () => {
    expect(s.scripts.map(x => x.heading)).toEqual(['Script 1 · Sitting all day', 'Script 2 · How heavy is your head'])
    expect(s.scripts[0].comments).toEqual([])
    expect(s.scripts[1].comments).toHaveLength(1)
    expect(s.scripts[1].comments[0]).toMatchObject({ quote: '27 kilos', who: 'Stretchworks', fromClient: true, resolved: true })
    // the scripts are not also dumped into the brief's grid
    expect(s.parts.some(p => /^script/i.test(p.label))).toBe(false)
  })
  it('a resolved comment is still shown: the page is where an editor reads what was asked', () => {
    expect(s.scripts[1].comments[0].resolved).toBe(true)
  })
  it('a comment on other words of the plan says what it is on', () => {
    expect(s.onThePlan).toHaveLength(1)
    expect(s.onThePlan[0]).toMatchObject({ on: 'the objective', quote: '8 videos', who: 'Manal Rizwan', fromClient: false })
  })
  it('the rest of the thread, each with its replies under it', () => {
    expect(s.general).toHaveLength(1)
    expect(s.general[0].body).toBe('the comments made.')
    expect(s.general[0].replies).toEqual([{ id: 'c3', body: 'Understood, changed.', at: '2026-11-04T06:29:00Z', who: 'Manal Rizwan', fromClient: false }])
  })
  it('a shoot with no scripts keeps its talking points in the brief', () => {
    const plain = sharedShoot({ title: 'T', script: 'Point one' } as never, null, [])
    expect(plain.scripts).toEqual([])
    expect(plain.parts.some(p => /^script/i.test(p.label))).toBe(true)
  })
})

describe('wired through (source pins)', () => {
  const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  it('the page is open to anybody holding the link, and only the making of the link needs a sign-in', () => {
    const mw = read('middleware.ts')
    expect(mw).not.toContain("'/shoot-plan")
    expect(mw).toContain("'/api/production(.*)'")
    const route = read('app/api/production/batches/[id]/team-link/route.ts')
    expect(route).toContain("await requireRole('scheduler')")
    expect(route).toContain("user.role === 'editor' || user.role === 'scheduler' || (await canOpenBatch(user, batch as never))")
  })
  it('one link per shoot, made by a claim, and switching it off clears it', () => {
    const route = read('app/api/production/batches/[id]/team-link/route.ts')
    expect(route).toContain("await table<Batch>('batches').claim(id, cur => {")
    expect(route).toContain('{ team_share_token: null }')
  })
  it('the page reads and never writes, changes nothing on the board, and is not offered to search engines', () => {
    const lib = read('app/lib/shoot-share.ts')
    expect(lib).not.toMatch(/\.(update|insert|upsert|claim|remove|delete)\(/)
    expect(read('app/shoot-plan/[token]/SharedBoard.tsx')).toContain('canEdit={false} clientName={clientName} onOp={async () => false}')
    expect(read('app/shoot-plan/[token]/page.tsx')).toContain('robots: { index: false, follow: false }')
    const view = read('app/shoot-plan/[token]/SharedShootView.tsx')
    expect(view).not.toMatch(/<(input|textarea|form|section)\b/)
    expect(view).not.toContain('/dashboard')
    expect(view).toContain('Please do not forward it to the client.')
    // every address in the plan, the scripts and the comments opens in a new tab (23 Nov 2026), built as elements
    expect(view).toContain('target="_blank" rel="noopener noreferrer"')
    expect(view.match(/<Linked text=/g)).toHaveLength(5)
    expect(view).not.toContain('dangerouslySetInnerHTML')
  })
  it('the shoot page has the button, where the editor’s card is', () => {
    const now = read('app/dashboard/production/shoots/[id]/ShootNow.tsx')
    expect(now).toContain('<TeamLinkRow batchId={batch.id}')
    expect(now).toContain('Copy link')
    expect(now).toContain('Switch the link off')
    expect(now.indexOf('Editor’s card')).toBeLessThan(now.indexOf('<TeamLinkRow batchId'))
  })
})
