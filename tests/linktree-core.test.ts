import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LINKTREE_TOOLS, analyticsWindow, cleanLinkInput, linksFrom, linktreeAuthorizeUrl, linktreeErrorWords, linktreeScopes,
  mayManageLinktree, numbersFrom, parseToolResult, profilesFrom,
} from '../app/lib/linktree-core'

describe('Linktree — the pure half (21 Sep 2026)', () => {
  it('asks only for the tools it calls, one scope each, and sends PKCE and the resource on sign-in', () => {
    expect(linktreeScopes().split(' ')).toEqual(LINKTREE_TOOLS.map(t => `mcp:${t}`))
    const u = new URL(linktreeAuthorizeUrl({ authorizationEndpoint: 'https://ciam.linktr.ee/authorize', clientId: 'cid', redirectUri: 'https://app.mdmmarketing.com.au/api/production/linktree/callback', state: 'st', codeChallenge: 'ch' }))
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('resource')).toBe('https://mcp.linktr.ee/mcp')
    expect(u.searchParams.get('scope')).toContain('mcp:add_link')
  })
  it('reads a tool result: structured first, then JSON text, a refusal as its own words', () => {
    expect(parseToolResult({ structuredContent: { links: [] } })).toEqual({ ok: true, data: { links: [] } })
    expect(parseToolResult({ content: [{ type: 'text', text: '{"views":3}' }] })).toEqual({ ok: true, data: { views: 3 } })
    expect(parseToolResult({ content: [{ type: 'text', text: 'done' }] })).toEqual({ ok: true, data: { text: 'done' } })
    expect(parseToolResult({ isError: true, content: [{ type: 'text', text: 'UPGRADE_REQUIRED: gradients' }] })).toEqual({ ok: false, error: 'UPGRADE_REQUIRED: gradients' })
  })
  it('finds profiles, links and numbers however the list is wrapped', () => {
    expect(profilesFrom({ profiles: [{ username: 'kode', displayName: 'Kode', profileUrl: 'https://linktr.ee/kode', isEditable: true }, { username: '' }] })).toEqual([{ username: 'kode', displayName: 'Kode', profileUrl: 'https://linktr.ee/kode', isEditable: true }])
    expect(linksFrom([{ id: 7, title: 'Book', url: 'https://x.com', active: false }, { id: 'x', url: '' }])).toEqual([{ id: 7, title: 'Book', url: 'https://x.com', active: false }])
    expect(numbersFrom({ totals: { views: 120, clicks: 30, ctr: 0.25 } }, '2026-08-25', '2026-09-21')).toEqual({ views: 120, clicks: 30, ctr: 0.25, from: '2026-08-25', to: '2026-09-21' })
    expect(numbersFrom({ views: 5 }, 'a', 'b').clicks).toBeNull()
    expect(analyticsWindow(Date.parse('2026-09-21T03:00:00Z'))).toEqual({ startDate: '2026-08-25', endDate: '2026-09-21' })
  })
  it('cleans a typed link, and says Linktree’s refusals in the team’s words', () => {
    expect(cleanLinkInput({ title: '  Book   a call ', url: 'kodefinance.com.au/book' })).toEqual({ ok: true, title: 'Book a call', url: 'https://kodefinance.com.au/book' })
    expect(cleanLinkInput({ url: '' })).toEqual({ ok: false, error: 'Paste the address the link goes to' })
    expect(cleanLinkInput({ url: 'javascript:alert(1)' }).ok).toBe(false)
    expect(linktreeErrorWords('UPGRADE_REQUIRED')).toBe('That needs a paid Linktree plan on this profile')
    expect(linktreeErrorWords('UNAUTHORIZED: x')).toBe('The Linktree sign-in has lapsed — connect it again')
    expect(mayManageLinktree({ role: 'account_manager' })).toBe(true)
    expect(mayManageLinktree({ role: 'editor' })).toBe(false)
  })
  it('tokens are encrypted at rest, the state is claimed once, writes are a manager’s, and the card sits with the channels', () => {
    const server = readFileSync('app/lib/linktree.ts', 'utf8')
    expect(server).toContain('access_token_enc: encryptSecret(t.access_token),')
    const cb = readFileSync('app/api/production/linktree/callback/route.ts', 'utf8')
    expect(cb).toContain("const claimed = await table<LinktreeState>('linktree_states').claim(state, ((cur: LinktreeState | null): unknown => {")
    expect(cb).toContain('if (!row || row.used_at || row.user_id !== user.id) return null')
    const one = readFileSync('app/api/production/linktree/[clientId]/route.ts', 'utf8')
    expect(one).toContain('if (!mayManageLinktree(user)) return NextResponse.json(')
    expect(readFileSync('app/api/production/linktree/connect/route.ts', 'utf8')).toContain("const user = await requireRole('account_manager')")
    expect(readFileSync('app/dashboard/social/page.tsx', 'utf8')).toContain('<LinktreeCard clientId={c.id} />')
    expect(readFileSync('app/dashboard/clients/[id]/social/page.tsx', 'utf8')).toContain('<LinktreeCard clientId={id} />')
    expect(readFileSync('app/dashboard/clients/LinktreeCard.tsx', 'utf8')).toContain('Linktree has no way to make a profile from here.')
  })
})
