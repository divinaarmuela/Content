import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/* ── the Scheduling tab (docs/ONE_PORTAL_SPEC.md R10, R11) ── */

vi.mock('@/lib/db', () => ({ table: () => ({ get: async () => null, list: async () => [], claim: async () => ({ claimed: false }) }) }))
const { schedulingWaiting } = await import('../app/lib/one-portal-schedule')

const t = (over: Record<string, unknown>) => ({ post_id: 'p', state: 'not_reviewed', answerable: true, ...over }) as never
const profile = (booked: unknown[], off: unknown[] = []) => ({ network: 'instagram', booked, off, posted: [] }) as never

describe('the Scheduling badge', () => {
  it('counts a booked post the client has not answered, once across networks', () => {
    expect(schedulingWaiting([profile([t({ post_id: 'a' })]), profile([t({ post_id: 'a' })])])).toBe(1)
    expect(schedulingWaiting([profile([t({ post_id: 'a', state: 'approved' })])])).toBe(0)
    expect(schedulingWaiting([profile([t({ post_id: 'a', state: 'asked_again' })])])).toBe(1)
  })
  it('counts a "wait" post that came off unanswered; never one they said no to', () => {
    expect(schedulingWaiting([profile([], [t({ post_id: 'w', answerable: true })])])).toBe(1)
    expect(schedulingWaiting([profile([], [t({ post_id: 'n', state: 'not_approved', answerable: false })])])).toBe(0)
  })
})

describe('the tab', () => {
  const loader = readFileSync('app/lib/one-portal-schedule.ts', 'utf8')
  const ui = readFileSync('app/components/portal/OnePortalScheduling.tsx', 'utf8')
  it('reads the feeds from the stored copy, refreshed every 15 minutes, never on every visit', () => {
    expect(loader).toContain('const FEED_FRESH_MS = 15 * 60 * 1000')
    expect(loader).toMatch(/if \(fresh\) return/)
    expect(loader).toMatch(/withFeeds \? await feedFor\(account, now\)/)
  })
  it('keeps a person to their own posts', () => {
    expect(loader).toMatch(/postOnPortal\(contactOf\(p\), scope\)/)
  })
  it('the client answers the frozen version they saw, with their name, and a note for Not approved', () => {
    expect(ui).toContain("body: JSON.stringify({ token, post_id: tile.post_id, version: tile.version, action, note: note.trim() || null, author_name: name.trim() })")
    expect(ui).toContain("if (!name.trim()) { toast.error('Add your name so the team knows who answered.'); return }")
    expect(ui).toContain("if (action === 'client_not_approved' && !note.trim())")
  })
  it('each network as its own profile: Instagram a grid, LinkedIn a feed, TikTok a 9:16 grid', () => {
    expect(ui).toContain("profile.network === 'linkedin'")
    expect(ui).toContain("tall={profile.network === 'tiktok'}")
    expect(ui).toContain("const aspect = tall ? 'aspect-[9/16]' : 'aspect-[4/5]'")
  })
})

describe('the client comments on a post (2 Oct 2026: "why can\'t they leave comments?")', () => {
  const route = readFileSync('app/api/portal/act/route.ts', 'utf8')
  const ui = readFileSync('app/components/portal/OnePortalScheduling.tsx', 'utf8')
  it('a comment on a post still to go out, in its Client thread, with their name; the maker and holder are told', () => {
    expect(route).toContain("if (body.action === 'client_comment') return commentOnPost(body, client, scope)")
    expect(route).toMatch(/async function commentOnPost[\s\S]{0,200}if \(!onePortal\(client\)\)/)
    expect(route).toMatch(/visibility: 'client',\s+author_id: actor\.id, author_name: name, author_role: 'client',/)
    expect(route).toContain('const people = [...new Set([post.created_by, post.assigned_to].filter((x): x is string => !!x))]')
    expect(route).toMatch(/postOnPortal\(post, scope\)/)
  })
  it('the sheet shows the thread and one name box for the answer and the comment', () => {
    expect(ui).toContain('<Comments token={token} tile={tile} name={name} />')
    expect((ui.match(/placeholder="Your name"/g) ?? []).length).toBe(1)
  })
})

describe('mini pages (2 Oct 2026: "each tab has like mini pages"; Scheduling "by the work")', () => {
  it('groups booked posts by the work they came from, waiting first, "Other posts" last; one post on two networks counts once', async () => {
    const { schedulingWorks, profilesForWork } = await import('../app/lib/one-portal-schedule')
    const t = (post_id: string, work_id: string, over: Record<string, unknown> = {}) =>
      ({ post_id, work_id, work_title: work_id === 'other' ? 'Other posts' : `Work ${work_id}`, state: 'approved', answerable: true, scheduled_for: '2026-10-09T00:00:00.000Z', ...over }) as never
    const ig = { network: 'instagram', booked: [t('p1', 'w1'), t('p2', 'w2', { state: 'not_reviewed' }), t('p3', 'other')], off: [t('p4', 'w1', { state: 'not_approved', answerable: false })], posted: [{ id: 'x' }] } as never
    const li = { network: 'linkedin', booked: [t('p2', 'w2', { state: 'not_reviewed' })], off: [], posted: [] } as never
    const works = schedulingWorks([ig, li])
    expect(works.map(w => w.id)).toEqual(['w2', 'w1', 'other'])
    expect(works.find(w => w.id === 'w2')).toMatchObject({ booked: 1, waiting: 1 })
    expect(works.find(w => w.id === 'w1')).toMatchObject({ booked: 1, off: 1, waiting: 0 })
    const only = profilesForWork([ig, li], 'w2')
    expect(only.map(p => p.network)).toEqual(['instagram', 'linkedin'])
    expect(only[0].posted).toEqual([])
  })
  it('the page: Shoot brief lists shoots and boards, Scheduling lists Your feed and the works; each opens its own page', () => {
    const page = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
    expect(page).toContain("<OnePortalList heading={dateRows.length > 0 ? 'Shoots' : undefined} rows={shootRows}")
    expect(page).toContain('<OnePortalList heading="By the work" rows={workRows}')
    // a piece no longer there opens the tab's list, never a 404 (2 Oct 2026, the rollout's link test)
    expect(page).toContain('if (!page.boards.some(b => b.id === openBoard)) redirect(onePortalPath(token, tab))')
  })
})

describe('the Boards tab, and taking a piece off the portal (2 Oct 2026)', () => {
  it('Boards is the fifth tab', async () => {
    const { PORTAL_TABS } = await import('../app/lib/one-portal-core')
    expect(PORTAL_TABS.map(t => t.label)).toEqual(['Shoot brief', 'Editing', 'Designing', 'Scheduling', 'Boards', 'Forms'])
    const page = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
    expect(page).toContain("{tab === 'boards' && <OnePortalList rows={boardRows}")
  })
  it('a piece a manager took off is not shown, and only a manager may take it off', () => {
    expect(readFileSync('app/lib/one-portal-page.ts', 'utf8')).toContain('?.portal_hidden !== true)')
    const route = readFileSync('app/api/production/items/[id]/route.ts', 'utf8')
    expect(route).toMatch(/hasOwnProperty\.call\(body, 'portal_hidden'\)\) \{\s+if \(!\['account_manager', 'super_admin'\]\.includes\(user\.role\)\)/)
    expect(readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')).toContain('Take it off the client&apos;s portal — they will not see it there.')
  })
})

describe('a booked video tile shows its Cloudflare still (3 Oct 2026, the Safari check)', () => {
  it('the loader attaches the still; the tile draws it before trying the video', () => {
    const loader = readFileSync('app/lib/one-portal-schedule.ts', 'utf8')
    expect(loader).toContain("const posterOf = new Map(previews.map(r => [r.source_url, pickPoster(r)]))")
    const ui = readFileSync('app/components/portal/OnePortalScheduling.tsx', 'utf8')
    expect(ui).toContain("if (poster) return <img src={poster}")
  })
})

describe('the person\'s own "If the client hasn\'t approved" choice is not "someone else" (5 Oct 2026, Karly\'s Capila draft)', () => {
  const line = readFileSync('app/dashboard/social/schedule/OnePortalPostLine.tsx', 'utf8')
  const win = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
  it('the choice tells the window when its write starts and the post it ended on', () => {
    expect(line).toContain("onOwnChange?.('start', null)")
    expect(line).toContain("onOwnChange?.('end', r.ok ? r.post : null)")
  })
  it('the window holds the new rev, keeps what is being typed, and never calls it a conflict', () => {
    expect(win).toContain("savingRef.current = phase === 'start'")
    expect(win).toContain('loadedKey.current = `${after.id}:${after.rev}`')
    expect(win).toMatch(/setAnswered\(after\)\s+setMovedUnder\(false\)/)
  })
})

describe('the card column on the editor and designer page ends at the bottom of the screen (5 Oct 2026: "I need to scroll outside the two windows")', () => {
  it('its height is what is left under its own top edge, kept right on scroll and resize', () => {
    const page = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(page).toContain('const cardColumn = useFitsScreen<HTMLElement>()')
    expect(page).toContain('<aside ref={cardColumn}')
    expect(page).toContain('el.style.maxHeight = `${Math.max(240, window.innerHeight - top - 16)}px`')
    expect(page).toContain("window.addEventListener('scroll', fit, { capture: true, passive: true })")
    // on a phone the column is not a scrolling box at all
    expect(page).toContain("if (!wide.matches) { el.style.maxHeight = ''; return }")
  })
})

describe('a card\'s brief is kept whole and can be re-edited (the owner, 5 Oct 2026: "put no limits and allow it to be reedited")', () => {
  it('no cut when the card is made, nor on a batch\'s objective', () => {
    const items = readFileSync('app/api/production/items/route.ts', 'utf8')
    expect(items).toContain('brief: it.brief ? String(it.brief) : null,')
    expect(items).not.toMatch(/String\(it\.brief\)\.slice\(/)
    expect(readFileSync('app/api/production/batches/route.ts', 'utf8')).not.toMatch(/String\(body\.description\)\.slice\(/)
  })
  it('the edit box is tall and the person can drag it taller', () => {
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain('<textarea rows={12} value={eBrief}')
    expect(drawer).toContain('resize-y')
  })
})

describe('the clients list (the owner, 5 Oct 2026: "because of url everything is pushed to the left")', () => {
  const page = readFileSync('app/dashboard/clients/page.tsx', 'utf8')
  it('a long website link is cut to its site and path, in a cell with a width; the whole link is the title and the href', () => {
    expect(page).toContain('<TableCell className="max-w-[18rem]">')
    expect(page).toContain('{siteWords(c.website)}')
    expect(page).toContain('bare.split(/[?#]/)[0]')
    expect(page).toContain('title={c.website}')
    expect(page).toContain('className="block truncate text-secondary-13 text-muted-foreground hover:underline"')
  })
  it('the header tint follows the card\'s rounded corners', () => {
    expect(page).toContain('[&>th:first-child]:rounded-tl-card [&>th:last-child]:rounded-tr-card')
  })
})

describe('a link to one post opens it on Your feed (the owner, 5 Oct 2026, Justin\'s link: "feed view cache is not picked")', () => {
  it('the post is drawn among what is already posted, not alone on its work\'s page', () => {
    const page = readFileSync('app/portal/[token]/home/page.tsx', 'utf8')
    expect(page).toContain("const workId = id && id !== askedPost ? id : 'feed'")
    expect(page).toContain("profiles={workId === 'feed' ? profiles : profilesForWork(profiles, workId)} openPostId={askedPost}")
  })
})
