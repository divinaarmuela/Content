import { describe, expect, it } from 'vitest'
import { answerableBlocks, completion, normaliseDefinition } from '../app/lib/intake-core'
import { TEMPLATES, templateFor } from '../app/lib/intake-templates'

/** THE DISCOVERY FORM (20 Nov 2026: "a discovery intake form we can send to potential clients") */
describe('the discovery form', () => {
  const def = templateFor('discovery')
  const asked = answerableBlocks(def)

  it('asks who they are, then the twenty questions, plus one line for "Other"', () => {
    expect(def.name).toBe('Discovery form')
    // 24 questions always on the page, plus the upload box that shows only after a Yes
    expect(asked).toHaveLength(25)
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

import { formatSocialHandles, mergeAnswers, parseSocialHandles } from '../app/lib/intake-core'

/** SOCIAL HANDLES, ONE PER PLATFORM (20 Nov 2026: "selecting social media icons and providing the handle there, for each") */
describe('social handles, picked by icon', () => {
  const def = templateFor('discovery')
  it('the discovery form asks for them by platform; a client’s intake keeps its one-line box', () => {
    expect(answerableBlocks(def).find(b => b.id === 'socials')?.type).toBe('social_handles')
    for (const key of ['ongoing', 'rebrand', 'launch', 'one_off'] as const) {
      expect(answerableBlocks(TEMPLATES[key]).some(b => b.type === 'social_handles'), key).toBe(false)
    }
  })
  it('the answer is one piece of text, a line per platform, in the platforms’ own order', () => {
    const text = formatSocialHandles([{ platform: 'tiktok', handle: ' @acme.tt ' }, { platform: 'instagram', handle: '@acme' }, { platform: 'facebook', handle: '' }])
    expect(text).toBe('Instagram: @acme\nTikTok: @acme.tt')
    expect(parseSocialHandles(text)).toEqual([{ platform: 'instagram', handle: '@acme' }, { platform: 'tiktok', handle: '@acme.tt' }])
  })
  it('reads only what it knows, and a link with a colon in it stays whole', () => {
    expect(parseSocialHandles('Instagram: https://instagram.com/acme\nMySpace: tom\nnot a line')).toEqual([{ platform: 'instagram', handle: 'https://instagram.com/acme' }])
    expect(parseSocialHandles(null)).toEqual([])
    expect(parseSocialHandles('X: @acme')).toEqual([{ platform: 'twitter', handle: '@acme' }])
  })
  it('saves like any text answer, counts as answered, and clears when every handle is removed', () => {
    const saved = mergeAnswers(def, {}, { socials: 'Instagram: @acme' })
    expect(saved.socials).toBe('Instagram: @acme')
    expect(completion(def, saved).answered).toBe(1)
    expect(mergeAnswers(def, saved, { socials: formatSocialHandles([{ platform: 'instagram', handle: '' }]) }).socials).toBeUndefined()
  })
})

import { readFileSync } from 'node:fs'
import { blockShown } from '../app/lib/intake-core'
import { intakeFileTarget } from '../app/lib/gdrive-core'
import { brandAssetProblem } from '../app/lib/brand-assets-core'

/** UPLOADS, ONLY AFTER A YES (20 Nov 2026: "allow users to upload multiple files if they said yes … put file type and limit for each file size") */
describe('the brand files upload', () => {
  const def = templateFor('discovery')
  const box = answerableBlocks(def).find(b => b.id === 'brand_files')!
  it('is a file box that waits on Yes to the brand guidelines question', () => {
    expect(box.type).toBe('file')
    expect(box.showIf).toEqual({ id: 'has_brand_guidelines', equals: 'Yes' })
    expect(blockShown(box, {})).toBe(false)
    expect(blockShown(box, { has_brand_guidelines: 'No' })).toBe(false)
    expect(blockShown(box, { has_brand_guidelines: 'Yes' })).toBe(true)
  })
  it('is not counted as unanswered while it is not on the page', () => {
    expect(completion(def, {}).total).toBe(24)
    expect(completion(def, { has_brand_guidelines: 'No' })).toMatchObject({ answered: 1, total: 24 })
    expect(completion(def, { has_brand_guidelines: 'Yes' })).toMatchObject({ answered: 1, total: 25 })
    expect(completion(def, { has_brand_guidelines: 'Yes', brand_files: ['logo.png', 'guide.pdf'] })).toMatchObject({ answered: 2, total: 25 })
  })
  it('the rule survives the form being saved and read back', () => {
    const back = normaliseDefinition(JSON.parse(JSON.stringify(def)), 'discovery')
    expect(answerableBlocks(back).find(b => b.id === 'brand_files')?.showIf).toEqual({ id: 'has_brand_guidelines', equals: 'Yes' })
  })
  it('no question on a client’s intake form waits on another', () => {
    for (const key of ['ongoing', 'rebrand', 'launch', 'one_off'] as const) expect(answerableBlocks(TEMPLATES[key]).some(b => b.showIf), key).toBe(false)
  })
  it('takes what the client Brand tab takes: 1 GB a file, and the same kinds, design files and video included', () => {
    const GB = 1024 * 1024 * 1024
    expect(brandAssetProblem('logo.png', 2000)).toBeNull()
    expect(brandAssetProblem('brand-pack.zip', 800 * 1024 * 1024)).toBeNull()
    expect(brandAssetProblem('master.ai', 300 * 1024 * 1024)).toBeNull()
    expect(brandAssetProblem('brand-film.mp4', GB)).toBeNull()
    expect(brandAssetProblem('huge.zip', GB + 1)).toContain('over 1 GB')
    expect(brandAssetProblem('virus.exe', 2000)).toContain('not a brand file we can take')
    expect(brandAssetProblem('empty.png', 0)).toContain('is empty')
  })
  it('every intake form uploads under that one rule: the old 50MB rule is gone from the route', () => {
    const route = readFileSync('app/api/intake/[token]/upload/route.ts', 'utf8')
    expect(route).toContain('const why = brandAssetProblem(filename, size)')
    expect(route).not.toMatch(/UPLOAD_MAX_BYTES|must be under|template_key === 'discovery'/)
    expect(readFileSync('app/intake/[token]/blocks.tsx', 'utf8')).toContain('Up to 1 GB each')
    // one upload box for every form: several files, the rules said first
    const form = readFileSync('app/intake/[token]/IntakeForm.tsx', 'utf8')
    expect(form.match(/<MultiFileBlock/g)).toHaveLength(1)
    expect(form).not.toContain('<FileBlock')
  })
  it('all four client forms, and the discovery form, ask for logo and brand files', () => {
    for (const key of ['ongoing', 'rebrand', 'launch', 'one_off', 'discovery'] as const) {
      const box = answerableBlocks(TEMPLATES[key]).find(b => b.id === 'brand_files')
      expect(box?.type, key).toBe('file')
      // "brand" in the id is what sends its files to the client's Brand tab (intakeFileTarget)
      expect(intakeFileTarget(box!.id, box!.label), key).toBe('brand')
    }
  })
  it('on submit, a brand question’s files are added to the client’s Brand tab beside what is there', () => {
    const submit = readFileSync('app/api/intake/[token]/submit/route.ts', 'utf8')
    expect(submit).toContain("if (intakeFileTarget(f.block_id, labels.get(f.block_id) ?? '') !== 'brand') continue")
    expect(submit).toContain("await addClientBrandFile(clientId, { name: f.filename, url: f.url }, 'intake form')")
  })
})
