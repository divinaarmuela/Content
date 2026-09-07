import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  APPROVAL_GROUPS, approvalCount, approvalKindOf, approvalRowHref, approvalRows,
  DEFAULT_SCHEDULE_VIEW, OLD_SCHEDULER_VIEWS, parseScheduleView, SCHEDULE_HREF,
  SCHEDULE_VIEWS, scheduleViewHref, type ApprovalItem,
} from '../app/lib/schedule-page-core'
import { boardHref } from '../app/lib/board-view-core'
import { backLinkFor } from '../app/lib/work-pages-core'
import {
  canSeePage, defaultAllows, GRANTABLE_PAGES, isGrantablePage, SCHEDULE_PAGE,
} from '../app/lib/page-access-core'
import { NAV_MAIN, NAV_SOCIAL_CHILDREN, GROUPS, PAGE_TITLES, resolveNav } from '../app/dashboard/ui/Shell'

/**
 * ONE SCHEDULE.
 *
 * There were two entries for one job — a Scheduler page with a board and a
 * posting calendar behind its own pills, and a Schedule page under Social with
 * the same calendar on it. The owner, looking at the live app: "this page will
 * be too confusing … why can't anything that needs approving just be in the
 * Schedule".
 *
 * So: one page at `/dashboard/social/schedule` with three views, the old
 * addresses kept as permanent redirects, and one Schedule entry in the
 * sidebar. This pins the parts of that a person would notice if they broke —
 * the old links still landing, nobody losing access, and the three views
 * actually drawing three different things.
 */

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const VIEW_DIR = 'app/dashboard/social/schedule'

/* ── the views ──────────────────────────────────────────────────────────── */

describe('the page names its three views, and the address carries which', () => {
  it('has exactly three, calendar first', () => {
    expect([...SCHEDULE_VIEWS]).toEqual(['calendar', 'board', 'approvals'])
    expect(DEFAULT_SCHEDULE_VIEW).toBe('calendar')
  })

  it('reads ?view= tolerantly and refuses what it does not know', () => {
    expect(parseScheduleView('board')).toBe('board')
    expect(parseScheduleView('APPROVALS')).toBe('approvals')
    expect(parseScheduleView(' calendar ')).toBe('calendar')
    for (const junk of ['queue', '', null, undefined, 7, {}]) {
      expect(parseScheduleView(junk), String(junk)).toBeNull()
    }
  })

  it('writes ?view= out even for the default — a link must beat the memory', () => {
    expect(scheduleViewHref('calendar')).toBe(`${SCHEDULE_HREF}?view=calendar`)
    expect(scheduleViewHref('board', { column: 'ready_to_post' }))
      .toBe(`${SCHEDULE_HREF}?view=board&column=ready_to_post`)
    // nothing empty is carried: `?client=` on the end is a client nobody picked
    expect(scheduleViewHref('approvals', { client: '', item: null, card: undefined }))
      .toBe(`${SCHEDULE_HREF}?view=approvals`)
  })

  it('the page draws the pills and hands each view its own component', () => {
    const src = read(`${VIEW_DIR}/page.tsx`)
    for (const label of ['Calendar', 'Board', 'Approvals']) {
      expect(src, label).toContain(`label: '${label}'`)
    }
    expect(src).toContain('<CalendarView />')
    expect(src).toContain('<BoardView />')
    expect(src).toContain('<ApprovalsView go={go} />')
    // the choice lives in the address AND in this person's browser
    expect(src).toContain("url.searchParams.set('view', next)")
    expect(src).toContain('localStorage.setItem(SCHEDULE_VIEW_KEY, next)')
    // …and a link that names a view wins over the memory
    expect(src).toContain('restoredChoice(SCHEDULE_VIEWS')
  })

  it('the three views really are three different things', () => {
    const calendar = read(`${VIEW_DIR}/CalendarView.tsx`)
    const board = read(`${VIEW_DIR}/BoardView.tsx`)
    const approvals = read(`${VIEW_DIR}/ApprovalsView.tsx`)

    // the calendar: the week grid, the media rail, the composer
    expect(calendar).toContain('<WeekGrid')
    expect(calendar).toContain('<MediaRail')
    expect(calendar).toContain('<NewPostDialog')
    // its own Week/Month/List choice moved off ?view= so it cannot collide
    expect(calendar).toContain("VIEWS, 'Week', 'look'")
    expect(calendar).not.toContain("VIEWS, 'Week', 'view'")

    // the board: the five lanes, exactly as the Scheduler page drew them
    expect(board).toContain('page="scheduler"')
    expect(board).toMatch(/<Board\b/)
    expect(board).not.toContain('<WeekGrid')

    // the approvals: the one list, off the one pure function
    expect(approvals).toContain('approvalRows(')
    expect(approvals).toContain('APPROVAL_GROUPS')
    expect(approvals).not.toMatch(/<Board\b/)
    expect(approvals).not.toContain('<WeekGrid')
  })

  it('the New menu still offers both, and New card lands on the board', () => {
    const button = read(`${VIEW_DIR}/NewPostButton.tsx`)
    expect(button).toContain('New post')
    expect(button).toContain('New card')
    const page = read(`${VIEW_DIR}/page.tsx`)
    // a card is board work, so asking for one from the calendar goes there
    expect(page).toContain("go('board')")
    expect(page).toContain('NEW_CARD_EVENT')
  })
})

/* ── the redirects ──────────────────────────────────────────────────────── */

describe('the old Scheduler addresses still land — permanently', () => {
  it('names which view each one meant', () => {
    expect(OLD_SCHEDULER_VIEWS['/dashboard/scheduler']).toBe('board')
    expect(OLD_SCHEDULER_VIEWS['/dashboard/scheduler/calendar']).toBe('calendar')
  })

  it('/dashboard/scheduler redirects to the Board view, keeping its deep links', async () => {
    const redirect = vi.fn()
    vi.doMock('next/navigation', () => ({ permanentRedirect: redirect }))
    const page = (await import('../app/dashboard/scheduler/page')).default
    await page({ searchParams: Promise.resolve({ column: 'ready_to_post', card: 'x1' }) })
    expect(redirect).toHaveBeenCalledWith(
      '/dashboard/social/schedule?view=board&column=ready_to_post&card=x1')
    vi.doUnmock('next/navigation')
    vi.resetModules()
  })

  it('/dashboard/scheduler/calendar and /dashboard/calendar redirect to the Calendar view', async () => {
    const redirect = vi.fn()
    vi.doMock('next/navigation', () => ({ permanentRedirect: redirect }))
    const cal = (await import('../app/dashboard/scheduler/calendar/page')).default
    await cal({ searchParams: Promise.resolve({ client: 'c1', item: 'i1' }) })
    expect(redirect).toHaveBeenCalledWith(
      '/dashboard/social/schedule?view=calendar&client=c1&item=i1')

    const old = (await import('../app/dashboard/calendar/page')).default
    old()
    expect(redirect).toHaveBeenLastCalledWith('/dashboard/social/schedule?view=calendar')
    vi.doUnmock('next/navigation')
    vi.resetModules()
  })

  it('every one of them is PERMANENT — a bookmark should stop asking', () => {
    for (const rel of [
      'app/dashboard/scheduler/page.tsx',
      'app/dashboard/scheduler/calendar/page.tsx',
      'app/dashboard/calendar/page.tsx',
    ]) {
      expect(read(rel), rel).toContain('permanentRedirect(')
    }
  })

  it('the Scheduler folder holds nothing but redirects now', () => {
    const kept = readdirSync(join(root, 'app/dashboard/scheduler'))
    expect(kept.sort()).toEqual(
      ['availability', 'calendar', 'page.tsx', 'proposals', 'redirect-query.ts'])
  })
})

/* ── nothing points at the old page any more ────────────────────────────── */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) sourceFiles(rel, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

describe('no live link points at the folded page', () => {
  /** the stubs themselves, and the one module that names the old addresses
   *  so the redirects have something to be about */
  const ALLOWED = [
    'app/dashboard/scheduler/page.tsx',
    'app/dashboard/scheduler/calendar/page.tsx',
    'app/dashboard/scheduler/redirect-query.ts',
    'app/lib/schedule-page-core.ts',
  ]

  const files = [...sourceFiles('app'), ...sourceFiles('lib')]
    .map(f => f.split(sep).join('/'))

  it('finds the tree at all (a sweep over nothing is not a pass)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it("no href, no fetch, no <Link> says '/dashboard/scheduler'", () => {
    const hits: string[] = []
    for (const rel of files) {
      if (ALLOWED.includes(rel)) continue
      // comments may explain where the page went; code may not go there
      const code = read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*)/.test(l))
        .join('\n')
      code.split('\n').forEach((line, i) => {
        if (line.includes('/dashboard/scheduler')) hits.push(`${rel}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(hits, `still pointing at the folded page:\n${hits.join('\n')}`).toEqual([])
  })

  it('the board and the item page send people to the Schedule instead', () => {
    expect(boardHref('scheduler')).toBe('/dashboard/social/schedule?view=board')
    expect(backLinkFor({ status: 'approved_for_scheduling' }))
      .toEqual({ href: '/dashboard/social/schedule?view=board', label: 'Schedule' })
  })
})

/* ── the sidebar, and who may see it ────────────────────────────────────── */

describe('one Schedule in the sidebar, and nobody lost access', () => {
  it('Scheduler is off the nav; Schedule is Social’s child, once', () => {
    expect(NAV_MAIN.map(n => n.href)).not.toContain('/dashboard/scheduler')
    expect(GROUPS.flatMap(g => g.hrefs)).not.toContain('/dashboard/scheduler')
    const schedules = [...NAV_MAIN, ...NAV_SOCIAL_CHILDREN]
      .filter(n => n.label === 'Schedule')
    expect(schedules.map(n => n.href)).toEqual([SCHEDULE_PAGE])
  })

  it('the Schedule is the only one of them with a title — the rest never draw', () => {
    expect(PAGE_TITLES[SCHEDULE_PAGE]).toBe('Schedule')
    // a redirect renders nothing, so a title for it would be a name on a page
    // that does not exist
    for (const gone of ['/dashboard/scheduler', '/dashboard/scheduler/calendar', '/dashboard/calendar']) {
      expect(PAGE_TITLES[gone], gone).toBeUndefined()
    }
  })

  it('a scheduler still has their page — and it is the Schedule', () => {
    expect(defaultAllows('scheduler', SCHEDULE_PAGE)).toBe(true)
    expect(canSeePage('scheduler', SCHEDULE_PAGE, [])).toBe(true)
    // …drawn without Social above it, as it always was
    const nav = resolveNav('scheduler', [], [], SCHEDULE_PAGE)
    expect(nav.children.map(c => c.href)).toEqual([SCHEDULE_PAGE])
    expect(nav.allowed.has('/dashboard/social')).toBe(false)
    expect(nav.current).toBe(SCHEDULE_PAGE)
  })

  it('an editor is where they were — Editor, and no Schedule', () => {
    expect(defaultAllows('editor', '/dashboard/editor')).toBe(true)
    expect(canSeePage('editor', SCHEDULE_PAGE, [])).toBe(false)
  })

  it('the managers reach it through Social, as they always did', () => {
    for (const role of ['account_manager', 'super_admin'] as const) {
      expect(canSeePage(role, SCHEDULE_PAGE, []), role).toBe(true)
    }
  })

  it('it can be handed to one person, and the folded page cannot', () => {
    expect(isGrantablePage(SCHEDULE_PAGE)).toBe(true)
    expect(isGrantablePage('/dashboard/scheduler')).toBe(false)
    expect(GRANTABLE_PAGES.find(p => p.href === SCHEDULE_PAGE)?.label).toBe('Schedule')
  })
})

/* ── approvals ──────────────────────────────────────────────────────────── */

describe('everything waiting on somebody, in one list', () => {
  const item = (over: Partial<ApprovalItem>): ApprovalItem => ({
    id: 'i1', client_id: 'c1', title: 'A piece', status: 'draft_uploaded',
    updated_at: '2026-09-01T00:00:00.000Z', ...over,
  })

  it('has three groups, posts first', () => {
    expect(APPROVAL_GROUPS.map(g => g.kind)).toEqual(['post', 'client', 'check'])
  })

  it('a post sent for sign-off is a post, wherever its card sits', () => {
    expect(approvalKindOf(item({
      status: 'client_review', posting_approval_state: 'pending',
    }))).toBe('post')
  })

  it('a card with the client, or waiting on a check, is each its own', () => {
    expect(approvalKindOf(item({ status: 'client_review' }))).toBe('client')
    expect(approvalKindOf(item({ status: 'client_changes_requested' }))).toBe('client')
    expect(approvalKindOf(item({ status: 'internal_review' }))).toBe('check')
  })

  it('nothing else is waiting on anybody', () => {
    for (const status of ['draft_uploaded', 'revision_required', 'approved_for_scheduling', 'scheduled', 'published']) {
      expect(approvalKindOf(item({ status })), status).toBeNull()
    }
    // an approved or a never-asked post is not a question
    expect(approvalKindOf(item({ status: 'scheduled', posting_approval_state: 'approved' }))).toBeNull()
    expect(approvalKindOf(item({ status: 'scheduled', posting_approval_state: 'nonsense' }))).toBeNull()
  })

  it('lists posts, then the client, then the check — newest first inside each', () => {
    const rows = approvalRows([
      item({ id: 'a', status: 'internal_review', updated_at: '2026-09-03T00:00:00.000Z' }),
      item({ id: 'b', status: 'client_review', updated_at: '2026-09-01T00:00:00.000Z' }),
      item({ id: 'c', status: 'client_review', updated_at: '2026-09-02T00:00:00.000Z' }),
      item({ id: 'd', status: 'scheduled', posting_approval_state: 'pending' }),
      item({ id: 'e', status: 'published' }),
    ])
    expect(rows.map(r => r.itemId)).toEqual(['d', 'c', 'b', 'a'])
    expect(rows.map(r => r.kind)).toEqual(['post', 'client', 'client', 'check'])
  })

  it('never lists one piece twice', () => {
    const rows = approvalRows([
      item({ id: 'a', status: 'client_review', posting_approval_state: 'pending' }),
    ])
    expect(rows).toHaveLength(1)
  })

  it('narrows to one client — the chip’s number and the list are one function', () => {
    const rows = [
      item({ id: 'a', client_id: 'c1', status: 'client_review' }),
      item({ id: 'b', client_id: 'c2', status: 'client_review' }),
    ]
    expect(approvalRows(rows, { clientId: 'c1' }).map(r => r.itemId)).toEqual(['a'])
    expect(approvalCount(rows, { clientId: 'c1' })).toBe(1)
    expect(approvalCount(rows)).toBe(2)
  })

  it('a row opens the thing it is about', () => {
    const [post] = approvalRows([item({ status: 'scheduled', posting_approval_state: 'pending' })])
    expect(approvalRowHref(post))
      .toBe('/dashboard/social/schedule?view=calendar&client=c1&item=i1')
    const [card] = approvalRows([item({ status: 'client_review' })])
    expect(approvalRowHref(card))
      .toBe('/dashboard/social/schedule?view=board&client=c1&card=i1')
  })

  it('says who each one is sitting with, in plain words', () => {
    const words = (over: Partial<ApprovalItem>) => approvalRows([item(over)])[0]
    expect(words({ status: 'client_review' }).who).toBe('Waiting on the client')
    expect(words({ status: 'client_changes_requested' }).who).toBe('Waiting on us')
    expect(words({ status: 'internal_review' }).who).toBe('Waiting on an account manager')
    expect(words({ status: 'scheduled', posting_approval_state: 'pending' }).what)
      .toBe('Sent for approval')
  })

  it('the calendar’s waiting chip is a link to this list, for that client', () => {
    const rail = read(`${VIEW_DIR}/MediaRail.tsx`)
    expect(rail).toContain('href={waitingHref}')
    expect(rail).toContain('Waiting for approval · {waiting}')
    const calendar = read(`${VIEW_DIR}/CalendarView.tsx`)
    expect(calendar).toContain("scheduleViewHref('approvals', { client: clientId })")
    // and the number itself is approvalCount, not a second rule
    expect(read(`${VIEW_DIR}/useSchedulePosts.ts`)).toContain('approvalCount(')
  })

  it('the Approve and the Ask for a change are the SAME route as everywhere else', () => {
    const approvals = read(`${VIEW_DIR}/ApprovalsView.tsx`)
    expect(approvals).toContain('/posting-approval')
    expect(approvals).toContain("action: what === 'approve' ? 'approve' : 'request_changes'")
    // and only offered to somebody the server would say yes to
    expect(approvals).toContain('mayApprovePost(actingRoles(viewer, item))')
  })
})

/** Kept honest: `relative` is imported for the sweep's paths on Windows. */
void relative
