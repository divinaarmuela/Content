import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanEmail, clientRecipients, defaultRecipients, pickRecipients } from '@/app/lib/client-recipients-core'
import { answerProblem } from '@/app/lib/post-window-core'

/**
 * WHO A CLIENT SEND MAY GO TO — one list and one rule for the server and every
 * page (review fix, 29 Sep 2026: the board ticked the first address when nobody
 * was primary, the window ticked everyone, and the window's email check was
 * looser than the server's).
 */
describe('the client\'s addresses', () => {
  it('the business first, then its people, primary first, each once — never a typed address', () => {
    const list = clientRecipients({ name: 'Jordan Wilson', email: 'Hello@Jordan.invalid' }, [
      { name: 'Sam', email: 'sam@jordan.invalid', role: null, is_primary: false },
      { name: 'Jordan', email: 'jordan@jordan.invalid', role: 'Owner', is_primary: true },
      { name: 'Dup', email: 'hello@jordan.invalid' },
      { name: 'Bad', email: 'not an email' },
    ])
    expect(list.map(c => c.email)).toEqual(['hello@jordan.invalid', 'jordan@jordan.invalid', 'sam@jordan.invalid'])
    expect(list[0]).toMatchObject({ label: 'The business', business: true, primary: false })
    expect(list[1]).toMatchObject({ label: 'Owner', primary: true, business: false })
    expect(clientRecipients(null, [])).toEqual([])
  })

  it('only addresses on the client\'s own list are accepted', () => {
    const list = clientRecipients({ name: 'TKBG', email: 'hello@tkbg.com.au' }, [{ name: 'Jordan Wilson', email: 'jordan@tkbg.com.au', is_primary: true }])
    expect(pickRecipients(['JORDAN@tkbg.com.au'], list)).toEqual({ ok: true, emails: ['jordan@tkbg.com.au'] })
    expect(pickRecipients(['jordan@tkbg.com.au', 'someone@else.com'], list)).toMatchObject({ ok: false, error: expect.stringContaining('not on this client') })
    expect(pickRecipients([], list)).toMatchObject({ ok: false })
    expect(pickRecipients(['a@b.co'], [])).toMatchObject({ ok: false, error: expect.stringContaining('no email address') })
  })

  it('one address check: trimmed, lower-cased, and a real address', () => {
    expect(cleanEmail(' A@B.invalid ')).toBe('a@b.invalid')
    expect(cleanEmail('nope')).toBeNull()
    expect(cleanEmail('x@y')).toBeNull()
  })
})

describe('B2: who is ticked when a send opens — one rule for Post approval and the post window', () => {
  const business = { name: 'Cafe', email: 'owner@cafe.test' }
  it('the primary contact(s)', () => {
    const list = clientRecipients(business, [
      { name: 'A', email: 'a@cafe.test', is_primary: true },
      { name: 'B', email: 'b@cafe.test', is_primary: true },
      { name: 'C', email: 'c@cafe.test' },
    ])
    expect(defaultRecipients(list)).toEqual(['a@cafe.test', 'b@cafe.test'])
  })
  it('with nobody primary, the client\'s own business address — not everyone, not the first person', () => {
    const list = clientRecipients(business, [{ name: 'C', email: 'c@cafe.test' }, { name: 'D', email: 'd@cafe.test' }])
    expect(defaultRecipients(list)).toEqual(['owner@cafe.test'])
  })
  it('with no business address either, the first on the list', () => {
    const list = clientRecipients({ name: 'Cafe', email: null }, [{ name: 'C', email: 'c@cafe.test' }, { name: 'D', email: 'd@cafe.test' }])
    expect(defaultRecipients(list)).toEqual(['c@cafe.test'])
    expect(defaultRecipients([])).toEqual([])
  })
  it('both pages tick with this rule and read this list', () => {
    const src = (f: string) => readFileSync(f, 'utf8')
    for (const f of ['app/dashboard/scheduler/board/usePostActs.tsx', 'app/dashboard/scheduler/board/ClientRound.tsx', 'app/dashboard/social/schedule/PostWindow.tsx']) {
      expect(src(f), f).toMatch(/from '[^']*client-recipients-core'/)
      expect(src(f), f).toContain('defaultRecipients(')
    }
  })
  it('the window refuses an address the server would refuse', () => {
    const q = { action: 'send_to_client' as const, needs: ['recipients' as const] }
    expect(answerProblem(q, { send_to: ['x@y'], via: 'email' }, 0)).toMatch(/Tick who gets it/)
    expect(answerProblem(q, { send_to: ['x@y.co'], via: 'email' }, 0)).toBeNull()
  })
})
