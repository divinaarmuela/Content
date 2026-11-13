import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { render } from '@react-email/components'
import OnboardingEmail from '../app/emails/OnboardingEmail'
import { existsSync, readFileSync } from 'node:fs'
import {
  applyTemplate, defaultOnboarding, joinWords, normaliseOnboarding, templateId, templateName, onboardingProblems, plainDate, safeLink, type OnboardingDraft,
} from '../app/lib/onboarding-email-core'
import { canSeeSubpage, defaultAllows, ONBOARDING_SUBPAGE } from '../app/lib/page-access-core'

const base = () => defaultOnboarding({
  clientName: 'ZZ Test Client', contactName: 'Alia Example',
  lines: [{ label: 'Reels', monthly_qty: 8 }, { label: 'Graphics', monthly_qty: 20 }, { label: 'Stories', monthly_qty: 0 }],
  services: [{ label: 'Weekly reporting', active: true }, { label: 'EDM / email marketing', active: false }],
  startDate: '2026-11-20', managerName: 'Sam Manager',
})

describe('the first draft comes from the client record', () => {
  it('greets the contact by first name and lists only what the agreement really holds', () => {
    const d = base()
    expect(d.greeting).toBe('Hi Alia,')
    expect(d.subject).toBe('Welcome to MD Media, Alia')
    expect(d.agreed.find(r => r.label === 'Each month')?.value).toBe('8 reels and 20 graphics.')
    expect(d.agreed.find(r => r.label === 'Also included')?.value).toBe('Weekly reporting.')
    expect(d.agreed.find(r => r.label === 'Start date')?.value).toBe('20 November 2026')
    expect(d.agreed.find(r => r.label === 'Your account manager')?.value).toBe('Sam Manager')
  })
  it('says nothing about deliverables, services or a start date that are not on file', () => {
    const d = defaultOnboarding({ clientName: 'ZZ Test Client' })
    expect(d.greeting).toBe('Hi ZZ Test Client,')
    expect(d.agreed.map(r => r.label)).toEqual(['Approvals'])
  })
  it('joins and dates in plain words', () => {
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c')
    expect(joinWords(['a'])).toBe('a')
    expect(plainDate('2026-01-05')).toBe('5 January 2026')
    expect(plainDate('soon')).toBe('')
  })
})

describe('what a browser sends is cut to shape', () => {
  it('keeps edits, drops empty lines and caps the lists', () => {
    const d = normaliseOnboarding({
      subject: 'Hello\nthere', agreed: [{ label: 'A', value: 'one' }, { label: ' ', value: ' ' }, ...Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: 'v' }))],
      next: 'not a list',
    }, base())
    expect(d.subject).toBe('Hello there')
    expect(d.agreed).toHaveLength(12)
    expect(d.agreed[0]).toEqual({ label: 'A', value: 'one' })
    expect(d.next).toEqual(base().next)
    expect(d.greeting).toBe('Hi Alia,')
  })
  it('only lets a real link through', () => {
    expect(safeLink('https://calendly.com/x')).toBe('https://calendly.com/x')
    expect(safeLink('mailto:hello@mdmmarketing.com.au')).toBe('mailto:hello@mdmmarketing.com.au')
    expect(safeLink('javascript:alert(1)')).toBe('')
    expect(safeLink('https://x.com/"><script>')).toBe('')
    expect(normaliseOnboarding({ callUrl: 'javascript:alert(1)' }, base()).callUrl).toBe('')
  })
})

const html = (draft: OnboardingDraft, portalUrl: string | null) =>
  render(createElement(OnboardingEmail, { draft, portalUrl, assetBase: 'https://app.example.test' }))

describe('the email (the React Email template)', () => {
  const portalUrl = 'https://app.example.test/portal/abc'
  it('holds every part, in order, with the portal button on the client link and our own pictures', async () => {
    const out = await html({ ...base(), callUrl: 'https://calendly.com/x' }, portalUrl)
    const order = ['Hi Alia,', 'What we agreed', 'How we work', 'What you will see', 'Your portal', 'A few things we still need', 'A set-up call', 'What happens next', 'The MD Media team']
    const at = order.map(t => out.indexOf(t))
    expect(at.every(i => i > -1)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
    expect(out).toContain(`href="${portalUrl}"`)
    expect(out).toContain('href="https://calendly.com/x"')
    expect(out).toContain('https://app.example.test/email/onboarding/hero.jpg')
    expect(out).toContain('https://app.example.test/MDLogo-trim.png')
    expect(out).toContain('max-width:640px')
    // the footer: three links, and none of them a path on the app (the owner: "why is pointing to /website")
    for (const href of ['https://www.mdmmarketing.com.au', 'https://www.instagram.com/mdmedia._', 'mailto:hello@mdmmarketing.com.au']) expect(out).toContain(`href="${href}"`)
    expect(out).not.toMatch(/href="\/[a-z]/)
    expect(out).toContain('Melbourne, Australia')
    // the website's own type, never a serif
    expect(out).toContain('Inter Tight')
    expect(out).toContain('JetBrains Mono')
    expect(out).not.toMatch(/Instrument Serif|Georgia/)
  })
  it('leaves out the portal part with no link, the call button with no link, and any emptied part', async () => {
    const d = { ...base(), needBody: '', see: [], callUrl: '' }
    const out = await html(d, null)
    expect(out).not.toContain('Your portal')
    expect(out).not.toContain('Book a call')
    expect(out).not.toContain('A few things we still need')
    expect(out).not.toContain('What you will see')
    expect(out).toContain('A set-up call')
    expect(onboardingProblems(d, { portalUrl: null })).toHaveLength(2)
    expect(onboardingProblems({ ...d, callUrl: 'https://calendly.com/x' }, { portalUrl })).toEqual([])
  })
  it('never lets typed text become markup', async () => {
    const out = await html({ ...base(), greeting: '<img src=x onerror=1>', intro: 'a\n<b>b</b>' }, portalUrl)
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img src=x onerror=1&gt;')
    expect(out).toContain('&lt;b&gt;b&lt;/b&gt;')
  })
  it('every picture the template names is in public/email/onboarding', () => {
    for (const f of ['hero.jpg', 'shoot-brief.jpg', 'editing.jpg', 'designing.jpg', 'scheduling.jpg']) expect(existsSync(`public/email/onboarding/${f}`)).toBe(true)
  })
})

describe('who may open Onboarding', () => {
  it('account managers and super admins, nobody else by default', () => {
    expect(defaultAllows('super_admin', ONBOARDING_SUBPAGE)).toBe(true)
    expect(defaultAllows('account_manager', ONBOARDING_SUBPAGE)).toBe(true)
    for (const role of ['general', 'scheduler', 'editor', 'quality_checker', 'client'] as const) {
      expect(defaultAllows(role, ONBOARDING_SUBPAGE)).toBe(false)
      expect(canSeeSubpage(role, ONBOARDING_SUBPAGE, [])).toBe(false)
    }
    expect(canSeeSubpage('account_manager', ONBOARDING_SUBPAGE, [])).toBe(true)
  })
  it('the route names the two roles and nothing sends: the email is copied off the page', () => {
    const shared = readFileSync('app/api/clients/[id]/onboarding/shared.ts', 'utf8')
    const route = readFileSync('app/api/clients/[id]/onboarding/route.ts', 'utf8')
    expect(shared).toContain("export const ONBOARDING_ROLES = ['account_manager', 'super_admin']")
    expect(shared).toContain('accessibleClientIds')
    expect(route.match(/onboardingGate\(id\)/g)).toHaveLength(2)
    // "not send from here": no sender anywhere under the route, and no test-send route
    for (const src of [shared, route]) expect(src).not.toMatch(/notify\(|sendSystemEmail|sendRawEmail|smtp/i)
    expect(existsSync('app/api/clients/[id]/onboarding/test')).toBe(false)
    const page = readFileSync('app/dashboard/clients/[id]/onboarding/page.tsx', 'utf8')
    expect(page).toContain('Copy email')
    expect(page).not.toMatch(/sendSystemEmail|\/onboarding\/test/)
  })
})

describe('templates', () => {
  it('a template brings its wording but never another client\'s name or agreement', () => {
    const saved = { ...base(), intro: 'Our retainer welcome.', next: [{ title: 'Kick-off', body: 'This week.' }] }
    const other = defaultOnboarding({ clientName: 'ZZ Other Client', contactName: 'Sam Other', lines: [{ label: 'Reels', monthly_qty: 4 }] })
    const out = applyTemplate(saved, other)
    expect(out.intro).toBe('Our retainer welcome.')
    expect(out.next).toEqual([{ title: 'Kick-off', body: 'This week.' }])
    expect(out.greeting).toBe('Hi Sam,')
    expect(out.subject).toBe('Welcome to MD Media, Sam')
    expect(out.agreed).toEqual(other.agreed)
    expect(JSON.stringify(out)).not.toContain('Alia')
  })
  it('the same name is the same template, and a blank name is refused', () => {
    expect(templateId('Social Retainer')).toBe(templateId('  social   retainer '.trim().replace(/\s+/g, ' ')))
    expect(templateId('Social Retainer')).toBe('social-retainer')
    expect(templateName('   ')).toBeNull()
    expect(templateName('  Social   retainer ')).toBe('Social retainer')
  })
  it('only the two roles reach the templates route', () => {
    const src = readFileSync('app/api/clients/onboarding-templates/route.ts', 'utf8')
    expect(src).toContain('ONBOARDING_ROLES.includes(user.role)')
    expect(src.match(/await gate\(\)/g)).toHaveLength(2)
  })
})

describe('the Onboarding tab shows the portal link itself (the owner, 13 Nov 2026)', () => {
  it('in the "Their portal" box, to read, copy or open', () => {
    const page = readFileSync('app/dashboard/clients/[id]/onboarding/page.tsx', 'utf8')
    expect(page).toContain('<Input readOnly value={data.portal_url}')
    expect(page).toContain("toast.success('Portal link copied')")
    expect(page).toContain('<a href={data.portal_url} target="_blank"')
  })
})
