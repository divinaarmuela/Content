import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  belongsToPortal, personPortalPath, planPortalTitle, portalName, portalToggles, type PortalScope,
} from '../app/lib/portal-owner-core'

/**
 * WHOSE PORTAL IS THIS? (the owner, 15 Sep 2026: "then yea, it's a separate
 * portal too" — "the business portal would be separate" — "making sure
 * there is no cross data if we toggle that it's for a contact").
 */
const business: PortalScope = { kind: 'business' }
const justin: PortalScope = { kind: 'person', contactId: 'c-j', name: 'Justin' }

describe('belongsToPortal — no cross data', () => {
  it('the business portal shows only rows for nobody in particular; a person’s shows only theirs', () => {
    const forBusiness = { for_contact_id: null }
    const forJustin = { for_contact_id: 'c-j' }
    const forJordan = { for_contact_id: 'c-o' }
    expect(belongsToPortal(forBusiness, business)).toBe(true)
    expect(belongsToPortal(forJustin, business)).toBe(false)
    expect(belongsToPortal(forJordan, business)).toBe(false)
    expect(belongsToPortal(forJustin, justin)).toBe(true)
    expect(belongsToPortal(forJordan, justin)).toBe(false)
    expect(belongsToPortal(forBusiness, justin)).toBe(false)
  })
  it('every existing row — no person on it — stays on the business portal exactly as before', () => {
    expect(belongsToPortal({}, business)).toBe(true)
    expect(belongsToPortal({ for_contact_id: undefined }, business)).toBe(true)
    expect(belongsToPortal({}, justin)).toBe(false)
  })
})

describe('what the portal is called', () => {
  it('the business portal wears the business name; a person’s wears theirs', () => {
    expect(portalName('Turnkey Real Estate', business)).toBe('Turnkey Real Estate')
    expect(portalName('Turnkey Real Estate', justin)).toBe('Justin')
  })
  it('a plan’s title on a person’s portal follows the two toggles, and is never blank', () => {
    expect(planPortalTitle({}, 'Turnkey Real Estate', justin)).toBe('Turnkey Real Estate · Justin')
    expect(planPortalTitle({ portal_show_business: false }, 'Turnkey Real Estate', justin)).toBe('Justin')
    expect(planPortalTitle({ portal_show_person: false }, 'Turnkey Real Estate', justin)).toBe('Turnkey Real Estate')
    expect(planPortalTitle({ portal_show_business: false, portal_show_person: false }, 'Turnkey Real Estate', justin)).toBe('Justin')
    expect(planPortalTitle({ portal_show_business: false }, 'Turnkey Real Estate', business)).toBe('Turnkey Real Estate')
  })
  it('the toggles are never saved both off', () => {
    expect(portalToggles(false, false)).toEqual({ portal_show_business: false, portal_show_person: true })
    expect(portalToggles(true, false)).toEqual({ portal_show_business: true, portal_show_person: false })
    expect(portalToggles(true, true)).toEqual({ portal_show_business: true, portal_show_person: true })
  })
  it('a person’s portal is the same door shape as the client’s', () => {
    expect(personPortalPath('abc')).toBe('/portal/abc')
  })
})

describe('the doors and the pages (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
  it('every portal door resolves a token as the client’s or one of their people’s', () => {
    expect(src('app/lib/portal-data.ts')).toContain('const owner = await portalOwnerByToken(token)')
    expect(src('app/lib/portal-data.ts')).toContain("return owner ? getPortalData(owner.client.id, owner.scope) : null")
    expect(src('app/lib/portal-thread.ts')).toContain('const owner = await portalOwnerByToken(rawToken)')
    for (const p of ['app/api/portal/act/route.ts', 'app/api/portal/comment/route.ts', 'app/api/portal/shoot-pdf/route.ts', 'app/api/instagram-video/route.ts']) {
      expect(src(p), p).toContain('await clientByPortalToken(token)')
    }
  })
  it('the portal reads filter by whose portal it is — shoots and pieces alike', () => {
    const d = src('app/lib/portal-data.ts')
    expect(d).toContain('.then(rows => rows.filter(b => belongsToPortal(b as { for_contact_id?: string | null }, scope)))')
    expect(d).toContain('.filter(i => belongsToPortal(i as unknown as { for_contact_id?: string | null }, scope))')
    expect(d).toContain('name: portalName(clientRow.name as string, scope)')
  })
  it('a shoot says who it is for, checked on the client; a card from a shoot inherits it', () => {
    expect(src('app/api/production/batches/route.ts')).toContain('for_contact_id: forContact,')
    expect(src('app/api/production/batches/[id]/route.ts')).toContain('Object.assign(patch, portalToggles(')
    expect(src('app/api/production/items/route.ts')).toContain('(batchById.get(it.batch_id) as { for_contact_id?: string | null } | undefined)?.for_contact_id ?? null')
    const sop = src('app/dashboard/production/shoots/[id]/ShootSop.tsx')
    expect(sop).toContain('Show the business name on their portal')
    expect(sop).toContain('Show their name on their portal')
    expect(sop).toContain("fetch(`/api/website/clients/${batch.client_id}/contacts/portal-link`, {")
    expect(src('app/dashboard/production/NewItemDialog.tsx')).toContain('<ShootFor clientId={draft.client_id} value={draft.for_contact_id}')
  })
  it('a person’s link is minted once and kept; the client page copies it', () => {
    const r = src('app/api/website/clients/[id]/contacts/portal-link/route.ts')
    expect(r).toContain('return held ? cur : { ...cur, share_token: randomUUID() }')
    expect(src('app/dashboard/clients/[id]/ContactsPanel.tsx')).toContain('aria-label={`Copy ${c.name}’s portal link`}')
    expect(src('app/dashboard/board/EditorCardDrawer.tsx')).toContain("return p ? ` · for ${p.name}` : ''")
  })
})
