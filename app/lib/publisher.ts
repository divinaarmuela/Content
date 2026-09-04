import 'server-only'
import {
  asOrganizationUrn, buildPostBody, classifyResponse, mediaTypeFor,
  COMMERCIAL_CONTENT_LABELS, TIKTOK_PRIVACY_LABELS,
  type CommercialContentType, type MediaItem, type Platform, type PublishOutcome,
  type Target, type TikTokPrivacy,
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
  /** Push bytes to the provider and return a URL usable in a post.
   *
   *  `body` is whatever fetch will send — for the relay it is the SOURCE
   *  RESPONSE'S STREAM, never a buffer. See the implementation for why that
   *  distinction is the difference between a 2 GB master posting and the
   *  process being killed. */
  uploadMedia(input: {
    body: BodyInit
    filename: string
    contentType: string
    /** the source's Content-Length, when it had one — a presigned PUT wants
     *  a length, and a stream cannot be measured */
    contentLength?: number | null
  }): Promise<MediaItem>
  /** Create (or schedule) a post. Idempotent on requestId. */
  createPost(input: CreatePostInput): Promise<PublishOutcome>
  /** The lists only this account can give us: its playlists, its company
   *  pages, its Facebook Pages, the privacy levels TikTok allows it.
   *
   *  `mediaType` is TikTok's: a creator's limits differ between a video and a
   *  set of pictures, and asking for the wrong one is a different answer. */
  channelOptions(
    providerAccountId: string, platform: string, mediaType?: 'video' | 'photo',
  ): Promise<ChannelOptions>
}

/**
 * What one account may be set to post as.
 *
 * Four lists, one shape, because the composer draws them the same way: a
 * select with names in it. Every one of them is per ACCOUNT and cannot be
 * guessed — a playlist id invented locally is a post YouTube refuses — so an
 * empty list means "we could not ask", and the window says so rather than
 * offering a choice that does not exist.
 */
export type ChannelChoice = { value: string; label: string }

export type ChannelOptions = {
  /** YouTube: the channel's playlists */
  playlists: ChannelChoice[]
  /** LinkedIn: the company pages this person may post as */
  organizations: ChannelChoice[]
  /** Facebook: the Pages behind this account */
  pages: ChannelChoice[]
  /** TikTok: the privacy levels TikTok allows THIS creator */
  privacy: ChannelChoice[]
  /** TikTok: the disclosures this creator may make */
  commercial: ChannelChoice[]
  /**
   * TikTok: what this creator's account ALLOWS by default.
   *
   * An account with comments turned off is not a post that asks for comments
   * — TikTok refuses the whole thing. The window seeds its tick boxes from
   * this rather than from our own "an agency means public with everything
   * on", which is only true of an unrestricted account.
   */
  interactions: TikTokInteractions | null
}

export type TikTokInteractions = {
  allowComment: boolean
  allowDuet: boolean
  allowStitch: boolean
}

export const NO_CHANNEL_OPTIONS: ChannelOptions = {
  playlists: [], organizations: [], pages: [], privacy: [],
  commercial: [], interactions: null,
}

/**
 * Read TikTok's creator info into the three things the window needs.
 *
 * `GET /accounts/{id}/tiktok/creator-info?mediaType=video|photo` answers
 * `{ creator, privacyLevels, postingLimits, commercialContentTypes }`. The
 * limits name what is DISABLED (TikTok's own wording: `comment_disabled`,
 * `duet_disabled`, `stitch_disabled`), so the defaults are the negation —
 * and an account that says nothing is an account with nothing turned off.
 *
 * Pure, and tolerant of both spellings: this is the one endpoint whose exact
 * shape was got wrong once already.
 */
export function readCreatorInfo(raw: unknown): {
  privacy: ChannelChoice[]
  commercial: ChannelChoice[]
  interactions: TikTokInteractions | null
} {
  const j = (raw ?? {}) as Record<string, unknown>
  const info = (j.creatorInfo ?? j.creator_info ?? j) as Record<string, unknown>
  const pick = (...names: string[]): unknown => {
    for (const n of names) {
      if (info[n] !== undefined) return info[n]
      if (j[n] !== undefined) return j[n]
    }
    return undefined
  }

  const privacy = readChoices(pick('privacyLevels', 'privacy_levels'), {
    id: ['value', 'level', 'id'], label: ['label', 'name'],
  }).map(c => ({ value: c.value, label: TIKTOK_PRIVACY_LABELS[c.value as TikTokPrivacy] ?? c.label }))

  const commercial = readChoices(pick('commercialContentTypes', 'commercial_content_types'), {
    id: ['value', 'type', 'id'], label: ['label', 'name'],
  }).map(c => ({
    value: c.value,
    label: COMMERCIAL_CONTENT_LABELS[c.value as CommercialContentType] ?? c.label,
  }))

  const limits = (pick('postingLimits', 'posting_limits') ?? {}) as Record<string, unknown>
  const off = (...names: string[]) => names.some(n => limits[n] === true)
  const on = (...names: string[]) => names.find(n => typeof limits[n] === 'boolean')
  const interactions: TikTokInteractions | null = Object.keys(limits).length > 0
    ? {
      allowComment: on('allow_comment', 'allowComment')
        ? Boolean(limits.allow_comment ?? limits.allowComment)
        : !off('comment_disabled', 'commentDisabled'),
      allowDuet: on('allow_duet', 'allowDuet')
        ? Boolean(limits.allow_duet ?? limits.allowDuet)
        : !off('duet_disabled', 'duetDisabled'),
      allowStitch: on('allow_stitch', 'allowStitch')
        ? Boolean(limits.allow_stitch ?? limits.allowStitch)
        : !off('stitch_disabled', 'stitchDisabled'),
    }
    : null

  return { privacy, commercial, interactions }
}

/** Rows come back from the provider under whichever names that endpoint uses;
 *  this reads them all rather than pinning one spelling that a later version
 *  of their API quietly renames. */
export function readChoices(
  raw: unknown,
  keys: { id: string[]; label: string[] },
): ChannelChoice[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown> | null)?.data)
      ? (raw as { data: unknown[] }).data
      : []
  const out: ChannelChoice[] = []
  for (const row of list) {
    if (typeof row === 'string') { out.push({ value: row, label: row }); continue }
    const r = (row ?? {}) as Record<string, unknown>
    const value = keys.id.map(k => r[k]).find(v => typeof v === 'string' && v)
    if (typeof value !== 'string') continue
    const label = keys.label.map(k => r[k]).find(v => typeof v === 'string' && v)
    out.push({ value, label: typeof label === 'string' ? label : value })
  }
  return out.slice(0, 100)
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
   *  our own storage (Cloudflare R2) must be relayed through here rather than
   *  linked.
   *
   *  ── Why this takes a body and not an ArrayBuffer ──
   *
   *  It used to take the whole file as an ArrayBuffer, which meant the relay
   *  read every byte into memory before sending the first one. A 2 GB master
   *  is a 2 GB allocation inside a serverless function, and the function is
   *  killed for it — not thrown from, KILLED, so the catch never runs, the job
   *  is never marked failed, and the row sits in `publishing` with no error
   *  while the post silently never happens. Retrying repeats it exactly.
   *
   *  Streaming costs nothing and has no ceiling: the bytes pass through. */
  async uploadMedia({ body, filename, contentType, contentLength }: {
    body: BodyInit
    filename: string
    contentType: string
    contentLength?: number | null
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
      headers: {
        'Content-Type': contentType,
        // a presigned PUT signs the length when it knows it, and a stream
        // cannot be measured — so the source's own length is passed through
        ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
      },
      body,
      // undici refuses a stream body without this; it is the flag that says
      // "I am not waiting to read the response before I finish sending"
      ...(typeof body === 'object' && body !== null && 'getReader' in body
        ? { duplex: 'half' } as RequestInit
        : {}),
    })
    if (!put.ok) throw new Error(`Media upload failed (${put.status})`)

    return { url: publicUrl, type }
  }

  /**
   * The four per-account lists, from the four endpoints Zernio documents.
   *
   * One network per call — asking YouTube for Facebook Pages is a 404 and a
   * wasted second. Every one of them goes through `getJson`, so a missing or
   * unavailable endpoint is an EMPTY list rather than a window that will not
   * open: the composer can always fall back to typing, and a post with no
   * playlist is still a post.
   */
  async channelOptions(
    id: string, platform: string, mediaType: 'video' | 'photo' = 'video',
  ): Promise<ChannelOptions> {
    const out: ChannelOptions = { ...NO_CHANNEL_OPTIONS }
    const account = encodeURIComponent(id)
    if (platform === 'youtube') {
      const json = await this.getJson(`/accounts/${account}/youtube-playlists`) as Record<string, unknown> | null
      out.playlists = readChoices(json?.playlists ?? json, {
        id: ['id', '_id', 'playlistId'], label: ['title', 'name'],
      })
    }
    if (platform === 'linkedin') {
      const json = await this.getJson(`/accounts/${account}/linkedin-organizations`) as Record<string, unknown> | null
      out.organizations = readChoices(json?.organizations ?? json, {
        id: ['urn', 'organizationUrn', 'id', '_id'], label: ['name', 'localizedName', 'title'],
      })
        // LinkedIn's lists hand back a bare id as often as a URN, and a bare
        // id posts as the person rather than as the company
        .map(c => ({ ...c, value: asOrganizationUrn(c.value) ?? '' }))
        .filter(c => c.value)
    }
    if (platform === 'facebook') {
      const json = await this.getJson(`/accounts/${account}/facebook-page`) as Record<string, unknown> | null
      out.pages = readChoices(json?.pages ?? json?.page ?? json, {
        id: ['pageId', 'id', '_id'], label: ['name', 'pageName', 'title'],
      })
    }
    if (platform === 'tiktok') {
      // the creator's OWN allowed values. TikTok decides per account which
      // privacy levels a creator may use — a new or restricted account may
      // not post publicly at all — and sending one they may not is a refusal
      // hours later, on the one network that also demands a consent tick.
      const json = await this.getJson(
        `/accounts/${account}/tiktok/creator-info?mediaType=${mediaType}`)
      const info = readCreatorInfo(json)
      out.privacy = info.privacy
      out.commercial = info.commercial
      out.interactions = info.interactions
    }
    return out
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

  async channelOptions(): Promise<ChannelOptions> {
    return { ...NO_CHANNEL_OPTIONS }
  }
}

/**
 * The provider with the network taken out — the test harness's publisher.
 *
 * Publishing is the one action this system cannot undo, so "the test suite
 * must not post to a real account" is enforced HERE rather than by every test
 * remembering to mock the module. With PUBLISH_DRY_RUN=1 the provider itself
 * answers: a fake post id derived from the job's own request id (so a retry
 * of the same job gets the same id, exactly as the real idempotency does),
 * and not a single fetch.
 *
 * It inherits the unconfigured publisher, so anything the flow does NOT touch
 * still refuses loudly instead of pretending to work.
 */
function dryRunPublisher(): Publisher {
  // everything the flow does NOT touch still refuses loudly, so a dry run
  // cannot quietly pretend a whole feature works
  const base = new UnconfiguredPublisher()
  return Object.assign(Object.create(base) as Publisher, {
    name: 'dry-run',
    configured: () => true,
    createPost: async (input: CreatePostInput): Promise<PublishOutcome> =>
      ({ kind: 'published' as const, postId: `dry-run-${input.requestId}`, replayed: false }),
    accountHealth: async (providerAccountId: string) =>
      ({ ok: true, accountId: providerAccountId, dryRun: true }),
    deletePost: async () => ({ ok: true, dryRun: true }),
    uploadMedia: async (input: { filename: string; contentType: string }): Promise<MediaItem> =>
      ({ url: `https://dry-run.invalid/${input.filename}`, type: mediaTypeFor(input.contentType) ?? 'image' }),
    // the four per-account lists, answered without a socket: enough for the
    // composer to draw a real select in a test, and obviously fake in it
    channelOptions: async (id: string, platform: string): Promise<ChannelOptions> => {
      // TikTok's answer is shaped like the real endpoint's, read through the
      // same parser: an ordinary creator with duets turned off, so a dry run
      // exercises the part that matters — the window seeding a tick box from
      // what the ACCOUNT allows rather than from what we assume.
      const tiktok = platform === 'tiktok'
        ? readCreatorInfo({
          creator: { nickname: 'Dry run creator' },
          privacyLevels: [
            'PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY',
          ],
          postingLimits: { comment_disabled: false, duet_disabled: true, stitch_disabled: false },
          commercialContentTypes: ['none', 'brand_organic', 'brand_content'],
        })
        : { privacy: [], commercial: [], interactions: null }
      return {
        playlists: platform === 'youtube' ? [{ value: 'dry-run-playlist', label: 'Dry run playlist' }] : [],
        organizations: platform === 'linkedin'
          ? [{ value: 'urn:li:organization:1', label: 'Dry run company' }] : [],
        pages: platform === 'facebook' ? [{ value: `dry-run-page-${id}`, label: 'Dry run Page' }] : [],
        ...tiktok,
      }
    },
  })
}

/**
 * Is the dry run on? Exactly the string '1', nothing else.
 *
 * Loose truthiness here would be a foot-gun pointed at the client's account:
 * a stray PUBLISH_DRY_RUN=0 or =false read as "on" would stop every real post
 * going out while every screen reported success.
 */
export function isPublishDryRun(): boolean {
  return process.env.PUBLISH_DRY_RUN === '1'
}

export function getPublisher(): Publisher {
  if (isPublishDryRun()) return dryRunPublisher()
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
