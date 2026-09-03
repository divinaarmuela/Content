import { describe, it, expect, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'

let fake: ReturnType<typeof installFakeRtdb>
afterEach(() => fake?.restore())

const U = 'https://fake.firebasedatabase.app'

describe('fake rtdb', () => {
  it('GET/PUT/PATCH/DELETE round-trip', async () => {
    fake = installFakeRtdb()
    await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', body: JSON.stringify({ id: 'a', n: 1 }) })
    await fetch(`${U}/mdm.json`, { method: 'PATCH', body: JSON.stringify({ 'tables/t/b': { id: 'b', n: 2 }, 'tables/t/a/n': 5 }) })
    expect(await (await fetch(`${U}/mdm/tables/t.json`)).json()).toEqual({ a: { id: 'a', n: 5 }, b: { id: 'b', n: 2 } })
    await fetch(`${U}/mdm/tables/t/a.json`, { method: 'DELETE' })
    expect(await (await fetch(`${U}/mdm/tables/t/a.json`)).json()).toBeNull()
  })
  it('shallow and equalTo queries', async () => {
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', client_id: 'x' }, b: { id: 'b', client_id: 'y' } } } } })
    expect(await (await fetch(`${U}/mdm/tables/t.json?shallow=true`)).json()).toEqual({ a: true, b: true })
    const r = await (await fetch(`${U}/mdm/tables/t.json?orderBy=${encodeURIComponent('"client_id"')}&equalTo=${encodeURIComponent('"y"')}`)).json()
    expect(r).toEqual({ b: { id: 'b', client_id: 'y' } })
  })
  it('null in a PATCH deletes', async () => {
    fake = installFakeRtdb({ mdm: { x: 1, y: 2 } })
    await fetch(`${U}/mdm.json`, { method: 'PATCH', body: JSON.stringify({ x: null }) })
    expect(fake.tree().mdm).toEqual({ y: 2 })
  })
  it('GET with an orderBy on an unindexed column 400s', async () => {
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', c: 'x' } } } } })
    const res = await fetch(`${U}/mdm/tables/t.json?orderBy=${encodeURIComponent('"c"')}&equalTo=${encodeURIComponent('"x"')}`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Index not defined/)
  })
  it('GET with an orderBy on an indexed column still works', async () => {
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', client_id: 'x' } } } } })
    const res = await fetch(`${U}/mdm/tables/t.json?orderBy=${encodeURIComponent('"client_id"')}&equalTo=${encodeURIComponent('"x"')}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ a: { id: 'a', client_id: 'x' } })
  })
  it('PATCH rejects an overwrite of an existing different unique claim (401, nothing applied)', async () => {
    fake = installFakeRtdb({ mdm: { uniq: { team_users: { email: { k1: 'u1' } } }, tables: { team_users: { u1: { id: 'u1' } } } } })
    const res = await fetch(`${U}/mdm.json`, {
      method: 'PATCH',
      body: JSON.stringify({ 'uniq/team_users/email/k1': 'u2', 'tables/team_users/u2': { id: 'u2' } }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Permission denied' })
    expect(fake.tree().mdm.uniq.team_users.email.k1).toBe('u1')
    expect(fake.tree().mdm.tables.team_users.u2).toBeUndefined()
  })
  it('PATCH allows re-claiming a uniq slot with the same value, and clearing one (null)', async () => {
    fake = installFakeRtdb({ mdm: { uniq: { team_users: { email: { k1: 'u1' } } } } })
    const res = await fetch(`${U}/mdm.json`, { method: 'PATCH', body: JSON.stringify({ 'uniq/team_users/email/k1': 'u1' }) })
    expect(res.status).toBe(200)
    const res2 = await fetch(`${U}/mdm.json`, { method: 'PATCH', body: JSON.stringify({ 'uniq/team_users/email/k1': null }) })
    expect(res2.status).toBe(200)
    expect(fake.tree().mdm?.uniq).toBeUndefined()
  })
})
