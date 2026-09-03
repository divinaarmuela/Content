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
  it('GET returns an ETag only when the request asks for one', async () => {
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', n: 1 } } } } })
    const plain = await fetch(`${U}/mdm/tables/t/a.json`)
    expect(plain.headers.get('ETag')).toBeNull()
    const tagged = await fetch(`${U}/mdm/tables/t/a.json`, { headers: { 'X-Firebase-ETag': 'true' } })
    const etag = tagged.headers.get('ETag')
    expect(etag).toBeTruthy()
    // the same value hashes to the same tag; a changed value does not
    const again = await fetch(`${U}/mdm/tables/t/a.json`, { headers: { 'X-Firebase-ETag': 'true' } })
    expect(again.headers.get('ETag')).toBe(etag)
    await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', body: JSON.stringify({ id: 'a', n: 2 }) })
    const changed = await fetch(`${U}/mdm/tables/t/a.json`, { headers: { 'X-Firebase-ETag': 'true' } })
    expect(changed.headers.get('ETag')).not.toBe(etag)
  })
  it('a missing node has the well-known null ETag', async () => {
    fake = installFakeRtdb({ mdm: {} })
    const res = await fetch(`${U}/mdm/tables/t/nope.json`, { headers: { 'X-Firebase-ETag': 'true' } })
    expect(res.headers.get('ETag')).toBe('null_etag')
    expect(await res.json()).toBeNull()
  })
  it('PUT with if-match applies on a match and 412s with the current value on a mismatch', async () => {
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', n: 1 } } } } })
    const etag = (await fetch(`${U}/mdm/tables/t/a.json`, { headers: { 'X-Firebase-ETag': 'true' } })).headers.get('ETag')!

    const stale = await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', headers: { 'if-match': 'v-nope' }, body: JSON.stringify({ id: 'a', n: 9 }) })
    expect(stale.status).toBe(412)
    expect(await stale.json()).toEqual({ id: 'a', n: 1 })
    expect(stale.headers.get('ETag')).toBe(etag)
    expect(fake.tree().mdm.tables.t.a.n).toBe(1)

    const ok = await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ id: 'a', n: 9 }) })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('ETag')).toBeTruthy()
    expect(fake.tree().mdm.tables.t.a.n).toBe(9)
  })
  it('a PUT of null with if-match on an absent node creates it, and a rival creation loses', async () => {
    fake = installFakeRtdb({ mdm: {} })
    const first = await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', headers: { 'if-match': 'null_etag' }, body: JSON.stringify({ id: 'a', n: 1 }) })
    expect(first.status).toBe(200)
    const second = await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', headers: { 'if-match': 'null_etag' }, body: JSON.stringify({ id: 'a', n: 2 }) })
    expect(second.status).toBe(412)
    expect(fake.tree().mdm.tables.t.a.n).toBe(1)
  })
  it('onBeforeWrite fires just before a write lands, which is how a race is staged', async () => {
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', n: 1 } } } } })
    const etag = (await fetch(`${U}/mdm/tables/t/a.json`, { headers: { 'X-Firebase-ETag': 'true' } })).headers.get('ETag')!
    const off = fake.onBeforeWrite('/mdm/tables/t/a', () => { fake.tree().mdm.tables.t.a.n = 42 })
    // the rival's write lands between our read and our conditional PUT
    const res = await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ id: 'a', n: 7 }) })
    expect(res.status).toBe(412)
    expect(await res.json()).toEqual({ id: 'a', n: 42 })
    off()
    const after = await fetch(`${U}/mdm/tables/t/a.json`, { method: 'PUT', headers: { 'if-match': (await (await fetch(`${U}/mdm/tables/t/a.json`, { headers: { 'X-Firebase-ETag': 'true' } })).headers.get('ETag'))! }, body: JSON.stringify({ id: 'a', n: 7 }) })
    expect(after.status).toBe(200)
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
