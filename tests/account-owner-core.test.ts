import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  accountSections, contactIdOf, contactsInOrder, ownerChoices, ownerLabel, possessive,
} from '../app/lib/account-owner-core'

/**
 * WHOSE ACCOUNT IS THIS? (the owner, 15 Sep 2026: "sometimes we are
 * connecting their personal account" — "master social channel client, and
 * underneath the client name and their accounts too").
 */
const justin = { id: 'c-j', name: 'Justin', role: 'Director', is_primary: true }
const jordan = { id: 'c-o', name: 'Jordan', role: '', is_primary: false }
const ig = { id: 'a1', platform: 'instagram', username: 'justin_engelke', contact_id: 'c-j' }
const tt = { id: 'a2', platform: 'tiktok', username: 'justinengelke17', contact_id: 'c-j' }
const page = { id: 'a3', platform: 'instagram', username: 'turnkeyrealestate', contact_id: null }
const orphan = { id: 'a4', platform: 'linkedin', username: 'x', contact_id: 'gone' }

describe('accountSections — the company first, then each person', () => {
  it('draws the company, then a section per contact who has accounts, primary first', () => {
    const s = accountSections('Turnkey Real Estate', [ig, tt, page], [jordan, justin])
    expect(s.map(x => [x.key, x.title, x.accounts.map(a => a.id)])).toEqual([
      ['company', 'Turnkey Real Estate', ['a3']],
      ['c-j', 'Justin', ['a1', 'a2']],
    ])
    expect(s[1].hint).toBe('Justin’s personal accounts · Director')
    expect(s[0].hint).toBe('The official business accounts')
  })
  it('the company section is always there, even empty; an account whose contact is gone falls back to it', () => {
    expect(accountSections('Acme', [], [justin])).toEqual([
      { key: 'company', title: 'Acme', hint: 'The official business accounts', accounts: [] },
    ])
    expect(accountSections('Acme', [orphan], [justin])[0].accounts).toEqual([orphan])
  })
  it('contacts come primary first, then by name', () => {
    expect(contactsInOrder([jordan, justin]).map(c => c.name)).toEqual(['Justin', 'Jordan'])
  })
})

describe('the picker and the label', () => {
  it('offers the company and each contact, in plain words', () => {
    expect(ownerChoices('Turnkey Real Estate', [jordan, justin])).toEqual([
      { value: 'company', label: 'Turnkey Real Estate — the official business account' },
      { value: 'c-j', label: 'Justin — their personal account' },
      { value: 'c-o', label: 'Jordan — their personal account' },
    ])
  })
  it('says whose an account is', () => {
    expect(ownerLabel(ig, 'Turnkey Real Estate', [justin])).toBe('Justin’s personal account')
    expect(ownerLabel(page, 'Turnkey Real Estate', [justin])).toBe('Turnkey Real Estate business account')
    expect(ownerLabel(orphan, 'Turnkey Real Estate', [justin])).toBe('Turnkey Real Estate business account')
  })
  it('possessives and the picker value', () => {
    expect(possessive('Justin')).toBe('Justin’s')
    expect(possessive('James')).toBe('James’')
    expect(contactIdOf('company')).toBeNull()
    expect(contactIdOf('')).toBeNull()
    expect(contactIdOf('c-j')).toBe('c-j')
  })
})

describe('the route and the page (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
  it('the account PATCH takes contact_id, checks the contact is the client’s, and writes it by claim', () => {
    const s = src('app/api/social/accounts/[id]/route.ts')
    expect(s).toContain("const wantsOwner = 'contact_id' in body")
    expect(s).toContain("return NextResponse.json({ error: 'That person is not on this client' }, { status: 400 })")
    expect(s).toContain('...(wantsOwner ? { contact_id: contactId } : {})')
  })
  it('the Accounts page draws the sections and the picker; the connections themselves are not touched', () => {
    const p = src('app/dashboard/social/schedule/access/page.tsx')
    expect(p).toContain("useTable<ClientContact>('client_contacts', { by: byClient, enabled: on })")
    expect(p).toContain('accountSections(clientName, accounts, contacts)')
    expect(p).toContain('Whose account is this?')
    expect(p).toContain("ownerChoices(client.name, contacts)")
    expect(p).toContain('contact_id: contactIdOf(owner)')
  })
  it('the column exists on the connection row', () => {
    expect(src('lib/db-types.ts')).toMatch(/export interface SocialAccount \{[\s\S]*?contact_id: string \| null/)
  })
})
