import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  POLL_AFTER_MS, isVideoUrl, missingPreviewSources, pollablePreviews,
  previewPatchFrom, parseWebhookSignature, webhookSignatureSource,
  webhookTimestampFresh,
  type PreviewPatch, type PreviewRow,
} from './stream-core'

/**
 * Cloudflare Stream: the browser-playable copy of a camera file.
 *
 * The pure half of this lives in `stream-core.ts` — what the player does, how
 * a Cloudflare response maps onto our columns, which rows the sweep wants.
 * This half is the I/O: the API calls, the claim, the webhook, the sweep.
 *
 * ── Every entry point is a no-op when the env vars are unset ──
 *
 * `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_STREAM_TOKEN` are read lazily, per
 * call, never at module load (CLAUDE.md trap 7: a module that reads env at
 * import time turns a missing variable into a failed BUILD). With them unset,
 * `streamConfigured()` is false, nothing is queued, no row is written, and
 * every player behaves exactly as it did the day before this file existed.
 *
 * ── Why the insert comes before the API call ──
 *
 * `video_previews.source_url` is unique and the row is claimed BEFORE
 * Cloudflare is asked to copy anything. Stream cannot be asked "do you already
 * have this URL?" — it is keyed by its own uid — so without the claim, an
 * upload saved twice, a retry, or the sweep landing on top of the upload hook
 * would each start a separate encode of the same 2 GB master. Stream bills per
 * minute of video stored, so a duplicate is a recurring charge, not just an
 * untidy table. Same pattern as `drive_files` and `email_ingest_log`.
 */

const API = 'https://api.cloudflare.com/client/v4'

function accountId(): string { return process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '' }
function token(): string { return process.env.CLOUDFLARE_STREAM_TOKEN?.trim() ?? '' }
function webhookSecret(): string { return process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET?.trim() ?? '' }

export function streamConfigured(): boolean {
  return Boolean(accountId() && token())
}

/** The URL to register with Cloudflare so `ready` arrives in seconds, not minutes. */
export function streamWebhookUrl(): string {
  const host = process.env.NEXT_PUBLIC_APP_HOST?.trim().toLowerCase() || 'app.mdmmarketing.com.au'
  return `https://${host}/api/stream/webhook`
}

type CfResult = { ok: boolean; result: unknown; error: string | null }

/**
 * One Cloudflare call. Never throws.
 *
 * A preview is an optional convenience sitting behind an upload, an approval
 * or a client's page load — none of which may fail because a third party is
 * having a bad afternoon. Every caller gets `{ok:false, error}` and decides
 * for itself, and the decision is always "leave the row for the sweep".
 */
async function cf(path: string, init?: RequestInit): Promise<CfResult> {
  try {
    const res = await fetch(`${API}/accounts/${accountId()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    })
    const json = await res.json().catch(() => null) as {
      success?: boolean; result?: unknown; errors?: { message?: string }[]
    } | null
    if (!res.ok || json?.success === false) {
      const message = json?.errors?.map(e => e?.message).filter(Boolean).join('; ')
        || `Cloudflare Stream returned ${res.status}`
      return { ok: false, result: null, error: message }
    }
    return { ok: true, result: json?.result ?? null, error: null }
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'Cloudflare Stream is unreachable' }
  }
}

// ── reading ───────────────────────────────────────────────────────────────

const ROW_COLUMNS = 'source_url, stream_uid, state, playback_hls, thumbnail_url, duration_sec, width, height, error'

/**
 * The preview rows for a set of source URLs.
 *
 * A missing table is an empty map, not an error: the feature is optional and
 * a dashboard must not 500 because `video_previews.sql` has not been run yet.
 */
export async function previewsFor(urls: readonly string[]): Promise<Map<string, PreviewRow>> {
  const out = new Map<string, PreviewRow>()
  const wanted = [...new Set(urls.map(u => String(u ?? '')).filter(Boolean))].slice(0, 100)
  if (wanted.length === 0 || !streamConfigured()) return out
  const { data, error } = await supabase
    .from('video_previews').select(ROW_COLUMNS).in('source_url', wanted)
  if (error) {
    console.error('[stream] could not read previews:', error.message)
    return out
  }
  for (const row of data ?? []) out.set(String(row.source_url), row as PreviewRow)
  return out
}

export async function previewFor(url: string): Promise<PreviewRow | null> {
  return (await previewsFor([url])).get(String(url ?? '')) ?? null
}

// ── asking for one ────────────────────────────────────────────────────────

/**
 * Ask Cloudflare to make a playable copy of one file. Never throws.
 *
 * Returns what HAPPENED, which is not the same as what was wanted: `claimed`
 * means this call is the one doing the work, `existing` means somebody else
 * already is, `skipped` means the feature is off or the URL is not a video.
 *
 * Copy-by-URL rather than an upload: the bytes are already in R2 behind a
 * public URL, so Cloudflare pulls them directly and the file never passes
 * through a Vercel function — which it could not, at 2 GB, and could not at
 * 45 MB either.
 */
export async function requestPreview(sourceUrl: string): Promise<
  { at: 'skipped'; why: string } | { at: 'existing' } | { at: 'claimed'; uid: string | null }
> {
  const url = String(sourceUrl ?? '').trim()
  if (!streamConfigured()) return { at: 'skipped', why: 'not configured' }
  if (!url || !/^https?:\/\//i.test(url)) return { at: 'skipped', why: 'not a URL' }
  if (!isVideoUrl(url)) return { at: 'skipped', why: 'not a video' }

  // the claim. A duplicate key here is the whole point: it is how a second
  // caller learns, in one round trip, that it has nothing to do.
  const { error } = await supabase.from('video_previews').insert({ source_url: url, state: 'queued' })
  if (error) {
    if (error.code === '23505') return { at: 'existing' }
    console.error('[stream] could not claim a preview:', error.message)
    return { at: 'skipped', why: error.message }
  }

  return { at: 'claimed', uid: await copyIntoStream(url) }
}

/**
 * Hand one claimed URL to Cloudflare and record what came back.
 *
 * A failure leaves the row `queued` with `stream_uid` null and the reason in
 * `error`. That is deliberately the same shape the claim itself creates, and
 * `retakeStalledClaims` is what looks for it — so a copy request lost to a
 * timeout is retried by the next sweep rather than becoming a row that waits
 * forever for a video nobody asked for.
 */
async function copyIntoStream(url: string): Promise<string | null> {
  const res = await cf('/stream/copy', {
    method: 'POST',
    body: JSON.stringify({
      url,
      meta: { name: fileNameOf(url), source_url: url },
      // Public playback, deliberately, and only for now. Signed URLs are the
      // follow-up (see docs/PROJECT_STATE.md): they would keep an unlisted
      // preview from being watched by anyone who guessed the uid, but they
      // also need a key, a signer and an expiry policy on every player —
      // including the portal, which has no login at all. The originals in R2
      // are already served from a public bucket, so this changes no exposure
      // that did not already exist; it is a smaller door on an open one.
      requireSignedURLs: false,
      // one second in: frame zero of a camera clip is usually black or a clapper
      thumbnailTimestampPct: 0.05,
    }),
  })
  if (!res.ok) {
    await supabase.from('video_previews')
      .update({ error: res.error, updated_at: new Date().toISOString() })
      .eq('source_url', url)
    console.error('[stream] copy request failed:', res.error)
    return null
  }
  const patch = previewPatchFrom(res.result)
  if (!patch) {
    await supabase.from('video_previews')
      .update({ error: 'Cloudflare accepted the copy but returned no video id', updated_at: new Date().toISOString() })
      .eq('source_url', url)
    return null
  }
  await writePatch({ source_url: url }, patch)
  return patch.stream_uid
}

function fileNameOf(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || 'video'
  } catch { return 'video' }
}

/** Apply a Cloudflare patch to the row identified by url OR uid. */
async function writePatch(
  where: { source_url?: string; stream_uid?: string }, patch: PreviewPatch,
): Promise<boolean> {
  let q = supabase.from('video_previews')
    .update({ ...patch, updated_at: new Date().toISOString() })
  q = where.source_url ? q.eq('source_url', where.source_url) : q.eq('stream_uid', where.stream_uid!)
  const { error } = await q
  if (error) {
    console.error('[stream] could not save preview state:', error.message)
    return false
  }
  return true
}

/**
 * Fire-and-forget, for request handlers — the same shape and the same reason
 * as `gdrive-mirror.mirrorFiles`.
 *
 * Through Next's `after()`, not a bare `void`: on Vercel a function that has
 * sent its response can be frozen before a detached promise finishes, and a
 * request that never left is a video that never gets a preview. `after()`
 * keeps the function alive until the work is done; outside a request scope
 * (tests, scripts, Inngest) it throws, and the detached call is the fallback.
 *
 * The 30-minute sweep is the backstop for both.
 */
export function previewVideos(urls: readonly (string | null | undefined)[]): void {
  const wanted = [...new Set(urls.map(u => String(u ?? '')).filter(isVideoUrl))]
  if (wanted.length === 0 || !streamConfigured()) return
  const job = async () => {
    for (const url of wanted) {
      await requestPreview(url).catch(e => console.error('[stream] preview request:', e))
    }
  }
  try {
    after(job)
  } catch {
    void job().catch(e => console.error('[stream] preview request:', e))
  }
}

/**
 * Is this URL one of OUR stored files?
 *
 * The guard on the player's lookup endpoint, which is public — it has to be,
 * because the client portal has no login and its videos need previews too.
 * Without this, `/api/stream/preview?url=…` would be an open "encode anything
 * on the internet at MD Media's expense" button. With it, the only URLs that
 * can ever start an encode are ones already sitting in our own bucket.
 */
export function isOwnStorageUrl(url: string): boolean {
  const u = String(url ?? '').trim()
  if (!/^https:\/\//i.test(u)) return false
  const bases = [
    process.env.R2_PUBLIC_BASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ].map(b => String(b ?? '').trim().replace(/\/$/, '')).filter(Boolean)
  return bases.some(b => u.startsWith(`${b}/`))
}

/**
 * What the player asks: the preview state of one file, and — the first time
 * anybody meets a video that has none — a request for one.
 *
 * The lazy claim matters. The upload hook and the half-hourly sweep between
 * them cover everything uploaded from now on, but neither covers the file an
 * editor uploaded last month, which is precisely the file somebody is opening
 * when they discover it will not play. Asking here means the FIRST person to
 * hit a stuck video starts the fix, instead of filing a bug about it.
 */
export async function lookupPreview(
  sourceUrl: string, { claim = false }: { claim?: boolean } = {},
): Promise<{ configured: boolean; row: PreviewRow | null }> {
  if (!streamConfigured()) return { configured: false, row: null }
  const url = String(sourceUrl ?? '').trim()
  const row = await previewFor(url)
  if (row || !claim || !isVideoUrl(url) || !isOwnStorageUrl(url)) {
    return { configured: true, row }
  }
  const out = await requestPreview(url)
  if (out.at === 'skipped') return { configured: true, row: null }
  return { configured: true, row: await previewFor(url) }
}

// ── keeping rows honest ───────────────────────────────────────────────────

/** Ask Cloudflare about one encode and write down the answer. */
export async function refreshPreview(uid: string): Promise<PreviewPatch | null> {
  const id = String(uid ?? '').trim()
  if (!id || !streamConfigured()) return null
  const res = await cf(`/stream/${encodeURIComponent(id)}`)
  if (!res.ok) {
    // A deleted video 404s forever. Marking it errored stops the poller
    // asking about it every half hour until the end of time, and the reason
    // is the truthful one to show a team member.
    if (/404|not found|not_found/i.test(res.error ?? '')) {
      await supabase.from('video_previews')
        .update({ state: 'error', error: 'This preview no longer exists at Cloudflare', updated_at: new Date().toISOString() })
        .eq('stream_uid', id)
    }
    return null
  }
  const patch = previewPatchFrom(res.result)
  if (!patch) return null
  await writePatch({ stream_uid: id }, patch)
  return patch
}

/** Remove the preview for a file — the encode at Cloudflare and our row. */
export async function deletePreview(sourceUrl: string): Promise<boolean> {
  const url = String(sourceUrl ?? '').trim()
  if (!url || !streamConfigured()) return false
  const row = await previewFor(url)
  if (row?.stream_uid) {
    const res = await cf(`/stream/${encodeURIComponent(row.stream_uid)}`, { method: 'DELETE' })
    // a video already gone is a delete that succeeded, as far as we are concerned
    if (!res.ok && !/404|not found/i.test(res.error ?? '')) {
      console.error('[stream] could not delete the encode:', res.error)
      return false
    }
  }
  const { error } = await supabase.from('video_previews').delete().eq('source_url', url)
  if (error) { console.error('[stream] could not delete the preview row:', error.message); return false }
  return true
}

// ── the webhook ───────────────────────────────────────────────────────────

/**
 * Cloudflare telling us an encode finished.
 *
 * The signature is the ONLY authentication: `/api/stream` is absent from the
 * middleware matcher, so Clerk never runs there. Verification is
 * HMAC-SHA256 over `time + "." + the raw body`, compared in constant time.
 * The body must be the raw text — re-serialising the parsed JSON changes key
 * order and produces a signature that can never match, which is the classic
 * way a verifier ends up rejecting every genuine delivery.
 *
 * With no secret configured we accept unsigned deliveries but still refuse to
 * invent state: a payload must name a uid we already have a row for, so the
 * worst an unauthenticated caller can do is tell us the truth slightly early.
 * The poller reaches the same answer within two minutes regardless.
 */
export async function handleStreamWebhook(
  rawBody: string, signatureHeader: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = webhookSecret()
  if (secret) {
    const parsed = parseWebhookSignature(signatureHeader)
    if (!parsed) return { status: 401, body: { error: 'Missing or malformed Webhook-Signature' } }
    if (!webhookTimestampFresh(parsed.time)) {
      return { status: 401, body: { error: 'Signature timestamp is outside the accepted window' } }
    }
    const expected = createHmac('sha256', secret)
      .update(webhookSignatureSource(parsed.time, rawBody))
      .digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(parsed.sig.toLowerCase(), 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { status: 401, body: { error: 'Bad signature' } }
    }
  }

  let payload: unknown = null
  try { payload = JSON.parse(rawBody) } catch { /* handled below */ }
  const patch = previewPatchFrom(payload)
  if (!patch?.stream_uid) return { status: 400, body: { error: 'No video in the payload' } }

  // Update by uid, and only where a row already exists — a delivery about a
  // video somebody else's account made is not ours to record.
  const wrote = await writePatch({ stream_uid: patch.stream_uid }, patch)
  if (!wrote) return { status: 500, body: { error: 'Could not save' } }
  return { status: 200, body: { ok: true, uid: patch.stream_uid, state: patch.state } }
}

// ── the sweep, and what the settings card counts ──────────────────────────

export type PreviewSweep = { missing: number; claimed: number; polled: number; retaken: number }

const SWEEP_DAYS = 14
const SWEEP_ITEM_LIMIT = 200

/**
 * Find video that should have a preview and does not, and chase the rows that
 * stopped moving.
 *
 * Rides the existing half-hourly cron rather than becoming an Inngest function
 * of its own, and that is not laziness: a NEW Inngest function does nothing at
 * all until the app is re-synced (CLAUDE.md trap 5b), so a self-healing job
 * that itself silently did nothing would be this bug wearing a hat.
 *
 * Recently touched work only, not the whole archive: a file that should have
 * been queued should have been queued because somebody just saved something.
 */
export async function sweepMissingPreviews(): Promise<PreviewSweep> {
  const empty: PreviewSweep = { missing: 0, claimed: 0, polled: 0, retaken: 0 }
  if (!streamConfigured()) return empty

  const since = new Date(Date.now() - SWEEP_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [itemsRes, versionsRes] = await Promise.all([
    supabase.from('content_items').select('id, raw_assets')
      .gte('updated_at', since).order('updated_at', { ascending: false }).limit(SWEEP_ITEM_LIMIT),
    supabase.from('asset_versions').select('file_url, files')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(SWEEP_ITEM_LIMIT),
  ])
  if (itemsRes.error && versionsRes.error) {
    console.error('[stream] sweep could not read work:', itemsRes.error.message)
    return empty
  }

  const candidates: string[] = []
  for (const row of itemsRes.data ?? []) {
    for (const a of Array.isArray(row.raw_assets) ? row.raw_assets : []) {
      const url = (a as { url?: unknown })?.url
      if (typeof url === 'string') candidates.push(url)
    }
  }
  for (const v of versionsRes.data ?? []) {
    if (typeof v.file_url === 'string') candidates.push(v.file_url)
    for (const s of Array.isArray(v.files) ? v.files : []) {
      const url = (s as { url?: unknown })?.url
      if (typeof url === 'string') candidates.push(url)
    }
  }

  const videos = [...new Set(candidates.filter(isVideoUrl))]
  let missing: string[] = []
  if (videos.length > 0) {
    // ask only about the URLs we are considering — `in` on a bounded list,
    // never a full scan of a table that grows with every file ever uploaded
    const { data: have } = await supabase
      .from('video_previews').select('source_url').in('source_url', videos.slice(0, 200))
    missing = missingPreviewSources(videos, (have ?? []).map(r => String(r.source_url)))
  }

  let claimed = 0
  for (const url of missing) {
    const out = await requestPreview(url)
    if (out.at === 'claimed') claimed++
  }

  const polled = await pollStalePreviews()
  const retaken = await retakeStalledClaims()

  if (missing.length || polled || retaken) {
    console.log(`[stream] sweep: ${missing.length} missing (claimed ${claimed}), polled ${polled}, retook ${retaken}`)
  }
  return { missing: missing.length, claimed, polled, retaken }
}

/** The backstop for a webhook that never arrived. */
async function pollStalePreviews(): Promise<number> {
  const cutoff = new Date(Date.now() - POLL_AFTER_MS).toISOString()
  const { data, error } = await supabase.from('video_previews')
    .select('stream_uid, state, updated_at')
    .in('state', ['queued', 'processing'])
    .lte('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(20)
  if (error || !data) return 0
  const rows = pollablePreviews(data as { state: 'queued' | 'processing'; updated_at: string; stream_uid: string | null }[])
  let n = 0
  for (const row of rows) {
    if (await refreshPreview(row.stream_uid!)) n++
  }
  return n
}

/**
 * Claims whose copy request never landed.
 *
 * A row that has held `queued` with no uid for two minutes is not waiting on
 * Cloudflare — Cloudflare was never successfully asked. The claim is still
 * ours, so we simply ask again; there is no risk of a duplicate encode
 * because there is no encode.
 */
async function retakeStalledClaims(): Promise<number> {
  const cutoff = new Date(Date.now() - POLL_AFTER_MS).toISOString()
  const { data } = await supabase.from('video_previews')
    .select('source_url')
    .eq('state', 'queued').is('stream_uid', null).lte('updated_at', cutoff)
    .limit(10)
  let n = 0
  for (const row of data ?? []) {
    if (await copyIntoStream(String(row.source_url))) n++
  }
  return n
}

export type PreviewStats = { ready: number; preparing: number; failed: number; total: number }

/** What the Settings → Integrations row counts. Last seven days. */
export async function previewStats(days = 7): Promise<PreviewStats> {
  const zero: PreviewStats = { ready: 0, preparing: 0, failed: 0, total: 0 }
  if (!streamConfigured()) return zero
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase.from('video_previews')
    .select('state').gte('created_at', since).limit(1000)
  if (error || !data) return zero
  const out = { ...zero, total: data.length }
  for (const row of data) {
    const s = String(row.state)
    if (s === 'ready') out.ready++
    else if (s === 'error') out.failed++
    else out.preparing++
  }
  return out
}

/**
 * "Retry failed" — throw away the failed encodes and ask again from scratch.
 *
 * Deleting the row rather than resetting it, because the encode at Cloudflare
 * failed and a retry must be a NEW video, not a poll of a dead uid. The
 * source URL is re-claimed on the way back through `requestPreview`, so the
 * duplicate protection holds throughout.
 */
export async function retryFailedPreviews(days = 7): Promise<{ retried: number }> {
  if (!streamConfigured()) return { retried: 0 }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase.from('video_previews')
    .select('source_url').eq('state', 'error').gte('created_at', since).limit(50)
  let retried = 0
  for (const row of data ?? []) {
    const url = String(row.source_url)
    if (await deletePreview(url) && (await requestPreview(url)).at === 'claimed') retried++
  }
  return { retried }
}

// ── a smaller copy for a channel that cannot take the master ──────────────

/**
 * A 1080p MP4 of a video we already hold, or where that stands.
 *
 * The encode is the same one the portal preview uses, so most of the time it
 * already exists; when it does not, this claims it (idempotently — the claim
 * is a unique key) and reports `encoding` until the webhook or a refresh
 * marks it ready. Then Stream is asked for a download, which it builds once
 * and serves from a fixed URL. Never throws: a failure is a state, and the
 * composer says it in words rather than losing the post over a preview.
 */
export async function smallerCopyOf(sourceUrl: string): Promise<
  | { status: 'encoding'; percent: number | null }
  | { status: 'ready'; url: string; bytes: number | null; width?: number; height?: number; seconds?: number }
  | { status: 'failed'; reason: string }
> {
  if (!streamConfigured()) return { status: 'failed', reason: 'video encoding is not set up on this workspace' }

  let row = await previewFor(sourceUrl)
  if (!row) {
    const asked = await requestPreview(sourceUrl)
    if (asked.at === 'skipped') return { status: 'failed', reason: asked.why }
    row = await previewFor(sourceUrl)
  }
  if (!row) return { status: 'encoding', percent: null }
  if (row.state === 'error') return { status: 'failed', reason: row.error ?? 'the encode failed' }
  if (!row.stream_uid) return { status: 'encoding', percent: null }
  if (row.state !== 'ready') {
    // the webhook usually moves the row; asking Stream directly closes the
    // gap when it has not arrived yet
    const fresh = await refreshPreview(row.stream_uid)
    if (fresh?.state === 'ready') row = { ...row, ...fresh, state: 'ready' }
    else if (fresh?.state === 'error') return { status: 'failed', reason: fresh.error ?? 'the encode failed' }
    else return { status: 'encoding', percent: null }
  }

  // enabling downloads is idempotent: a second POST reports the same job
  const asked = await cf(`/stream/${row.stream_uid}/downloads`, { method: 'POST' })
  const job = ((asked.ok ? asked.result : null) as {
    default?: { status?: string; url?: string; percentComplete?: number }
  } | null)?.default
  if (!asked.ok || !job?.url) return { status: 'failed', reason: asked.error ?? 'Stream would not make a download' }
  if (job.status !== 'ready') return { status: 'encoding', percent: job.percentComplete ?? null }

  // the size, so the check can judge the copy the way it judged the master
  let bytes: number | null = null
  try {
    const head = await fetch(job.url, { method: 'HEAD', cache: 'no-store' })
    const len = Number(head.headers.get('content-length'))
    if (Number.isFinite(len) && len > 0) bytes = len
  } catch { /* unknown size is reported as unknown */ }

  return {
    status: 'ready',
    url: job.url,
    bytes,
    ...(row.width && row.height ? { width: row.width, height: row.height } : {}),
    ...(row.duration_sec ? { seconds: row.duration_sec } : {}),
  }
}
