import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BEING_APPROVED, SCHEDULE_STAGES, binAction, isStory, matchesListFilter, moveBlockReason, networkLines,
  previewPosts, scheduleCounts, scheduleFacts, showsOnSchedule,
} from '@/app/lib/schedule-stage-core'
import {
  MISSED_LABEL, STAGE_LABEL, STAGE_TONE, readPostState, type AccountRef, type PostState,
} from '@/app/lib/post-stage-core'

/**
 * THE SCHEDULE PAGE, REBUILT ON THE STAGE (posting rebuild, package P4,
 * 29 Sep 2026). Every case here is one of the audit's schedule findings
 * (docs/posting-rebuild/AUDIT_EVIDENCE.md, S1–S15) or the owner's decision 1:
 * Schedule gets approved posts out and approves nothing.
 */

const NOW = '2026-10-01T00:00:00.000Z'
const IN_2H = '2026-10-01T02:00:00.000Z'
const IN_10M = '2026-10-01T00:10:00.000Z'

const ACCOUNTS: AccountRef[] = [
  { id: 'ig', platform: 'instagram', live: true },
  { id: 'li', platform: 'linkedin', live: true },
  { id: 'tt', platform: 'tiktok', live: true },
]

function post(over: Record<string, unknown> = {}): PostState {
  const s = readPostState({
    id: 'p1', client_id: 'c1', created_by: 'maker', stage: 'ready', rev: 3,
    stage_at: '2026-09-30T00:00:00.000Z', draft_version: 2, sent_version: 1,
    scheduled_for: IN_2H, channels: ['ig', 'li'], slides: [{ url: 'https://x/a.jpg', name: 'a.jpg', type: 'image' }],
    caption: 'Hello', per_channel: {},
    approval: { version: 1, by: 'joy', hat: 'quality_reviewer', at: NOW },
    qc_pass: { version: 1, by: 'joy', at: NOW },
    ...over,
  })
  if (!s) throw new Error('bad fixture')
  return s
}

describe('which posts the calendar draws (the owner’s decision 1)', () => {
  it('draws Ready to post, Booked in and Posted — nothing that is still being approved', () => {
    expect([...SCHEDULE_STAGES]).toEqual(['ready', 'booked', 'posted'])
    for (const s of ['draft', 'quality_check', 'with_client', 'cancelled'] as const) expect(showsOnSchedule(s), s).toBe(false)
    expect([...BEING_APPROVED]).toEqual(['draft', 'quality_check', 'with_client'])
  })
})

describe('what a tile says — the stage’s own words', () => {
  it('Ready to post, in its stage colour', () => {
    const f = scheduleFacts(post(), ACCOUNTS, NOW)
    expect(f.label).toBe(STAGE_LABEL.ready)
    expect(f.tone).toBe(STAGE_TONE.ready)
    expect(f.missed).toBe(false)
    expect(f.alert).toBeNull()
    expect(f.networks).toEqual([])
  })

  it('a time missed while waiting reads "Missed — needs a new time", in red (decision 11)', () => {
    const f = scheduleFacts(post({ scheduled_for: IN_10M }), ACCOUNTS, NOW)
    expect(f.missed).toBe(true)
    expect(f.label).toBe(MISSED_LABEL)
    expect(f.tone).toBe('red')
  })

  it('reads the clock it is given, so a page that ticks shows the miss the minute it happens (audit S12)', () => {
    const p = post({ scheduled_for: '2026-10-01T00:30:00.000Z' })
    expect(scheduleFacts(p, ACCOUNTS, NOW).missed).toBe(false)
    expect(scheduleFacts(p, ACCOUNTS, '2026-10-01T00:16:00.000Z').missed).toBe(true)
  })

  it('a post live on some networks says "Posted on 1 of 2", in amber — never "Did not go out" (audit S7)', () => {
    const f = scheduleFacts(post({
      stage: 'posted',
      outcomes: { instagram: { status: 'published', url: 'https://ig/p/1' }, linkedin: { status: 'failed', error: 'Token expired' } },
      problem: 'Did not go out on LinkedIn.',
    }), ACCOUNTS, NOW)
    expect(f.label).toBe('Posted on 1 of 2 — LinkedIn did not go out')
    expect(f.label).not.toMatch(/^Did not go out/)
    expect(f.tone).toBe('amber')
    expect(f.partial).toBe(true)
    expect(f.networks.map(n => [n.network, n.label, n.url])).toEqual([
      ['Instagram', 'Went out', 'https://ig/p/1'],
      ['LinkedIn', 'Did not go out', null],
    ])
    expect(f.networks[1].error).toBe('Token expired')
  })

  it('a "duplicate" answer is gone out: the network says it is already live (audit S5)', () => {
    const f = scheduleFacts(post({
      stage: 'posted', channels: ['tt'],
      outcomes: { tiktok: { status: 'duplicate', url: null } },
    }), ACCOUNTS, NOW)
    expect(f.label).toBe(STAGE_LABEL.posted)
    expect(f.tone).toBe(STAGE_TONE.posted)
    expect(f.networks[0]).toMatchObject({ network: 'TikTok', tone: 'done' })
    expect(f.networks[0].label).toMatch(/^Went out/)
  })

  it('never says "scheduled" beside Posted: a network with no answer reads "No answer yet" (audit S15)', () => {
    const lines = networkLines(post({
      stage: 'posted',
      outcomes: { instagram: { status: 'published' }, linkedin: { status: 'scheduled' } },
    }), ACCOUNTS)
    expect(lines.map(l => l.label)).toEqual(['Went out', 'No answer yet'])
  })

  it('a booked post lists each network as Booked in until it answers', () => {
    const lines = networkLines(post({ stage: 'booked' }), ACCOUNTS)
    expect(lines.map(l => `${l.network}: ${l.label}`)).toEqual(['Instagram: Booked in', 'LinkedIn: Booked in'])
  })

  it('a lost channel is an alert on the tile, in red — not a hover title (audit S13)', () => {
    const f = scheduleFacts(post({ stage: 'booked' }), [
      { id: 'ig', platform: 'instagram', live: false }, { id: 'li', platform: 'linkedin', live: true },
    ], NOW)
    expect(f.alert).toMatch(/^Instagram is not connected/)
    expect(f.tone).toBe('red')
    // a channel that is gone entirely is named as well
    expect(scheduleFacts(post(), [{ id: 'li', platform: 'linkedin', live: true }], NOW).alert).toMatch(/not connected/)
  })

  it('why a post came back from the schedule is an alert too', () => {
    const f = scheduleFacts(post({ problem: 'Did not go out on Instagram and LinkedIn.' }), ACCOUNTS, NOW)
    expect(f.alert).toBe('Did not go out on Instagram and LinkedIn.')
    expect(f.tone).toBe('red')
  })

  it('a story is read per network, off the post — never off the edit card (audit S3)', () => {
    expect(isStory(post({ per_channel: { ig: { kind: 'story' } } }))).toBe(true)
    expect(isStory(post({ per_channel: { ig: { kind: 'feed' } } }))).toBe(false)
    // settings left by a channel that was taken off the post do not count
    expect(isStory(post({ channels: ['li'], per_channel: { ig: { kind: 'story' } } }))).toBe(false)
    expect(scheduleFacts(post({ per_channel: { ig: { kind: 'story' } } }), ACCOUNTS, NOW).story).toBe(true)
  })
})

describe('moving a tile is "Change time", as postActions offers it', () => {
  it('a scheduler, a manager or a super admin may move Ready to post and Booked in', () => {
    for (const hats of [['scheduler'], ['am'], ['sa']] as const) {
      expect(moveBlockReason(post(), hats, NOW), hats.join()).toBeNull()
      expect(moveBlockReason(post({ stage: 'booked' }), hats, NOW), hats.join()).toBeNull()
    }
  })

  it('a missed post can still be moved — that is how it gets a new time', () => {
    expect(moveBlockReason(post({ scheduled_for: IN_10M }), ['scheduler'], NOW)).toBeNull()
  })

  it('says why not, in plain words, for everything else', () => {
    expect(moveBlockReason(post({ stage: 'posted' }), ['sa'], NOW)).toMatch(/already gone out/)
    expect(moveBlockReason(post({ stage: 'cancelled' }), ['sa'], NOW)).toMatch(/Re-book/)
    expect(moveBlockReason(post({ stage: 'with_client' }), ['sa'], NOW)).toMatch(/Post approval/)
    expect(moveBlockReason(post(), ['qr'], NOW)).toMatch(/^Only a scheduler/)
    expect(moveBlockReason(post(), [], NOW)).toMatch(/^Only a scheduler/)
  })
})

describe('the bin is postActions’ danger action (audit S1)', () => {
  it('"Delete draft" on a draft that was never sent — it really deletes (T23)', () => {
    const draft = post({ stage: 'draft', sent_version: null, approval: null, qc_pass: null })
    expect(binAction(draft, ['creator'], NOW)?.action).toBe('delete_draft')
    expect(binAction(draft, ['creator'], NOW)?.label).toBe('Delete draft')
  })

  it('"Cancel post" everywhere else — a draft that was sent before, Ready, Booked (T20)', () => {
    expect(binAction(post({ stage: 'draft', sent_version: 1 }), ['creator'], NOW)?.action).toBe('cancel')
    expect(binAction(post(), ['scheduler'], NOW)).toMatchObject({ action: 'cancel', label: 'Cancel post', blocked: null })
    expect(binAction(post({ stage: 'booked' }), ['scheduler'], NOW)?.action).toBe('cancel')
    // a scheduler may cancel ANY post, not only their own (the owner's decision 4)
    expect(binAction(post({ created_by: 'someone-else' }), ['scheduler'], NOW)?.action).toBe('cancel')
  })

  it('shows the bin with the reason beside it once a network has gone out', () => {
    const b = binAction(post({ stage: 'booked', outcomes: { instagram: { status: 'published' } } }), ['scheduler'], NOW)
    expect(b?.action).toBe('cancel')
    expect(b?.blocked).toMatch(/already gone out on Instagram/)
  })

  it('no bin on a posted or a cancelled post', () => {
    expect(binAction(post({ stage: 'posted' }), ['sa'], NOW)).toBeNull()
    expect(binAction(post({ stage: 'cancelled' }), ['sa'], NOW)).toBeNull()
  })
})

describe('the counts and the List’s filters, off the stage', () => {
  const rows = [
    { stage: 'ready' as const, facts: { missed: false } },
    { stage: 'ready' as const, facts: { missed: true } },
    { stage: 'booked' as const, facts: { missed: false } },
    { stage: 'posted' as const, facts: { missed: false } },
    { stage: 'draft' as const, facts: { missed: false } },
    { stage: 'quality_check' as const, facts: { missed: true } },
    { stage: 'with_client' as const, facts: { missed: false } },
    { stage: 'cancelled' as const, facts: { missed: false } },
  ]

  it('counts each stage once, and only schedule posts as missed', () => {
    expect(scheduleCounts(rows)).toEqual({ ready: 2, booked: 1, posted: 1, missed: 1, beingApproved: 3, drafts: 1, cancelled: 1 })
  })

  it('"all" is the calendar; drafts and cancelled are lists of their own', () => {
    expect(rows.filter(r => matchesListFilter(r, 'all')).map(r => r.stage)).toEqual(['ready', 'ready', 'booked', 'posted'])
    expect(rows.filter(r => matchesListFilter(r, 'missed'))).toHaveLength(1)
    expect(rows.filter(r => matchesListFilter(r, 'drafts')).map(r => r.stage)).toEqual(['draft'])
    expect(rows.filter(r => matchesListFilter(r, 'cancelled')).map(r => r.stage)).toEqual(['cancelled'])
  })
})

describe('the feed preview is Instagram posts going out (audit S8)', () => {
  const ig = new Set(['ig'])
  const rows = [
    { id: 'ready-ig', stage: 'ready' as const, channels: ['ig'] },
    { id: 'booked-ig', stage: 'booked' as const, channels: ['ig', 'li'] },
    { id: 'posted-ig', stage: 'posted' as const, channels: ['ig'] },
    { id: 'cancelled-ig', stage: 'cancelled' as const, channels: ['ig'] },
    { id: 'draft-ig', stage: 'draft' as const, channels: ['ig'] },
    { id: 'qc-ig', stage: 'quality_check' as const, channels: ['ig'] },
    { id: 'ready-li', stage: 'ready' as const, channels: ['li'] },
  ]

  it('keeps Ready and Booked on Instagram, and draws posted ones once — from the feed', () => {
    expect(previewPosts(rows, ig, true).map(r => r.id)).toEqual(['ready-ig', 'booked-ig'])
  })

  it('draws the posted ones from here only when the feed could not be read', () => {
    expect(previewPosts(rows, ig, false).map(r => r.id)).toEqual(['ready-ig', 'booked-ig', 'posted-ig'])
  })
})

/* ── the page, read as source ───────────────────────────────────────────── */

describe('the Schedule page reads the stage and approves nothing', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  /** the code without its comments, so an explanation cannot pass or fail a pin */
  const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
  const DIR = 'app/dashboard/social/schedule/'

  it('re-filters when "Whose accounts" changes — the memo listens to the owner (audit S4)', () => {
    expect(read(`${DIR}page.tsx`)).toContain('[livePosts, selected, owner, ownerAccountIds])')
  })

  it('moves and bins through the one act route, never the old schedule routes', () => {
    const page = code(`${DIR}page.tsx`)
    expect(page).toContain('postAct(post.id, { ...body, expect_rev: post.state.rev })')
    expect(page).toContain("action: 'change_time'")
    expect(page).toContain('action: post.bin.action, confirm: true')
    expect(page).not.toMatch(/\/api\/social\/schedule\/\$\{post(Id)?(\.id)?\}/)
    expect(page).not.toContain("method: 'DELETE' })\n    const json = await res.json().catch(() => ({}))\n    if (!res.ok) { toast.error(String(json?.error ?? 'Could not delete that draft'))")
    expect(page).not.toContain('Draft deleted')
  })

  it('reads no edit-card approval, no job and no old status to decide where a post is', () => {
    for (const f of ['page.tsx', 'views.tsx', 'WeekGrid.tsx', 'useSchedulePosts.ts', 'MediaRail.tsx']) {
      const src = code(`${DIR}${f}`)
      expect(src, f).not.toMatch(/posting_approval_state|posting_client_required|client_sent|mirrorStatus|postTileFacts|waitingOnWords/)
      expect(src, f).not.toMatch(/\.live_status\b/)
    }
    // the hook subscribes to no publish jobs: a post's outcomes are its own
    expect(code(`${DIR}useSchedulePosts.ts`)).not.toContain("'publish_jobs'")
  })

  it('offers no approving: no Approve button, no approve handler on the rail', () => {
    for (const f of ['page.tsx', 'views.tsx', 'WeekGrid.tsx', 'MediaRail.tsx']) {
      const src = code(`${DIR}${f}`)
      expect(src, f).not.toMatch(/onApprove|Approve without client|flow\.approve\b/)
    }
  })

  it('finds stories per network, not by the edit card’s type (audit S3)', () => {
    const page = code(`${DIR}page.tsx`)
    expect(page).toContain('inWeek.filter(p => p.facts.story)')
    expect(page).not.toContain("item_type ?? '').toLowerCase() === 'story'")
  })

  it('draws every network on a tile, not only the first (audit S14)', () => {
    const grid = code(`${DIR}WeekGrid.tsx`)
    expect(grid).toContain('<NetworkLogos platforms={post.platforms}')
    expect(grid).not.toContain('post.platforms[0]')
  })

  it('lets a manager reach Remove on every rail card, with the booked reason beside it (audit S11)', () => {
    const rail = code(`${DIR}MediaRail.tsx`)
    expect(rail).not.toContain('disabled={!m.ok}')
    expect(rail).toContain('Take its posts off the schedule first')
  })
})
