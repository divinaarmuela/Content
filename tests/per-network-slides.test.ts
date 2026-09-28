import { describe, expect, it } from 'vitest'
import { validateComposition } from '../app/lib/social-schedule-core'

/**
 * EACH NETWORK AGAINST ITS OWN PICTURES (28 Sep 2026): Jordan's 14 slides — Instagram takes ten through the API,
 * LinkedIn all fourteen. A post giving Instagram its own ten must not be refused for the fourteen it is not sending.
 */
const img = (i: number) => ({ url: `https://media.mdmmarketing.com.au/${i}.png`, type: 'image' as const })
const fourteen = Array.from({ length: 14 }, (_, i) => img(i))
const base = { item: null, version: null, caption: 'Where it started.', now: '2026-09-28T11:00:00Z', saving: true, withoutApproval: true }

describe('per-network slides', () => {
  it('fourteen for everyone: Instagram refuses, and says why', () => {
    const r = validateComposition({ ...base, slides: fourteen, channels: [{ platform: 'instagram' }, { platform: 'linkedin' }] } as never)
    expect(r.problems).toContain('Instagram takes 10 media files — take 4 out')
  })
  it('Instagram given its own ten, LinkedIn the fourteen: nothing to refuse', () => {
    const r = validateComposition({ ...base, slides: fourteen, channels: [{ platform: 'instagram', slides: fourteen.slice(0, 10) }, { platform: 'linkedin' }] } as never)
    expect(r.problems.filter(p => /media files/.test(p))).toEqual([])
  })
  it('LinkedIn alone takes the fourteen', () => {
    const r = validateComposition({ ...base, slides: fourteen, channels: [{ platform: 'linkedin' }] } as never)
    expect(r.problems.filter(p => /media files/.test(p))).toEqual([])
  })
})
