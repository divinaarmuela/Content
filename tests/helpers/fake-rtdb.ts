/**
 * The Realtime Database REST surface, in memory, on globalThis.fetch.
 * Just enough for lib/db.ts and the migration script: GET (shallow,
 * orderBy+equalTo), PUT, PATCH (multi-path), DELETE, null-deletes.
 */
type Json = any
const ORIGIN = 'https://fake.firebasedatabase.app'

function getAt(tree: Json, segs: string[]): Json {
  let cur = tree
  for (const s of segs) { if (cur == null || typeof cur !== 'object') return null; cur = cur[s] }
  return cur === undefined ? null : cur
}
function setAt(tree: Json, segs: string[], value: Json) {
  if (segs.length === 0) return value ?? {}
  let cur = tree
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] == null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {}
    cur = cur[segs[i]]
  }
  const last = segs[segs.length - 1]
  if (value === null || value === undefined) delete cur[last]; else cur[last] = value
  return tree
}
function prune(node: Json): Json {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const k of Object.keys(node)) { node[k] = prune(node[k]); if (node[k] === null || (typeof node[k] === 'object' && Object.keys(node[k]).length === 0)) delete node[k] }
    return Object.keys(node).length ? node : null
  }
  return node
}

export function installFakeRtdb(seed: Json = {}) {
  let tree: Json = structuredClone(seed)
  const calls: { method: string; path: string }[] = []
  const real = globalThis.fetch
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = ORIGIN

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.origin !== ORIGIN) return real(input, init)
    const method = (init.method ?? 'GET').toUpperCase()
    const segs = url.pathname.replace(/\.json$/, '').split('/').filter(Boolean)
    calls.push({ method, path: '/' + segs.join('/') })
    const body = init.body ? JSON.parse(init.body) : undefined
    const respond = (v: Json, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

    if (method === 'GET') {
      let node = structuredClone(getAt(tree, segs))
      const orderBy = url.searchParams.get('orderBy'), equalTo = url.searchParams.get('equalTo')
      if (orderBy && equalTo !== null && node && typeof node === 'object') {
        const col = JSON.parse(orderBy), val = JSON.parse(equalTo)
        node = Object.fromEntries(Object.entries(node).filter(([, r]: any) => r?.[col] === val))
        if (!Object.keys(node).length) node = null
      }
      if (url.searchParams.get('shallow') === 'true' && node && typeof node === 'object') node = Object.fromEntries(Object.keys(node).map(k => [k, true]))
      return respond(node)
    }
    if (method === 'PUT') { tree = prune(setAt(tree, segs, body)) ?? {}; return respond(body) }
    if (method === 'PATCH') {
      for (const [k, v] of Object.entries(body)) tree = setAt(tree, [...segs, ...k.split('/').filter(Boolean)], v)
      tree = prune(tree) ?? {}
      return respond(body)
    }
    if (method === 'DELETE') { tree = prune(setAt(tree, segs, null)) ?? {}; return respond(null) }
    return respond({ error: 'unsupported' }, 400)
  }) as typeof fetch

  return { tree: () => tree, calls: () => calls, restore: () => { globalThis.fetch = real } }
}
