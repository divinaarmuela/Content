import { describe, expect, it } from 'vitest'
import { answerableBlocks, completion, normaliseDefinition } from '../app/lib/intake-core'
import { TEMPLATES, templateFor } from '../app/lib/intake-templates'

/** THE DISCOVERY FORM (20 Nov 2026: "a discovery intake form we can send to potential clients") */
describe('the discovery form', () => {
  const def = templateFor('discovery')
  const asked = answerableBlocks(def)

  it('asks who they are, then the twenty questions, plus one line for "Other"', () => {
    expect(def.name).toBe('Discovery form')
    expect(asked).toHaveLength(24)
    // it is sent cold: without a name, an email or a phone number there is nobody to answer
    expect(asked.slice(0, 3).map(b => b.id)).toEqual(['primary_contact', 'contact_email', 'contact_mobile'])
    expect(asked[3].label).toBe('What’s your company name?')
    expect(asked[asked.length - 1].label).toBe('How did you hear about us?')
  })
  it('is in the six parts the team wrote it in, after a welcome and their details', () => {
    expect(def.sections.map(s => s.title)).toEqual([
      'Welcome', 'Your details', 'About your business', 'Goals and challenges', 'Current marketing and media', 'Scope and services', 'Budget and timeline', 'One last thing',
    ])
  })
  it('the channels are ticked from a list, and brand guidelines is Yes or No', () => {
    const channels = asked.find(b => b.id === 'channels_today')!
    expect(channels.type).toBe('multi_select')
    expect(channels.options).toEqual(['Social media', 'Email marketing', 'Paid ads', 'SEO', 'Content (blog, video, podcast)', 'PR', 'None yet', 'Other'])
    const guide = asked.find(b => b.id === 'has_brand_guidelines')!
    expect(guide.type).toBe('select')
    expect(guide.options).toEqual(['Yes', 'No'])
  })
  it('no two questions share an id, and the first four keep the ids a client record is filled from', () => {
    const ids = asked.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['public_name', 'website', 'socials', 'ideal_customer']) expect(ids).toContain(id)
  })
  it('survives being saved and read back, and counts what is answered', () => {
    expect(normaliseDefinition(JSON.parse(JSON.stringify(def)), 'discovery')).toEqual(def)
    expect(completion(def, { public_name: 'Acme', channels_today: ['SEO'] })).toMatchObject({ answered: 2, total: 24 })
  })
  it('sits beside the four client intakes without changing them', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(['discovery', 'launch', 'one_off', 'ongoing', 'rebrand'])
  })
})
