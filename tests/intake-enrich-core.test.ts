import { describe, it, expect } from 'vitest'
import {
  parsePrimaryContact, deriveContact, deriveVoiceTone, splitWords, extractHandles,
  deriveBrandFill, planEnrichment, answerText, TONE_PHRASES,
  extractEmail, extractPhone, deriveContactFromFreeText,
  nameFromEmail, isBadName, cleanContactName,
  toLabeledAnswers, selectRelevantAnswers, missingTargets,
  type LabeledAnswer,
} from '../app/lib/intake-enrich-core'
import { emptyProfile, normaliseProfile, type BrandProfile } from '../app/lib/brand-profile-core'
import type { Answers } from '../app/lib/intake-core'

const profile = (over: Partial<BrandProfile> = {}): BrandProfile =>
  normaliseProfile({ ...emptyProfile(), ...over })

const labeled = (rows: [string, string, string][]): LabeledAnswer[] =>
  rows.map(([id, label, value]) => ({ id, label, value }))

describe('answerText', () => {
  it('trims strings and joins multi-answers', () => {
    expect(answerText({ a: '  hi  ' }, 'a')).toBe('hi')
    expect(answerText({ a: ['x', ' y '] }, 'a')).toBe('x, y')
    expect(answerText({}, 'missing')).toBe('')
  })
})

describe('parsePrimaryContact', () => {
  it('splits name from title on the first separator', () => {
    expect(parsePrimaryContact('Jane Smith, Managing Director'))
      .toEqual({ name: 'Jane Smith', role: 'Managing Director' })
    expect(parsePrimaryContact('Jane Smith - Owner')).toEqual({ name: 'Jane Smith', role: 'Owner' })
    expect(parsePrimaryContact('Jane Smith\nFounder')).toEqual({ name: 'Jane Smith', role: 'Founder' })
  })
  it('keeps a comma inside the title (splits only once)', () => {
    expect(parsePrimaryContact('Sam Lee, Owner, Founder')).toEqual({ name: 'Sam Lee', role: 'Owner, Founder' })
  })
  it('treats a bare name as all name, no role', () => {
    expect(parsePrimaryContact('Alex Chen')).toEqual({ name: 'Alex Chen', role: '' })
    expect(parsePrimaryContact('   ')).toEqual({ name: '', role: '' })
  })
})

describe('deriveContact (structured fast-path)', () => {
  it('maps the standard fields into a contact', () => {
    const a: Answers = {
      primary_contact: 'Jane Smith, Owner',
      contact_email: 'jane@example.invalid',
      contact_mobile: '0400 000 000',
      best_call_window: 'Weekday mornings',
    }
    expect(deriveContact(a)).toEqual({
      name: 'Jane Smith', role: 'Owner', email: 'jane@example.invalid',
      phone: '0400 000 000', notes: 'Best window for calls: Weekday mornings',
    })
  })
  it('returns null when there is neither a name nor an email (e.g. the ongoing template has no such fields)', () => {
    expect(deriveContact({ contact_mobile: '123' })).toBeNull()
    expect(deriveContact({ day_to_day_contact: 'Jordan Wilson\n0488 420 104' })).toBeNull()
  })
})

describe('extractEmail / extractPhone', () => {
  it('pulls an email and phone from anywhere in free text', () => {
    expect(extractEmail('call me — jordan@tkbg.com.au — anytime')).toBe('jordan@tkbg.com.au')
    expect(extractEmail('no address here')).toBe('')
    expect(extractPhone('Jordan Wilson\n0488 420 104\njordan@tkbg.com.au')).toBe('0488 420 104')
    expect(extractPhone('reach me on 0490376772 please')).toBe('0490376772')
  })
})

describe('nameFromEmail / isBadName / cleanContactName — the name guard', () => {
  it('derives a proper name from the email local-part', () => {
    expect(nameFromEmail('cadell@tkbg.com')).toBe('Cadell')
    expect(nameFromEmail('jordan.wilson@tkbg.com.au')).toBe('Jordan Wilson')
    expect(nameFromEmail('info@tkbg.com')).toBe('')       // generic mailbox
    expect(nameFromEmail('')).toBe('')
  })
  it('rejects pronouns, fragments, @/digits and over-long runs', () => {
    expect(isBadName('Myself and Cadell for')).toBe(true)  // pronoun + filler
    expect(isBadName('We are the founders')).toBe(true)
    expect(isBadName('jordan@tkbg.com')).toBe(true)        // has @
    expect(isBadName('Team 2024')).toBe(true)              // has digit
    expect(isBadName('One Two Three Four Five')).toBe(true) // >4 words
    expect(isBadName('Jordan Wilson')).toBe(false)
    expect(isBadName('Cadell')).toBe(false)
  })
  it('keeps a good name, replaces a bad one with the email-derived name', () => {
    expect(cleanContactName('Jordan Wilson', 'jordan@tkbg.com')).toBe('Jordan Wilson')
    expect(cleanContactName('Myself and Cadell for', 'cadell@tkbg.com')).toBe('Cadell')
    expect(cleanContactName('We', 'info@tkbg.com')).toBe('') // nothing sensible → blank
  })
})

describe('deriveContactFromFreeText — the ongoing/Turnkey free-text contact', () => {
  it('parses a clean name + phone + email blob unchanged', () => {
    const c = deriveContactFromFreeText('Jordan Wilson\n0488 420 104\njordan@tkbg.com.au')
    expect(c).toEqual({ name: 'Jordan Wilson', role: '', email: 'jordan@tkbg.com.au', phone: '0488 420 104', notes: '' })
  })
  it('extracts the REAL name (not the leading sentence) when two people are named in prose', () => {
    const c = deriveContactFromFreeText('Myself and Cadell for day to day content discussions, 0490376772 cadell@tkbg.com')
    expect(c?.name).toBe('Cadell')            // NOT "Myself and Cadell for"
    expect(c?.email).toBe('cadell@tkbg.com')
    expect(c?.phone).toBe('0490376772')
  })
  it('returns null when there is neither a name nor an email', () => {
    expect(deriveContactFromFreeText('   ')).toBeNull()
  })
})

describe('deriveVoiceTone', () => {
  it('maps the known options to phrases and passes custom values through', () => {
    expect(deriveVoiceTone({ tone: 'Warm and family' })).toBe(TONE_PHRASES['Warm and family'])
    expect(deriveVoiceTone({ tone: 'Both, balanced' })).toContain('aspirational')
    expect(deriveVoiceTone({ tone: 'Edgy and loud' })).toBe('Edgy and loud')
    expect(deriveVoiceTone({})).toBe('')
  })
})

describe('splitWords', () => {
  it('splits lists on commas, slashes and "and"', () => {
    expect(splitWords('bold, honest and local')).toEqual(['bold', 'honest', 'local'])
    expect(splitWords('')).toEqual([])
  })
})

describe('extractHandles — cleans messy socials, never stores a raw URL', () => {
  it('keeps explicit @handles', () => {
    expect(extractHandles('@brand and @brand_tiktok')).toEqual(['@brand', '@brand_tiktok'])
  })
  it('drops a trailing platform note and a stray phrase', () => {
    expect(extractHandles('brandco, on Instagram')).toEqual(['@brandco'])
    expect(extractHandles('turnkeybuildinggroup (Instagram)')).toEqual(['@turnkeybuildinggroup'])
  })
  it('strips full and bare URLs down to a handle (the real Turnkey answer)', () => {
    const raw = 'turnkeybuildinggroup (Instagram), turnkey-building-group (LinkedIn), https://www.facebook.com/p/Turnkey-Building-Group-100064/'
    const h = extractHandles(raw)
    expect(h).toContain('@turnkeybuildinggroup')
    expect(h).toContain('@turnkey-building-group')
    // no raw URLs, no "@https…" mess
    expect(h.every(x => !/https?|:\/\/|\.com|\//.test(x))).toBe(true)
    expect(h.some(x => x.startsWith('@https'))).toBe(false)
  })
  it('pulls the handle out of an instagram URL', () => {
    expect(extractHandles('https://instagram.com/zztestco')).toEqual(['@zztestco'])
    expect(extractHandles('instagram.com/zztestco')).toEqual(['@zztestco'])
  })
})

describe('deriveBrandFill — fills only empty fields, never overwrites', () => {
  const answers: Answers = {
    tone: 'Aspirational and premium',
    three_words: 'bold, honest, local',
    never_words: 'cheap, tacky',
    socials: '@brandco',
    tagline: 'Built to last',
    website: 'brandco.example.invalid',
  }
  const files = [{ name: 'logo.svg', url: 'https://cdn.example.invalid/logo.svg' }]

  it('fills an empty profile from the answers', () => {
    const { profile: out, changed } = deriveBrandFill(answers, files, emptyProfile())
    const n = normaliseProfile(out)
    expect(changed).toBe(true)
    expect(n.voice.tone).toBe('Aspirational and premium')
    expect(n.voice.dos).toEqual(['bold', 'honest', 'local'])
    expect(n.voice.donts).toEqual(['cheap', 'tacky'])
    expect(n.handles).toEqual(['@brandco'])
    expect(n.logo_files).toEqual([{ name: 'logo.svg', url: 'https://cdn.example.invalid/logo.svg' }])
    expect(n.notes).toContain('Built to last')
  })

  it('does not overwrite fields that already have content', () => {
    const current = profile({
      voice: { summary: '', tone: 'Hand-picked tone', dos: ['existing'], donts: [] },
      handles: ['@existing'],
      logo_files: [{ name: 'old.png', url: 'https://cdn.example.invalid/old.png' }],
      notes: 'A note that was already here',
    })
    const { profile: out } = deriveBrandFill(answers, files, current)
    const n = normaliseProfile(out)
    expect(n.voice.tone).toBe('Hand-picked tone')
    expect(n.voice.dos).toEqual(['existing'])
    expect(n.voice.donts).toEqual(['cheap', 'tacky'])
    expect(n.handles).toEqual(['@existing'])
    expect(n.logo_files.map(f => f.name)).toEqual(['old.png'])
    expect(n.notes).toBe('A note that was already here')
  })

  it('reports no change when nothing maps and everything is filled', () => {
    const current = profile({
      voice: { summary: 's', tone: 't', dos: ['d'], donts: ['n'] },
      handles: ['@h'],
      logo_files: [{ name: 'l.png', url: 'https://cdn.example.invalid/l.png' }],
      notes: 'notes',
    })
    expect(deriveBrandFill({}, [], current).changed).toBe(false)
  })
})

describe('toLabeledAnswers / selectRelevantAnswers', () => {
  it('labels answers and drops empties', () => {
    const out = toLabeledAnswers({ a: 'hi', b: '' }, new Map([['a', 'Question A']]))
    expect(out).toEqual([{ id: 'a', label: 'Question A', value: 'hi' }])
  })
  it('selects only contact/brand-relevant answers, by id OR label', () => {
    const rows = labeled([
      ['day_to_day_contact', 'Primary contact for day-to-day communication', 'Jordan, 0488 420 104'],
      ['founder_stories', 'Each founder, where you came from', 'Two brothers…'],
      ['three_words', 'Three words you should feel', 'bold, honest'],
      ['parking', 'Parking for crew and gear', 'Out front'],
      ['catering', 'Catering and dietary notes', 'None'],
    ])
    const picked = selectRelevantAnswers(rows).map(a => a.id)
    expect(picked).toContain('day_to_day_contact')
    expect(picked).toContain('founder_stories')
    expect(picked).toContain('three_words')
    expect(picked).not.toContain('parking')
    expect(picked).not.toContain('catering')
  })
})

describe('missingTargets', () => {
  it('reports what is still empty after the deterministic pass', () => {
    const m = missingTargets(profile({ voice: { summary: '', tone: 'Warm', dos: ['x'], donts: [], } }), false)
    expect(m).toEqual({ contact: true, tone: false, dos: false, donts: true, summary: true, handles: true })
  })
})

describe('planEnrichment — the token gate', () => {
  const contactRow = labeled([['day_to_day_contact', 'Primary contact for day-to-day', 'Jordan Wilson\n0488 420 104\njordan@tkbg.com.au']])
  const voiceRow = labeled([['brand_as_person', 'If the business were a person…', 'Warm, reliable, local']])

  it('skips the AI when every target is filled and a contact is resolved', () => {
    const full = profile({
      voice: { summary: 's', tone: 't', dos: ['d'], donts: ['n'] }, handles: ['@h'],
    })
    expect(planEnrichment(full, true, [...contactRow, ...voiceRow]).aiNeeded).toBe(false)
  })

  it('skips the AI when a target is empty but there is no relevant answer to read', () => {
    expect(planEnrichment(emptyProfile(), true, labeled([['parking', 'Parking', 'Out front']])).aiNeeded).toBe(false)
  })

  it('calls the AI when the voice summary is blank and a relevant answer exists', () => {
    const plan = planEnrichment(profile({ voice: { summary: '', tone: 't', dos: ['d'], donts: ['n'] }, handles: ['@h'] }), true, voiceRow)
    expect(plan.missing.summary).toBe(true)
    expect(plan.aiNeeded).toBe(true)
    expect(plan.relevant.map(r => r.id)).toContain('brand_as_person')
  })

  it('calls the AI for the ongoing template: no contact resolved, day_to_day_contact present', () => {
    // ongoing has no primary_contact block, so deriveContact yields nothing and
    // the contact must come from the free-text day_to_day_contact answer
    const plan = planEnrichment(emptyProfile(), false, contactRow)
    expect(plan.missing.contact).toBe(true)
    expect(plan.aiNeeded).toBe(true)
    expect(plan.relevant.map(r => r.id)).toContain('day_to_day_contact')
  })
})
