import { describe, it, expect } from 'vitest'
import { rowToNode, buildUniq, TABLES, SKIPPED } from '../scripts/migrate-core.mjs'

describe('migrate-core', () => {
  it('skips exactly the two log tables', () => {
    expect(SKIPPED).toEqual(['scan_runs', 'asana_events'])
    expect(TABLES).not.toContain('scan_runs')
    expect(TABLES).toContain('content_items')
    expect(TABLES).toContain('assets')
  })
  it('keeps uuids, derives natural keys, strips nulls', () => {
    expect(rowToNode('clients', { id: 'c1', name: 'A', timezone: null })).toEqual(['c1', { id: 'c1', name: 'A' }])
    expect(rowToNode('team_user_clients', { team_user_id: 'u', client_id: 'c' })).toEqual(['u__c', { team_user_id: 'u', client_id: 'c', id: 'u__c' }])
    expect(rowToNode('scan_mailboxes', { email: 'a.b@x.com' })[0]).toBe('a%2Eb@x%2Ecom')
  })
  it('builds uniq pointers only for declared unique columns', () => {
    const uniq = buildUniq('team_users', [['u1', { email: 'a@x.com' }], ['u2', { email: null }]])
    expect(uniq).toEqual({ 'team_users/email/a@x%2Ecom': 'u1' })
  })
})
