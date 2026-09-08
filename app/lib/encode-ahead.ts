import 'server-only'
import { after } from 'next/server'
import { table } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { encoderConfigured } from './encoder'
import { canBeAskedAgain, getEncodeJob } from './encode-jobs'
import { copiesToPrepare, type CopyAsk } from './encode-ahead-core'
import { isPlatform, type MediaItem, type Platform, type PostKind } from './publish-core'
import type { ChannelExtras } from './schedule-compose-core'
import { headStoredObject } from './storage'
import { measuredDurationOf } from './stream'
import type { Slide } from './version-files-core'
import { inngest } from '../inngest/client'

/**
 * ASK FOR THE COPY WHEN THE MEDIA IS ATTACHED, NOT WHEN THE POST IS DUE.
 *
 * The decision is `encode-ahead-core.copiesToPrepare` and the whole of the
 * reasoning is written there. This half is the I/O around it: how big the
 * file is, how long it runs, which channels the post is going to, and the
 * `media/encode` event itself.
 *
 * ── It must never be felt by the person saving ──
 *
 * Somebody pressing Save is saving a post; they are not waiting on a HEAD
 * request against a bucket, a read of the channels, and four Inngest events.
 * So this is fire-and-forget in exactly the shape `previewVideos` and
 * `mirrorFiles` already use — through Next's `after()`, which keeps the
 * serverless function alive past the response rather than letting a detached
 * promise be frozen mid-flight, with the bare call as the fallback outside a
 * request scope (tests, scripts, Inngest).
 *
 * Nothing in here can fail a save. Every step is caught and logged, and the
 * worst case is the behaviour we had before this file existed: the publish
 * job asks for the copy itself and waits for it.
 *
 * ── Asking twice costs nothing, and is still avoided ──
 *
 * `encode_jobs` is claimed on `<source url>__<platform>`, so a second ask for
 * the same copy loses the claim and is dropped inside the job — re-saving a
 * post cannot start a second encode. The row is checked here anyway, because
 * an event that will certainly be thrown away is an Inngest run, a database
 * read and a line in the dashboard for nothing.
 *
 * CLAUDE.md trap 5b: `media/encode` is an existing function, so nothing new
 * needs registering for THIS change — but the app still has to have been
 * re-synced for that function to run at all.
 */

/** Everything the ask needs, as a post holds it. */
export type CopiesAheadInput = {
  clientId: string
  /** the post's media, in the order it was arranged */
  slides: readonly Slide[]
  /** the post's channels, by `social_accounts.id` */
  channels: readonly string[]
  /** the composer's per-channel overrides, keyed by the same ids */
  perChannel?: Record<string, ChannelExtras>
}

/**
 * Fire and forget: ask for every copy this post will need.
 *
 * Returns nothing on purpose. There is no answer a caller could act on — the
 * copy takes minutes and the save is finished in milliseconds — and a promise
 * handed back is a promise somebody eventually awaits.
 */
export function askForCopiesAhead(input: CopiesAheadInput): void {
  // no encoder, nothing to ask. The Stream fallback is a publish-time path
  // and is not worth warming: it is seconds, not minutes.
  if (!encoderConfigured()) return
  // one lone video is the only thing a copy is ever made of
  if (input.slides.length !== 1 || input.slides[0]?.type !== 'video') return
  if (input.channels.length === 0) return

  const job = async () => {
    let asks: CopyAsk[] = []
    try {
      asks = await copiesWanted(input)
    } catch (e) {
      console.error('[encode-ahead] could not work out which copies are needed:', e)
      return
    }
    for (const ask of asks) {
      try {
        await inngest.send({
          name: 'media/encode',
          data: {
            sourceUrl: ask.sourceUrl,
            platform: ask.platform,
            kind: ask.kind,
            seconds: ask.seconds,
            // the clip is being attached, so a copy that gave up on an
            // earlier post may be asked for again
            reopen: true,
          },
        })
      } catch (e) {
        // the publish job asks again when the post is due; a copy that was
        // never asked for early is late, not lost
        console.error('[encode-ahead] could not ask for a copy:', e)
      }
    }
  }

  try {
    after(job)
  } catch {
    void job().catch(e => console.error('[encode-ahead] preparing copies:', e))
  }
}

/**
 * The copies worth asking for, with the database's answers filled in.
 *
 * Separate from the send so the decision can be read on its own: the size and
 * the length come off our own rows, the channels off the client's accounts,
 * and the rule itself is the pure one the publish path uses.
 */
async function copiesWanted(input: CopiesAheadInput): Promise<CopyAsk[]> {
  const video = input.slides[0]

  // the size is the whole question, and only the storage host knows it
  const head = await headStoredObject(video.url).catch(() => null)
  if (head?.bytes == null) return []

  // how long the clip runs, if anything measured it. It matters as much here
  // as it does at publish time: the bitrate is the channel's size limit
  // spread over the length being budgeted for, and whoever asks FIRST fixes
  // that for good — which, after this change, is usually this call.
  const seconds = await measuredDurationOf(video.url).catch(() => null)

  const accounts = await table<SocialAccount>('social_accounts')
    .list({ where: a => a.client_id === input.clientId && input.channels.includes(a.id) })

  const platforms: Platform[] = []
  const kinds: Partial<Record<Platform, PostKind>> = {}
  const own: Partial<Record<Platform, MediaItem[]>> = {}
  for (const account of accounts) {
    // a channel that has been disconnected or switched off is not a channel;
    // the save path refuses one of those anyway
    if (!isPlatform(account.platform) || account.active === false) continue
    platforms.push(account.platform)
    const extras = input.perChannel?.[account.id]
    if (extras?.kind) kinds[account.platform] = extras.kind as PostKind
    if (extras?.slides?.length) {
      own[account.platform] = extras.slides.map(s => ({
        url: s.url, type: s.type === 'video' ? 'video' : 'image',
      }))
    }
  }

  const wanted = copiesToPrepare({
    probes: [{
      url: video.url,
      type: 'video',
      bytes: head.bytes,
      ...(seconds ? { seconds } : {}),
    }],
    platforms,
    kinds,
    own,
  })
  if (wanted.length === 0) return []

  /**
   * A row that already exists is left alone — with one exception.
   *
   * `done` and `running` are obvious. `queued` is somebody else's ask from a
   * moment ago, and a cold one is taken back by the sweep, not by us.
   *
   * The exception is a `failed` row that has spent all three attempts on
   * something a fourth could have fixed — a PUT that 500'd, a machine that
   * fell over. That row is terminal for ever otherwise: it is claimed on
   * `<source url>__<platform>`, so every future post of that clip to that
   * channel failed instantly with no way to clear it short of the database
   * console. The clip being attached afresh is the moment to try once more,
   * and `reopen` on the event is what lets the job do it. A failure a retry
   * could not improve on (no video in the file, HDR this machine cannot
   * convert) still stays failed.
   */
  const out: CopyAsk[] = []
  for (const ask of wanted) {
    const row = await getEncodeJob(ask.sourceUrl, ask.platform)
    if (row && !canBeAskedAgain(row)) continue
    out.push(ask)
  }
  return out
}
