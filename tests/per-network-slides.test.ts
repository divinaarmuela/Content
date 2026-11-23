import { describe, expect, it } from 'vitest'
import { validateComposition } from '../app/lib/social-schedule-core'

/**
 * EACH NETWORK AGAINST ITS OWN PICTURES (28 Sep 2026): Jordan's 14 slides — Instagram takes ten through the API,
 * LinkedIn all fourteen. A post giving Instagram its own ten must not be refused for the fourteen it is not sending.
 */
const img = (i: number) => ({ url: `https://media.mdmmarketing.com.au/${i}.png`, type: 'image' as const })
const fourteen = Array.from({ length: 24 }, (_, i) => img(i))
const base = { item: null, version: null, caption: 'Where it started.', now: '2026-09-28T11:00:00Z', saving: true, withoutApproval: true }

describe('per-network slides', () => {
  it('fourteen for everyone: Instagram refuses, and says why', () => {
    const r = validateComposition({ ...base, slides: fourteen, channels: [{ platform: 'instagram' }, { platform: 'tiktok' }] } as never)
    expect(r.problems).toContain('Instagram takes 20 media files — take 4 out')
  })
  it('Instagram given its own ten, LinkedIn the fourteen: nothing to refuse', () => {
    const r = validateComposition({ ...base, slides: fourteen, channels: [{ platform: 'instagram', slides: fourteen.slice(0, 20) }, { platform: 'tiktok' }] } as never)
    expect(r.problems.filter(p => /media files/.test(p))).toEqual([])
  })
  it('LinkedIn alone takes the fourteen', () => {
    const r = validateComposition({ ...base, slides: fourteen, channels: [{ platform: 'tiktok' }] } as never)
    expect(r.problems.filter(p => /media files/.test(p))).toEqual([])
  })

  // 23 Nov 2026: found by posting. 90 s went out; 2 min 50 s was refused with "couldn't download your video".
  const vid = (seconds?: number) => ({ url: `https://media.mdmmarketing.com.au/v${seconds}.mp4`, name: 'Script 2.mp4', type: 'video' as const, ...(seconds ? { seconds } : {}) })
  const LONG = 'Instagram takes videos up to 90 seconds inside a carousel — "Script 2.mp4" is 2 min 50 s. Post that video on its own (it goes out as a Reel), or trim it.'
  it('a long video inside an Instagram carousel is stopped, with what to do', () => {
    const r = validateComposition({ ...base, slides: [vid(170), img(1)], channels: [{ platform: 'instagram' }] } as never)
    expect(r.problems).toContain(LONG)
  })
  it('ninety seconds is fine; a video of unknown length is not guessed at', () => {
    for (const v of [vid(90), vid(45), vid()]) {
      const r = validateComposition({ ...base, slides: [v, img(1)], channels: [{ platform: 'instagram' }] } as never)
      expect(r.problems.filter(p => /inside a carousel/.test(p))).toEqual([])
    }
  })
  it('the same long video on its own is a Reel, and as Stories goes out one by one: neither is stopped', () => {
    const alone = validateComposition({ ...base, slides: [vid(170)], channels: [{ platform: 'instagram' }] } as never)
    expect(alone.problems.filter(p => /inside a carousel/.test(p))).toEqual([])
    const story = validateComposition({ ...base, slides: [vid(170), img(1)], channels: [{ platform: 'instagram', kind: 'story' }] } as never)
    expect(story.problems.filter(p => /inside a carousel/.test(p))).toEqual([])
  })
  it('it is the Instagram rule only, and reads the files Instagram is actually given', () => {
    const tt = validateComposition({ ...base, slides: [vid(170)], channels: [{ platform: 'tiktok' }] } as never)
    expect(tt.problems.filter(p => /inside a carousel/.test(p))).toEqual([])
    const own = validateComposition({ ...base, slides: [vid(170), img(1)], channels: [{ platform: 'instagram', slides: [img(1), img(2)] }] } as never)
    expect(own.problems.filter(p => /inside a carousel/.test(p))).toEqual([])
  })
})
