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
    fake = installFakeRtdb({ mdm: { tables: { t: { a: { id: 'a', c: 'x' }, b: { id: 'b', c: 'y' } } } } })
    expect(await (await fetch(`${U}/mdm/tables/t.json?shallow=true`)).json()).toEqual({ a: true, b: true })
    const r = await (await fetch(`${U}/mdm/tables/t.json?orderBy=${encodeURIComponent('"c"')}&equalTo=${encodeURIComponent('"y"')}`)).json()
    expect(r).toEqual({ b: { id: 'b', c: 'y' } })
  })
  it('null in a PATCH deletes', async () => {
    fake = installFakeRtdb({ mdm: { x: 1, y: 2 } })
    await fetch(`${U}/mdm.json`, { method: 'PATCH', body: JSON.stringify({ x: null }) })
    expect(fake.tree().mdm).toEqual({ y: 2 })
  })
})
