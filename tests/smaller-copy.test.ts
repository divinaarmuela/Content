import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * `smallerCopyOf`: which copy a channel gets, and what a person is told.
 *
 * This is a decision table, and it is worth writing out because the wrong
 * branch is invisible until a client sees mushy footage. Three inputs:
 *
 *   a publish-grade copy already exists    → use it
 *   no copy, and an encoder is configured  → ask for one, say "a few minutes"
 *   no encoder configured                  → Cloudflare Stream's player file,
 *                                            which is the OLD behaviour and is
 *                                            worse; it stays only so a
 *                                            workspace with no encoder does
 *                                            not simply lose the feature
 *
 * Nothing here reaches the network: Cloudflare is stubbed and the Inngest
 * client records the event instead of sending it.
 */

let sent: { name: string; data: Record<string, unknown> }[] = []
vi.mock('../app/inngest/client', () => ({
  inngest: { send: async (e: { name: string; data: Record<string, unknown> }) => { sent.push(e) } },
}))

vi.mock('../app/lib/storage', async () => {
  const real = await vi.importActual<typeof import('../app/lib/storage')>('../app/lib/storage')
  return { ...real, publicBase: () => 'https://media.example.com' }
})

/** Everything Cloudflare was asked. Empty is the assertion that matters most. */
let cfCalls: string[] = []
vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  cfCalls.push(`${init?.method ?? 'GET'} ${url}`)
  if (url.includes('/downloads')) {
    return new Response(JSON.stringify({
      success: true,
      result: { default: { status: 'ready', url: 'https://cf.example.com/player.mp4' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ success: true, result: null }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})

const { smallerCopyOf } = await import('../app/lib/stream')

const SOURCE = 'https://media.example.com/master.mp4'
/** sha256(SOURCE).slice(0,32) + '__instagram' — computed the way the code does. */
const { encodeJobId } = await import('../app/lib/encode-jobs')
const JOB_ID = encodeJobId(SOURCE, 'instagram')

const encodeJob = (over: Record<string, unknown>): Row => ({
  id: JOB_ID,
  source_url: SOURCE,
  platform: 'instagram',
  status: 'queued',
  output_key: null,
  bytes: null, width: null, height: null, duration_sec: null, video_kbps: null,
  error: null,
  asset_id: null, version_id: null, slide_index: null,
  created_at: '2026-09-03T00:00:00.000Z',
  updated_at: '2026-09-03T00:00:00.000Z',
  ...over,
} as unknown as Row)

const preview = (over: Record<string, unknown> = {}): Row => ({
  id: 'p1',
  source_url: SOURCE,
  stream_uid: 'deadbeef',
  state: 'ready',
  error: null,
  width: 1080, height: 1920, duration_sec: 20,
  created_at: '2026-09-03T00:00:00.000Z',
  updated_at: '2026-09-03T00:00:00.000Z',
  ...over,
} as unknown as Row)

let fake: ReturnType<typeof seedDb>
const withEncoder = () => {
  process.env.ENCODER_URL = 'https://encoder.example.com'
  process.env.ENCODER_TOKEN = 'token'
}

beforeEach(() => {
  sent = []
  cfCalls = []
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
  process.env.CLOUDFLARE_STREAM_TOKEN = 'cf-token'
})
afterEach(() => {
  fake?.restore()
  delete process.env.ENCODER_URL
  delete process.env.ENCODER_TOKEN
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  delete process.env.CLOUDFLARE_STREAM_TOKEN
})

describe('when a publish-grade copy already exists', () => {
  it('hands it back, and asks nobody for anything', async () => {
    withEncoder()
    fake = seedDb({
      encode_jobs: [encodeJob({
        status: 'done', output_key: 'copy-instagram.mp4',
        bytes: 24_917_504, width: 1080, height: 1920, duration_sec: 20,
      })],
    })
    expect(await smallerCopyOf(SOURCE, 'instagram')).toEqual({
      status: 'ready',
      url: 'https://media.example.com/copy-instagram.mp4',
      bytes: 24_917_504,
      width: 1080,
      height: 1920,
      seconds: 20,
    })
    expect(sent).toEqual([])
    expect(cfCalls).toEqual([])
  })

  it('reports a copy that failed, in the words the row holds', async () => {
    withEncoder()
    fake = seedDb({ encode_jobs: [encodeJob({ status: 'failed', error: 'the source has no video in it' })] })
    expect(await smallerCopyOf(SOURCE, 'instagram'))
      .toEqual({ status: 'failed', reason: 'the source has no video in it' })
    expect(sent).toEqual([])
  })

  it('waits, in plain words, while one is being made', async () => {
    withEncoder()
    fake = seedDb({ encode_jobs: [encodeJob({ status: 'running' })] })
    expect(await smallerCopyOf(SOURCE, 'instagram')).toEqual({
      status: 'encoding',
      percent: null,
      note: 'Making a clean copy for Instagram — usually a few minutes',
    })
    // …and does not ask for a second encode of a copy already under way
    expect(sent).toEqual([])
  })
})

describe('when there is no copy yet and an encoder is configured', () => {
  beforeEach(() => {
    withEncoder()
    fake = seedDb({ encode_jobs: [] })
  })

  it('asks for one and says how long it usually takes', async () => {
    expect(await smallerCopyOf(SOURCE, 'tiktok')).toEqual({
      status: 'encoding',
      percent: null,
      note: 'Making a clean copy for TikTok — usually a few minutes',
    })
    expect(sent).toEqual([{
      name: 'media/encode',
      data: { sourceUrl: SOURCE, platform: 'tiktok', kind: null, seconds: null },
    }])
  })

  it('carries the channel’s kind and the clip’s length into the ask', async () => {
    await smallerCopyOf(SOURCE, 'instagram', 'reel', 20)
    expect(sent[0].data).toEqual({ sourceUrl: SOURCE, platform: 'instagram', kind: 'reel', seconds: 20 })
  })

  it('never substitutes the player file — Cloudflare is not asked at all', async () => {
    await smallerCopyOf(SOURCE, 'instagram')
    expect(cfCalls).toEqual([])
  })
})

describe('when no encoder is configured', () => {
  it('falls back to the Stream player file, exactly as it did before', async () => {
    fake = seedDb({ video_previews: [preview()] })
    const state = await smallerCopyOf(SOURCE, 'instagram')
    expect(state).toMatchObject({ status: 'ready', url: 'https://cf.example.com/player.mp4' })
    // the old path, and the only path that talks to Cloudflare
    expect(cfCalls.some(c => c.includes('/downloads'))).toBe(true)
    expect(sent).toEqual([])
  })

  it('says so plainly when Stream is not set up either', async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID
    delete process.env.CLOUDFLARE_STREAM_TOKEN
    fake = seedDb({ video_previews: [] })
    expect(await smallerCopyOf(SOURCE, 'instagram'))
      .toEqual({ status: 'failed', reason: 'video encoding is not set up on this workspace' })
  })
})
