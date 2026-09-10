import { describe, expect, it } from 'vitest'
import {
  ACT_AS_COOKIE, ACT_AS_EMAIL, ACT_AS_MAX_AGE_SECONDS,
  actorLabel, auditActorName, mayActAs, readActAs,
} from '@/app/lib/act-as-core'

/**
 * The rule the whole feature rests on: ONE address, and a cookie that says
 * nothing on its own. Everything here is the pure half — the server checks
 * the row exists and is active; this decides who may ask.
 */

describe('mayActAs', () => {
  it('is the one address, however it is typed', () => {
    expect(mayActAs('tech@mdmmarketing.com.au')).toBe(true)
    expect(mayActAs('TECH@MDMMarketing.com.au')).toBe(true)
    expect(mayActAs('  tech@mdmmarketing.com.au  ')).toBe(true)
    expect(ACT_AS_EMAIL).toBe('tech@mdmmarketing.com.au')
  })

  it('is nobody else — not another super admin, not a lookalike', () => {
    expect(mayActAs('divina@mdmmarketing.com.au')).toBe(false)
    expect(mayActAs('tech@mdmmarketing.com')).toBe(false)
    expect(mayActAs('tech@mdmmarketing.com.au.evil.test')).toBe(false)
    expect(mayActAs('x tech@mdmmarketing.com.au')).toBe(false)
    expect(mayActAs('')).toBe(false)
    expect(mayActAs(null)).toBe(false)
    expect(mayActAs(undefined)).toBe(false)
  })
})

describe('readActAs', () => {
  it('gives back a plausible team_users id', () => {
    expect(readActAs('tu-1')).toBe('tu-1')
    expect(readActAs(' 8f14e45fceea167a5a36dedd4bea2543 ')).toBe('8f14e45fceea167a5a36dedd4bea2543')
    expect(readActAs('-NxAbc_123')).toBe('-NxAbc_123')
  })

  it('refuses anything that is not one', () => {
    expect(readActAs(null)).toBeNull()
    expect(readActAs(undefined)).toBeNull()
    expect(readActAs('')).toBeNull()
    expect(readActAs('   ')).toBeNull()
    // the Realtime Database forbids these in a key, so they were never an id
    for (const bad of ['a/b', 'a.b', 'a#b', 'a$b', 'a[b', 'a]b', '../../tables', 'a b']) {
      expect(readActAs(bad)).toBeNull()
    }
    expect(readActAs('x'.repeat(129))).toBeNull()
  })

  it('names the cookie once, and lapses in 12 hours', () => {
    expect(ACT_AS_COOKIE).toBe('mdm_act_as')
    expect(ACT_AS_MAX_AGE_SECONDS).toBe(12 * 60 * 60)
  })
})

describe('actorLabel', () => {
  it('names both people while somebody is acting as somebody', () => {
    expect(actorLabel('Tech MD', 'Renee Yap')).toBe('Tech MD, acting as Renee Yap')
    expect(actorLabel({ name: 'Tech MD' }, { name: 'Renee Yap' })).toBe('Tech MD, acting as Renee Yap')
  })

  it('is just your name when you are only yourself', () => {
    expect(actorLabel('Tech MD', null)).toBe('Tech MD')
    expect(actorLabel('Tech MD', { name: '  ' })).toBe('Tech MD')
    expect(actorLabel(null, 'Renee Yap')).toBe('Renee Yap')
  })
})

describe('auditActorName', () => {
  it('keeps the action theirs and still says who really did it', () => {
    expect(auditActorName('Renee Yap', 'Tech MD')).toBe('Renee Yap (Tech MD acting as them)')
  })

  it('is the plain name when nobody was acting', () => {
    expect(auditActorName('Renee Yap', null)).toBe('Renee Yap')
    expect(auditActorName(null, null)).toBe('someone')
    expect(auditActorName('', 'Tech MD')).toBe('someone (Tech MD acting as them)')
  })
})
