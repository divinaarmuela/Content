import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ANCHOR_GONE, checkAnchor, markQuotes, planPartText, planThreads, threadsOn } from '../app/lib/plan-comments-core'
import { forTheClient } from '../app/lib/comment-visibility-core'

// 29 Oct 2026, the owner with a video of Google Docs: select words of the plan and comment on exactly those
const plan = {
  objective: 'Show the new studio  and the classes',
  planned_deliverables: [{ id: 'd1', title: '3 reels for November' }],
  shot_list: [{ id: 's1', text: 'Wide of the reformer room', done: false }],
  scripts: [{ id: 'k1', title: 'Hook video', body: 'Ever wondered why your back aches?\nWe fix that.' }],
}

describe('the parts and their words', () => {
  it('reads each part as written', () => {
    expect(planPartText(plan, 'deliverable:d1')).toBe('3 reels for November')
    expect(planPartText(plan, 'shot:s1')).toBe('Wide of the reformer room')
    expect(planPartText(plan, 'script:k1')).toContain('Ever wondered why your back aches?')
    expect(planPartText(plan, 'nonsense')).toBeNull()
    expect(planPartText(plan, 'shot:nope')).toBeNull()
  })
  it('a comment is only on words still in that part — spaces and case loosely', () => {
    expect(checkAnchor(plan, 'objective', 'new studio and the')).toEqual({ ok: true, part: 'objective', quote: 'new studio and the' })
    expect(checkAnchor(plan, 'script:k1', 'WHY YOUR BACK')).toMatchObject({ ok: true })
    expect(checkAnchor(plan, 'shot:s1', 'kitchen')).toEqual({ ok: false, error: ANCHOR_GONE })
    expect(checkAnchor(plan, null, null)).toBeNull()
    expect(checkAnchor(plan, 'objective', '')).toMatchObject({ ok: false })
  })
})

describe('the words lit up', () => {
  it('marks each comment’s words where they stand, and leaves the rest plain', () => {
    const out = markQuotes('Show the new studio  and the classes', [{ id: 'c1', quote: 'new studio and' }])
    expect(out).toEqual([{ text: 'Show the ', ids: [] }, { text: 'new studio  and', ids: ['c1'] }, { text: ' the classes', ids: [] }])
    expect(markQuotes('nothing here', [{ id: 'c1', quote: 'gone words' }])).toEqual([{ text: 'nothing here', ids: [] }])
  })
})

describe('threads', () => {
  const rows = [
    { id: 'a', created_at: '2026-10-29T01:00:00Z', body: 'Change this', anchor_part: 'shot:s1', anchor_quote: 'reformer', resolved: false },
    { id: 'b', created_at: '2026-10-29T02:00:00Z', body: 'Done', parent_id: 'a' },
    { id: 'c', created_at: '2026-10-29T00:30:00Z', body: 'Old', anchor_part: 'shot:s1', anchor_quote: 'Wide', resolved: true },
    { id: 'g', created_at: '2026-10-29T00:00:00Z', body: 'General thread' },
  ]
  it('a reply under its first comment; open first; the general thread is not a plan thread', () => {
    const t = planThreads(rows)
    expect(t.map(x => x.root.id)).toEqual(['a', 'c'])
    expect(t[0].replies.map(r => r.id)).toEqual(['b'])
    expect(threadsOn(t, 'shot:s1').length).toBe(2)
    expect(threadsOn(t, 'objective').length).toBe(0)
  })
})

describe('who sees what', () => {
  const client = { role: 'client' }, team = { role: 'account_manager' }
  it('the client sees their own comments on the words and the team’s replies to them — not the team’s own notes', () => {
    const rows = [
      { id: 'r1', anchor_part: 'shot:s1', team_users: client, body: 'Can we…' },
      { id: 'r2', parent_id: 'r1', team_users: team, body: 'Yes, done' },
      { id: 'r3', parent_id: 'r1', team_users: team, body: '@Karly check this', assigned_to: 'k' },
      { id: 'r4', anchor_part: 'objective', team_users: team, body: 'Internal: tighten this' },
      { id: 'r5', parent_id: 'r4', team_users: team, body: 'agreed' },
    ]
    expect(forTheClient(rows as never[]).map((r: { id: string }) => r.id)).toEqual(['r1', 'r2'])
  })
})

describe('the doors', () => {
  it('the portal checks the words, answers only threads the client can see, and lets them resolve their own', () => {
    const s = readFileSync('app/api/portal/comment/route.ts', 'utf8')
    expect(s).toContain("const anchor = checkAnchor(batch as never, body.anchor_part ?? null, body.anchor_quote ?? null)")
    expect(s).toContain("if (kind === 'shoot' && body.action === 'resolve') {")
    expect(s).toContain('!clientMaySee(withRole as never)')
  })
  it('the team’s route checks the words too, and the general threads leave the plan’s comments out', () => {
    expect(readFileSync('app/api/production/batches/[id]/comments/route.ts', 'utf8')).toContain('const anchor = checkAnchor(g.batch as never, json.anchor_part ?? null, json.anchor_quote ?? null)')
    expect(readFileSync('app/dashboard/production/shoots/[id]/BriefComments.tsx', 'utf8')).toContain('!c.anchor_part && !c.parent_id')
    expect(readFileSync('app/lib/portal-thread.ts', 'utf8')).toContain('.filter(r => !r.anchor_part && !r.parent_id)')
  })
  it('the portal’s plan and the team’s boxes draw the parts and their threads', () => {
    const pb = readFileSync('app/components/portal/PortalBoard.tsx', 'utf8')
    expect(pb).toContain('<PlanPart as="span" part={`shot:${r.id}`} text={r.text} />')
    expect(pb).toContain('<PlanPartThreads part={part} />')
    const sop = readFileSync('app/dashboard/production/shoots/[id]/ShootSop.tsx', 'utf8')
    expect(sop).toContain('onSelect={pick(`shot:${shot.id}`)}')
    expect(readFileSync('app/dashboard/production/shoots/[id]/page.tsx', 'utf8')).toContain('<TeamPlanComments batchId={batch.id}>')
  })
})

describe('a client’s comment emails only who it may', () => {
  it('says which client it is about, so a test client’s shoot comment never reaches a real person', () => {
    const s = readFileSync('app/lib/portal-actor.ts', 'utf8')
    expect(s).toContain('clientId: opts.clientId,')
  })
})
