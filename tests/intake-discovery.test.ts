import { describe, expect, it } from 'vitest'
import { answerableBlocks, completion, normaliseDefinition } from '../app/lib/intake-core'
import { TEMPLATES, templateFor } from '../app/lib/intake-templates'

/** THE DISCOVERY FORM (20 Nov 2026: "a discovery intake form we can send to potential clients") */
describe('the discovery form', () => {
  const def = templateFor('discovery')
  const asked = answerableBlocks(def)

  it('asks who they are, then the twenty questions, plus one line for "Other"', () => {
    expect(def.name).toBe('Discovery form')
    // somebody only enquiring is not asked to upload anything (20 Nov 2026): no file box on this form
    // (27 boxes: the twenty questions, their details, their industry, and a line for "Other" under industry, channels and services)
    expect(asked).toHaveLength(27)
    expect(asked.some(b => b.type === 'file')).toBe(false)
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
    expect(channels.options).toEqual(['Social media', 'Website', 'Email marketing', 'Paid ads', 'SEO', 'Content (blog, video, podcast)', 'PR', 'None yet', 'Other'])
    const guide = asked.find(b => b.id === 'has_brand_guidelines')!
    expect(guide.type).toBe('select')
    expect(guide.options).toEqual(['Yes', 'No'])
  })
  it('services are ticked from our own list, the Services page’s names, with Other and a line for specifics', () => {
    const services = asked.find(b => b.id === 'services_wanted')!
    expect(services.type).toBe('multi_select')
    expect(services.options).toEqual(['Content Production', 'Ongoing Marketing', 'Brand & Strategy', 'Personal Brand', 'Podcast Studio', 'Website Optimisation', 'Not sure yet', 'Other'])
    const page = readFileSync('app/services/page.tsx', 'utf8')
    for (const name of services.options!.slice(0, 6)) expect(page, name).toContain(`name: '${name}'`)
    expect(asked.find(b => b.id === 'services_other')?.type).toBe('short_text')
  })
  it('no two questions share an id, and the first four keep the ids a client record is filled from', () => {
    const ids = asked.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['public_name', 'website', 'socials', 'ideal_customer']) expect(ids).toContain(id)
  })
  it('survives being saved and read back, and counts what is answered', () => {
    expect(normaliseDefinition(JSON.parse(JSON.stringify(def)), 'discovery')).toEqual(def)
    expect(completion(def, { public_name: 'Acme', channels_today: ['SEO'] })).toMatchObject({ answered: 2, total: 27 })
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
import { blockShown, type Block, type TemplateDefinition } from '../app/lib/intake-core'
import { intakeFileTarget } from '../app/lib/gdrive-core'
import { brandAssetProblem } from '../app/lib/brand-assets-core'

/** A QUESTION THAT WAITS ON ANOTHER'S ANSWER, and the upload rule (20 Nov 2026). The discovery form used this for an
 *  upload box after "Yes"; that box is gone ("they don't have to upload anything yet"), the rule stays for any form. */
describe('the brand files upload', () => {
  const waits: Block = { id: 'brand_files', type: 'file', label: 'Files', showIf: { id: 'has_brand_guidelines', equals: 'Yes' } }
  const def: TemplateDefinition = { key: 'discovery', name: 'T', sections: [{ id: 's', title: 'S', blocks: [
    { id: 'has_brand_guidelines', type: 'select', label: 'Have you?', options: ['Yes', 'No'] }, waits,
  ] }] }
  it('a block that waits on an answer is drawn only once it has it', () => {
    expect(blockShown(waits, {})).toBe(false)
    expect(blockShown(waits, { has_brand_guidelines: 'No' })).toBe(false)
    expect(blockShown(waits, { has_brand_guidelines: 'Yes' })).toBe(true)
  })
  it('and is not counted as unanswered while it is not on the page', () => {
    expect(completion(def, {}).total).toBe(1)
    expect(completion(def, { has_brand_guidelines: 'No' })).toMatchObject({ answered: 1, total: 1 })
    expect(completion(def, { has_brand_guidelines: 'Yes' })).toMatchObject({ answered: 1, total: 2 })
    expect(completion(def, { has_brand_guidelines: 'Yes', brand_files: ['logo.png', 'guide.pdf'] })).toMatchObject({ answered: 2, total: 2 })
  })
  it('the rule survives the form being saved and read back', () => {
    const back = normaliseDefinition(JSON.parse(JSON.stringify(def)), 'discovery')
    expect(answerableBlocks(back).find(b => b.id === 'brand_files')?.showIf).toEqual({ id: 'has_brand_guidelines', equals: 'Yes' })
  })
  it('no question on any of the five forms waits on another today', () => {
    for (const key of ['ongoing', 'rebrand', 'launch', 'one_off', 'discovery'] as const) expect(answerableBlocks(TEMPLATES[key]).some(b => b.showIf), key).toBe(false)
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
  it('all four client forms ask for logo and brand files; the discovery form does not', () => {
    expect(answerableBlocks(TEMPLATES.discovery).some(b => b.id === 'brand_files')).toBe(false)
    for (const key of ['ongoing', 'rebrand', 'launch', 'one_off'] as const) {
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

/** UPLOADING: BUSY, LOCKED, AND REMOVABLE (20 Nov 2026: "no loading state … users are able to move to other pages when
 *  uploading … once uploaded why is there no delete or remove") */
describe('a form’s uploads while they are going up, and after', () => {
  const form = readFileSync('app/intake/[token]/IntakeForm.tsx', 'utf8')
  const box = readFileSync('app/intake/[token]/blocks.tsx', 'utf8')
  const route = readFileSync('app/api/intake/[token]/upload/route.ts', 'utf8')
  const lib = readFileSync('app/lib/intake.ts', 'utf8')
  it('no way off the page while files are going up', () => {
    expect(form.match(/if \(busyNow\.current\) return/g)).toHaveLength(2) // changing page, and sending
    expect(form).toContain("uploadsBusy ? 'Uploading your files…'")
    expect(form).toContain("window.addEventListener('beforeunload', warn)")
  })
  it('the box says which file, how far, and to keep the page open', () => {
    expect(box).toContain('Keep this page open until it finishes')
    expect(form).toContain('xhr.upload.onprogress')
  })
  it('a file can be taken back off, but only before the form is sent, and only from its own form', () => {
    expect(box).toContain('aria-label={`Remove ${f.filename}`}')
    expect(route).toMatch(/export async function DELETE[\s\S]*?if \(!isWritable\(form\.status\)\)[\s\S]*?removeIntakeFile\(form\.id, url\)/)
    expect(lib).toContain("f.form_id === formId && f.url === url")
  })
  it('a save never undoes another save: answers and file names are written as claims on the row', () => {
    expect(lib).not.toMatch(/forms\(\)\.update\(data\.id, \{ answers, status: next \}\)/)
    expect(lib).not.toMatch(/forms\(\)\.update\(formId, \{ answers: \{ \.\.\.answers, \[blockId\]/)
    expect(lib.match(/await forms\(\)\.claim\(/g)!.length).toBeGreaterThanOrEqual(4)
  })
})

import { DISCOVERY_INDUSTRIES, workPeek } from '../app/lib/discovery-work'
import { SECTORS } from '../app/work/sectors'
import { existsSync } from 'node:fs'

/** THEIR INDUSTRY, AND A SNEAK PEEK OF OUR WORK IN IT (Abby, via the owner, 20 Nov 2026) */
describe('the industry question and the work shown on the thank-you screen', () => {
  const def = templateFor('discovery')
  it('asks their industry from the Work page’s own sectors, plus Other', () => {
    const q = answerableBlocks(def).find(b => b.id === 'industry')!
    expect(q.type).toBe('select')
    expect(q.options).toEqual([...SECTORS.map(s => s.name), 'Other'])
    expect(DISCOVERY_INDUSTRIES).toEqual(['Finance & Property', 'Trades & Logistics', 'Clinics & Health', 'Hospitality', 'Product & Retail'])
    expect(answerableBlocks(def).find(b => b.id === 'industry_other')?.type).toBe('short_text')
  })
  it('shows their own industry’s brands first, and always a full shelf of five', () => {
    const peek = workPeek('Hospitality')
    expect(peek).toMatchObject({ matched: 'Hospitality', mixed: false })
    expect(peek.tiles).toHaveLength(5)
    for (const t of peek.tiles) { expect(t.sector).toBe('Hospitality'); expect(t.href).toMatch(/^\/work(\/[a-z-]+)?$/) }
  })
  it('a sector with few pictures is filled from the others, theirs first, and says so', () => {
    const peek = workPeek('Finance & Property')
    expect(peek).toMatchObject({ matched: 'Finance & Property', mixed: true })
    expect(peek.tiles).toHaveLength(5)
    expect(peek.tiles.slice(0, 2).map(t => t.sector)).toEqual(['Finance & Property', 'Finance & Property'])
    expect(peek.tiles.slice(2).every(t => t.sector !== 'Finance & Property')).toBe(true)
    expect(new Set(peek.tiles.map(t => t.name)).size).toBe(5)
  })
  it('for Other, no answer or a made-up industry: a spread across the sectors, and it does not pretend to be a match', () => {
    for (const given of ['Other', '', null, undefined, 'Space travel']) {
      const peek = workPeek(given)
      expect(peek.matched).toBeNull()
      expect(peek.tiles).toHaveLength(5)
      expect(new Set(peek.tiles.map(t => t.sector)).size).toBeGreaterThanOrEqual(4)
    }
  })
  it('the Australian Open photo is shown as Pattons, never as Intersign (the owner, 20 Nov 2026)', () => {
    const shown = workPeek('Trades & Logistics', 99).tiles.filter(t => t.image === '/images/strategy/intersign.jpg')
    expect(shown.map(t => t.name)).toEqual(['Pattons'])
    for (const f of ['app/work/sectors.ts', 'app/landing/strategy/page.tsx', 'app/services/strategy/page.tsx']) {
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.includes('strategy/intersign') && !l.trim().startsWith('//'))) {
        expect(line, f).not.toMatch(/Intersign/)
      }
    }
    expect(workPeek('Trades & Logistics')).toMatchObject({ matched: 'Trades & Logistics', mixed: true })
  })
  it('a brand with a loop plays it, over its own still', () => {
    const t = workPeek('Hospitality').tiles.find(x => x.video)!
    expect(t.video).toMatch(/\.mp4$/)
    expect(t.image).toBe(t.video!.replace(/\.mp4$/, '.jpg'))
  })
  it('never shows a brand the Work page does not, and every picture is a file the site really has', () => {
    const known = new Set(SECTORS.flatMap(s => s.clients.map(c => c.name)))
    for (const industry of [...DISCOVERY_INDUSTRIES, 'Other']) {
      for (const t of workPeek(industry, 99).tiles) {
        expect(known.has(t.name), t.name).toBe(true)
        expect(existsSync(`public${t.image}`), t.image).toBe(true)
        if (t.video) expect(existsSync(`public${t.video}`), t.video).toBe(true)
      }
    }
  })
  it('is drawn only on the discovery form’s thank-you screen', () => {
    const form = readFileSync('app/intake/[token]/IntakeForm.tsx', 'utf8')
    expect(form.match(/<WorkPeek/g)).toHaveLength(1)
    expect(form).toContain("{discovery && <WorkPeek industry={typeof answers.industry === 'string' ? answers.industry : null} />}")
  })
})
