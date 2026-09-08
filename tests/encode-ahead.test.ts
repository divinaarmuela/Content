import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { copiesToPrepare } from '../app/lib/encode-ahead-core'
import { channelsNeedingCopy } from '../app/lib/shrink-core'
import { encodeTargetFor, type AssetProbe } from '../app/lib/media-fit-core'
import type { Platform } from '../app/lib/publish-core'

/**
 * THE COPY IS ASKED FOR WHEN THE MEDIA IS ATTACHED, NOT WHEN THE POST IS DUE.
 *
 * A 700 MB video scheduled for October used to start encoding in October: the
 * publish job reached `awaitCleanCopies`, found no copy, sent `media/encode`
 * and went back to the queue — so the post went out half an hour after the
 * time somebody had chosen. Everything here is about moving that ask to the
 * save, and about not moving anything else.
 *
 * Nothing reaches the network: storage answers a size, the Inngest client
 * records the event instead of sending it.
 */

const MASTER = 'https://media.example.com/master.mp4'
const SMALL = 'https://media.example.com/short.mp4'
const MB = 1024 * 1024

/* ── the pure rule ──────────────────────────────────────────────────────── */

const bigVideo: AssetProbe = { url: MASTER, type: 'video', bytes: 700 * MB, seconds: 20 }

describe('which copies a post needs', () => {
  it('is the SAME answer the publish path works out, channel for channel', () => {
    const platforms: Platform[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook', 'twitter']
    const kinds = { instagram: 'reel' as const }
    const mine = copiesToPrepare({ probes: [bigVideo], platforms, kinds })
    // the publish path's own two steps, in its own order
    const theirs = channelsNeedingCopy({ probes: [bigVideo], platforms, kinds })
      .filter(p => encodeTargetFor(p, kinds[p as 'instagram'], bigVideo.seconds))
    expect(mine.map(a => a.platform)).toEqual(theirs)
    // and it is not vacuous: Instagram needs one, TikTok and YouTube take the
    // master whole
    expect(mine.map(a => a.platform)).toContain('instagram')
    expect(mine.map(a => a.platform)).not.toContain('tiktok')
    expect(mine.map(a => a.platform)).not.toContain('youtube')
  })

  it('carries the kind and the measured length into the ask', () => {
    expect(copiesToPrepare({
      probes: [bigVideo], platforms: ['instagram'], kinds: { instagram: 'reel' },
    })).toEqual([{ sourceUrl: MASTER, platform: 'instagram', kind: 'reel', seconds: 20 }])
  })

  it('says nothing when the length was never measured — but still asks', () => {
    const asks = copiesToPrepare({
      probes: [{ url: MASTER, type: 'video', bytes: 700 * MB }], platforms: ['instagram'],
    })
    expect(asks).toEqual([{ sourceUrl: MASTER, platform: 'instagram', kind: null, seconds: null }])
  })

  it('asks for nothing when the file already fits every channel', () => {
    expect(copiesToPrepare({
      probes: [{ url: SMALL, type: 'video', bytes: 12 * MB, seconds: 20 }],
      platforms: ['instagram', 'facebook', 'linkedin'],
    })).toEqual([])
  })

  it('asks for nothing for a photo, a carousel, or a size nobody knows', () => {
    const platforms: Platform[] = ['instagram']
    expect(copiesToPrepare({
      probes: [{ url: 'https://media.example.com/one.jpg', type: 'image', bytes: 900 * MB }],
      platforms,
    })).toEqual([])
    expect(copiesToPrepare({
      probes: [bigVideo, { url: SMALL, type: 'video', bytes: 700 * MB }], platforms,
    })).toEqual([])
    expect(copiesToPrepare({
      probes: [{ url: MASTER, type: 'video' }], platforms,
    })).toEqual([])
  })

  it('leaves a channel that already carries its own file alone', () => {
    expect(copiesToPrepare({
      probes: [bigVideo],
      platforms: ['instagram'],
      own: { instagram: [{ url: 'https://media.example.com/mine.mp4', type: 'video' }] },
    })).toEqual([])
  })

  it('asks once for a channel a post uses twice', () => {
    // two Instagram accounts on one post are two channels and ONE copy
    expect(copiesToPrepare({
      probes: [bigVideo], platforms: ['instagram', 'instagram'],
    })).toHaveLength(1)
  })

  it('never asks for a copy that could not be made', () => {
    // `encodeTargetFor` answering null means no copy of this clip is worth
    // making for that channel. The publish path treats that as a failure a
    // person has to act on; nothing is gained by asking for it early, and an
    // ask the encoder will only refuse is a run for nothing.
    const every: Platform[] = [
      'instagram', 'tiktok', 'twitter', 'linkedin', 'facebook',
      'threads', 'youtube', 'pinterest', 'bluesky',
    ]
    for (const seconds of [undefined, 5, 20, 600, 3600, 7200]) {
      const probe: AssetProbe = {
        url: MASTER, type: 'video', bytes: 3000 * MB,
        ...(seconds === undefined ? {} : { seconds }),
      }
      for (const ask of copiesToPrepare({ probes: [probe], platforms: every })) {
        expect(
          encodeTargetFor(ask.platform, ask.kind ?? undefined, ask.seconds ?? undefined),
          `${ask.platform} at ${seconds}s`,
        ).not.toBeNull()
      }
    }
  })
})

/* ── the ask itself ─────────────────────────────────────────────────────── */

let sent: { name: string; data: Record<string, unknown> }[] = []
vi.mock('../app/inngest/client', () => ({
  inngest: { send: async (e: { name: string; data: Record<string, unknown> }) => { sent.push(e) } },
}))

let headBytes: number | null = 700 * MB
vi.mock('../app/lib/storage', async () => {
  const real = await vi.importActual<typeof import('../app/lib/storage')>('../app/lib/storage')
  return {
    ...real,
    publicBase: () => 'https://media.example.com',
    headStoredObject: async () => ({ contentType: 'video/mp4', bytes: headBytes }),
  }
})

const { askForCopiesAhead } = await import('../app/lib/encode-ahead')
const { encodeJobId } = await import('../app/lib/encode-jobs')

/** `after()` throws outside a request, so the job runs detached — let it. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) }

const account = (id: string, platform: string): Row => ({
  id, client_id: 'c1', platform, provider_account_id: `prov-${id}`,
  name: `Acme on ${platform}`, username: 'acme', avatar_url: null, active: true,
} as unknown as Row)

const encodeJob = (platform: string, over: Record<string, unknown> = {}): Row => ({
  id: encodeJobId(MASTER, platform as Platform),
  source_url: MASTER, platform, kind: null, status: 'running',
  output_key: 'copy.mp4', attempts: 1, target_source: 'measured',
  bytes: null, width: null, height: null, duration_sec: null, video_kbps: null,
  error: null, asset_id: null, version_id: null, slide_index: null,
  created_at: '2026-09-08T00:00:00.000Z', updated_at: '2026-09-08T00:00:00.000Z',
  ...over,
} as unknown as Row)

const videoSlide = { url: MASTER, name: 'master.mp4', type: 'video' as const }

let fake: ReturnType<typeof seedDb>
const seed = (over: Partial<Record<'encode_jobs' | 'video_previews', Row[]>> = {}) => seedDb({
  social_accounts: [account('acc-ig', 'instagram'), account('acc-tt', 'tiktok')],
  encode_jobs: over.encode_jobs ?? [],
  video_previews: over.video_previews ?? [],
})

beforeEach(() => {
  sent = []
  headBytes = 700 * MB
  process.env.ENCODER_URL = 'https://encoder.example.com'
  process.env.ENCODER_TOKEN = 'token'
  fake = seed()
})
afterEach(() => {
  fake?.restore()
  delete process.env.ENCODER_URL
  delete process.env.ENCODER_TOKEN
})

describe('asking for the copies a saved post will need', () => {
  it('sends one event per channel that needs one, and none for the rest', async () => {
    askForCopiesAhead({
      clientId: 'c1', slides: [videoSlide], channels: ['acc-ig', 'acc-tt'],
      perChannel: { 'acc-ig': { kind: 'reel' } },
    })
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0].name).toBe('media/encode')
    expect(sent[0].data).toMatchObject({
      sourceUrl: MASTER, platform: 'instagram', kind: 'reel',
    })
  })

  it('carries the measured length, so the copy is budgeted for the clip', async () => {
    fake.restore()
    fake = seed({
      video_previews: [{
        id: 'p1', source_url: MASTER, stream_uid: 'uid', state: 'ready', error: null,
        width: 1080, height: 1920, duration_sec: 20,
        created_at: '2026-09-08T00:00:00.000Z', updated_at: '2026-09-08T00:00:00.000Z',
      } as unknown as Row],
    })
    askForCopiesAhead({ clientId: 'c1', slides: [videoSlide], channels: ['acc-ig'] })
    await settle()
    expect(sent[0].data).toMatchObject({ seconds: 20 })
    // and that is what buys the full ceiling rather than the blind fallback
    expect(encodeTargetFor('instagram', undefined, 20)!.maxrateKbps)
      .toBeGreaterThan(encodeTargetFor('instagram', undefined)!.maxrateKbps)
  })

  it('sends nothing for a file every channel can take', async () => {
    headBytes = 12 * MB
    askForCopiesAhead({ clientId: 'c1', slides: [videoSlide], channels: ['acc-ig', 'acc-tt'] })
    await settle()
    expect(sent).toEqual([])
  })

  it('sends nothing for a photo, and nothing when no channel is chosen yet', async () => {
    askForCopiesAhead({
      clientId: 'c1',
      slides: [{ url: 'https://media.example.com/one.jpg', name: 'one.jpg', type: 'image' }],
      channels: ['acc-ig'],
    })
    askForCopiesAhead({ clientId: 'c1', slides: [videoSlide], channels: [] })
    await settle()
    expect(sent).toEqual([])
  })

  it('does not send twice when the copy is already being made', async () => {
    fake.restore()
    fake = seed({ encode_jobs: [encodeJob('instagram', {})] })
    askForCopiesAhead({ clientId: 'c1', slides: [videoSlide], channels: ['acc-ig'] })
    await settle()
    expect(sent).toEqual([])
  })

  it('does not send again once the copy is made', async () => {
    fake.restore()
    fake = seed({ encode_jobs: [encodeJob('instagram', { status: 'done' })] })
    askForCopiesAhead({ clientId: 'c1', slides: [videoSlide], channels: ['acc-ig'] })
    await settle()
    expect(sent).toEqual([])
  })

  it('saving the same post twice asks once', async () => {
    const save = () => askForCopiesAhead({
      clientId: 'c1', slides: [videoSlide], channels: ['acc-ig'],
    })
    save()
    await settle()
    expect(sent).toHaveLength(1)

    // the first ask left a row behind, exactly as `media/encode` does
    fake.restore()
    fake = seed({ encode_jobs: [encodeJob('instagram', { status: 'queued' })] })
    save()
    await settle()
    expect(sent).toHaveLength(1)
  })

  it('does nothing at all with no encoder configured', async () => {
    delete process.env.ENCODER_URL
    delete process.env.ENCODER_TOKEN
    askForCopiesAhead({ clientId: 'c1', slides: [videoSlide], channels: ['acc-ig'] })
    await settle()
    expect(sent).toEqual([])
  })

  it('a channel belonging to another client is not this post’s channel', async () => {
    askForCopiesAhead({ clientId: 'c2', slides: [videoSlide], channels: ['acc-ig'] })
    await settle()
    expect(sent).toEqual([])
  })

  it('never throws at the person saving, whatever goes wrong', async () => {
    fake.restore()             // no database at all behind it
    expect(() => askForCopiesAhead({
      clientId: 'c1', slides: [videoSlide], channels: ['acc-ig'],
    })).not.toThrow()
    await settle()
    expect(sent).toEqual([])
    fake = seed()
  })
})

/* ── the save paths ─────────────────────────────────────────────────────── */

/**
 * Every place a post's media or channels are written asks for the copies.
 *
 * Read off the source rather than driven through four route tests: what is
 * being pinned is that no save path is left out, and a fifth one added next
 * month fails this rather than quietly posting late.
 */
describe('every save path asks', () => {
  it('the post insert, the composer edit and a media change all call it', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/lib/social-schedule.ts', 'utf8')
    const bodies = ['insertPost', 'updatePost', 'claimPostSlides']
    for (const name of bodies) {
      const at = src.indexOf(`function ${name}(`)
      expect(at, `${name} is gone — the wiring moved`).toBeGreaterThan(-1)
      const next = bodies
        .map(other => (other === name ? -1 : src.indexOf(`function ${other}(`)))
        .filter(i => i > at)
      const body = src.slice(at, Math.min(...[...next, src.length]))
      expect(body, `${name} no longer asks for the copies`).toContain('askForCopiesAhead(')
    }
  })
})
