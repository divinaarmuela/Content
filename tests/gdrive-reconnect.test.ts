import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { DriveConnection, Row } from '@/lib/db-types'

/**
 * Reconnecting Google Drive with a DIFFERENT account.
 *
 * Google's `drive.file` grants are per app AND per account. A folder handed to
 * this app by tech@ is not readable by hello@, however senior hello@ is — so a
 * reconnect that changes the account leaves `root_folder_id` pointing at a
 * folder nothing can open. Every read 404s, the Files page says "Could not
 * reach Google Drive just now", and until now nothing anywhere said why.
 *
 * It is not fixed automatically. Clearing the pick would be the app overruling
 * the person who made it, and re-picking is thirty seconds of work by somebody
 * who can see both accounts. So it is RECORDED, and the Settings card — the
 * one place the fix lives — says the sentence.
 */

const google = {
  email: 'tech@mdmmarketing.com.au',
  refresh: 'refresh-token',
}

vi.mock('../app/lib/inbox-connect', () => ({
  inboxClientId: () => 'client-id',
  inboxClientSecret: () => 'client-secret',
  forgetGoogleToken: () => {},
  googleAccessToken: async () => ({ ok: true, token: 'access' }),
}))

vi.mock('../app/lib/secret-box', () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.replace(/^enc:/, ''),
  credentialsKeyConfigured: () => true,
}))

const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  void init
  const href = String(url)
  if (href.includes('oauth2.googleapis.com/token')) {
    return new Response(
      JSON.stringify({ access_token: 'access', refresh_token: google.refresh }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (href.includes('openidconnect.googleapis.com')) {
    return new Response(
      JSON.stringify({ email: google.email, name: 'MD Media Tech' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  throw new Error(`unexpected fetch in this test: ${href}`)
})
vi.stubGlobal('fetch', fetchMock)

const { completeDriveConnect, driveStatus } = await import('../app/lib/gdrive')

const connection = (over: Partial<DriveConnection>): Row => ({
  id: 'team',
  account_email: 'tech@mdmmarketing.com.au',
  root_folder_id: 'HQ1',
  root_folder_name: 'MD Media HQ',
  root_origin: 'picked',
  root_name: 'Clients',
  ...over,
}) as unknown as Row

let fake: ReturnType<typeof seedDb>
const req = new Request('https://app.test.invalid/api/gdrive/callback')

beforeEach(() => {
  google.email = 'tech@mdmmarketing.com.au'
  fetchMock.mockClear()
})
afterEach(() => fake.restore())

const row = () => fake.rows('drive_connection')[0] as unknown as DriveConnection

describe('reconnecting under a picked root', () => {
  it('flags a change of Google account, and never creates a folder', async () => {
    fake = seedDb({ drive_connection: [connection({})] })
    google.email = 'hello@mdmmarketing.com.au'

    const res = await completeDriveConnect(req, 'code', 'owner@md.invalid')
    expect(res.ok).toBe(true)

    expect(row().root_account_changed).toBe(true)
    // the pick itself is untouched — the app does not overrule the person who
    // made it, it tells them
    expect(row().root_folder_id).toBe('HQ1')
    expect(row().root_origin).toBe('picked')
    // and nothing was created in anybody's Drive on the way through
    // the only two calls it may make are the token exchange and the userinfo
    // read; anything creating a folder would be a third
    const hosts = fetchMock.mock.calls.map(([u]) => new URL(String(u)).host)
    expect(hosts).toEqual(['oauth2.googleapis.com', 'openidconnect.googleapis.com'])
  })

  it('says nothing when the same account reconnects', async () => {
    fake = seedDb({ drive_connection: [connection({})] })
    const res = await completeDriveConnect(req, 'code', 'owner@md.invalid')
    expect(res.ok).toBe(true)
    expect(row().root_account_changed).toBe(false)
  })

  it('says nothing when there was no account recorded before', async () => {
    // a first connection cannot have "changed" account
    fake = seedDb({ drive_connection: [connection({ account_email: null })] })
    const res = await completeDriveConnect(req, 'code', 'owner@md.invalid')
    expect(res.ok).toBe(true)
    expect(row().root_account_changed).toBe(false)
  })

  it('ignores case and spacing, which Google does not promise to keep', async () => {
    fake = seedDb({ drive_connection: [connection({ account_email: ' Tech@MDMmarketing.com.au ' })] })
    const res = await completeDriveConnect(req, 'code', 'owner@md.invalid')
    expect(res.ok).toBe(true)
    expect(row().root_account_changed).toBe(false)
  })

  it('is reported by driveStatus, which is what the card reads', async () => {
    fake = seedDb({ drive_connection: [connection({ root_account_changed: true })] })
    expect((await driveStatus()).root_account_changed).toBe(true)
  })
})

describe('an app-made root, which is not affected', () => {
  it('does not flag anything — there is no picked folder to be unreadable', async () => {
    fake = seedDb({
      drive_connection: [connection({ root_origin: 'app', root_folder_name: null })],
    })
    google.email = 'someone.else@mdmmarketing.com.au'
    // ensureRootFolder would run here; with no Drive fetch stubbed for it the
    // call fails, and that is fine — what matters is that a NON-picked root
    // never sets the flag
    await completeDriveConnect(req, 'code', 'owner@md.invalid').catch(() => null)
    expect(row()?.root_account_changed ?? false).toBeFalsy()
  })
})
