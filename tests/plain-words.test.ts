import { describe, it, expect } from 'vitest'
import {
  isTechnical, friendlyError, notSetUpMessage, loadFailedMessage, techMailto, TECH_EMAIL,
} from '../app/lib/support-core'
import { GLOSSARY, GLOSSARY_KEYS, glossary } from '../app/lib/glossary-core'
import { panelForRole, shouldShowGettingStarted } from '../app/lib/getting-started-core'
import {
  eventWords, notificationHref, splitTransition,
} from '../app/lib/notification-words'
import {
  transitionSubject, whatHappensNext, longDate, OPEN_ITEM_CTA,
} from '../app/lib/email-voice-core'

/**
 * The pure half of "a non-expert can use this": what a person is told when
 * something breaks, what the invented words mean, what their first three
 * steps are, what a notification says and where it goes, and who an email is
 * addressed to.
 *
 * Every one of these was, until now, either a database string, a raw enum, or
 * the sender's own button label.
 */

describe('nothing written for a developer reaches a person', () => {
  const DEV_STRINGS = [
    'Could not load leads — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.',
    'Failed to load clients. Has website_cms.sql been run in Supabase?',
    'Run supabase/booking.sql in the SQL editor to switch bookings on.',
    'Run supabase/agreements_and_briefs.sql first',
    'Failed to load — has identity.sql been run in Supabase?',
    'Publishing is not configured — set ZERNIO_API_KEY on the server.',
    "Could not find the table 'public.batches' in the schema cache",
    'relation "content_items" does not exist',
    'column "getting_started_dismissed_at" does not exist',
    'PGRST202: no function matches',
    'set GMAIL_USER and GMAIL_REFRESH_TOKEN on the server',
  ]

  it('recognises every string the review found on screen', () => {
    for (const s of DEV_STRINGS) {
      expect(isTechnical(s), `not caught: ${s}`).toBe(true)
    }
  })

  it('replaces them with a sentence that blames nobody', () => {
    for (const s of DEV_STRINGS) {
      const out = friendlyError(s, 'Leads')
      expect(out).toBe(notSetUpMessage('Leads'))
      expect(isTechnical(out)).toBe(false)
      expect(out).toMatch(/Nothing you did caused this/)
    }
  })

  it('leaves a message that was already written for a person alone', () => {
    const human = 'That client already has an agreement for this month.'
    expect(friendlyError(human, 'Clients')).toBe(human)
    expect(isTechnical(human)).toBe(false)
  })

  it('falls back rather than showing an empty error', () => {
    expect(friendlyError('', 'Bookings')).toBe(notSetUpMessage('Bookings'))
    expect(friendlyError(null, 'Bookings')).toBe(notSetUpMessage('Bookings'))
  })

  it('a load failure is worded differently from a feature being off', () => {
    // an outage displayed as "nothing here yet" is a lie, not a display bug
    expect(loadFailedMessage('your leads')).not.toBe(notSetUpMessage('Leads'))
    expect(loadFailedMessage('your leads')).toMatch(/try again/i)
  })
})

describe('the support email arrives already filled in', () => {
  const url = techMailto({
    subject: "Bookings isn't switched on",
    detail: 'Could not find the table \'public.bookings\' in the schema cache',
    page: '/dashboard/bookings',
    who: 'sam@example.invalid',
  })

  it('goes to the tech address', () => {
    expect(url.startsWith(`mailto:${TECH_EMAIL}?`)).toBe(true)
  })

  it('carries the page, the person and the exact error the screen hid', () => {
    const body = decodeURIComponent(url.split('&body=')[1])
    expect(body).toContain('/dashboard/bookings')
    expect(body).toContain('sam@example.invalid')
    expect(body).toContain('schema cache')
  })

  it('still sends when nothing technical was captured', () => {
    const bare = techMailto({ subject: 'Something looks wrong' })
    expect(decodeURIComponent(bare)).toContain('(none captured)')
  })
})

describe('the glossary', () => {
  it('defines the eight words the review named', () => {
    expect(GLOSSARY_KEYS).toHaveLength(8)
  })

  it('never explains jargon with more jargon', () => {
    // a definition containing the word it defines teaches nothing
    for (const key of GLOSSARY_KEYS) {
      const { title, body } = glossary(key)
      expect(body.length, `${key} has no definition`).toBeGreaterThan(30)
      expect(body).not.toMatch(/\bPGRST|\.sql\b|supabase/i)
      expect(title.length).toBeGreaterThan(0)
    }
  })

  it('points "shoot plan" at the word people have actually seen', () => {
    // somebody who has only ever seen "brief task" has to be able to find it
    expect(GLOSSARY.shoot_plan.body).toMatch(/brief task/i)
    expect(GLOSSARY.shoot.body).toMatch(/batch/i)
  })
})

describe('getting started', () => {
  it('gives each working role three steps, each with a real link', () => {
    for (const role of ['editor', 'scheduler', 'account_manager', 'super_admin'] as const) {
      const panel = panelForRole(role)
      expect(panel, `${role} has no panel`).not.toBeNull()
      expect(panel!.steps).toHaveLength(3)
      for (const step of panel!.steps) {
        // the overview role panels always end each step in a real link
        expect(step.href, `${role} step has no href`).toBeDefined()
        expect(step.href!.startsWith('/dashboard')).toBe(true)
        expect(step.linkLabel!.length).toBeGreaterThan(0)
      }
    }
  })

  it('shows nothing to a client, and nothing before the role is known', () => {
    expect(panelForRole('client')).toBeNull()
    expect(shouldShowGettingStarted('client', null)).toBe(false)
    expect(shouldShowGettingStarted(null, null)).toBe(false)
  })

  it('stays dismissed for the role it was dismissed in', () => {
    expect(shouldShowGettingStarted('editor', null)).toBe(true)
    expect(shouldShowGettingStarted('editor', 'editor')).toBe(false)
  })

  it('comes back once when the job changes', () => {
    // an editor promoted to account manager is doing a different job
    expect(shouldShowGettingStarted('account_manager', 'editor')).toBe(true)
  })
})

describe('notifications say something, and go somewhere', () => {
  it('never prints the raw event name', () => {
    expect(eventWords('prospect_auto_ingested')).toBe('A new enquiry became a client')
    expect(eventWords('job_assigned')).toBe('Assigned to you')
    expect(eventWords('job_assigned')).not.toMatch(/_/)
  })

  it('reads a transition event as the stage it landed in', () => {
    expect(splitTransition('internal_review_approved_for_scheduling'))
      .toEqual({ from: 'internal_review', to: 'approved_for_scheduling' })
    expect(eventWords('transition_internal_review_approved_for_scheduling'))
      .toBe('Moved to Ready to post')
  })

  it('does not invent a meaning for an event it does not know', () => {
    expect(eventWords('some_future_event')).toBeNull()
  })

  it('gives every entity type somewhere to go', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    for (const type of ['content_item', 'batch', 'shoot', 'client', 'intake', 'social_account']) {
      expect(notificationHref(type, id), `${type} is a dead row`).not.toBeNull()
    }
    expect(notificationHref('lead', 'anything')).toBe('/dashboard/leads')
    expect(notificationHref('booking', 'anything')).toBe('/dashboard/bookings')
  })

  it('strips the dedupe suffix off an entity id', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    expect(notificationHref('content_item', `${id}#v2`)).toBe(`/dashboard/production/${id}`)
  })
})

describe('emails are addressed to the person reading them', () => {
  it('tells the recipient what THEY have to do when it is their move', () => {
    expect(transitionSubject({
      title: 'Winter Reel 3', to: 'internal_review',
      stageLabel: 'Ready for checking', recipientRole: 'account_manager',
    })).toBe('Winter Reel 3 needs your review')
  })

  it('never issues an instruction to somebody it is not for', () => {
    // "Ask for changes: Winter Reel 3" arrived in the EDITOR's inbox and read
    // as an order to them, when it meant the opposite
    const subject = transitionSubject({
      title: 'Winter Reel 3', to: 'revision_required',
      stageLabel: 'Being changed', recipientRole: 'scheduler',
    })
    expect(subject).toBe('Winter Reel 3 — now Being changed')
    expect(subject).not.toMatch(/your|Ask for changes/i)
  })

  it('gives the scheduler the outstanding action, not the word "Approved"', () => {
    expect(transitionSubject({
      title: 'Winter Reel 3', to: 'approved_for_scheduling',
      stageLabel: 'Ready to post', recipientRole: 'scheduler',
    })).toBe('Winter Reel 3 needs a posting date')
  })

  it('always carries one line of what happens next', () => {
    expect(whatHappensNext('approved_for_scheduling')).toBe('Signed off. Needs a posting time.')
    expect(whatHappensNext('client_review')).toMatch(/client/i)
  })

  it('writes a date a person can read, never an ISO string', () => {
    const out = longDate('2026-09-11')
    expect(out).toMatch(/September/)
    expect(out).not.toMatch(/2026-09-11/)
    expect(longDate(null)).toBeNull()
    expect(longDate('not a date')).toBeNull()
  })

  it('has exactly one call to action', () => {
    expect(OPEN_ITEM_CTA).toBe('Open the item')
  })
})
