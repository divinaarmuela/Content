import { describe, it, expect } from 'vitest'
import {
  intakeAnswerView, portalIntakeForms, type IntakeFormRow,
} from '../app/lib/intake-portal-core'
import type { TemplateDefinition } from '../app/lib/intake-core'

const DEF: TemplateDefinition = {
  key: 'rebrand',
  name: 'Rebrand intake',
  sections: [
    {
      id: 'brand', title: 'Brand snapshot',
      blocks: [
        { id: 'why', type: 'guidance', label: 'Tell us the truth' },
        { id: 'name', type: 'short_text', label: 'Business name' },
        { id: 'goals', type: 'long_text', label: 'Goals' },
        { id: 'channels', type: 'multi_select', label: 'Channels', options: ['IG', 'TikTok'] },
      ],
    },
    // a section of nothing but guidance must not print an empty heading
    { id: 'note', title: 'A note', blocks: [{ id: 'n', type: 'guidance', label: 'FYI' }] },
  ],
}

const ANSWERS = { name: 'Acme', channels: ['IG', 'TikTok'] }

describe('intakeAnswerView', () => {
  const view = intakeAnswerView(DEF, ANSWERS)

  it('drops guidance blocks and guidance-only sections', () => {
    expect(view).toHaveLength(1)
    expect(view[0].id).toBe('brand')
    expect(view[0].rows.map(r => r.id)).toEqual(['name', 'goals', 'channels'])
  })

  it('joins array answers and flags unanswered', () => {
    const rows = Object.fromEntries(view[0].rows.map(r => [r.id, r]))
    expect(rows.name.text).toBe('Acme')
    expect(rows.name.answered).toBe(true)
    expect(rows.channels.text).toBe('IG, TikTok')
    expect(rows.channels.answered).toBe(true)
    expect(rows.goals.text).toBe('')
    expect(rows.goals.answered).toBe(false)
  })
})

describe('portalIntakeForms', () => {
  const base = (over: Partial<IntakeFormRow>): IntakeFormRow => ({
    id: 'f', title: 'Brief', definition: DEF, answers: ANSWERS, ...over,
  })

  it('shows only forms toggled on', () => {
    const rows = [
      base({ id: 'on', show_on_portal: true }),
      base({ id: 'off', show_on_portal: false }),
      base({ id: 'missing' }), // column absent → undefined → not shown
      base({ id: 'null', show_on_portal: null }),
    ]
    expect(portalIntakeForms(rows).map(f => f.id)).toEqual(['on'])
  })

  it('is empty when nothing is toggled on (portal shows no tab)', () => {
    expect(portalIntakeForms([base({ show_on_portal: false })])).toEqual([])
    expect(portalIntakeForms([])).toEqual([])
  })

  it('orders most recent first by submitted_at then created_at', () => {
    const rows = [
      base({ id: 'a', show_on_portal: true, submitted_at: '2026-01-01T00:00:00Z' }),
      base({ id: 'b', show_on_portal: true, submitted_at: '2026-03-01T00:00:00Z' }),
      base({ id: 'c', show_on_portal: true, submitted_at: null, created_at: '2026-02-01T00:00:00Z' }),
    ]
    expect(portalIntakeForms(rows).map(f => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('carries a title fallback and answered/total counts', () => {
    const [form] = portalIntakeForms([base({ show_on_portal: true, title: '  ' })])
    expect(form.title).toBe('Intake form')
    expect(form.total).toBe(3) // name, goals, channels
    expect(form.answered).toBe(2) // name, channels
  })

  it('tolerates a form with no answers', () => {
    const [form] = portalIntakeForms([base({ show_on_portal: true, answers: null })])
    expect(form.answered).toBe(0)
    expect(form.total).toBe(3)
  })
})
