import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The test switch on the provider.
 *
 * Every route test in this repo that reaches a publish path would otherwise
 * have to mock `getPublisher` by hand, and the one time somebody forgets, a
 * test posts to a client's real Instagram. `PUBLISH_DRY_RUN=1` makes that
 * impossible from the inside: the provider itself answers with a fake id and
 * never opens a socket.
 *
 * The switch is deliberately exact — the string '1' and nothing else. A stray
 * 'true', 'yes' or '0' in a production environment must NOT silently stop the
 * agency's posts going out.
 */

const ENV = { ...process.env }
afterEach(() => {
  process.env = { ...ENV }
  vi.restoreAllMocks()
  vi.resetModules()
})

async function publisher() {
  vi.resetModules()
  const { getPublisher } = await import('../app/lib/publisher')
  return getPublisher()
}

const input = {
  caption: 'Hello',
  media: [{ url: 'https://media.mdmmarketing.com.au/a.jpg', type: 'image' as const }],
  targets: [{ platform: 'instagram' as const, accountId: 'acc-1' }],
  requestId: 'req-abc',
}

describe('PUBLISH_DRY_RUN', () => {
  it('never opens a socket and returns a deterministic fake id', async () => {
    process.env.PUBLISH_DRY_RUN = '1'
    process.env.ZERNIO_API_KEY = 'live-key-that-must-not-be-used'
    const spy = vi.spyOn(globalThis, 'fetch')

    const p = await publisher()
    expect(p.name).toBe('dry-run')
    const first = await p.createPost(input)
    const again = await p.createPost(input)

    expect(first).toEqual({ kind: 'published', postId: 'dry-run-req-abc', replayed: false })
    expect(again).toEqual(first)                 // same request id, same answer
    expect(spy).not.toHaveBeenCalled()
  })

  it('answers the account-health call the schedule flow makes, without a network hop', async () => {
    process.env.PUBLISH_DRY_RUN = '1'
    process.env.ZERNIO_API_KEY = 'live-key'
    const spy = vi.spyOn(globalThis, 'fetch')

    const p = await publisher()
    expect(await p.accountHealth('acc-1')).toEqual({ ok: true, accountId: 'acc-1', dryRun: true })
    expect(await p.deletePost('dry-run-req-abc')).toEqual({ ok: true, dryRun: true })
    expect(await p.uploadMedia({
      body: 'x', filename: 'a.jpg', contentType: 'image/jpeg', contentLength: 1,
    })).toEqual({ url: 'https://dry-run.invalid/a.jpg', type: 'image' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('is off unless the value is exactly "1"', async () => {
    process.env.ZERNIO_API_KEY = 'live-key'
    for (const value of ['0', 'true', 'yes', '', ' 1', '11']) {
      process.env.PUBLISH_DRY_RUN = value
      expect((await publisher()).name).toBe('zernio')
    }
    delete process.env.PUBLISH_DRY_RUN
    expect((await publisher()).name).toBe('zernio')
  })
})
