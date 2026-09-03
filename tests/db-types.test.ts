import { describe, it, expect } from 'vitest'
import { TABLE_COLUMNS, NULLABLE_COLUMNS, UPDATED_AT_TABLES, NATURAL_KEYS } from '@/lib/db-types'

describe('db-types (generated)', () => {
  it('knows the core tables and their columns', () => {
    expect(TABLE_COLUMNS.content_items).toContain('client_id')
    expect(TABLE_COLUMNS.team_users).toContain('email')
    expect(TABLE_COLUMNS.clients).toContain('name')
  })
  it('marks nullable columns', () => {
    expect(NULLABLE_COLUMNS.content_items).toContain('due_date')
    expect(NULLABLE_COLUMNS.content_items).not.toContain('id')
  })
  it('lists the tables that had an updated_at trigger', () => {
    for (const t of ['content_items','batches','team_users','projects','journal_posts','client_contacts','client_notes','client_credentials','agency_credentials','report_settings','client_agreements']) {
      expect(UPDATED_AT_TABLES.has(t as any)).toBe(true)
    }
  })
  it('derives natural keys for composite tables', () => {
    expect(NATURAL_KEYS.team_user_clients!({ team_user_id: 'u1', client_id: 'c1' })).toBe('u1__c1')
    expect(NATURAL_KEYS.user_page_access!({ team_user_id: 'u1', href: '/dashboard/x' })).toBe('u1__%2Fdashboard%2Fx')
    expect(NATURAL_KEYS.scan_mailboxes!({ email: 'a.b@x.com' })).toBe('a%2Eb@x%2Ecom')
    expect(NATURAL_KEYS.asana_tasks!({ gid: '123' })).toBe('123')
    expect(NATURAL_KEYS.scan_settings!({})).toBe('singleton')
  })
})
