import 'server-only'
import {
  buildPostBody, classifyResponse, mediaTypeFor,
  type MediaItem, type Platform, type PublishOutcome, type Target,
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
  /** Revoke an account at the provider, not just locally. */
  disconnectAccount(providerAccountId: string): Promise<void>
  /** Token validity and per-scope permissions for one account. */
  accountHealth(providerAccountId: string): Promise<unknown>
  /** Platform-native account insights (reach, views, engagement). */
  accountInsights(providerAccountId: string, platform: string): Promise<unknown>
  /** Day-by-day aggregate metrics. */
  dailyMetrics(providerAccountId?: string): Promise<unknown>
  /** Follower history and growth. */
  followerStats(): Promise<unknown>
  /** Published and scheduled posts. */
  listPosts(params?: { limit?: number }): Promise<unknown>
  /** Per-post analytics, including posts published outside this dashboard. */
  postAnalytics(postId?: string): Promise<unknown>
  /** Posts that have comments, across connected accounts. */
  listComments(): Promise<unknown>
  /** DM inbox: conversations across connected accounts. */
  listConversations(): Promise<unknown>
  /** Messages inside one conversation. */
  conversationMessages(conversationId: string, accountId: string): Promise<unknown>
  /** Send a reply into a conversation. */
  sendConversationMessage(conversationId: string, accountId: string, message: string): Promise<unknown>
  markConversationRead(conversationId: string, accountId: string): Promise<unknown>
  /** Best posting slots from historical engagement. */
  bestTimes(providerAccountId?: string): Promise<unknown>
  /** Comment→DM automations: list / detail / create / update / delete. */
  listAutomations(): Promise<unknown>
  getAutomation(id: string): Promise<unknown>
  automationLogs(id: string): Promise<unknown>
  createAutomation(body: Record<string, unknown>): Promise<unknown>
  updateAutomation(id: string, body: Record<string, unknown>): Promise<unknown>
  deleteAutomation(id: string): Promise<unknown>
  /** Comments on one post. */
  postComments(postId: string): Promise<unknown>
  /** Public reply, visible under the comment. */
  replyToComment(postId: string, commentId: string, message: string): Promise<unknown>
  /** Private DM to the comment's author (Instagram/Facebook). */
  privateReply(postId: string, commentId: string, message: string, buttons?: ReplyButton[]): Promise<unknown>
  /** Hide or unhide a comment. */
  setCommentHidden(postId: string, commentId: string, hidden: boolean): Promise<unknown>
  /** Delete a comment outright. */
  deleteComment(postId: string, commentId: string): Promise<unknown>
  /** Edit the caption of an existing post. */
  editPost(postId: string, content: string): Promise<unknown>
  /** Delete a published post from the platform. */
  deletePost(postId: string): Promise<unknown>
  /** Bulk messaging campaigns. */
  listBroadcasts(): Promise<unknown>
  /** Push bytes to the provider and return a URL usable in a post. */
  uploadMedia(input: { bytes: ArrayBuffer; filename: string; contentType: string }): Promise<MediaItem>
  /** Create (or schedule) a post. Idempotent on requestId. */
  createPost(input: CreatePostInput): Promise<PublishOutcome>
}

export type ReplyButton = { type?: string; title: string; url?: string; payload?: string }

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
  targets: Target[]
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

  async disconnectAccount(providerAccountId: string): Promise<void> {
    const res = await fetch(`${BASE}/accounts/${providerAccountId}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!res.ok && res.status !== 404) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json?.error ?? `Could not disconnect account (${res.status})`)
    }
  }

  /** GET returning parsed JSON, or null when the endpoint is unavailable.
   *
   *  Read endpoints are decorative relative to publishing: an account page
   *  missing its insights panel is a degraded page, not a broken one. Anything
   *  that is not JSON (their app HTML, served when a path does not exist) is
   *  treated as absent rather than allowed to throw. */
  private async getJson(path: string): Promise<unknown | null> {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: this.headers() })
      if (!res.ok) return null
      const text = await res.text()
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) return null
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  accountHealth(id: string) {
    return this.getJson(`/accounts/${id}/health`)
  }

  accountInsights(id: string, platform: string) {
    // only some platforms expose account-level insights
    const supported = ['instagram', 'facebook', 'tiktok', 'youtube']
    if (!supported.includes(platform)) return Promise.resolve(null)
    const path = platform === 'facebook' ? 'facebook/page-insights'
      : platform === 'youtube' ? 'youtube/channel-insights'
      : `${platform}/account-insights`
    return this.getJson(`/analytics/${path}?accountId=${encodeURIComponent(id)}`)
  }

  dailyMetrics(id?: string) {
    return this.getJson(`/analytics/daily-metrics${id ? `?accountId=${encodeURIComponent(id)}` : ''}`)
  }

  followerStats() {
    return this.getJson('/accounts/follower-stats')
  }

  listPosts(params: { limit?: number } = {}) {
    return this.getJson(`/posts?limit=${params.limit ?? 20}`)
  }

  listComments() {
    return this.getJson('/inbox/comments')
  }

  /** DM inbox: every conversation across connected accounts (IG, Telegram…). */
  listConversations() {
    return this.getJson('/inbox/conversations')
  }

  // the messages endpoints require the owning account as well as the
  // conversation — the conversation id alone is a 400
  conversationMessages(conversationId: string, accountId: string) {
    return this.getJson(
      `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?accountId=${encodeURIComponent(accountId)}`)
  }

  sendConversationMessage(conversationId: string, accountId: string, message: string) {
    return this.post(
      `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?accountId=${encodeURIComponent(accountId)}`,
      { message, accountId })
  }

  /** Clears the provider-side unread count, so every surface agrees on
   *  what has been seen. Undocumented but real: returns {success, markedCount}. */
  markConversationRead(conversationId: string, accountId: string) {
    return this.post(
      `/inbox/conversations/${encodeURIComponent(conversationId)}/read?accountId=${encodeURIComponent(accountId)}`,
      { accountId })
  }

  /** Best posting slots from historical engagement — the Later signature. */
  bestTimes(accountId?: string) {
    return this.getJson(`/analytics/best-time-to-post${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`)
  }

  /** POST returning parsed JSON, throwing with the provider's own message so
   *  the operator sees why an action was refused rather than a status code. */
  private async post(path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const j = json as Record<string, unknown>
      throw new Error(String(j.error ?? j.message ?? `Request failed (${res.status})`))
    }
    return json
  }

  /** Same contract as post(), for other verbs. */
  private async send(method: 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const j = json as Record<string, unknown>
      throw new Error(String(j.error ?? j.message ?? `Request failed (${res.status})`))
    }
    return json
  }

  /* ── comment→DM automations: "comment LINK and I'll DM you" ─────────── */

  listAutomations() {
    return this.getJson('/comment-automations')
  }

  getAutomation(id: string) {
    return this.getJson(`/comment-automations/${encodeURIComponent(id)}`)
  }

  /** Per-commenter trigger history — includes clickedAt/clickCount per
   *  person (undocumented but real; verified live). */
  automationLogs(id: string) {
    return this.getJson(`/comment-automations/${encodeURIComponent(id)}/logs`)
  }

  createAutomation(body: Record<string, unknown>) {
    return this.post('/comment-automations', body)
  }

  // the docs say PUT; the live API answers 405 to PUT and accepts PATCH
  updateAutomation(id: string, body: Record<string, unknown>) {
    return this.send('PATCH', `/comment-automations/${encodeURIComponent(id)}`, body)
  }

  deleteAutomation(id: string) {
    return this.send('DELETE', `/comment-automations/${encodeURIComponent(id)}`)
  }

  postComments(postId: string) {
    return this.getJson(`/inbox/comments/${encodeURIComponent(postId)}`)
  }

  replyToComment(postId: string, commentId: string, message: string) {
    return this.post(
      `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/reply`,
      { message }
    )
  }

  /** Meta allows one private reply per comment, within a limited window after
   *  it is posted. A refusal here is usually that window having closed, so the
   *  provider's message is passed through untouched. */
  privateReply(postId: string, commentId: string, message: string, buttons?: ReplyButton[]) {
    return this.post(
      `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/private-reply`,
      { message, ...(buttons?.length ? { buttons } : {}) }
    )
  }

  setCommentHidden(postId: string, commentId: string, hidden: boolean) {
    const action = hidden ? 'hide' : 'unhide'
    return this.post(
      `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/${action}`
    )
  }

  async deleteComment(postId: string, commentId: string) {
    const res = await fetch(
      `${BASE}/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}`,
      { method: 'DELETE', headers: this.headers() }
    )
    const json = await res.json().catch(() => ({}))
    if (!res.ok && res.status !== 404) {
      throw new Error(String((json as Record<string, unknown>).error ?? `Could not delete comment (${res.status})`))
    }
    return json
  }

  editPost(postId: string, content: string) {
    return this.post(`/posts/${encodeURIComponent(postId)}/edit`, { content })
  }

  deletePost(postId: string) {
    return this.post(`/posts/${encodeURIComponent(postId)}/delete`)
  }

  listBroadcasts() {
    return this.getJson('/broadcasts')
  }

  /** Unlike /posts, this covers everything the platform knows about — posts
   *  published directly on Instagram appear here too, with their metrics. */
  postAnalytics(postId?: string) {
    return this.getJson(`/analytics${postId ? `?postId=${encodeURIComponent(postId)}` : ''}`)
  }

  /** Presign → PUT → return the public URL.
   *
   *  The provider does not accept arbitrary public URLs, so assets held in
   *  our own storage (Cloudflare R2) must be relayed through here rather than linked. */
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
  async disconnectAccount() { return this.fail() }
  async accountHealth() { return null }
  async accountInsights() { return null }
  async dailyMetrics() { return null }
  async followerStats() { return null }
  async listPosts() { return null }
  async postAnalytics() { return null }
  async listComments() { return null }
  async listConversations() { return null }
  async conversationMessages() { return null }
  async sendConversationMessage() { return this.fail() }
  async markConversationRead() { return null }
  async bestTimes() { return null }
  async listAutomations() { return null }
  async getAutomation() { return null }
  async automationLogs() { return null }
  async createAutomation(): Promise<unknown> { return this.fail() }
  async updateAutomation(): Promise<unknown> { return this.fail() }
  async deleteAutomation(): Promise<unknown> { return this.fail() }
  async postComments() { return null }
  async replyToComment() { return this.fail() }
  async privateReply() { return this.fail() }
  async setCommentHidden() { return this.fail() }
  async deleteComment() { return this.fail() }
  async editPost() { return this.fail() }
  async deletePost() { return this.fail() }
  async listBroadcasts() { return null }
  async uploadMedia() { return this.fail() }
  async createPost(): Promise<PublishOutcome> {
    return { kind: 'permanent', message: 'No publishing provider is configured' }
  }
}

export function getPublisher(): Publisher {
  const zernio = new ZernioPublisher()
  return zernio.configured() ? zernio : new UnconfiguredPublisher()
}

/* ── webhook registration ──────────────────────────────────────────────── */

export type RegisteredWebhook = {
  id: string
  url: string
  secret: string
  events: string[]
  /** false when an existing registration for the same URL was updated */
  created: boolean
}

/**
 * Point the provider at our webhook, so a post's outcome arrives in seconds
 * rather than whenever the 10-minute reconcile next runs.
 *
 * Kept OUT of the `Publisher` interface on purpose: that interface is the
 * vendor-neutral surface the scheduler talks to, and a second provider would
 * register callbacks its own way (or not at all). This is Zernio's, named so.
 *
 * Idempotent by URL. The provider allows 50 webhooks per key and does not
 * de-duplicate them, so a second press of "Enable instant post updates" must
 * update the existing registration — otherwise every event would be delivered
 * twice, then three times, forever.
 *
 * Docs: GET/POST/PUT `/webhooks/settings` (`_id` travels in the PUT body, not
 * the path). The secret is OURS: we generate it, send it, and store it
 * encrypted — the provider echoes it back rather than minting one.
 */
export async function registerZernioWebhook(input: {
  url: string
  secret: string
  events: readonly string[]
  name?: string
}): Promise<RegisteredWebhook> {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error('ZERNIO_API_KEY is not set')
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  const call = async (method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(`${BASE}/webhooks/settings`, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const json = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) {
      throw new Error(String(json.error ?? json.message ?? `Zernio refused the webhook (${res.status})`))
    }
    return json
  }

  const name = input.name ?? 'MD Media dashboard'
  let events = [...input.events]

  /**
   * Is this registration ours?
   *
   * Not string equality on the URL. The webhook was first registered BY HAND
   * from Zernio's dashboard, and a hand-typed URL differs from ours in all the
   * ways hand-typed URLs do: a trailing slash, a query string, `http`, or the
   * other path that serves the same handler (`/api/zernio/webhook`). Every one
   * of those would look like a different webhook, and "register" would quietly
   * create a SECOND one — which does not fail, it just delivers every event
   * twice from then on.
   */
  const ours = (raw: unknown): boolean => {
    const value = String(raw ?? '').trim()
    if (!value) return false
    if (value === input.url) return true
    try {
      const a = new URL(value)
      const b = new URL(input.url)
      const path = (u: URL) => u.pathname.replace(/\/+$/, '')
      return a.host === b.host
        && (path(a) === path(b) || ['/api/zernio/webhook', '/api/social/webhook'].includes(path(a)))
    } catch { return false }
  }

  // does one already exist for this endpoint?
  let existingId: string | null = null
  try {
    const list = await call('GET')
    const rows = (Array.isArray(list) ? list : list.webhooks ?? []) as Record<string, unknown>[]
    const match = rows.find(w => ours(w.url))
    if (match) {
      existingId = String(match._id ?? match.id ?? '') || null
      // UNION, never replace. The owner's hand-made registration may carry
      // events we do not ask for (or ones added since), and a PUT sends the
      // whole `events` array — so replacing it would silently UNSUBSCRIBE from
      // whatever they had set up. Adding the missing events is the whole job
      // this button has when a registration already exists.
      const already = Array.isArray(match.events) ? match.events.map(String) : []
      events = [...new Set([...already, ...events])]
    }
  } catch {
    // listing is a courtesy; failing it should not block a first registration
  }

  const payload = { name, url: input.url, events, secret: input.secret, isActive: true }
  const json = existingId
    ? await call('PUT', { _id: existingId, ...payload })
    : await call('POST', payload)

  const hook = (json.webhook ?? json) as Record<string, unknown>
  const id = String(hook._id ?? hook.id ?? existingId ?? '')
  if (!id) throw new Error('Zernio returned no webhook id')

  return {
    id,
    url: String(hook.url ?? input.url),
    // the provider echoes the secret; ours is the fallback and the same value
    secret: typeof hook.secret === 'string' && hook.secret ? hook.secret : input.secret,
    events: Array.isArray(hook.events) ? hook.events.map(String) : events,
    created: !existingId,
  }
}
