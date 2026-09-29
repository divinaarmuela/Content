import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AN ACCOUNT MANAGER RUNS A CLIENT'S INTAKE FORMS (the owner, 29 Sep 2026: "can an AM create an intake form? …
 * make it so they can … they can modify the questions there right?"). Create, rename, edit the questions, send,
 * delete an unanswered one. Three things stay a super admin's: the default list for every form, deleting a form the
 * client has answered, and (on their own route) the shared templates.
 */

let role = 'account_manager'
const RANK: Record<string, number> = { client: 0, editor: 1, scheduler: 2, general: 3, account_manager: 4, super_admin: 5 }
class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('../app/lib/authz', () => ({
  requireRole: async (required: string) => {
    if (RANK[role] < RANK[required]) throw new AuthzError('Insufficient permissions', 403)
    return { id: 'u1', role, email: 'am@example.invalid' }
  },
  roleSatisfies: (actual: string, required: string) => RANK[actual] >= RANK[required],
  authzErrorResponse: (e: unknown) => e instanceof AuthzError ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))
vi.mock('@/lib/db', () => ({ withRequestCache: (f: () => unknown) => f(), table: () => ({}) }))
vi.mock('@/lib/db-join', () => ({ attachOne: async (r: unknown) => r }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: async () => {} } }))

const calls: string[] = []
let answers: Record<string, unknown> = {}
const definition = { sections: [{ id: 's', title: 'S', blocks: [{ id: 'q1', label: 'Q', type: 'text' }] }] }
vi.mock('../app/lib/intake', () => ({
  createIntakeForm: async () => { calls.push('create'); return { id: 'f1', token: 't', status: 'draft', title: 'X' } },
  getIntakeFormForClient: async () => ({ id: 'f1', template_key: 'one_off', definition, answers }),
  updateIntakeDefinition: async () => { calls.push('update_definition'); return true },
  setFormRecipients: async () => { calls.push('set_recipients') },
  saveIntakeDefaultRecipients: async () => { calls.push('save_default') },
  deleteIntakeForm: async () => { calls.push('delete') },
  renameIntakeForm: async () => { calls.push('rename') },
  listIntakeFormsForClient: async () => [], listTeamRecipients: async () => [], getIntakeDefaultRecipients: async () => [],
  getShowOnPortalFlags: async () => ({}), listIntakeFiles: async () => [],
  reopenIntake: async () => {}, rotateIntakeToken: async () => 't2', markIntakeSent: async () => {}, setShowOnPortal: async () => {},
}))

const route = await import('../app/api/clients/[id]/intake/route')
const params = Promise.resolve({ id: 'c1' })
const req = (method: string, body?: unknown, qs = '') =>
  new Request(`http://x/api/clients/c1/intake${qs}`, { method, body: body ? JSON.stringify(body) : undefined })

beforeEach(() => { role = 'account_manager'; calls.length = 0; answers = {} })

describe('an account manager and intake forms', () => {
  it('creates a form', async () => {
    const res = await route.POST(req('POST', { template_key: 'one_off' }), { params })
    expect(res.status).toBe(201)
    expect(calls).toEqual(['create'])
  })

  it('edits the questions and renames the form', async () => {
    expect((await route.PATCH(req('PATCH', { form_id: 'f1', action: 'update_definition', definition }), { params })).status).toBe(200)
    expect((await route.PATCH(req('PATCH', { form_id: 'f1', action: 'rename', title: 'New' }), { params })).status).toBe(200)
    expect(calls).toEqual(['update_definition', 'rename'])
  })

  it('is told the buttons are theirs, but not the super admin ones', async () => {
    const json = await (await route.GET(req('GET'), { params })).json()
    expect(json).toMatchObject({ can_manage: true, is_admin: false })
  })

  it('sets one form\'s recipients, but not the list for every form — refused before anything is written', async () => {
    expect((await route.PATCH(req('PATCH', { form_id: 'f1', action: 'set_recipients', emails: ['a@b.c'] }), { params })).status).toBe(200)
    const res = await route.PATCH(req('PATCH', { form_id: 'f1', action: 'set_recipients', emails: ['a@b.c'], apply_to_all: true }), { params })
    expect(res.status).toBe(403)
    expect(calls).toEqual(['set_recipients'])
  })

  it('deletes an unanswered form, never one the client answered', async () => {
    const d0 = await route.DELETE(req('DELETE', undefined, '?form_id=f1'), { params })
    expect(d0.status).toBe(200)
    answers = { q1: 'the client wrote this' }
    expect((await route.DELETE(req('DELETE', undefined, '?form_id=f1&confirm=answers'), { params })).status).toBe(403)
    expect(calls).toEqual(['delete'])
  })

  it('a super admin still may do both', async () => {
    role = 'super_admin'
    answers = { q1: 'the client wrote this' }
    expect((await route.DELETE(req('DELETE', undefined, '?form_id=f1&confirm=answers'), { params })).status).toBe(200)
    expect((await route.PATCH(req('PATCH', { form_id: 'f1', action: 'set_recipients', emails: ['a@b.c'], apply_to_all: true }), { params })).status).toBe(200)
    expect(calls).toEqual(['delete', 'set_recipients', 'save_default'])
  })

  it('an editor still only reads', async () => {
    role = 'editor'
    expect((await route.POST(req('POST', {}), { params })).status).toBe(403)
    expect((await route.GET(req('GET'), { params })).status).toBe(200)
  })
})

describe('an account manager adds a client (29 Sep 2026)', () => {
  it('is put on the client they made, so it does not vanish from their boards', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/website/clients/route.ts', 'utf8')
    expect(src).toContain("const user = await requireRole('account_manager')")
    expect(src).toContain("if (!roleSatisfies(user.role, 'super_admin')) {")
    expect(src).toContain("team_user_id: user.id, client_id: String(data.id)")
  })
})
