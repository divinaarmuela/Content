import { describe, expect, it } from 'vitest'
import {
  ALL_STATUSES, CLIENT_FACING_STATUSES, EMPTY_BOARD_LINE, NOT_WITH_YOU, PORTAL_COLUMNS,
  actedLine, brandLogoUrl, cardLine, columnCounts, isClientFacing, kindWord, linkFor,
  planDecidable, planPdfHref, portalActions, portalCardTone, portalColumnFor, shootDayLabel,
  shootStanding, sortForColumn, swipeOffset, swipeToApprove, toPortalComment, waitingOnYou,
} from '../app/lib/portal-core'
import type { ItemStatus } from '../app/lib/workflow-core'

/** the words a client must never read on their own board */
const JARGON = /internal|revision|draft_|_review|scheduling|graphic|status|asset/i

describe('the five columns, in the client’s words', () => {
  it('are five, and cover every status exactly once', () => {
    expect(PORTAL_COLUMNS).toHaveLength(5)
    const seen = PORTAL_COLUMNS.flatMap(c => c.statuses)
    expect([...seen].sort()).toEqual([...ALL_STATUSES].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('carry the same statuses as the team’s five columns', () => {
    const by = Object.fromEntries(PORTAL_COLUMNS.map(c => [c.key, c.statuses]))
    expect(by.making).toEqual(['draft_uploaded'])
    expect(by.checking).toEqual(['internal_review', 'revision_required', 'revision_complete'])
    expect(by.your_review).toEqual(['client_review', 'client_changes_requested'])
    expect(by.approved).toEqual(['approved_for_scheduling'])
    expect(by.posted).toEqual(['scheduled', 'published'])
  })

  it('are named and explained without jargon', () => {
    for (const c of PORTAL_COLUMNS) {
      expect(c.title).not.toMatch(JARGON)
      expect(c.hint).not.toMatch(JARGON)
    }
  })

  it('finds the column for any status', () => {
    expect(portalColumnFor('client_review')).toBe('your_review')
    expect(portalColumnFor('published')).toBe('posted')
    expect(portalColumnFor('revision_required')).toBe('checking')
  })
})

describe('what a card offers', () => {
  it('approves and asks for a change only while the piece is with the client', () => {
    for (const s of ALL_STATUSES) {
      const a = portalActions(s)
      expect(a.approve).toBe(s === 'client_review')
      expect(a.askForChange).toBe(s === 'client_review')
    }
  })

  it('allows a comment only on a card that has reached the client', () => {
    for (const s of ALL_STATUSES) {
      expect(portalActions(s).comment).toBe(CLIENT_FACING_STATUSES.includes(s))
      expect(isClientFacing(s)).toBe(CLIENT_FACING_STATUSES.includes(s))
    }
    expect(isClientFacing('draft_uploaded')).toBe(false)
    expect(isClientFacing('internal_review')).toBe(false)
    expect(isClientFacing('client_changes_requested')).toBe(true)
  })

  it('refuses in plain words', () => {
    expect(NOT_WITH_YOU).not.toMatch(JARGON)
  })
})

describe('the one sentence on a card', () => {
  it('is at most one sentence, for every status', () => {
    for (const s of ALL_STATUSES) {
      const line = cardLine(s)
      expect(line.length).toBeGreaterThan(0)
      // one full stop at the end, none in the middle
      expect(line.slice(0, -1)).not.toMatch(/\.\s/)
      expect(line).not.toMatch(JARGON)
    }
  })

  it('tells the client it is their move', () => {
    expect(cardLine('client_review')).toMatch(/approve/i)
    expect(cardLine('client_review')).toMatch(/ask for a change/i)
  })

  it('says when a booked post goes out', () => {
    expect(cardLine('scheduled', { postedWhen: 'Thu 27 Aug, 9:00 am' })).toBe('Going out Thu 27 Aug, 9:00 am.')
    expect(cardLine('scheduled')).toMatch(/booked/i)
  })

  it('lets the “coming back” line outrank the stock sentence', () => {
    expect(cardLine('internal_review', { progress: 'We’re updating this — a new version is on its way' }))
      .toBe('We’re updating this — a new version is on its way')
  })

  it('never says graphic', () => {
    expect(kindWord('static')).toBe('Image')
    expect(kindWord('reel')).toBe('Reel')
    expect(kindWord('other')).toBeNull()
    expect(kindWord(null)).toBeNull()
  })
})

describe('the link on a card', () => {
  it('labels Google Drive and Dropbox links', () => {
    expect(linkFor('https://drive.google.com/file/d/abc/view')?.label).toBe('Open in Google Drive')
    expect(linkFor('https://docs.google.com/presentation/d/x')?.provider).toBe('drive')
    expect(linkFor('https://www.dropbox.com/scl/fi/abc/reel.mp4?dl=0')?.label).toBe('Open in Dropbox')
  })

  it('calls anything else the file', () => {
    expect(linkFor('https://media.mdmmarketing.com.au/reel.mp4')).toEqual({
      url: 'https://media.mdmmarketing.com.au/reel.mp4', label: 'Open the file', provider: 'other',
    })
  })

  it('offers nothing for an empty, broken or plain-http link', () => {
    expect(linkFor(null)).toBeNull()
    expect(linkFor('   ')).toBeNull()
    expect(linkFor('not a url')).toBeNull()
    expect(linkFor('http://drive.google.com/x')).toBeNull()
    expect(linkFor('javascript:alert(1)')).toBeNull()
  })
})

describe('the card’s colour', () => {
  it('is amber only for the card waiting on the client', () => {
    expect(portalCardTone('client_review')).toBe('amber')
    expect(portalCardTone('approved_for_scheduling')).toBe('green')
    expect(portalCardTone('scheduled')).toBe('blue')
    expect(portalCardTone('published')).toBe('ink')
    expect(portalCardTone('client_changes_requested')).toBeUndefined()
    expect(portalCardTone('draft_uploaded')).toBeUndefined()
  })
})

describe('swipe from the right approves', () => {
  it('approves a leftward swipe past the threshold', () => {
    expect(swipeToApprove(-120, 4)).toBe(true)
    expect(swipeToApprove(-96, 0)).toBe(true)
  })

  it('ignores a short swipe, a rightward one, and a scroll', () => {
    expect(swipeToApprove(-40, 0)).toBe(false)
    expect(swipeToApprove(120, 0)).toBe(false)
    // mostly vertical: the client is scrolling the board
    expect(swipeToApprove(-120, 90)).toBe(false)
  })

  it('follows the finger leftwards only, and not off the screen', () => {
    expect(swipeOffset(30)).toBe(0)
    expect(swipeOffset(-50)).toBe(-50)
    expect(swipeOffset(-900)).toBe(-160)
  })
})

describe('comments pinned to a card', () => {
  it('names the team and calls the client by their company', () => {
    const to = toPortalComment('Nathan Homes')
    expect(to({ id: '1', created_at: 't', body: 'hi', team_users: { name: 'Priya', role: 'account_manager' } }))
      .toMatchObject({ author_name: 'Priya', from_team: true })
    expect(to({ id: '2', created_at: 't', body: 'ok', team_users: { name: 'Nathan Homes (client portal)', role: 'client' } }))
      .toMatchObject({ author_name: 'Nathan Homes', from_team: false })
    expect(to({ id: '3', created_at: 't', body: 'x', team_users: null }).from_team).toBe(false)
  })
})

describe('ordering and counting', () => {
  const card = (id: string, status: ItemStatus, updated_at: string) => ({ id, status, updated_at })

  it('puts the card waiting on the client first, then newest first', () => {
    const sorted = sortForColumn([
      card('old', 'client_changes_requested', '2026-09-01'),
      card('new', 'client_changes_requested', '2026-09-05'),
      card('wait', 'client_review', '2026-08-01'),
    ])
    expect(sorted.map(c => c.id)).toEqual(['wait', 'new', 'old'])
  })

  it('counts by column and says how many are waiting — a shoot counts like a piece', () => {
    const asCard = (status: ItemStatus) => ({ column: portalColumnFor(status), actions: portalActions(status) })
    const cards = [
      asCard('draft_uploaded'), asCard('client_review'), asCard('client_review'),
      asCard('published'), asCard('scheduled'),
      // a shoot whose plan is with them
      { column: 'your_review' as const, actions: { approve: true, askForChange: true, comment: true } },
    ]
    expect(columnCounts(cards)).toEqual({ making: 1, checking: 0, your_review: 3, approved: 0, posted: 2 })
    expect(waitingOnYou(cards)).toBe(3)
  })
})

describe('the client’s brand', () => {
  it('picks the first https logo file and nothing else', () => {
    expect(brandLogoUrl({ logo_files: [{ name: 'x', url: 'http://a/b.png' }, { url: 'https://a/logo.png' }] }))
      .toBe('https://a/logo.png')
    expect(brandLogoUrl({ logo_files: [] })).toBeNull()
    expect(brandLogoUrl(null)).toBeNull()
    expect(brandLogoUrl({ colours: [] })).toBeNull()
  })

  it('has a real empty state', () => {
    expect(EMPTY_BOARD_LINE).toMatch(/one tap/)
    expect(EMPTY_BOARD_LINE).not.toMatch(JARGON)
  })
})

describe('the shoot plan as a card', () => {
  it('can be decided on only when it is shared AND its brief is with the client', () => {
    expect(planDecidable(true, 'client_review')).toBe(true)
    expect(planDecidable(false, 'client_review')).toBe(false)
    expect(planDecidable(true, 'internal_review')).toBe(false)
    expect(planDecidable(true, 'approved_for_scheduling')).toBe(false)
    expect(planDecidable(true, null)).toBe(false)
    expect(planDecidable(true, undefined)).toBe(false)
  })

  it('is ONE card from booked to wrapped — the stage moves, the card does not', () => {
    const day = 'Thu 17 Sep'
    // being planned, nothing shared yet
    expect(shootStanding({ sharedWithClient: false, briefStatus: 'internal_review', shootStatus: 'brief', dateLabel: day }))
      .toMatchObject({ column: 'making', line: 'Being planned for Thu 17 Sep.', actions: { approve: false, comment: false } })
    // the plan is shared and with them: their call
    expect(shootStanding({ sharedWithClient: true, briefStatus: 'client_review', shootStatus: 'brief' }))
      .toMatchObject({ column: 'your_review', tone: 'amber', line: 'Your plan is ready to look at — approve it, or ask for a change.', actions: { approve: true, askForChange: true, comment: true } })
    // they asked for a change
    expect(shootStanding({ sharedWithClient: true, briefStatus: 'client_changes_requested', shootStatus: 'brief' }))
      .toMatchObject({ column: 'your_review', line: 'We have your notes and we’ll come back with an updated plan.', actions: { approve: false } })
    // approved, not yet booked
    expect(shootStanding({ sharedWithClient: true, briefStatus: 'approved_for_scheduling', shootStatus: 'brief' }))
      .toMatchObject({ column: 'approved', tone: 'green', line: 'Plan approved — we’ll confirm the date shortly.' })
    // booked: the date is the line
    expect(shootStanding({ sharedWithClient: true, briefStatus: 'approved_for_scheduling', shootStatus: 'locked', dateLabel: day }))
      .toMatchObject({ column: 'approved', tone: 'blue', line: 'Booked for Thu 17 Sep.', actions: { approve: false, comment: true } })
    // filmed, then wrapped
    expect(shootStanding({ sharedWithClient: true, briefStatus: 'approved_for_scheduling', shootStatus: 'shot', dateLabel: day }))
      .toMatchObject({ column: 'approved', line: 'Filmed on Thu 17 Sep — being edited now.' })
    expect(shootStanding({ sharedWithClient: true, briefStatus: 'approved_for_scheduling', shootStatus: 'wrapped', dateLabel: day }))
      .toMatchObject({ column: 'posted', tone: 'ink', line: 'Wrapped on Thu 17 Sep — the footage is being turned into your content.' })
  })

  it('an unshared plan at client_review is NOT approvable, and a booked unshared shoot still shows its date', () => {
    expect(shootStanding({ sharedWithClient: false, briefStatus: 'client_review', shootStatus: 'brief' }).actions)
      .toEqual({ approve: false, askForChange: false, comment: false })
    expect(shootStanding({ sharedWithClient: false, briefStatus: null, shootStatus: 'locked', dateLabel: 'Thu 17 Sep' }))
      .toMatchObject({ column: 'approved', line: 'Booked for Thu 17 Sep.' })
  })

  it('a wrapped shoot says wrapped even if the plan paperwork is still with them', () => {
    expect(shootStanding({ sharedWithClient: true, briefStatus: 'client_review', shootStatus: 'wrapped' }))
      .toMatchObject({ column: 'posted', line: 'Wrapped — the footage is being turned into your content.' })
  })

  it('never says jargon on a shoot card', () => {
    for (const shootStatus of ['brief', 'locked', 'shot', 'wrapped', null]) {
      for (const briefStatus of ['client_review', 'client_changes_requested', 'approved_for_scheduling', 'internal_review', null]) {
        for (const sharedWithClient of [true, false]) {
          expect(shootStanding({ sharedWithClient, briefStatus, shootStatus, dateLabel: 'Thu 17 Sep' }).line).not.toMatch(JARGON)
        }
      }
    }
  })

  it('reaches the PDF from the share link only', () => {
    expect(planPdfHref('3ae353c7-c879-4db7-bf71-dec9657d40e3', 'b-1'))
      .toBe('/api/portal/shoot-pdf?token=3ae353c7-c879-4db7-bf71-dec9657d40e3&id=b-1')
    expect(planPdfHref(null, 'b-1')).toBeNull()
  })

  it('answers the moment they act', () => {
    expect(actedLine('shoot', 'approve')).toBe('Plan approved — we’ll confirm the date shortly.')
    expect(actedLine('shoot', 'request_changes')).toMatch(/your notes/)
    expect(actedLine('work', 'approve')).toBe('Approved — we’ll book a posting time.')
    expect(actedLine('work', 'request_changes')).toMatch(/your notes/)
  })

  it('writes the shoot day as a calendar day, whatever the clock', () => {
    expect(shootDayLabel('2026-09-17')).toBe('Thu 17 Sep')
    expect(shootDayLabel(null)).toBeNull()
    expect(shootDayLabel('soon')).toBeNull()
  })
})
