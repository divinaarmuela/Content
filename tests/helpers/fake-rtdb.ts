/**
 * The Realtime Database REST surface, in memory, on globalThis.fetch.
 * Just enough for lib/db.ts and the migration script: GET (shallow,
 * orderBy+equalTo), PUT, PATCH (multi-path), DELETE, null-deletes.
 *
 * Also fakes the two pieces of database.rules.json that lib/db.ts's own
 * logic depends on rather than merely wraps: an orderBy on a column with no
 * ".indexOn" 400s, exactly like the real database would; and a PATCH that
 * would overwrite an existing, different, non-null /mdm/uniq/... claim 401s
 * with nothing applied — the atomic half of the unique-claim race guard.
 *
 * …and the third: conditional writes. A GET carrying `X-Firebase-ETag: true`
 * answers with an `ETag` header; a PUT carrying `if-match` is applied only if
 * the node still hashes to that tag, and otherwise 412s with the node's
 * current value and a fresh `ETag`. That is the compare-and-set lib/db.ts's
 * claim paths are built on, so the fake has to be honest about it.
 *
 * `onBeforeWrite(path, fn)` runs `fn` immediately before a write at `path`
 * lands — the seam a test uses to stage a rival's write landing between a
 * claimant's read and its conditional PUT.
 */
import { INDEXED_COLUMNS } from '@/lib/db'

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

/**
 * The node's ETag: a stable hash of its JSON. A missing node has a well-known
 * one.
 *
 * Hashing the CONTENT rather than counting versions is deliberate, and it
 * reproduces the real database's behaviour rather than papering over it: RTDB
 * derives its ETag from the node's value too, so a node written to B and back
 * to A carries the tag it had at A, and a conditional write held across that
 * round trip succeeds. That is the classic ABA, and every claim in lib/db.ts
 * is written to be indifferent to it — the predicate is about the value, so a
 * value that came back is a value that is still true. A counter here would
 * hide an assumption the production database does not honour.
 */
const NULL_ETAG = 'null_etag'
function etagOf(node: Json): string {
  if (node === null || node === undefined) return NULL_ETAG
  const s = JSON.stringify(node)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return 'v' + (h >>> 0).toString(36)
}
/** Header lookup that does not care how the caller cased the name. */
function headerOf(init: any, name: string): string | null {
  const h = init?.headers
  if (!h) return null
  if (typeof h.get === 'function') return h.get(name)
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name.toLowerCase()) return String(v)
  return null
}

export function installFakeRtdb(seed: Json = {}) {
  let tree: Json = structuredClone(seed)
  const calls: { method: string; path: string; query: string }[] = []
  const hooks: { path: string; fn: () => void | Promise<void> }[] = []
  const real = globalThis.fetch
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = ORIGIN

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.origin !== ORIGIN) return real(input, init)
    const method = (init.method ?? 'GET').toUpperCase()
    const segs = url.pathname.replace(/\.json$/, '').split('/').filter(Boolean)
    const path = '/' + segs.join('/')
    calls.push({ method, path, query: url.search })
    const body = init.body ? JSON.parse(init.body) : undefined
    const respond = (v: Json, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...extra } })

    if (method !== 'GET') {
      // the seam a race test writes through: a rival's write lands here,
      // after this caller read and before its own write is applied
      for (const h of [...hooks]) if (h.path === path) await h.fn()
    }

    if (method === 'GET') {
      const orderBy = url.searchParams.get('orderBy'), equalTo = url.searchParams.get('equalTo')
      if (orderBy) {
        const col = JSON.parse(orderBy)
        if (!INDEXED_COLUMNS.has(col)) {
          return respond({ error: `Index not defined, add ".indexOn": "${col}", for the path "/${segs.join('/')}" to your security rules for better performance` }, 400)
        }
      }
      let node = structuredClone(getAt(tree, segs))
      if (orderBy && equalTo !== null && node && typeof node === 'object') {
        const col = JSON.parse(orderBy), val = JSON.parse(equalTo)
        node = Object.fromEntries(Object.entries(node).filter(([, r]: any) => r?.[col] === val))
        if (!Object.keys(node).length) node = null
      }
      if (url.searchParams.get('shallow') === 'true' && node && typeof node === 'object') node = Object.fromEntries(Object.keys(node).map(k => [k, true]))
      const wantsEtag = (headerOf(init, 'X-Firebase-ETag') ?? '') !== ''
      return respond(node, 200, wantsEtag ? { ETag: etagOf(node) } : {})
    }
    if (method === 'PUT') {
      const ifMatch = headerOf(init, 'if-match')
      if (ifMatch != null) {
        const current = getAt(tree, segs)
        if (etagOf(current) !== ifMatch) {
          return respond(current, 412, { ETag: etagOf(current) })
        }
      }
      tree = prune(setAt(tree, segs, body)) ?? {}
      return respond(body, 200, ifMatch != null ? { ETag: etagOf(getAt(tree, segs)) } : {})
    }
    if (method === 'PATCH') {
      // The atomic half of the unique-claim guard (database.rules.json
      // ".write" on /mdm/uniq/$table/$field/$key): a losing claimant's
      // whole multi-path PATCH is rejected, nothing partially applied.
      for (const [k, v] of Object.entries(body)) {
        const fullSegs = [...segs, ...k.split('/').filter(Boolean)]
        const uniqAt = fullSegs.indexOf('uniq')
        if (uniqAt >= 0 && fullSegs.length >= uniqAt + 4) {
          const existing = getAt(tree, fullSegs)
          if (existing != null && v != null && existing !== v) {
            return respond({ error: 'Permission denied' }, 401)
          }
        }
      }
      for (const [k, v] of Object.entries(body)) tree = setAt(tree, [...segs, ...k.split('/').filter(Boolean)], v)
      tree = prune(tree) ?? {}
      return respond(body)
    }
    if (method === 'DELETE') { tree = prune(setAt(tree, segs, null)) ?? {}; return respond(null) }
    return respond({ error: 'unsupported' }, 400)
  }) as typeof fetch

  return {
    tree: () => tree,
    calls: () => calls,
    restore: () => { globalThis.fetch = real },
    /** Run `fn` just before any write at `path` lands. Returns an unregister. */
    onBeforeWrite(path: string, fn: () => void | Promise<void>) {
      const hook = { path, fn }
      hooks.push(hook)
      return () => { const i = hooks.indexOf(hook); if (i >= 0) hooks.splice(i, 1) }
    },
  }
}
