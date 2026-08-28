import { describe, it, expect } from 'vitest'
import {
  parsePrimaryContact, deriveContact, deriveVoiceTone, splitWords, extractHandles,
  deriveBrandFill, planEnrichment, voiceSummarySources, extraAnswers, answerText,
  TONE_PHRASES,
} from '../app/lib/intake-enrich-core'
import { emptyProfile, normaliseProfile, type BrandProfile } from '../app/lib/brand-profile-core'
import type { Answers } from '../app/lib/intake-core'

const profile = (over: Partial<BrandProfile> = {}): BrandProfile =>
  normaliseProfile({ ...emptyProfile(), ...over })

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
    expect(parsePrimaryContact('Jane Smith - Owner'))
      .toEqual({ name: 'Jane Smith', role: 'Owner' })
    expect(parsePrimaryContact('Jane Smith\nFounder'))
      .toEqual({ name: 'Jane Smith', role: 'Founder' })
  })
  it('keeps a comma inside the title (splits only once)', () => {
    expect(parsePrimaryContact('Sam Lee, Owner, Founder'))
      .toEqual({ name: 'Sam Lee', role: 'Owner, Founder' })
  })
  it('treats a bare name as all name, no role', () => {
    expect(parsePrimaryContact('Alex Chen')).toEqual({ name: 'Alex Chen', role: '' })
    expect(parsePrimaryContact('   ')).toEqual({ name: '', role: '' })
  })
})

describe('deriveContact', () => {
  it('maps the standard fields into a contact', () => {
    const a: Answers = {
      primary_contact: 'Jane Smith, Owner',
      contact_email: 'jane@example.invalid',
      contact_mobile: '0400 000 000',
      best_call_window: 'Weekday mornings',
    }
    expect(deriveContact(a)).toEqual({
      name: 'Jane Smith',
      role: 'Owner',
      email: 'jane@example.invalid',
      phone: '0400 000 000',
      notes: 'Best window for calls: Weekday mornings',
    })
  })
  it('returns null when there is neither a name nor an email', () => {
    expect(deriveContact({ contact_mobile: '123' })).toBeNull()
  })
  it('works from an email alone', () => {
    expect(deriveContact({ contact_email: 'x@y.invalid' })?.email).toBe('x@y.invalid')
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

describe('splitWords / extractHandles', () => {
  it('splits lists on commas, slashes and "and"', () => {
    expect(splitWords('bold, honest and local')).toEqual(['bold', 'honest', 'local'])
    expect(splitWords('')).toEqual([])
  })
  it('prefers @handles, else keeps single tokens', () => {
    expect(extractHandles('@brand and @brand_tiktok')).toEqual(['@brand', '@brand_tiktok'])
    expect(extractHandles('brandco, on Instagram')).toEqual(['@brandco'])
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
    expect(n.notes).toContain('brandco.example.invalid')
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
    expect(n.voice.tone).toBe('Hand-picked tone')       // untouched
    expect(n.voice.dos).toEqual(['existing'])           // untouched
    expect(n.voice.donts).toEqual(['cheap', 'tacky'])   // was empty → filled
    expect(n.handles).toEqual(['@existing'])            // untouched
    expect(n.logo_files.map(f => f.name)).toEqual(['old.png']) // untouched
    expect(n.notes).toBe('A note that was already here') // untouched
  })

  it('reports no change when nothing maps and everything is filled', () => {
    const current = profile({
      voice: { summary: 's', tone: 't', dos: ['d'], donts: ['n'] },
      handles: ['@h'],
      logo_files: [{ name: 'l.png', url: 'https://cdn.example.invalid/l.png' }],
      notes: 'notes',
    })
    const { changed } = deriveBrandFill({}, [], current)
    expect(changed).toBe(false)
  })
})

describe('voiceSummarySources / extraAnswers', () => {
  it('collects only the non-empty voice sources', () => {
    const ids = voiceSummarySources({ admired: 'Aesop', perception: '', misconception: 'x' }).map(a => a.id)
    expect(ids).toEqual(['admired', 'misconception'])
  })
  it('extras exclude mapped and voice-source ids', () => {
    const ids = extraAnswers({
      primary_contact: 'mapped', admired: 'voice source',
      not_asked: 'hello there', empty: '',
    }).map(a => a.id)
    expect(ids).toEqual(['not_asked'])
  })
})

describe('planEnrichment — the AI gate', () => {
  it('skips the AI when the summary is present and a contact is resolved', () => {
    const current = profile({ voice: { summary: 'Already written', tone: '', dos: [], donts: [] } })
    const plan = planEnrichment({ admired: 'Aesop', not_asked: 'blah' }, current, true)
    expect(plan.aiNeeded).toBe(false)
    expect(plan.aiVoiceNeeded).toBe(false)
    expect(plan.aiContactNeeded).toBe(false)
  })

  it('skips the AI when nothing fuzzy is missing at all', () => {
    const plan = planEnrichment({ tone: 'Warm and family' }, emptyProfile(), true)
    expect(plan.aiNeeded).toBe(false)
  })

  it('wants a voice summary when it is blank and there are sources', () => {
    const plan = planEnrichment({ admired: 'Aesop, for its restraint' }, emptyProfile(), true)
    expect(plan.aiVoiceNeeded).toBe(true)
    expect(plan.aiNeeded).toBe(true)
    expect(plan.voiceSources).toHaveLength(1)
  })

  it('wants a contact when none is resolved and there are unmapped answers', () => {
    const plan = planEnrichment({ some_custom_block: 'Call Jane on jane@x.invalid' }, emptyProfile(), false)
    expect(plan.aiContactNeeded).toBe(true)
    expect(plan.aiNeeded).toBe(true)
  })

  it('does not want a contact once one is resolved, even with extras present', () => {
    const plan = planEnrichment({ some_custom_block: 'noise' }, emptyProfile(), true)
    expect(plan.aiContactNeeded).toBe(false)
  })
})
