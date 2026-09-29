import { describe, expect, it } from 'vitest'
import { clientChoices, readClientChoices } from '@/app/lib/client-pick-core'

/**
 * "Who is this post for?" (29 Sep 2026): the New post client list is one lean
 * request answering id + name only, for the clients this person may post for.
 */
const rows = [
  { id: 'c2', name: 'Zeta Cafe', status: 'active', brand_profile: { big: 'x'.repeat(1000) }, notes: 'secret' },
  { id: 'c1', name: 'Acme', status: 'active', share_token: 'tok' },
  { id: 'c3', name: 'Old Co', status: 'archived' },
  { id: 'c4', name: '  ', status: 'active' },
  { name: 'No id' },
]

describe('clientChoices', () => {
  it('answers id and name only — no other column leaves the server', () => {
    const out = clientChoices(rows, null)
    for (const c of out) expect(Object.keys(c).sort()).toEqual(['id', 'name'])
  })

  it('unrestricted (null): every client that is not archived, by name', () => {
    expect(clientChoices(rows, null)).toEqual([
      { id: 'c1', name: 'Acme' },
      { id: 'c4', name: 'Unnamed client' },
      { id: 'c2', name: 'Zeta Cafe' },
    ])
  })

  it('restricted: only the clients this person may touch', () => {
    expect(clientChoices(rows, ['c2', 'c3'])).toEqual([{ id: 'c2', name: 'Zeta Cafe' }])
    expect(clientChoices(rows, [])).toEqual([])
  })
})

describe('readClientChoices', () => {
  it('reads the route answer and drops anything malformed', () => {
    expect(readClientChoices({ clients: [{ id: 'a', name: 'A', extra: 1 }, { id: 2 }, null] })).toEqual([{ id: 'a', name: 'A' }])
    expect(readClientChoices(null)).toEqual([])
    expect(readClientChoices({ error: 'no' })).toEqual([])
  })
})
