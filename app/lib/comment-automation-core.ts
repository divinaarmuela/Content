/**
 * COMMENT-TO-DM AUTOMATIONS, ONE POST EACH — the pure half. No I/O.
 *
 * The owner (29 Sep 2026): "in automation page according to zernio docs make
 * sure we select account and the post name and then do that". And the
 * standing rule that sits over it: NOTHING MESSAGES A PROSPECT ON ITS OWN,
 * except a comment-to-DM automation a person deliberately switches on for ONE
 * specific post. So an automation made here is always bound to one post, and
 * this file is where "never account-wide" is enforced: `chooseBinding` refuses
 * a choice with no post, and `zernioPayload` refuses to build a body that has
 * neither binding.
 *
 * The binding, from Zernio's docs (POST /v1/comment-automations, Request Body):
 *   - `platformPostId` — "Platform media/post ID … Omit for an account-wide
 *     (any-post / any-story) automation." We never omit it for a live post.
 *   - `postId` — "Zernio post ID (24 hexadecimal characters); platform IDs
 *     return 400 … Use it INSTEAD of platformPostId to bind a per-post
 *     automation to a not-yet-published Zernio post: the automation stays
 *     pending and arms itself when that post publishes. For a post already
 *     live on the platform, pass platformPostId alone and omit this."
 *   So: a live post sends platformPostId alone; a booked post sends postId
 *   alone; nothing sends neither.
 *
 * The link: every link a DM carries gets the agency's UTM tags, so the
 * booking page's analytics can tell an Instagram-DM visitor from anyone else.
 * The owner verified live (29 Sep 2026) that Zernio's tracked button keeps
 * the tags (Instagram adds its own fbclid, which is harmless).
 */

/** The only networks Zernio's comment automations run on (docs: "Instagram or Facebook account"). */
export const AUTOMATION_PLATFORMS = ['instagram', 'facebook'] as const
export type AutomationPlatform = typeof AUTOMATION_PLATFORMS[number]
export const isAutomationPlatform = (p: unknown): p is AutomationPlatform =>
  AUTOMATION_PLATFORMS.includes(String(p ?? '').toLowerCase() as AutomationPlatform)

export const MATCH_MODES = ['word', 'contains', 'exact'] as const
export type MatchMode = typeof MATCH_MODES[number]

/** Meta's cap on a DM that carries buttons; without one, Zernio's own ceiling. */
export const BUTTON_DM_LIMIT = 640
export const DM_LIMIT = 1000
export const BUTTON_TITLE_LIMIT = 20
export const COMMENT_REPLY_LIMIT = 300
export const MAX_KEYWORDS = 10
export const DEFAULT_KEYWORD = 'BOOK'
/**
 * Other DM texts / other public replies, picked at random with the main one (Zernio's
 * `dmMessageVariations` / `commentReplyVariations`, OpenAPI v1.151.0: string arrays, maxItems 5, on POST
 * and PATCH; PATCH [] clears). The owner's form offers four beside the main one.
 */
export const MAX_VARIATIONS = 4

/** A Zernio post id: a 24-character hex ObjectId (the docs: "platform IDs return 400"). */
export const isZernioPostId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v)

/* ── the UTM link ───────────────────────────────────────────────────────── */

export const UTM_SOURCE = 'mdmedia'
export const UTM_MEDIUM = 'instagram_dm'
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const

/** "justin-engelke" → "justin_engelke": the campaign name the owner reads in the booking page's analytics. */
export function campaignOf(clientSlug: string): string {
  return String(clientSlug ?? '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export type LinkResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * The link with the four UTM tags on it.
 *
 * The rest of the query string is kept EXACTLY as it was typed — not parsed
 * and re-serialised, which would turn a booking tool's `%20` into `+` and
 * reorder its parameters. Only a utm_source / utm_medium / utm_campaign /
 * utm_content already on the link is replaced, so a link pasted twice does not
 * carry two campaigns. A #fragment stays at the end, where it belongs.
 */
export function withUtm(link: string, tags: { clientSlug: string; keyword: string }): LinkResult {
  const raw = String(link ?? '').trim()
  if (!raw) return { ok: false, error: 'Add the link the DM sends' }
  let parsed: URL
  try { parsed = new URL(raw) } catch { return { ok: false, error: 'The link is not a valid web address' } }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'The link must start with https://' }
  const campaign = campaignOf(tags.clientSlug)
  if (!campaign) return { ok: false, error: 'This client has no short name to tag the link with' }
  const content = String(tags.keyword ?? '').trim().toLowerCase()
  if (!content) return { ok: false, error: 'Add a keyword first — the link is tagged with it' }

  const hashAt = raw.indexOf('#')
  const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw
  const hash = hashAt >= 0 ? raw.slice(hashAt) : ''
  const qAt = beforeHash.indexOf('?')
  const base = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash
  const query = qAt >= 0 ? beforeHash.slice(qAt + 1) : ''

  const keyOf = (pair: string) => {
    const k = pair.split('=')[0]
    try { return decodeURIComponent(k.replace(/\+/g, ' ')).toLowerCase() } catch { return k.toLowerCase() }
  }
  const kept = query.split('&').filter(p => p !== '' && !(UTM_KEYS as readonly string[]).includes(keyOf(p)))
  const ours = [
    ['utm_source', UTM_SOURCE], ['utm_medium', UTM_MEDIUM], ['utm_campaign', campaign], ['utm_content', content],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
  return { ok: true, url: `${base}?${[...kept, ...ours].join('&')}${hash}` }
}

/* ── the post it answers on ─────────────────────────────────────────────── */

/**
 * One post a person can pick. `source` says where we found it: the app's own
 * post (booked or posted from the Schedule), or a post that is on the account
 * but was never made here (Zernio's GET /v1/accounts/{accountId}/posts, which
 * "covers everything on the account, including posts that were never created
 * through Zernio").
 */
export type PostChoice = {
  /** stable key the browser sends back: `app:<social_post_id>` or `ig:<platform post id>` */
  key: string
  source: 'app' | 'account'
  social_post_id: string | null
  /** the network's own post id — known once the post is live */
  platform_post_id: string | null
  /** Zernio's post id — known for a post booked through the app */
  zernio_post_id: string | null
  title: string
  thumb: string | null
  /** when it went out, or when it is booked for */
  date: string | null
  /** 'booked' (not live yet) | 'posted' (live) */
  state: 'booked' | 'posted'
  permalink: string | null
  /** a sentence when this post cannot be picked, e.g. its booking has not reached Zernio yet */
  unavailable: string | null
}

export type Binding =
  | { kind: 'live'; platformPostId: string }
  | { kind: 'pending'; postId: string }

export const NO_POST = 'Pick the post this automation answers on — an automation is never switched on for a whole account.'

/**
 * Which binding a picked post gets. A live post (its network id known) is
 * bound by `platformPostId` alone; a booked post by Zernio's `postId` alone,
 * which Zernio arms when it publishes. Anything else is refused — there is no
 * account-wide answer.
 */
export function chooseBinding(choice: Pick<PostChoice, 'platform_post_id' | 'zernio_post_id' | 'unavailable'> | null | undefined):
  { ok: true; binding: Binding } | { ok: false; error: string } {
  if (!choice) return { ok: false, error: NO_POST }
  if (choice.unavailable) return { ok: false, error: choice.unavailable }
  const live = String(choice.platform_post_id ?? '').trim()
  if (live) return { ok: true, binding: { kind: 'live', platformPostId: live } }
  const pending = String(choice.zernio_post_id ?? '').trim()
  if (pending) {
    if (!isZernioPostId(pending)) return { ok: false, error: 'That post has no Zernio booking the automation can wait on.' }
    return { ok: true, binding: { kind: 'pending', postId: pending } }
  }
  return { ok: false, error: NO_POST }
}

/** The first line of a caption, short enough to name a post in a list. */
export function postTitleOf(caption: string | null | undefined, fallbackDate?: string | null): string {
  const line = String(caption ?? '').split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? ''
  if (line) return line.length > 80 ? `${line.slice(0, 79)}…` : line
  if (fallbackDate) {
    const d = new Date(fallbackDate)
    if (!Number.isNaN(d.getTime())) return `Post of ${d.toISOString().slice(0, 10)}`
  }
  return 'Post with no caption'
}

/** An Instagram permalink without its query or trailing slash, so /p/X/ and /p/X?igsh=… are the same post. */
export function normalisePermalink(url: string | null | undefined): string | null {
  const s = String(url ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch { return null }
}

/** One post from Zernio's GET /v1/accounts/{accountId}/posts (shape read live, 29 Sep 2026). */
export type AccountPost = { id: string; message: string; createdTime: string | null; picture: string | null; permalink: string | null }

export function readAccountPosts(raw: unknown): AccountPost[] {
  const r = raw as { posts?: unknown; data?: unknown } | null
  const list = Array.isArray(raw) ? raw : Array.isArray(r?.posts) ? r!.posts as unknown[] : Array.isArray(r?.data) ? r!.data as unknown[] : []
  return list.flatMap(item => {
    const p = (item ?? {}) as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id : ''
    if (!id) return []
    return [{
      id,
      message: typeof p.message === 'string' ? p.message : typeof p.caption === 'string' ? p.caption : '',
      createdTime: typeof p.createdTime === 'string' ? p.createdTime : typeof p.timestamp === 'string' ? p.timestamp : null,
      picture: typeof p.picture === 'string' ? p.picture : typeof p.thumbnailUrl === 'string' ? p.thumbnailUrl : null,
      permalink: typeof p.permalink === 'string' ? p.permalink : null,
    }]
  })
}

/**
 * The platform post id Zernio recorded for one account on one of its posts
 * (GET /v1/posts/{postId} → `post.platforms[]`, each with `accountId._id`,
 * `platformPostId` and `platformPostUrl` — read live 29 Sep 2026).
 */
export function platformPostIdOn(raw: unknown, providerAccountId: string): { id: string | null; url: string | null } {
  const post = ((raw as { post?: unknown } | null)?.post ?? raw) as { platforms?: unknown } | null
  const list = Array.isArray(post?.platforms) ? post!.platforms as Record<string, unknown>[] : []
  for (const p of list) {
    const acc = p?.accountId
    const accId = typeof acc === 'string' ? acc : String((acc as { _id?: unknown } | null)?._id ?? '')
    if (accId !== providerAccountId) continue
    return {
      id: typeof p.platformPostId === 'string' && p.platformPostId ? p.platformPostId : null,
      url: typeof p.platformPostUrl === 'string' ? p.platformPostUrl : null,
    }
  }
  return { id: null, url: null }
}

/** The slice of an app post this file reads. */
export type AppPostInput = {
  id: string
  stage: string
  caption: string
  scheduled_for: string | null
  channels: string[]
  slides: { url: string; type: string }[]
  outcomes: Record<string, { status: string; url: string | null; at: string | null }>
  job_ids: string[]
}

/** The slice of a publish job this file reads. */
export type AppJobInput = { id: string; status: string; provider_post_id: string | null; targets: unknown }

const jobPlatforms = (targets: unknown): string[] =>
  (Array.isArray(targets) ? targets : [])
    .map(t => String((t as { platform?: unknown } | null)?.platform ?? '').toLowerCase())
    .filter(Boolean)

/** jobs that stand for a live or pending booking at Zernio */
const STANDING = ['scheduled', 'published', 'publishing', 'queued', 'duplicate']

/**
 * The app's own post as a choice for one account. Booked: bound by the Zernio
 * post id on its publish job (pending until it publishes). Posted: bound by
 * the network's id, which the caller resolves (`platformId`) from Zernio —
 * the app records the live URL per network (`outcomes`), not the network's id.
 * Returns null for a post that is not on this account.
 */
export function appPostChoice(
  post: AppPostInput,
  account: { id: string; platform: string },
  jobs: readonly AppJobInput[],
  platformId: string | null,
): PostChoice | null {
  if (!post.channels.includes(account.id)) return null
  if (post.stage !== 'booked' && post.stage !== 'posted') return null
  const platform = account.platform.toLowerCase()
  const mine = jobs.filter(j => post.job_ids.includes(j.id) && STANDING.includes(j.status)
    && (jobPlatforms(j.targets).length === 0 || jobPlatforms(j.targets).includes(platform)))
  const zernio = mine.map(j => j.provider_post_id).find(isZernioPostId) ?? null
  const outcome = post.outcomes[platform]
  const posted = post.stage === 'posted' || outcome?.status === 'published'
  const firstImage = post.slides.find(s => s.type === 'image')?.url ?? null
  const date = posted ? (outcome?.at ?? post.scheduled_for) : post.scheduled_for
  let unavailable: string | null = null
  if (posted && outcome && outcome.status !== 'published') unavailable = `This post did not go out on ${platform === 'instagram' ? 'Instagram' : 'Facebook'}.`
  else if (posted && !platformId && !zernio) unavailable = 'Zernio has not told us this post\'s id yet — try again in a few minutes.'
  else if (!posted && !zernio) unavailable = 'This post\'s booking has not reached Zernio yet — try again in a minute.'
  return {
    key: `app:${post.id}`,
    source: 'app',
    social_post_id: post.id,
    platform_post_id: posted ? platformId : null,
    // a posted post whose network id could not be read keeps the Zernio id —
    // Zernio resolves it; a post it already published is armed at once
    zernio_post_id: zernio,
    title: postTitleOf(post.caption, date),
    thumb: firstImage,
    date,
    state: posted ? 'posted' : 'booked',
    permalink: outcome?.url ?? null,
    unavailable,
  }
}

/** A post on the account that the app did not make. */
export function accountPostChoice(p: AccountPost): PostChoice {
  return {
    key: `ig:${p.id}`,
    source: 'account',
    social_post_id: null,
    platform_post_id: p.id,
    zernio_post_id: null,
    title: postTitleOf(p.message, p.createdTime),
    thumb: p.picture,
    date: p.createdTime,
    state: 'posted',
    permalink: p.permalink,
    unavailable: null,
  }
}

/**
 * The app's posts first (newest first), then the account's own posts that are
 * not one of them — matched by the network's id or, failing that, the link.
 */
export function mergeChoices(app: readonly PostChoice[], account: readonly AccountPost[]): PostChoice[] {
  const ids = new Set(app.map(c => c.platform_post_id).filter(Boolean) as string[])
  const links = new Set(app.map(c => normalisePermalink(c.permalink)).filter(Boolean) as string[])
  const rest = account
    .filter(p => !ids.has(p.id) && !links.has(normalisePermalink(p.permalink) ?? '\u0000'))
    .map(accountPostChoice)
  const byDate = (a: PostChoice, b: PostChoice) => String(b.date ?? '').localeCompare(String(a.date ?? ''))
  return [...[...app].sort(byDate), ...rest.sort(byDate)]
}

/** The network's id for a posted app post, read off the account's own list by its link. */
export function platformIdByPermalink(permalink: string | null, account: readonly AccountPost[]): string | null {
  const want = normalisePermalink(permalink)
  if (!want) return null
  return account.find(p => normalisePermalink(p.permalink) === want)?.id ?? null
}

/* ── the form ───────────────────────────────────────────────────────────── */

export type AutomationInput = {
  client_id: string
  social_account_id: string
  post_key: string
  keywords: string[]
  match_mode: MatchMode
  dm_message: string
  button_title: string | null
  /** the link as typed; the UTM tags are added by withUtm */
  link: string | null
  comment_reply: string | null
  /** other DM texts, one picked at random with dm_message */
  dm_variations: string[]
  /** other public replies, one picked at random with comment_reply */
  reply_variations: string[]
  name: string | null
  /** who runs it: Zernio's automation, or our app off the comment webhook (runAppAutomations) */
  runner: Runner
}

/**
 * Variations as typed: an array, or one per line. Blank lines dropped, repeats (and a repeat of the
 * main text) dropped. Too many, or one too long, is refused with the reason.
 */
export function readVariations(raw: unknown, opts: { what: string; max: number; main?: string | null }):
  { ok: true; list: string[] } | { ok: false; error: string } {
  const items = Array.isArray(raw) ? raw.map(v => String(v ?? '')) : typeof raw === 'string' ? raw.split(/\r?\n/) : []
  const out: string[] = []
  const main = String(opts.main ?? '').trim().toLowerCase()
  for (const item of items) {
    const t = item.trim()
    if (!t || t.toLowerCase() === main || out.some(x => x.toLowerCase() === t.toLowerCase())) continue
    if (t.length > opts.max) return { ok: false, error: `Each of the other ${opts.what} must be ${opts.max} characters or fewer` }
    out.push(t)
  }
  if (out.length > MAX_VARIATIONS) return { ok: false, error: `Up to ${MAX_VARIATIONS} other ${opts.what} — there are ${out.length}` }
  return { ok: true, list: out }
}

/** Keywords as an array or a comma-separated string, trimmed, deduped case-insensitively. Empty → BOOK. */
export function normaliseKeywords(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const out: string[] = []
  for (const item of list) {
    const k = String(item ?? '').trim().slice(0, 60)
    if (k && !out.some(x => x.toLowerCase() === k.toLowerCase())) out.push(k)
  }
  return out.length ? out.slice(0, MAX_KEYWORDS) : [DEFAULT_KEYWORD]
}

/** The DM as it will be sent: with no button, the link rides at the end of the text. */
export function dmText(dm: string, link: string | null, hasButton: boolean): string {
  const text = String(dm ?? '').trim()
  if (!link || hasButton) return text
  return `${text}\n\n${link}`
}

export function parseAutomationInput(raw: unknown): { ok: true; value: AutomationInput } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const client_id = s(r.client_id)
  if (!client_id) return { ok: false, error: 'Pick the client' }
  const social_account_id = s(r.social_account_id)
  if (!social_account_id) return { ok: false, error: 'Pick the Instagram or Facebook account' }
  const post_key = s(r.post_key)
  if (!post_key) return { ok: false, error: NO_POST }
  const keywords = normaliseKeywords(r.keywords)
  const match_mode: MatchMode = (MATCH_MODES as readonly string[]).includes(s(r.match_mode)) ? s(r.match_mode) as MatchMode : 'word'
  const dm_message = s(r.dm_message)
  if (!dm_message) return { ok: false, error: 'Write the DM it sends' }
  const button_title = s(r.button_title) || null
  const link = s(r.link) || null
  if (button_title && !link) return { ok: false, error: 'The button needs a link' }
  if (button_title && button_title.length > BUTTON_TITLE_LIMIT) {
    return { ok: false, error: `The button label must be ${BUTTON_TITLE_LIMIT} characters or fewer` }
  }
  if (button_title && dm_message.length > BUTTON_DM_LIMIT) {
    return { ok: false, error: `With a button, the DM must be ${BUTTON_DM_LIMIT} characters or fewer` }
  }
  if (dm_message.length > DM_LIMIT) return { ok: false, error: `The DM must be ${DM_LIMIT} characters or fewer` }
  const comment_reply = s(r.comment_reply) || null
  if (comment_reply && comment_reply.length > COMMENT_REPLY_LIMIT) {
    return { ok: false, error: `The public reply must be ${COMMENT_REPLY_LIMIT} characters or fewer` }
  }
  const dmVar = readVariations(r.dm_variations, { what: 'DM texts', max: button_title ? BUTTON_DM_LIMIT : DM_LIMIT, main: dm_message })
  if (!dmVar.ok) return dmVar
  const replyVar = readVariations(r.reply_variations, { what: 'public replies', max: COMMENT_REPLY_LIMIT, main: comment_reply })
  if (!replyVar.ok) return replyVar
  // Zernio picks from [commentReply, ...variations]: others with no main reply would never be said
  if (replyVar.list.length > 0 && !comment_reply) return { ok: false, error: 'Write the public reply first — the other replies are picked at random with it' }
  const name = s(r.name).slice(0, 80) || null
  const runner: Runner = r.runner === 'app' ? 'app' : 'zernio'
  return {
    ok: true,
    value: {
      client_id, social_account_id, post_key, keywords, match_mode, dm_message, button_title, link, comment_reply,
      dm_variations: dmVar.list, reply_variations: replyVar.list, name, runner,
    },
  }
}

/** The link tagged, and the DM checked against its limit once the link is in the text. */
export function finalLink(
  input: Pick<AutomationInput, 'link' | 'keywords' | 'dm_message' | 'button_title'> & { dm_variations?: readonly string[] },
  clientSlug: string,
): { ok: true; link: string | null } | { ok: false; error: string } {
  if (!input.link) return { ok: true, link: null }
  const tagged = withUtm(input.link, { clientSlug, keyword: input.keywords[0] ?? DEFAULT_KEYWORD })
  if (!tagged.ok) return tagged
  // with no button the link rides at the end of EVERY text, the variations too
  if (!input.button_title && [input.dm_message, ...(input.dm_variations ?? [])].some(t => dmText(t, tagged.url, false).length > DM_LIMIT)) {
    return { ok: false, error: `The DM and its link together must be ${DM_LIMIT} characters or fewer` }
  }
  return { ok: true, link: tagged.url }
}

/**
 * The body for POST /v1/comment-automations. Exactly one binding — the
 * function throws rather than build an account-wide body, so a future caller
 * that forgets the post cannot switch on a DM to everyone who comments.
 */
export function zernioPayload(
  input: Pick<AutomationInput, 'keywords' | 'match_mode' | 'dm_message' | 'button_title' | 'comment_reply'>
    & { dm_variations?: readonly string[]; reply_variations?: readonly string[] },
  ids: { profileId: string; accountId: string },
  binding: Binding,
  extra: { name: string; postTitle: string; link: string | null },
): Record<string, unknown> {
  const bound = binding?.kind === 'live' ? { platformPostId: binding.platformPostId }
    : binding?.kind === 'pending' ? { postId: binding.postId }
    : null
  const boundTo = bound ? Object.values(bound)[0] : ''
  if (!bound || !boundTo) throw new Error(NO_POST)
  const hasButton = !!(input.button_title && extra.link)
  return {
    profileId: ids.profileId,
    accountId: ids.accountId,
    trigger: 'comment',
    ...bound,
    postTitle: extra.postTitle.slice(0, 120),
    name: extra.name.slice(0, 80),
    keywords: input.keywords,
    matchMode: input.match_mode,
    dmMessage: dmText(input.dm_message, extra.link, hasButton),
    ...(hasButton
      // `type: 'url'` — this endpoint's discriminator (the live automation reads
      // `{type:'url', title, url}`); click tracking on, which the owner verified keeps the UTM tags
      ? { buttons: [{ type: 'url', title: input.button_title, url: extra.link }], linkTracking: true }
      : {}),
    ...(input.comment_reply ? { commentReply: input.comment_reply } : {}),
    ...(input.dm_variations?.length
      ? { dmMessageVariations: input.dm_variations.map(t => dmText(t, extra.link, hasButton)) }
      : {}),
    ...(input.comment_reply && input.reply_variations?.length ? { commentReplyVariations: [...input.reply_variations] } : {}),
  }
}

/** A readable name when the person did not give one: the keyword and the post. */
export function defaultName(keywords: readonly string[], postTitle: string): string {
  return `${keywords[0] ?? DEFAULT_KEYWORD} on "${postTitle.slice(0, 50)}"`
}

/* ── what Zernio says back ──────────────────────────────────────────────── */

/** The automation id out of the create response (`{ success, automation: { id } }`). */
export function createdAutomationId(raw: unknown): string | null {
  const r = (raw ?? {}) as { automation?: { id?: unknown; _id?: unknown }; id?: unknown; _id?: unknown }
  const id = r.automation?.id ?? r.automation?._id ?? r.id ?? r._id
  return typeof id === 'string' && id ? id : null
}

export type AutomationStats = {
  triggered: number; dmsSent: number; delivered: number; read: number; failed: number; linkClicks: number; uniqueClicks: number
}

/** Zernio's `stats` block (read live 29 Sep 2026: triggered, dmsSent, dmsFailed, delivered, read, linkClicks, uniqueClicks …). */
export function shapeStats(raw: unknown): AutomationStats {
  const s = (raw ?? {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    triggered: n(s.triggered), dmsSent: n(s.dmsSent), delivered: n(s.delivered), read: n(s.read),
    failed: n(s.dmsFailed), linkClicks: n(s.linkClicks), uniqueClicks: n(s.uniqueClicks),
  }
}

export type AutomationLogRow = {
  id: string; username: string | null; comment: string | null; status: string; error: string | null; clicks: number; at: string | null
}

/** Recent log rows, newest first — from GET /v1/comment-automations/{id} (`logs`) or its /logs page. */
export function shapeLogs(raw: unknown, limit = 10): AutomationLogRow[] {
  const r = (raw ?? {}) as { logs?: unknown; data?: unknown }
  const list = Array.isArray(raw) ? raw : Array.isArray(r.logs) ? r.logs as unknown[] : Array.isArray(r.data) ? r.data as unknown[] : []
  return list.flatMap(item => {
    const l = (item ?? {}) as Record<string, unknown>
    const id = typeof l.id === 'string' ? l.id : typeof l._id === 'string' ? l._id : ''
    if (!id) return []
    return [{
      id,
      username: typeof l.commenterName === 'string' ? l.commenterName : null,
      comment: typeof l.commentText === 'string' ? l.commentText : null,
      status: typeof l.status === 'string' ? l.status : 'unknown',
      error: typeof l.error === 'string' ? l.error : null,
      clicks: typeof l.clickCount === 'number' ? l.clickCount : 0,
      at: typeof l.createdAt === 'string' ? l.createdAt : null,
    }]
  }).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, limit)
}

/** Zernio's automation list (`{ success, automations: [...] }`). */
export type ZernioAutomation = {
  id: string; name: string; platform: string; accountId: string; platformPostId: string | null; postId: string | null
  keywords: string[]; isActive: boolean; stats: AutomationStats; trigger: string
}

export function readZernioAutomations(raw: unknown): ZernioAutomation[] {
  const r = (raw ?? {}) as { automations?: unknown; data?: unknown }
  const list = Array.isArray(raw) ? raw : Array.isArray(r.automations) ? r.automations as unknown[] : Array.isArray(r.data) ? r.data as unknown[] : []
  return list.flatMap(item => readZernioAutomation(item) ?? [])
}

export function readZernioAutomation(raw: unknown): ZernioAutomation | null {
  const a = (((raw as { automation?: unknown } | null)?.automation) ?? raw ?? {}) as Record<string, unknown>
  const id = typeof a.id === 'string' ? a.id : typeof a._id === 'string' ? a._id : ''
  if (!id) return null
  return {
    id,
    name: typeof a.name === 'string' ? a.name : 'Automation',
    platform: typeof a.platform === 'string' ? a.platform : '',
    accountId: typeof a.accountId === 'string' ? a.accountId : '',
    platformPostId: typeof a.platformPostId === 'string' && a.platformPostId ? a.platformPostId : null,
    postId: typeof a.postId === 'string' && a.postId ? a.postId : null,
    keywords: Array.isArray(a.keywords) ? a.keywords.map(String) : [],
    isActive: a.isActive !== false,
    stats: shapeStats(a.stats),
    trigger: typeof a.trigger === 'string' ? a.trigger : 'comment',
  }
}

/** An automation at Zernio with no post: answers every comment on the account — against the owner's rule. */
export function isAccountWide(a: Pick<ZernioAutomation, 'platformPostId' | 'postId' | 'trigger'>): boolean {
  return a.trigger !== 'story_reply' && !a.platformPostId && !a.postId
}

/**
 * The automation is waiting on a booking that is gone: it was bound to a
 * booked post's Zernio id, the post has not gone out, and the post's current
 * booking is a different Zernio post (moving a booked post pulls the old
 * booking and books a new one). Zernio would never arm it.
 */
export function waitingOnOldBooking(
  row: { zernio_post_id: string | null; platform_post_id: string | null },
  post: { stage: string; zernio_ids: readonly string[] } | null,
): boolean {
  if (!row.zernio_post_id || row.platform_post_id || !post) return false
  if (post.stage !== 'booked') return false
  return !post.zernio_ids.includes(row.zernio_post_id)
}

/** Only these patch fields go to Zernio's PATCH /v1/comment-automations/{id}. */
export function updatePatch(
  raw: unknown,
  ctx: { link: string | null; hasButton: boolean } = { link: null, hasButton: false },
): { ok: true; patch: Record<string, unknown>; ours: Record<string, unknown> } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  const ours: Record<string, unknown> = {}
  if (typeof r.active === 'boolean') { patch.isActive = r.active; ours.active = r.active; ours.paused_reason = null }
  if (typeof r.dm_message === 'string') {
    const dm = r.dm_message.trim()
    if (!dm) return { ok: false, error: 'The DM cannot be empty' }
    if (ctx.hasButton && dm.length > BUTTON_DM_LIMIT) return { ok: false, error: `With a button, the DM must be ${BUTTON_DM_LIMIT} characters or fewer` }
    // with no button the link rides in the text, so an edit keeps it there
    const sent = dmText(dm, ctx.link, ctx.hasButton)
    if (sent.length > DM_LIMIT) return { ok: false, error: `The DM must be ${DM_LIMIT} characters or fewer` }
    patch.dmMessage = sent; ours.dm_message = dm
  }
  if (typeof r.comment_reply === 'string') {
    const c = r.comment_reply.trim()
    if (c.length > COMMENT_REPLY_LIMIT) return { ok: false, error: `The public reply must be ${COMMENT_REPLY_LIMIT} characters or fewer` }
    patch.commentReply = c; ours.comment_reply = c || null
  }
  if (r.dm_variations !== undefined) {
    const v = readVariations(r.dm_variations, { what: 'DM texts', max: ctx.hasButton ? BUTTON_DM_LIMIT : DM_LIMIT - (ctx.link ? ctx.link.length + 2 : 0) })
    if (!v.ok) return v
    // [] clears them (Zernio: "Pass [] to clear")
    patch.dmMessageVariations = v.list.map(t => dmText(t, ctx.link, ctx.hasButton)); ours.dm_variations = v.list
  }
  if (r.reply_variations !== undefined) {
    const v = readVariations(r.reply_variations, { what: 'public replies', max: COMMENT_REPLY_LIMIT })
    if (!v.ok) return v
    patch.commentReplyVariations = v.list; ours.reply_variations = v.list
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to change' }
  return { ok: true, patch, ours }
}

/* ── the automation that rides on a post (set up while scheduling) ───────── */

/**
 * THE POST'S OWN AUTOMATION (the owner, 29 Sep 2026: "manychat next —
 * schedule post automation"). Set in the post window beside the caption,
 * saved in the working copy (`social_posts.automation`) and frozen with it
 * (`post_versions.automation`), so what goes out is what was approved. It is
 * made at Zernio when the post is BOOKED, bound to that booking's Zernio post
 * (`postId`, pending until it publishes) — or to the live post
 * (`platformPostId`) when it has already gone out — and never to the account.
 *
 * `link` is kept as typed; the UTM tags are added when it is made (withUtm),
 * so a client's slug or a keyword changed later is what the link carries.
 */
export type PostAutomation = {
  on: boolean
  keywords: string[]
  dm_message: string
  button_title: string | null
  link: string | null
  comment_reply: string | null
  /** other DM texts, picked at random with dm_message (up to MAX_VARIATIONS) */
  dm_variations: string[]
  /** other public replies, picked at random with comment_reply */
  reply_variations: string[]
}

export const NO_AUTOMATION: PostAutomation = {
  on: false, keywords: [DEFAULT_KEYWORD], dm_message: '', button_title: null, link: null, comment_reply: null,
  dm_variations: [], reply_variations: [],
}

/** Read whatever is stored (or sent) as a post's automation; null when there is none. */
export function readPostAutomation(raw: unknown): PostAutomation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  const dm = s(r.dm_message, DM_LIMIT + 100)
  const on = r.on === true
  // an automation nobody ever wrote anything into is no automation at all
  if (!on && !dm.trim() && !s(r.link, 2000).trim() && !s(r.button_title, 60).trim() && !s(r.comment_reply, 400).trim()) return null
  return {
    on,
    keywords: normaliseKeywords(r.keywords),
    dm_message: dm,
    button_title: s(r.button_title, 60).trim() || null,
    link: s(r.link, 2000).trim() || null,
    comment_reply: s(r.comment_reply, 400).trim() || null,
    // kept as written (capped only against junk); readVariations judges them when it is switched on
    dm_variations: (Array.isArray(r.dm_variations) ? r.dm_variations : []).map(v => String(v ?? '').slice(0, DM_LIMIT + 100)).slice(0, 10),
    reply_variations: (Array.isArray(r.reply_variations) ? r.reply_variations : []).map(v => String(v ?? '').slice(0, 400)).slice(0, 10),
  }
}

/** Why this automation cannot be switched on as it is, or null. Nothing is checked while it is off. */
export function postAutomationProblem(a: PostAutomation | null | undefined, clientSlug: string | null): string | null {
  if (!a?.on) return null
  const parsed = parseAutomationInput({
    client_id: 'x', social_account_id: 'x', post_key: 'x',
    keywords: a.keywords, dm_message: a.dm_message, button_title: a.button_title, link: a.link, comment_reply: a.comment_reply,
    dm_variations: a.dm_variations, reply_variations: a.reply_variations,
  })
  if (!parsed.ok) return `Automation: ${parsed.error}`
  // the slug only names the campaign; without one, the link itself is still checked
  const link = finalLink(parsed.value, clientSlug || 'client')
  if (!link.ok) return `Automation: ${link.error}`
  return null
}

/** The id of OUR row for one post's automation on one account — one per post and account, by construction. */
export const postAutomationRowId = (postId: string, accountId: string) => `post_${postId}__${accountId}`

/** Why the app switched an automation off itself — only these are switched back on by a re-booking. */
export const TAKEN_OFF_REASON = 'The post was taken off the schedule'
export const CANCELLED_REASON = 'The post was cancelled'
export const SYSTEM_PAUSES: readonly string[] = [TAKEN_OFF_REASON, CANCELLED_REASON]

/**
 * What to do for one post and account when its booking reaches Zernio.
 *   create     — nothing recorded yet
 *   rebind     — recorded against an earlier booking that was pulled (a move re-books): the old one
 *                never armed, so it is replaced, keeping our record
 *   reactivate — the same booking, switched off by the app (taken off, then booked again)
 *   none       — already right, or switched off by a PERSON (never undone by the app)
 */
export function armDecision(
  row: { zernio_post_id: string | null; platform_post_id: string | null; active: boolean; paused_reason: string | null } | null,
  binding: Binding,
): 'create' | 'rebind' | 'reactivate' | 'none' {
  if (!row) return 'create'
  const personPaused = !row.active && !SYSTEM_PAUSES.includes(row.paused_reason ?? '')
  if (personPaused) return 'none'
  const sameBooking = binding.kind === 'pending'
    ? row.zernio_post_id === binding.postId
    : row.platform_post_id === binding.platformPostId || (!!row.zernio_post_id && !row.platform_post_id)
  if (!sameBooking) return 'rebind'
  return row.active ? 'none' : 'reactivate'
}

/**
 * The line on the card and in the window:
 *   "Automation: BOOK → DM with link · waiting for the post"
 *   "Automation: BOOK → DM with link · live · 12 DMs, 5 clicks"
 */
export function automationLine(
  a: Pick<PostAutomation, 'on' | 'keywords' | 'link' | 'button_title'> | null | undefined,
  state: { made: boolean; active: boolean; live: boolean; stats: Pick<AutomationStats, 'dmsSent' | 'linkClicks'> | null } | null,
): string | null {
  if (!a) return null
  const what = `${a.keywords[0] ?? DEFAULT_KEYWORD} → DM${a.link ? ' with link' : ''}`
  if (!a.on) return `Automation: ${what} · off`
  if (!state?.made) return `Automation: ${what} · starts when the post is booked`
  if (!state.active) return `Automation: ${what} · switched off`
  if (!state.live) return `Automation: ${what} · waiting for the post`
  const s = state.stats
  const dms = s ? `${s.dmsSent} DM${s.dmsSent === 1 ? '' : 's'}, ${s.linkClicks} click${s.linkClicks === 1 ? '' : 's'}` : ''
  return `Automation: ${what} · live${dms ? ` · ${dms}` : ''}`
}

/* ── run by our app (the owner, 30 Sep 2026: "we have a comment trigger … and then we send") ── */

/**
 * AN AUTOMATION OUR APP RUNS ITSELF. Zernio tells us of every comment (`comment.received` on the webhook);
 * for an automation with runner 'app' our app decides and sends the DM — Instagram's private reply, through
 * the same Zernio call the Inbox's DM button uses — and the public reply. Still ONE post each (never an
 * account), still switched on by a person, so it sits under the same standing rule as Zernio's.
 *
 * Instagram's rules, which no runner can change: one private reply per comment, within 7 days of it; and
 * nothing more until the person writes back.
 */
export const RUNNERS = ['zernio', 'app'] as const
export type Runner = typeof RUNNERS[number]
export const runnerOf = (row: { runner?: string | null }): Runner => (row.runner === 'app' ? 'app' : 'zernio')

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Does this comment say one of the keywords, the way Zernio's matchMode would read it? Case never matters. */
export function keywordMatches(text: string, keywords: readonly string[], mode: MatchMode | string): boolean {
  const t = String(text ?? '').trim().toLowerCase()
  if (!t) return false
  const ks = keywords.map(k => String(k ?? '').trim().toLowerCase()).filter(Boolean)
  if (ks.length === 0) return true
  if (mode === 'exact') return ks.some(k => t === k)
  if (mode === 'contains') return ks.some(k => t.includes(k))
  // word: the keyword on its own, not inside another word ("rba!" yes, "carbage" no)
  return ks.some(k => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}($|[^\\p{L}\\p{N}])`, 'u').test(t))
}

/** One of [main, ...others], the same one every time for the same seed — a retried send says the same thing. */
export function pickText(main: string, others: readonly string[], seed: string): string {
  const all = [main, ...others].filter(t => typeof t === 'string' && t.trim())
  if (all.length === 0) return main
  let h = 0
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return all[h % all.length]
}

/** The row id of one person's send on one automation: the claim that makes it exactly once. */
export function sendKey(automationId: string, person: string): string {
  const who = String(person ?? '').trim().toLowerCase().replace(/^@/, '')
  return `${automationId}:${who.replace(/[.#$\[\]\/%]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}`
}

export type IncomingComment = {
  commentId: string
  accountId: string | null
  platformPostId: string | null
  text: string
  authorId?: string
  authorUsername?: string
  own?: boolean
}

export type AppRunRow = {
  id: string; runner?: string | null; active: boolean; provider_account_id: string; platform_post_id: string | null
  keywords: unknown; match_mode: string; comment_reply: string | null; reply_variations: unknown
}

/**
 * Should our app answer this comment for this automation? The person is the commenter's id, else their name.
 * Our own replies come back through the webhook as comments ("Link sent to your DM") — they are never answered:
 * Zernio marks them own, and a comment that is word for word one of this automation's public replies is ours too.
 */
export function appSendDecision(row: AppRunRow, c: IncomingComment):
  { send: true; person: string } | { send: false; reason: string } {
  if (runnerOf(row) !== 'app') return { send: false, reason: 'run by Zernio' }
  if (!row.active) return { send: false, reason: 'switched off' }
  if (!c.accountId || c.accountId !== row.provider_account_id) return { send: false, reason: 'another account' }
  if (!c.platformPostId || c.platformPostId !== row.platform_post_id) return { send: false, reason: 'another post' }
  if (c.own) return { send: false, reason: 'our own comment' }
  const replies = [row.comment_reply, ...(Array.isArray(row.reply_variations) ? row.reply_variations : [])]
    .map(r => String(r ?? '').trim().toLowerCase()).filter(Boolean)
  if (replies.includes(String(c.text ?? '').trim().toLowerCase())) return { send: false, reason: 'our own reply' }
  const keywords = Array.isArray(row.keywords) ? (row.keywords as unknown[]).map(String) : []
  if (!keywordMatches(c.text, keywords, row.match_mode)) return { send: false, reason: 'no keyword' }
  const person = (c.authorId || c.authorUsername || '').trim()
  if (!person) return { send: false, reason: 'the comment names nobody' }
  return { send: true, person }
}

/** Our own sends as the list's numbers and log (the same shape Zernio's give). */
export function appStats(sends: readonly { status: string }[]): AutomationStats {
  const n = (s: string) => sends.filter(r => r.status === s).length
  return { triggered: sends.length, dmsSent: n('sent'), delivered: 0, read: 0, failed: n('failed'), linkClicks: 0, uniqueClicks: 0 }
}

export function appLogs(sends: readonly {
  id: string; commenter: string; commenter_name: string | null; comment_text: string | null; status: string; error: string | null; created_at: string
}[], limit = 10): AutomationLogRow[] {
  return [...sends]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map(r => ({
      id: r.id,
      username: r.commenter_name && !/^\d+$/.test(r.commenter_name) ? r.commenter_name : r.commenter,
      comment: r.comment_text, status: r.status, error: r.error, clicks: 0, at: r.created_at,
    }))
}
