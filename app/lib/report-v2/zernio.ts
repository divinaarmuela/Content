import 'server-only'
import type { ZernioFetch } from './types'

/** REPORT V2 — the live Zernio reader (GET only). Waits out a 429 (about 10 calls per 2 s) up to four times. */
const BASE = process.env.ZERNIO_API_URL ?? 'https://zernio.com/api/v1'

export const liveZernio: ZernioFetch = async (path, query) => {
  const key = process.env.ZERNIO_API_KEY
  if (!key) return { ok: false, error: 'Zernio is not connected (no API key)' }
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' })
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      if (res.status === 429 && attempt < 4) {
        const reset = Number(res.headers.get('x-ratelimit-reset'))
        const wait = Number.isFinite(reset) && reset > 0 ? Math.min(20_000, Math.max(1000, reset * 1000 - Date.now() + 250)) : 2000 * (attempt + 1)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) return { ok: false, error: String(body.error ?? body.message ?? `Zernio ${res.status}`) }
      return { ok: true, data: body as never }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Zernio could not be reached' }
    }
  }
}
