import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { table } from '@/lib/db'
import type { LinktreeConnection } from '@/lib/db-types'
import { decryptSecret, encryptSecret } from './secret-box'
import { DASHBOARD_URL } from './app-url'
import {
  LINKTREE_AUTH_METADATA_URL, LINKTREE_CALLBACK_PATH, LINKTREE_CLIENT_ID_DEFAULT, LINKTREE_MCP_URL, LINKTREE_PROTOCOL,
  parseToolResult, type LinktreeTool,
} from './linktree-core'

/**
 * LINKTREE — the server half (linktree-core.ts says what was checked and
 * why it is shaped this way). Tokens are kept per client, encrypted with the
 * same box the client credentials use, and refreshed when they lapse. Every
 * tool call opens its own short session with Linktree's server, because a
 * serverless request has nowhere to keep one between calls.
 */

export function linktreeClientId(): string {
  return process.env.LINKTREE_CLIENT_ID?.trim() || LINKTREE_CLIENT_ID_DEFAULT
}

export function linktreeRedirectUri(): string {
  return `${DASHBOARD_URL}${LINKTREE_CALLBACK_PATH}`
}

type AuthMeta = { authorization_endpoint: string; token_endpoint: string }
let metaCache: { at: number; meta: AuthMeta } | null = null

/** Linktree's sign-in and token addresses, read from its own metadata — never hardcoded, they carry tenant ids */
export async function linktreeAuthMeta(): Promise<AuthMeta> {
  if (metaCache && Date.now() - metaCache.at < 3_600_000) return metaCache.meta
  const res = await fetch(LINKTREE_AUTH_METADATA_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Linktree's sign-in service did not answer (${res.status})`)
  const json = await res.json() as Partial<AuthMeta>
  if (!json.authorization_endpoint || !json.token_endpoint) throw new Error('Linktree’s sign-in service answered without its addresses')
  metaCache = { at: Date.now(), meta: { authorization_endpoint: json.authorization_endpoint, token_endpoint: json.token_endpoint } }
  return metaCache.meta
}

export function newPkce(): { state: string; verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return {
    state: randomBytes(24).toString('hex'),
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

type TokenSet = { access_token: string; refresh_token?: string; expires_in?: number }

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const { token_endpoint } = await linktreeAuthMeta()
  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: linktreeClientId(), resource: LINKTREE_MCP_URL, ...params }).toString(),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({})) as TokenSet & { error?: string; error_description?: string }
  if (!res.ok || !json.access_token) throw new Error(json.error_description || json.error || `Linktree refused the sign-in (${res.status})`)
  return json
}

export function exchangeLinktreeCode(code: string, verifier: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: linktreeRedirectUri() })
}

/** the connection's tokens, as the row keeps them */
export function tokenFields(t: TokenSet, nowMs: number, previousRefresh?: string | null): Pick<LinktreeConnection, 'access_token_enc' | 'refresh_token_enc' | 'expires_at'> {
  const refresh = t.refresh_token ?? previousRefresh ?? null
  return {
    access_token_enc: encryptSecret(t.access_token),
    refresh_token_enc: refresh ? encryptSecret(refresh) : null,
    expires_at: new Date(nowMs + Math.max(60, Number(t.expires_in ?? 3600) - 60) * 1000).toISOString(),
  } as never
}

/** a token that works now: the stored one, or a fresh one from the refresh token — written back */
export async function freshAccessToken(conn: LinktreeConnection): Promise<string> {
  const row = conn as LinktreeConnection & { access_token_enc?: string | null; refresh_token_enc?: string | null; expires_at?: string | null }
  const expires = row.expires_at ? Date.parse(row.expires_at) : 0
  if (row.access_token_enc && expires > Date.now() + 30_000) return decryptSecret(row.access_token_enc)
  if (!row.refresh_token_enc) throw new Error('UNAUTHORIZED: the Linktree sign-in has lapsed')
  const previous = decryptSecret(row.refresh_token_enc)
  const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: previous })
  await table<LinktreeConnection>('linktree_connections').update(conn.id, {
    ...tokenFields(next, Date.now(), previous), updated_at: new Date().toISOString(), last_error: null,
  } as never)
  return next.access_token
}

/* ── Linktree's server: a short session per request ─────────────────────── */

type Rpc = { jsonrpc: '2.0'; id?: number; method: string; params?: unknown }

/** the JSON-RPC answer out of a reply that is either JSON or an event stream */
async function readRpc(res: Response, id: number): Promise<{ result?: unknown; error?: { message?: string } }> {
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('text/event-stream')) {
    const text = await res.text()
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      try {
        const msg = JSON.parse(line.slice(5).trim()) as { id?: number; result?: unknown; error?: { message?: string } }
        if (msg.id === id) return msg
      } catch { /* a keep-alive or a partial line */ }
    }
    throw new Error('Linktree answered without a result')
  }
  return await res.json() as { result?: unknown; error?: { message?: string } }
}

/**
 * Open a session with Linktree's server and run `work` inside it. `call`
 * runs one tool and gives back its parsed result, or throws the tool's own
 * reason.
 */
export async function withLinktree<T>(
  accessToken: string,
  work: (call: (tool: LinktreeTool, args?: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  let session: string | null = null
  let nextId = 1
  const post = async (body: Rpc): Promise<Response> => {
    const res = await fetch(LINKTREE_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${accessToken}`,
        'MCP-Protocol-Version': LINKTREE_PROTOCOL,
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (res.status === 401) throw new Error('UNAUTHORIZED: Linktree did not accept the sign-in')
    if (res.status === 429) throw new Error('RATE_LIMITED')
    return res
  }

  const initId = nextId++
  const init = await post({
    jsonrpc: '2.0', id: initId, method: 'initialize',
    params: { protocolVersion: LINKTREE_PROTOCOL, capabilities: {}, clientInfo: { name: 'md-media-agency-os', version: '1.0.0' } },
  })
  if (!init.ok) throw new Error(`Linktree did not open a session (${init.status})`)
  session = init.headers.get('mcp-session-id')
  const opened = await readRpc(init, initId)
  if (opened.error) throw new Error(opened.error.message ?? 'Linktree did not open a session')
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null)

  const call = async (tool: LinktreeTool, args: Record<string, unknown> = {}): Promise<unknown> => {
    const id = nextId++
    const res = await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } })
    if (!res.ok) throw new Error(`Linktree refused ${tool} (${res.status})`)
    const msg = await readRpc(res, id)
    if (msg.error) throw new Error(msg.error.message ?? `Linktree refused ${tool}`)
    const parsed = parseToolResult(msg.result)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.data
  }
  return work(call)
}
