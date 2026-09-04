import { describe, expect, it } from 'vitest'
import { isPrivateHost, parseJob, sourceUrlProblem } from '../src/request.js'
import type { EncodeTarget } from '../src/ladder.js'

/**
 * What this machine will and will not be talked into.
 *
 * Every rule here is a refusal, and a refusal that has never been run is a
 * hope. The one that matters most is the source host: with it pinned, a
 * request that got past the bearer token still cannot make this machine fetch
 * Fly's internal network or a cloud metadata endpoint on somebody's behalf.
 */

const target: EncodeTarget = {
  platform: 'instagram', maxMB: 300, maxSeconds: 90,
  maxrateKbps: 10_000, bufsizeKbps: 20_000, audioKbps: 160,
  longSide: 1920, shortSide: 1080, maxFps: 30,
}

const HOSTS = ['media.mdmmarketing.com.au']

const body = (over: Record<string, unknown> = {}) => ({
  jobId: 'abc123__instagram',
  sourceUrl: 'https://media.mdmmarketing.com.au/master.mp4',
  uploadUrl: 'https://acct.r2.cloudflarestorage.com/copy.mp4?X-Amz-Signature=x',
  callbackUrl: 'https://app.mdmmarketing.com.au/api/media/encode/callback',
  target,
  ...over,
})

const problem = (over: Record<string, unknown> = {}, hosts = HOSTS) => {
  const out = parseJob(body(over), hosts)
  return 'problem' in out ? out.problem : null
}

describe('a whole job description', () => {
  it('is accepted, and comes back as the four things the encoder needs', () => {
    const out = parseJob(body(), HOSTS)
    expect('job' in out).toBe(true)
    if (!('job' in out)) return
    expect(out.job.jobId).toBe('abc123__instagram')
    expect(out.job.target.maxrateKbps).toBe(10_000)
  })
})

describe('the source it will fetch', () => {
  it('must be on this workspace’s own file storage', () => {
    expect(problem({ sourceUrl: 'https://evil.example.com/x.mp4' }))
      .toBe('sourceUrl is not on this workspace’s file storage')
  })

  it('must be https, whatever the host', () => {
    expect(problem({ sourceUrl: 'http://media.mdmmarketing.com.au/x.mp4' }))
      .toBe('sourceUrl must be an https URL')
    expect(problem({ sourceUrl: 'file:///etc/passwd' })).toBe('sourceUrl must be an https URL')
    expect(problem({ sourceUrl: '' })).toBe('sourceUrl must be an https URL')
    expect(problem({ sourceUrl: 'not a url' })).toBe('sourceUrl must be an https URL')
  })

  it('with no host pinned, still refuses this machine’s own network', () => {
    for (const host of [
      '127.0.0.1', 'localhost', '10.0.0.5', '172.16.3.4', '192.168.1.1',
      '169.254.169.254', 'top1.nearest.of.mdm-encoder.internal', '[::1]',
    ]) {
      expect(sourceUrlProblem(`https://${host}/x.mp4`, []), host)
        .toBe('sourceUrl is not a public address')
    }
  })

  it('with no host pinned, allows an ordinary public one', () => {
    expect(sourceUrlProblem('https://media.mdmmarketing.com.au/x.mp4', [])).toBeNull()
    expect(sourceUrlProblem('https://8.8.8.8/x.mp4', [])).toBeNull()
  })

  it('knows a private address from a public one', () => {
    expect(isPrivateHost('172.15.0.1')).toBe(false)   // just outside the range
    expect(isPrivateHost('172.32.0.1')).toBe(false)   // just outside the other end
    expect(isPrivateHost('172.20.0.1')).toBe(true)
    expect(isPrivateHost('11.0.0.1')).toBe(false)
    expect(isPrivateHost('fd00::1')).toBe(true)
  })
})

describe('the rest of the description', () => {
  it('wants a plain job id', () => {
    expect(problem({ jobId: '' })).toBe('jobId is missing or not a plain id')
    expect(problem({ jobId: '../../etc/passwd' })).toBe('jobId is missing or not a plain id')
    expect(problem({ jobId: 'a'.repeat(200) })).toBe('jobId is missing or not a plain id')
  })

  it('wants both of the URLs it will write and report to', () => {
    expect(problem({ uploadUrl: 'http://x/y' })).toBe('uploadUrl must be an https URL')
    expect(problem({ uploadUrl: undefined })).toBe('uploadUrl must be an https URL')
    expect(problem({ callbackUrl: 'ftp://x/y' })).toBe('callbackUrl must be an https URL')
  })

  it('passes the target through the ladder’s own rules', () => {
    expect(problem({ target: undefined })).toBe('target is missing')
    expect(problem({ target: { ...target, maxrateKbps: 0 } }))
      .toBe('target.maxrateKbps must be a positive number')
    // a ladder that would overrun the channel it is for is refused here too
    expect(problem({ target: { ...target, maxrateKbps: 40_000 } })).toMatch(/over the 300 MB/)
  })

  it('refuses nothing at all', () => {
    expect(parseJob(null, HOSTS)).toEqual({ problem: 'jobId is missing or not a plain id' })
  })
})
