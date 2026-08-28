import { describe, it, expect } from 'vitest'
import {
  MONTH_NAMES, normaliseMonth, normaliseYear, currentMonthYear,
  monthLabel, monthlyTitle,
} from '../app/lib/monthly-core'
import { monthlyTemplate, MONTHLY_TEMPLATE } from '../app/lib/monthly-templates'
import { answerableBlocks, completion, normaliseDefinition } from '../app/lib/intake-core'

describe('normaliseMonth', () => {
  it('accepts 1–12 as number or numeric string', () => {
    expect(normaliseMonth(1)).toBe(1)
    expect(normaliseMonth(12)).toBe(12)
    expect(normaliseMonth('9')).toBe(9)
  })
  it('rejects anything outside 1–12', () => {
    expect(normaliseMonth(0)).toBeNull()
    expect(normaliseMonth(13)).toBeNull()
    expect(normaliseMonth('x')).toBeNull()
    expect(normaliseMonth(null)).toBeNull()
    expect(normaliseMonth(1.5)).toBeNull()
  })
})

describe('normaliseYear', () => {
  it('accepts a sane calendar range', () => {
    expect(normaliseYear(2026)).toBe(2026)
    expect(normaliseYear('2030')).toBe(2030)
  })
  it('rejects out-of-range or non-integer years', () => {
    expect(normaliseYear(1999)).toBeNull()
    expect(normaliseYear(2101)).toBeNull()
    expect(normaliseYear('nope')).toBeNull()
  })
})

describe('currentMonthYear', () => {
  it('returns 1-based month and full year', () => {
    // January (getMonth() === 0) must become 1, not 0
    expect(currentMonthYear(new Date('2026-01-15T12:00:00Z'))).toEqual({ month: 1, year: 2026 })
    expect(currentMonthYear(new Date('2026-09-01T12:00:00Z'))).toEqual({ month: 9, year: 2026 })
  })
})

describe('monthLabel / monthlyTitle', () => {
  it('names the month for a human', () => {
    expect(monthLabel(9, 2026)).toBe('September 2026')
    expect(MONTH_NAMES[0]).toBe('January')
  })
  it('builds the default title', () => {
    expect(monthlyTitle(9, 2026)).toBe('Monthly update — September 2026')
  })
  it('degrades rather than printing undefined for a bad month', () => {
    expect(monthLabel(0, 2026)).toBe('January 2026')
  })
})

describe('monthly template', () => {
  it('has the four spec sections and eight answerable questions plus intro guidance', () => {
    const def = monthlyTemplate()
    expect(def).toBe(MONTHLY_TEMPLATE)
    expect(def.sections.map(s => s.title)).toEqual([
      'Your monthly check-in', 'Last month', "This month & what's ahead", 'Content fuel',
    ])
    // 8 real questions; the welcome guidance block is copy, not a question
    expect(answerableBlocks(def)).toHaveLength(8)
    expect(completion(def, {}).total).toBe(8)
  })

  it('survives normaliseDefinition unchanged (stable ids, valid types)', () => {
    const def = monthlyTemplate()
    const repaired = normaliseDefinition(def, 'one_off')
    expect(repaired.sections.flatMap(s => s.blocks).map(b => b.id))
      .toEqual(def.sections.flatMap(s => s.blocks).map(b => b.id))
  })

  it('the "posts made" question keeps its five choices', () => {
    const def = monthlyTemplate()
    const posts = def.sections.flatMap(s => s.blocks).find(b => b.id === 'posts_made')
    expect(posts?.options).toEqual(['All', 'Most', 'About half', 'A few', 'Almost none'])
  })
})
