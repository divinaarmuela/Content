import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The seams of the four routes behind "Where the files go".
 *
 * One of them hands a Google access token to a browser, and two of them can
 * write into the agency's real Drive. So what is checked here is not the happy
 * path — the library tests cover that — but who is let in, what a bad id is
 * told, and whether the token is allowed to sit in a cache.
 */

let role = 'super_admin'
const RANK: Record<string, number> = {
  client: 0, editor: 1, scheduler: 2, account_manager: 3, super_admin: 4,
}
class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('../app/lib/authz', () => ({
  requireRole: async (required: string) => {
    if (RANK[role] < RANK[required]) throw new AuthzError('Insufficient permissions', 403)
    return { role, email: 'owner@example.invalid' }
  },
  authzErrorResponse: (e: unknown) => e instanceof AuthzError
    ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))

const picked = {
  id: 'hq', name: 'MD Media HQ', owner_email: 'tech@example.invalid',
  picked_at: null, picked_by: null, clients_folder_id: 'clients-folder',
}

const saved: { id: string; name: string; by: string }[] = []
const applied: unknown[][] = []
let planCalls: { createClientsFolder?: boolean }[] = []

vi.mock('../app/lib/gdrive', () => ({
  driveConfigured: () => true,
  driveStatus: async () => ({ connected: true, account_email: 'tech@example.invalid' }),
  pickedRoot: async () => picked,
  accessToken: async () => ({ ok: true, token: 'a-google-access-token' }),
}))

vi.mock('../app/lib/gdrive-root', async () => {
  const actual = await vi.importActual<typeof import('../app/lib/gdrive-root')>(
    '../app/lib/gdrive-root',
  )
  return {
    ...actual,
    choosePickedRoot: async (args: { id: string; by: string }) => {
      if (!actual.DRIVE_ID.test(args.id)) {
        return { ok: false, message: 'That is not a Google Drive folder' }
      }
      saved.push({ id: args.id, name: 'MD Media HQ', by: args.by })
      return { ok: true, name: 'MD Media HQ', owner_email: null }
    },
    buildRootPlan: async (opts?: { createClientsFolder?: boolean }) => {
      planCalls.push(opts ?? {})
      return { ok: true, plan: { rows: [], matched: 0, total: 0, to_create: 0 } }
    },
    applyRootPlan: async (rows: unknown[]) => {
      applied.push(rows)
      return { ok: true, result: { linked: rows.length, created: 0, skipped: [] } }
    },
  }
})

const { GET: getRoot } = await import('../app/api/gdrive/root/route')
const { GET: getToken } = await import('../app/api/gdrive/root/token/route')
const { POST: postPick } = await import('../app/api/gdrive/root/pick/route')
const { GET: getPlan, POST: postPlan } = await import('../app/api/gdrive/root/plan/route')
const { POST: postApply } = await import('../app/api/gdrive/root/apply/route')

const post = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  role = 'super_admin'
  saved.length = 0
  applied.length = 0
  planCalls = []
})

describe('the token route', () => {
  it('gives a super admin a token, and never the refresh token', async () => {
    const res = await getToken()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ token: 'a-google-access-token' })
  })

  it('tells it never to be stored', async () => {
    // an OAuth token sitting in a proxy cache, or in the back/forward cache,
    // is a token somebody else can read minutes later
    const res = await getToken()
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/)
  })

  it('is closed to everybody else — including an account manager', async () => {
    for (const r of ['account_manager', 'scheduler', 'editor', 'client']) {
      role = r
      const res = await getToken()
      expect(res.status, r).toBe(403)
      expect(await res.text(), r).not.toContain('a-google-access-token')
    }
  })
})

describe('who may change where the files go', () => {
  it('refuses everyone below super admin', async () => {
    role = 'account_manager'
    expect((await getRoot()).status).toBe(403)
    expect((await postPick(post('https://x.test/', { id: 'hq' }))).status).toBe(403)
    expect((await getPlan()).status).toBe(403)
    expect((await postPlan(post('https://x.test/', {}))).status).toBe(403)
    expect((await postApply(post('https://x.test/', { rows: [{ client_id: 'c1' }] }))).status).toBe(403)
    expect(saved).toEqual([])
    expect(applied).toEqual([])
    expect(planCalls).toEqual([])
  })

  it('does not cache the folder ids it answers with', async () => {
    expect((await getRoot()).headers.get('Cache-Control')).toMatch(/no-store/)
  })
})

describe('choosing the folder', () => {
  it('refuses anything that is not a Drive id', async () => {
    for (const id of ['', '../../etc', "hq' or '1", 'hq/clients', 'a b']) {
      const res = await postPick(post('https://x.test/', { id }))
      expect(res.status, id).toBe(400)
    }
    expect(saved).toEqual([])
  })

  it('records who chose it', async () => {
    const res = await postPick(post('https://x.test/', { id: '11LurZJxEOuysDaec-eKMeZemLqhgMq6K' }))
    expect(res.status).toBe(200)
    expect(saved).toEqual([{
      id: '11LurZJxEOuysDaec-eKMeZemLqhgMq6K', name: 'MD Media HQ', by: 'owner@example.invalid',
    }])
  })
})

describe('the plan', () => {
  it('creates nothing on a read', async () => {
    await getPlan()
    expect(planCalls).toEqual([{}])
  })

  it('makes the Clients folder only when a person said so', async () => {
    await postPlan(post('https://x.test/', {}))
    expect(planCalls).toEqual([{ createClientsFolder: false }])
    planCalls = []
    await postPlan(post('https://x.test/', { create_clients_folder: true }))
    expect(planCalls).toEqual([{ createClientsFolder: true }])
  })
})

describe('applying', () => {
  it('refuses an empty submission rather than treating it as "all of them"', async () => {
    const res = await postApply(post('https://x.test/', { rows: [] }))
    expect(res.status).toBe(400)
    expect(applied).toEqual([])
  })

  it('passes the rows through exactly as the person left them', async () => {
    const rows = [{ client_id: 'c1', folder_id: 'f1' }, { client_id: 'c2', create: true }]
    const res = await postApply(post('https://x.test/', { rows }))
    expect(res.status).toBe(200)
    expect(applied).toEqual([rows])
  })
})
