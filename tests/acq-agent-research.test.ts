import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { contactPatch, profileFromScrape, profileWords, RESEARCH_SYSTEM, sitesGuessedFromHandle, pageTextFrom, publicMetaFrom, researchNote, researchPatch, safePublicUrl, type Research } from '../app/lib/acq-agent-core'

const r = (over: Partial<Research> = {}): Research => ({
  found: true, summary: 'A Melbourne mortgage broker.', what_they_do: 'Home loans', industry: 'Finance', tier: 1, website: 'kodefinance.com.au',
  location: 'Melbourne', contact_name: 'Sam Lee', weaknesses: ['No reels', 'Site has no booking link'], audit_angle: 'Show three reel ideas from their FAQs',
  fit: 'strong', confidence: 0.85, sources: ['https://kodefinance.com.au/'], ...over,
})

describe('the agent researches the business (21 Sep 2026)', () => {
  it('reads what Instagram shows anyone — the counts — from the page’s own preview tags', () => {
    const html = '<meta property="og:description" content="1 Followers, 0 Following, 0 Posts - See Instagram photos and videos from Crestline Consultants (&#064;crestlineconsultants)" />'
    expect(publicMetaFrom(html)).toBe('1 Followers, 0 Following, 0 Posts - See Instagram photos and videos from Crestline Consultants (@crestlineconsultants)')
    expect(publicMetaFrom('<html>login wall</html>')).toBeNull()
  })

  it('reads a site as a visitor does, and only ever fetches a public web address', () => {
    const text = pageTextFrom('<title>Kode Finance</title><meta name="description" content="Home loans, done properly"><h1>Buy your first home</h1><script>var x=1</script><p>Call us. hello@kode.com.au</p><a href="https://www.instagram.com/kode">ig</a>')
    expect(text).toContain('TITLE: Kode Finance')
    expect(text).toContain('HEADINGS: Buy your first home')
    expect(text).toContain('EMAILS ON THE PAGE: hello@kode.com.au')
    expect(text).toContain('SOCIAL LINKS: https://www.instagram.com/kode')
    expect(text).not.toContain('var x=1')
    expect(safePublicUrl('kodefinance.com.au')).toBe('https://kodefinance.com.au/')
    for (const bad of ['http://localhost:3000', 'http://127.0.0.1/', 'http://10.0.0.5/admin', 'https://intranet.local/', 'javascript:alert(1)', 'ftp://x.com']) expect(safePublicUrl(bad)).toBeNull()
  })

  it('fills only what is empty — a person’s entry always stands — and nothing at all when it is not sure which business it is', () => {
    expect(researchPatch({}, r())).toEqual({ tier: 1, industry: 'Finance', website: 'https://kodefinance.com.au/', audit_angle: 'Show three reel ideas from their FAQs', contact_name: 'Sam Lee', weakness_tags: ['No reels', 'Site has no booking link'] })
    expect(researchPatch({ tier: 3, industry: 'Cafes', website: 'https://mine.com', audit_angle: 'Mine', contact_name: 'Jo', weakness_tags: ['x'] }, r())).toEqual({})
    expect(researchPatch({}, r({ found: false }))).toEqual({})
    expect(researchPatch({}, r({ confidence: 0.4 })).tier).toBeUndefined()
    expect(researchPatch({}, r({ website: 'not a site' })).website).toBeUndefined()
  })

  it('the write-up carries its sources, and says so when it could not tell', () => {
    expect(researchNote(r())).toContain('Sources: https://kodefinance.com.au/')
    expect(researchNote(r({ found: false, summary: 'Three businesses share the name.' }))).toContain('could not be sure which business it is: Three businesses share the name.')
  })

  it('it runs by itself when a lead is made or a target is added; the blueprint’s two research points are only proposed', () => {
    const src = readFileSync('app/lib/acq-agent.ts', 'utf8')
    expect(src).toContain("tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] as never,")
    expect(src).toContain("await logAcqEvent({ prospectId: p.id, kind: 'fit', source: 'agent', confirmed: false,")
    expect(src).toContain("await logAcqEvent({ prospectId: p.id, kind: 'weak_presence', source: 'agent', confirmed: false,")
    expect(src).toContain("await inngest.send({ name: 'app/acquisition.research.requested', data: { prospect_id: made.id } })")
    expect(readFileSync('app/api/leads/acquisition/route.ts', 'utf8')).toContain("name: 'app/acquisition.research.requested', data: { prospect_id: prospect.id }")
    expect(readFileSync('app/inngest/functions.ts', 'utf8')).toContain("triggers: [{ event: 'app/acquisition.research.requested' }],")
  })

  it('only a handle: the profile address is searched for its bio and link, and the handle’s likeliest domains are tried as a GUESS', () => {
    expect(sitesGuessedFromHandle('crestline.consultants_')).toEqual(['https://crestlineconsultants.com.au/', 'https://crestlineconsultants.com/', 'https://www.crestlineconsultants.com.au/'])
    expect(sitesGuessedFromHandle('ab')).toEqual([])
    expect(RESEARCH_SYSTEM).toContain('instagram.com/<handle>')
    expect(readFileSync('app/lib/acq-agent.ts', 'utf8')).toContain('A SITE GUESSED FROM THE HANDLE — NOT CONFIRMED TO BE THEIRS')
  })

  it('with ScrapeCreators the whole public profile is read: the bio, the link in bio, the public contact, the captions', () => {
    const p = profileFromScrape({ data: { user: { username: 'kode', full_name: 'Kode Finance', biography: 'Home loans, Melbourne', external_url: 'https://kodefinance.com.au', bio_links: [{ url: 'https://kodefinance.com.au' }, { url: 'https://linktr.ee/kode' }], category_name: 'Mortgage Brokers', is_business_account: true, business_email: 'Hello@Kode.com.au', business_phone_number: '+61 400 000 000', edge_followed_by: { count: 812 }, edge_owner_to_timeline_media: { count: 40, edges: [{ node: { edge_media_to_caption: { edges: [{ node: { text: 'Rates  are\nmoving' } }] } } }] } } } })!
    expect(p).toMatchObject({ name: 'Kode Finance', bio: 'Home loans, Melbourne', link: 'https://kodefinance.com.au', category: 'Mortgage Brokers', business: true, followers: 812, posts: 40, captions: ['Rates are moving'] })
    expect(profileWords('kode', p)).toContain('link in bio: https://kodefinance.com.au · also https://linktr.ee/kode')
    expect(contactPatch({}, p)).toEqual({ email: 'hello@kode.com.au', phone: '+61 400 000 000' })
    expect(contactPatch({ email: 'sam@kode.com.au', phone: '03 9000 0000' }, p)).toEqual({})     // a person’s entry stands
    expect(profileFromScrape({ error: 'not found' })).toBeNull()
    const src = readFileSync('app/lib/acq-agent.ts', 'utf8')
    expect(src).toContain("const key = process.env.SCRAPECREATORS_API_KEY?.trim()")
    expect(src).toContain('const profile = handle ? await instagramProfile(handle) : null')
  })
})
