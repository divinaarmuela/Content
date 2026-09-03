import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * Nothing secret may reach the model.
 *
 * Each tool used to say what it wanted in `.select('...')` and Postgres
 * enforced it; the helper returns whole rows, so the projection is now the
 * code's own job and this file is what holds it to it. Two fields matter most:
 *
 *   clients.share_token                  the portal credential — anyone
 *                                        holding it can open the client's
 *                                        portal with no login at all, which is
 *                                        why the clients API shows it only to
 *                                        account managers
 *   scan_mailboxes.refresh_token_encrypted   a Gmail credential
 *
 * The assertion is on the SERIALISED result, not on named keys, because a
 * secret nested one level deeper inside a join is still a leak.
 */

const { assistantTools } = await import('../app/lib/assistant-tools')

const SHARE_TOKEN = 'share-tok-must-never-leak'
const REFRESH_TOKEN = 'enc:refresh-must-never-leak'

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  fake = seedDb({
    clients: [{
      id: 'client-1', name: 'ZZ TEST', slug: 'zz-test', industry: 'Homes',
      contact_name: 'Pat', email: 'pat@example.invalid', phone: '0400 000 000',
      status: 'active', created_at: '2026-01-01T00:00:00.000Z',
      share_token: SHARE_TOKEN, social_profile_id: 'profile_1',
      notes: 'internal only', brand_profile: { rev: 1 },
    }] as unknown as Row[],
    client_contacts: [{
      id: 'cc-1', client_id: 'client-1', name: 'Pat', role: 'owner',
      email: 'pat@example.invalid', phone: '0400 000 000', is_primary: true,
    }] as unknown as Row[],
    intake_forms: [{
      id: 'form-1', client_id: 'client-1', title: 'Onboarding',
      template_key: 'rebrand', status: 'sent', token: 'intake-token-secret',
      created_at: '2026-01-02T00:00:00.000Z', answers: {}, definition: { sections: [] },
    }] as unknown as Row[],
    leads: [{
      id: 'lead-1', created_at: '2026-09-01T00:00:00.000Z', fname: 'Sam',
      lname: 'Lee', email: 'sam@example.invalid', biz: 'Sam Co',
      need: 'reels', budget: '5k', timeline: 'Q4', source: 'web_form',
    }] as unknown as Row[],
    team_users: [{
      id: 'u-1', email: 'am@example.invalid', name: 'Ada', role: 'account_manager',
      employment_type: 'employee', active_status: true,
      clerk_user_id: 'clerk_secret_id', notification_prefs: { email: true },
    }] as unknown as Row[],
    scan_mailboxes: [{
      id: 'mb-1', email: 'hello@example.invalid', enabled: true, source: 'self',
      connected_at: '2026-08-01T00:00:00.000Z', connected_by: 'ada',
      refresh_token_encrypted: REFRESH_TOKEN,
    }] as unknown as Row[],
    scan_runs: [],
    email_ingest_log: [],
  })
})

afterEach(() => fake.restore())

const tools = () => assistantTools('super_admin')
const out = async (fn: () => Promise<unknown>) => JSON.stringify(await fn())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: string, input: any) => (tools() as any)[name].execute(input, {} as never)

describe('the assistant never sees a secret', () => {
  it('search_clients returns only the summary columns', async () => {
    const body = await out(() => run('search_clients', { query: '', status: 'any' }))
    expect(body).not.toContain(SHARE_TOKEN)
    expect(body).not.toContain('share_token')
    expect(body).not.toContain('social_profile_id')
    expect(body).not.toContain('brand_profile')
    expect(body).toContain('ZZ TEST')
    expect(body).toContain('Homes')
  })

  it('get_client returns only the summary columns, contacts and form headers', async () => {
    const body = await out(() => run('get_client', { client_id: 'client-1' }))
    expect(body).not.toContain(SHARE_TOKEN)
    expect(body).not.toContain('share_token')
    // the intake token is a credential too — the old select never named it
    expect(body).not.toContain('intake-token-secret')
    expect(body).toContain('ZZ TEST')
    expect(body).toContain('Onboarding')
  })

  it('get_scanner_status never carries a mailbox refresh token', async () => {
    const body = await out(() => run('get_scanner_status', { hours: 24 }))
    expect(body).not.toContain(REFRESH_TOKEN)
    expect(body).not.toContain('refresh_token_encrypted')
    expect(body).toContain('hello@example.invalid')
  })

  it('get_team returns names, roles and emails and nothing else', async () => {
    const body = await out(() => run('get_team', {}))
    expect(body).not.toContain('clerk_secret_id')
    expect(body).not.toContain('notification_prefs')
    expect(body).toContain('Ada')
    expect(body).toContain('account_manager')
  })

  it('get_leads returns the named lead columns', async () => {
    const body = await out(() => run('get_leads', { days: 30, search: '' }))
    const leads = JSON.parse(body).leads as Record<string, unknown>[]
    expect(Object.keys(leads[0]).sort()).toEqual([
      'biz', 'budget', 'created_at', 'email', 'fname', 'id', 'lname', 'need',
      'source', 'timeline',
    ])
  })

  it('get_intake_status carries the form headers and the client name only', async () => {
    const body = await out(() => run('get_intake_status', { only: 'all' }))
    expect(body).not.toContain('intake-token-secret')
    expect(body).not.toContain(SHARE_TOKEN)
    expect(body).toContain('Onboarding')
    expect(body).toContain('ZZ TEST')
  })
})
