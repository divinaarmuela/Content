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
  it('the composer groups the channel picker by whom the post is for — the business, then each person (15 Sep 2026)', () => {
    const d = src('app/dashboard/social/schedule/NewPostDialog.tsx')
    expect(d).toContain("accountSections(clientName || 'The business', accounts, contacts).filter(s => s.accounts.length > 0).map(section => (")
    expect(d).toContain('role="group" aria-label={section.title}')
    expect(d).toContain("title={ownerLabel(a, clientName || 'The business', contacts)}")
    const h = src('app/dashboard/social/schedule/useSchedulePosts.ts')
    expect(h).toContain("const contacts = useTable<ClientContact>('client_contacts', { by: byClient, enabled: on })")
    expect(src('app/dashboard/social/schedule/useComposeFlow.tsx')).toContain('contacts={data.contacts}')
  })
  it('the Social channels card draws the business first, then each person; the connect-link box can add a person on the spot', () => {
    const c = src('app/dashboard/clients/SocialChannels.tsx')
    expect(c).toContain('accountSections(clientName, accounts, contacts)')
    const l = src('app/dashboard/social/ClientConnectLink.tsx')
    expect(l).toContain('Connect link — for the business, or for one of their people')
    expect(l).toContain('+ Add a person')
    expect(l).toContain('fetch(`/api/website/clients/${clientId}/contacts`, {')
  })
  it('the column exists on the connection row', () => {
    expect(src('lib/db-types.ts')).toMatch(/export interface SocialAccount \{[\s\S]*?contact_id: string \| null/)
  })
})

describe('whom the post is for, from the New post window to the Schedule window (the owner, 15 Sep 2026)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
  it('the New post window offers the business, or a person with an account connected, and the card carries it', () => {
    const d = src('app/dashboard/board/BoardDialogs.tsx')
    // a post says "Posting for"; an editing card says "This work is for" (15 Sep 2026)
    expect(d).toContain("<Label htmlFor=\"new-post-for\">{forPosting ? 'Posting for' : 'This work is for'}</Label>")
    expect(d).toContain('accountRows.some(a => a.client_id === clientId && a.active !== false && a.contact_id === c.id)')
    expect(d).toContain('...(forPosting && contactIdOf(postFor) ? { for_contact_id: contactIdOf(postFor) } : {}),')
    const r = src('app/api/production/items/route.ts')
    expect(r).toContain("for_contact_id: typeof it.for_contact_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(it.for_contact_id) ? it.for_contact_id : null,")
    expect(r).toContain("return NextResponse.json({ error: 'That person is not on this client' }, { status: 400 })")
    expect(src('lib/db-types.ts')).toMatch(/export interface ContentItem \{[\s\S]*?for_contact_id: string \| null/)
  })
  it('the Schedule window opens a new post on that person’s channels; the post’s card says whom it is for', () => {
    const w = src('app/dashboard/social/schedule/NewPostDialog.tsx')
    expect(w).toContain("const { row: itemRow } = useRow<ContentItem>('content_items', target.itemId)")
    expect(w).toContain('const theirs = accounts.filter(a => a.contact_id === who).map(a => a.id)')
    expect(w).toContain('if (seededFor.current || state.postId || !itemRow) return')
    const c = src('app/dashboard/board/PostApprovalDetail.tsx')
    expect(c).toContain('Posting for: {postFor ? `${postFor.name} — their personal account` : `${client?.name ?? \'the client\'} — the business`}')
  })
})
