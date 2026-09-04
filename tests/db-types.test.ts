import { describe, it, expect } from 'vitest'
import {
  TABLE_COLUMNS, NULLABLE_COLUMNS, UPDATED_AT_TABLES, NATURAL_KEYS,
  JSON_COLUMNS, JSON_ARRAY_COLUMNS,
} from '@/lib/db-types'
import type {
  Batch, ScheduleEntry, WebhookDelivery, ScanMailbox, ContentItem, TeamUser,
  SocialPost, ScheduleNote,
} from '@/lib/db-types'

// Compile-time guard: these interface names must exist and be PascalCase
// singular. If a name regresses (e.g. back to `Batche`/`ScanMailboxe`), this
// file fails to type-check under `npx tsc --noEmit` and this test file fails
// to even load under vitest.
const _batch: Pick<Batch, 'id'> = { id: 'x' }
const _entry: Pick<ScheduleEntry, 'id'> = { id: 'x' }
const _delivery: Pick<WebhookDelivery, 'id'> = { id: 'x' }
const _mailbox: Pick<ScanMailbox, 'id'> = { id: 'x' }
const _item: Pick<ContentItem, 'id'> = { id: 'x' }
const _user: Pick<TeamUser, 'id'> = { id: 'x' }
const _post: Pick<SocialPost, 'id'> = { id: 'x' }
const _note: Pick<ScheduleNote, 'id'> = { id: 'x' }
void _batch, _entry, _delivery, _mailbox, _item, _user, _post, _note

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
  // What the image editor saves for a VIDEO. No SQL ever created these, so
  // the generator is the only place their shape is written down — and all
  // three are nullable because the overwhelming majority of versions are
  // pictures, or clips nobody has picked a cover for.
  it('knows what a video version can carry', () => {
    for (const c of ['cover_url', 'trim_start', 'trim_end']) {
      expect(TABLE_COLUMNS.asset_versions).toContain(c)
      expect(NULLABLE_COLUMNS.asset_versions).toContain(c)
    }
  })
  // The client's group of accounts at the posting service is
  // `social_profile_id` and has been since the connect flow was written. The
  // Schedule access page writes THAT column: a second one meaning the same
  // thing would be two answers to "which group does this client post from".
  it('has exactly one column for the client’s provider group', () => {
    expect(TABLE_COLUMNS.clients).toContain('social_profile_id')
    expect(TABLE_COLUMNS.clients).not.toContain('zernio_profile_id')
  })
  it('lists the tables that had an updated_at trigger', () => {
    for (const t of ['content_items','batches','team_users','projects','journal_posts','client_contacts','client_notes','client_credentials','agency_credentials','report_settings','client_agreements']) {
      expect(UPDATED_AT_TABLES.has(t as any)).toBe(true)
    }
  })
  // The two ghost tables behind the Schedule calendar: no SQL ever created
  // them, so the generator is the only place their shape is written down.
  it('knows the planned post table', () => {
    expect(TABLE_COLUMNS.social_posts).toEqual([
      'id', 'client_id', 'item_id', 'version_id', 'version_number', 'slides',
      'caption', 'per_channel', 'channels', 'scheduled_for', 'timezone',
      'status', 'publish_job_ids', 'created_by', 'created_at', 'updated_at',
      'sent_at', 'approved_at', 'approved_by', 'approval_mode', 'note',
    ])
    // a post always belongs to a client and an item; a draft may not have
    // picked its version, its time or its words yet
    expect(NULLABLE_COLUMNS.social_posts).not.toContain('client_id')
    expect(NULLABLE_COLUMNS.social_posts).not.toContain('item_id')
    expect(NULLABLE_COLUMNS.social_posts).not.toContain('status')
    // how the post was cleared — 'client' through the approval, 'self' when
    // an account manager cleared it at send time — and null until it is sent
    for (const c of ['version_id', 'version_number', 'scheduled_for', 'caption', 'note',
      'approval_mode', 'approved_by']) {
      expect(NULLABLE_COLUMNS.social_posts).toContain(c)
    }
    // the jsonb columns lib/db.ts has to put back when they read empty
    expect(JSON_COLUMNS.social_posts)
      .toEqual(['slides', 'per_channel', 'channels', 'publish_job_ids'])
    expect(JSON_ARRAY_COLUMNS.social_posts)
      .toEqual(['slides', 'channels', 'publish_job_ids'])
    expect(JSON_ARRAY_COLUMNS.social_posts).not.toContain('per_channel')
    expect(UPDATED_AT_TABLES.has('social_posts')).toBe(true)
  })

  // A ghost COLUMN, not a ghost table: the client row is real SQL, and this
  // one field was added by the generator because Instagram's location is a
  // Facebook Page id nobody can look up at post time.
  it('knows where a client keeps the places it tags posts at', () => {
    expect(TABLE_COLUMNS.clients).toContain('instagram_locations')
    // it is a list, always — an empty one reads back as [] rather than null,
    // so no caller has to guard for both
    expect(NULLABLE_COLUMNS.clients).not.toContain('instagram_locations')
    expect(JSON_COLUMNS.clients).toContain('instagram_locations')
    expect(JSON_ARRAY_COLUMNS.clients).toContain('instagram_locations')
  })

  it('knows the calendar note table', () => {
    expect(TABLE_COLUMNS.schedule_notes).toEqual([
      'id', 'client_id', 'at', 'text', 'created_by', 'created_at', 'updated_at',
    ])
    expect(NULLABLE_COLUMNS.schedule_notes).toEqual(['created_by'])
    expect(JSON_COLUMNS.schedule_notes).toEqual([])
    expect(UPDATED_AT_TABLES.has('schedule_notes')).toBe(true)
  })

  it('derives natural keys for composite tables', () => {
    expect(NATURAL_KEYS.team_user_clients!({ team_user_id: 'u1', client_id: 'c1' })).toBe('u1__c1')
    expect(NATURAL_KEYS.user_page_access!({ team_user_id: 'u1', href: '/dashboard/x' })).toBe('u1__%2Fdashboard%2Fx')
    expect(NATURAL_KEYS.scan_mailboxes!({ email: 'a.b@x.com' })).toBe('a%2Eb@x%2Ecom')
    expect(NATURAL_KEYS.asana_tasks!({ gid: '123' })).toBe('123')
    expect(NATURAL_KEYS.scan_settings!({})).toBe('singleton')
  })
})
