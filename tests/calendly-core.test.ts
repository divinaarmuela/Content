import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { parseBooking, verifySignature, signingKey, bookingPatch, leadStatus, sourceLabel, placementLabel } from '@/app/lib/calendly-core'

const body = (event: string, extra: Record<string, unknown> = {}) => ({
  event, payload: {
    uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1', email: 'Jo@Example.com', name: 'Jo Bloggs Smith',
    text_reminder_number: null, questions_and_answers: [{ question: 'Phone number', answer: '0412 345 678' }],
    tracking: { utm_source: 'fb', utm_medium: 'Facebook_Mobile_Feed', utm_campaign: 'Nov leads', utm_term: 'Melbourne 30-55', utm_content: 'Video A' },
    scheduled_event: { name: 'Discovery call', start_time: '2026-11-12T01:00:00Z' }, ...extra,
  },
})

describe('calendly booking', () => {
  it('stores the booking form answers: service, budget, the rest as notes', () => {
    const b = parseBooking(body('invitee.created', { questions_and_answers: [
      { question: 'Phone number', answer: '+61 423 262 136' },
      { question: 'Which service are you after?', answer: 'Ongoing Marketing Services' },
      { question: 'Tell me about your business', answer: 'Property' },
      { question: "What's your #1 goal in the next 90 days?", answer: 'More leads' },
      { question: 'What is your current monthly marketing budget?', answer: '$4,000 – $7,500/month' },
      { question: 'How did you find MD Marketing?', answer: 'Instagram' },
    ] }))!
    expect(b.phone).toBe('+61 423 262 136')
    const p = bookingPatch(b, null, 'now')
    expect(p.model).toBe('Ongoing Marketing Services'); expect(p.budget).toBe('$4,000 – $7,500/month')
    expect(p.need).toContain('More leads'); expect(p.need).toContain('Instagram'); expect(p.need).not.toContain('423')
    const kept = bookingPatch(b, { model: 'Website', need: 'From the form' }, 'now')
    expect(kept.model).toBeUndefined(); expect(kept.need).toContain('From the form'); expect(kept.need).toContain('More leads')
  })
  it('reads the phone from a phone-call location when no question holds it', () => {
    const b = parseBooking(body('invitee.created', { questions_and_answers: [], scheduled_event: { name: 'Inquiry call', start_time: 'x', location: { type: 'outbound_call', location: '+61 423 262 136' } } }))!
    expect(b.phone).toBe('+61 423 262 136')
    const z = parseBooking(body('invitee.created', { questions_and_answers: [], scheduled_event: { name: 'Zoom', location: { type: 'zoom', location: 'https://zoom.us/j/1' } } }))!
    expect(z.phone).toBeNull()
  })
  it('parses a booking: lowercased email, split name, phone from answers', () => {
    const b = parseBooking(body('invitee.created'))!
    expect(b).toMatchObject({ kind: 'booked', email: 'jo@example.com', fname: 'Jo', lname: 'Bloggs Smith', phone: '0412 345 678', event: 'Discovery call' })
  })
  it('ignores other events and bodies without email', () => {
    expect(parseBooking({ event: 'routing_form_submission.created', payload: {} })).toBeNull()
    expect(parseBooking(body('invitee.created', { email: '' }))).toBeNull()
  })
  it('a new booking from an ad is Call booked with campaign, ad set, ad and placement', () => {
    const p = bookingPatch(parseBooking(body('invitee.created'))!, null, 'now')
    expect(p).toMatchObject({
      stage: 'qualified', booking_status: 'booked', source: 'fb', source_tag: 'Nov leads', call_at: '2026-11-12T01:00:00Z',
      ad_campaign: 'Nov leads', ad_set: 'Melbourne 30-55', ad_name: 'Video A', ad_placement: 'Facebook_Mobile_Feed',
    })
    expect(leadStatus(p as any, k => k)).toBe('Call booked')
  })
  it('a site-button booking has no ad details', () => {
    const p = bookingPatch(parseBooking(body('invitee.created', { tracking: { utm_source: 'website', utm_campaign: 'hero' } }))!, null, 'now')
    expect(p.source).toBe('website'); expect(p.ad_campaign).toBeUndefined()
  })
  it('a form lead that books keeps its name and source, becomes Call booked', () => {
    const p = bookingPatch(parseBooking(body('invitee.created'))!, { fname: 'Joanne', phone: null, stage: 'new', source: 'web_form' }, 'now')
    expect(p.fname).toBe('Joanne'); expect(p.phone).toBe('0412 345 678'); expect(p.source).toBeUndefined()
    expect(p.stage).toBe('qualified')
  })
  it('cancel marks Cancelled and does not move a later stage', () => {
    const p = bookingPatch(parseBooking(body('invitee.canceled'))!, { stage: 'proposal', ad_campaign: 'x' }, 'now')
    expect(p.booking_status).toBe('cancelled'); expect(p.stage).toBeUndefined()
    expect(leadStatus({ booking_status: 'cancelled', stage: 'qualified' }, k => k)).toBe('Cancelled')
  })
  it('form lead without booking is New lead; later stages show their label', () => {
    expect(leadStatus({ stage: 'new' }, k => k)).toBe('New lead')
    expect(leadStatus({ stage: 'proposal', booking_status: 'booked' }, k => `L:${k}`)).toBe('L:proposal')
  })
  it('labels read plainly', () => {
    expect(sourceLabel('web_form')).toBe('Website form')
    expect(sourceLabel('fb', 'Nov leads')).toBe('Facebook · Nov leads')
    expect(sourceLabel(null)).toBe('Unknown')
    expect(placementLabel('Instagram_Stories')).toBe('Instagram stories')
  })
  it('verifies signatures and rejects tampering and old ones', () => {
    const key = signingKey('s'); const raw = '{"a":1}'; const now = 1_800_000_000_000; const t = now / 1000
    const v1 = createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')
    expect(verifySignature(`t=${t},v1=${v1}`, raw, key, now)).toBe(true)
    expect(verifySignature(`t=${t},v1=${v1}`, raw + ' ', key, now)).toBe(false)
    expect(verifySignature(`t=${t},v1=${v1}`, raw, key, now + 3600_000)).toBe(false)
    expect(verifySignature(null, raw, key, now)).toBe(false)
  })
})

describe('status words by source', () => {
  it('only the website form is New lead; the scanner says Emailed in', () => {
    expect(leadStatus({ source: 'web_form', stage: null }, k => k)).toBe('New lead')
    expect(leadStatus({ source: 'email_ingest', stage: null }, k => k)).toBe('Emailed in')
    expect(sourceLabel('email_ingest')).toBe('Email')
  })
})

import { pageLabel } from '@/app/lib/calendly-core'
describe('booked from', () => {
  it('reads the page back and names it plainly', () => {
    const b = parseBooking({ event: 'invitee.created', payload: { uri: 'u', email: 'a@b.co', tracking: { salesforce_uuid: '/campaign-shoots' } } })!
    expect(bookingPatch(b, null, 'now').booked_from).toBe('/campaign-shoots')
    expect(pageLabel('/')).toBe('Home'); expect(pageLabel('/campaign-shoots')).toBe('Campaign shoots')
    expect(parseBooking({ event: 'invitee.created', payload: { uri: 'u', email: 'a@b.co', tracking: { salesforce_uuid: 'abc' } } })!.page).toBeNull()
  })
})
