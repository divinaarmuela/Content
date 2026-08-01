import 'server-only'
import {
  buildPostBody, classifyResponse, mediaTypeFor,
  type MediaItem, type Platform, type PublishOutcome,
} from './publish-core'

/**
 * Social publishing provider.
 *
 * Everything the app does goes through this interface, so the vendor is one
 * adapter rather than a dependency threaded through the codebase. Swapping
 * providers means writing a second implementation, not touching the scheduler.
 */
export interface Publisher {
  readonly name: string
  /** Is the provider usable right now (credentials present)? */
  configured(): boolean
  /** Create a provider profile to hold one client's accounts. Returns its id. */
  createProfile(name: string): Promise<string>
  /** OAuth URL to connect one platform for one client profile. */
  connectUrl(input: { platform: Platform; profileId: string; redirectUrl: string }): Promise<string>
  /** Accounts currently connected, optionally scoped to one client profile. */
  listAccounts(profileId?: string): Promise<ProviderAccount[]>
  /** Push bytes to the provider and return a URL usable in a post. */
  uploadMedia(input: { bytes: ArrayBuffer; filename: string; contentType: string }): Promise<MediaItem>
  /** Create (or schedule) a post. Idempotent on requestId. */
  createPost(input: CreatePostInput): Promise<PublishOutcome>
}

export type ProviderAccount = {
  providerAccountId: string
  platform: string
  name: string | null
  username: string | null
  avatarUrl: string | null
}

export type CreatePostInput = {
  caption: string
  media: MediaItem[]
  targets: { platform: Platform; accountId: string }[]
  scheduledFor?: string | null
  timezone?: string
  /** UUID, stored before the call and reused on every retry of this job. */
  requestId: string
  profileId?: string | null
}

const BASE = process.env.ZERNIO_API_URL ?? 'https://zernio.com/api/v1'

class ZernioPublisher implements Publisher {
  readonly name = 'zernio'

  configured() {
    return Boolean(process.env.ZERNIO_API_KEY)
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const key = process.env.ZERNIO_API_KEY
    if (!key) throw new Error('ZERNIO_API_KEY is not set')
    return { Authorization: `Bearer ${key}`, ...extra }
  }

  /** Profile ids are provider-minted ObjectIds — they cannot be invented
   *  locally, so a client's profile is created here on first connect. */
  async createProfile(name: string): Promise<string> {
    const res = await fetch(`${BASE}/profiles`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error ?? `Could not create profile (${res.status})`)
    const id = json?.profile?._id ?? json?._id
    if (typeof id !== 'string') throw new Error('Provider returned no profile id')
    return id
  }

  async connectUrl({ platform, profileId, redirectUrl }: {
    platform: Platform; profileId: string; redirectUrl: string
  }): Promise<string> {
    const qs = new URLSearchParams({ profileId, redirect_url: redirectUrl })
    const res = await fetch(`${BASE}/connect/${platform}?${qs}`, { headers: this.headers() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error ?? `Could not start ${platform} connection (${res.status})`)
    const url = json?.authUrl ?? json?.url
    if (typeof url !== 'string') throw new Error('Provider returned no authUrl')
    return url
  }

  async listAccounts(profileId?: string): Promise<ProviderAccount[]> {
    const qs = profileId ? `?${new URLSearchParams({ profileId })}` : ''
    const res = await fetch(`${BASE}/accounts${qs}`, { headers: this.headers() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error ?? `Could not list accounts (${res.status})`)

    const rows: unknown[] = Array.isArray(json) ? json : (json.accounts ?? json.data ?? [])
    return rows.map(r => {
      const a = r as Record<string, unknown>
      return {
        providerAccountId: String(a._id ?? a.id ?? ''),
        platform: String(a.platform ?? ''),
        name: (a.name ?? a.displayName ?? null) as string | null,
        username: (a.username ?? a.handle ?? null) as string | null,
        avatarUrl: (a.avatarUrl ?? a.picture ?? null) as string | null,
      }
    }).filter(a => a.providerAccountId && a.platform)
  }

  /** Presign → PUT → return the public URL.
   *
   *  The provider does not accept arbitrary public URLs, so assets held in
   *  Supabase Storage must be relayed through here rather than linked. */
  async uploadMedia({ bytes, filename, contentType }: {
    bytes: ArrayBuffer; filename: string; contentType: string
  }): Promise<MediaItem> {
    const type = mediaTypeFor(contentType)
    if (!type) throw new Error(`Unsupported media type: ${contentType}`)

    const presign = await fetch(`${BASE}/media/presign`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ filename, contentType }),
    })
    const pj = await presign.json().catch(() => ({}))
    if (!presign.ok) throw new Error(pj?.error ?? `Could not presign media (${presign.status})`)

    const uploadUrl = pj?.uploadUrl
    const publicUrl = pj?.publicUrl
    if (!uploadUrl || !publicUrl) throw new Error('Presign response missing uploadUrl/publicUrl')

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
    })
    if (!put.ok) throw new Error(`Media upload failed (${put.status})`)

    return { url: publicUrl, type }
  }

  async createPost(input: CreatePostInput): Promise<PublishOutcome> {
    const body = buildPostBody({
      caption: input.caption,
      media: input.media,
      targets: input.targets,
      scheduledFor: input.scheduledFor,
      timezone: input.timezone,
    })

    let res: Response
    try {
      res = await fetch(`${BASE}/posts`, {
        method: 'POST',
        headers: this.headers({
          'Content-Type': 'application/json',
          // provider-side replay protection for our own retries
          'x-request-id': input.requestId,
          ...(input.profileId ? { 'x-profile-id': input.profileId } : {}),
        }),
        body: JSON.stringify(body),
      })
    } catch (e) {
      // network failure: we do not know whether the post was created, so this
      // must be retryable — the request id makes the retry safe
      return { kind: 'retryable', message: e instanceof Error ? e.message : 'Network error' }
    }

    const json = await res.json().catch(() => ({}))
    return classifyResponse(res.status, json)
  }
}

/** Refuses every call with a clear message, so the app runs and the UI can
 *  explain what is missing instead of crashing at import time. */
class UnconfiguredPublisher implements Publisher {
  readonly name = 'none'
  configured() { return false }
  private fail(): never {
    throw new Error('No publishing provider is configured — set ZERNIO_API_KEY')
  }
  async createProfile() { return this.fail() }
  async connectUrl() { return this.fail() }
  async listAccounts() { return [] as ProviderAccount[] }
  async uploadMedia() { return this.fail() }
  async createPost(): Promise<PublishOutcome> {
    return { kind: 'permanent', message: 'No publishing provider is configured' }
  }
}

export function getPublisher(): Publisher {
  const zernio = new ZernioPublisher()
  return zernio.configured() ? zernio : new UnconfiguredPublisher()
}
