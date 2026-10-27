import { describe, expect, it } from 'vitest'
import { keepLive, liveLinkFromId, resultsFromRemote, type OutcomeJob } from '../app/lib/post-outcome-core'

describe('a live link built from the network\'s post id when the provider has none (27 Oct 2026, MGMT\'s 6 pm post)', () => {
  it('builds LinkedIn, Facebook, TikTok, YouTube and X links from their ids', () => {
    expect(liveLinkFromId('linkedin', 'urn:li:ugcPost:7520741542743941120')).toBe('https://www.linkedin.com/feed/update/urn:li:ugcPost:7520741542743941120/')
    expect(liveLinkFromId('facebook', '331459013380302_122229927902346970')).toBe('https://www.facebook.com/331459013380302/posts/122229927902346970')
    expect(liveLinkFromId('tiktok', '7701239255405710598', 'mgmt.aus', 'Carousel')).toBe('https://www.tiktok.com/@mgmt.aus/photo/7701239255405710598')
    expect(liveLinkFromId('tiktok', '7701239255405710598', '@mgmt.aus', 'Reel')).toBe('https://www.tiktok.com/@mgmt.aus/video/7701239255405710598')
    expect(liveLinkFromId('youtube', 'dQw4w9WgXcQ')).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(liveLinkFromId('twitter', '123', 'mdm')).toBe('https://x.com/mdm/status/123')
  })
  it('builds nothing it cannot be sure of', () => {
    expect(liveLinkFromId('instagram', '17965422162219196', 'mgmtaus')).toBeNull()
    expect(liveLinkFromId('tiktok', '7701239255405710598')).toBeNull()
    expect(liveLinkFromId('linkedin', 'not-a-urn')).toBeNull()
    expect(liveLinkFromId('facebook', '')).toBeNull()
  })
  it('a live channel with an id and no link gets the built link; one still waiting does not', () => {
    const job = { targets: [{ platform: 'linkedin' }, { platform: 'tiktok' }], media: [] } as unknown as OutcomeJob
    const out = resultsFromRemote(job, [
      { platform: 'linkedin', status: 'published', platformPostUrl: null, platformPostId: 'urn:li:share:1' },
      { platform: 'tiktok', status: 'processing', platformPostId: '9', accountUsername: 'a' },
    ], 'published', '2026-10-27T07:02:00Z')
    expect(out.find(o => o.platform === 'linkedin')?.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:1/')
    expect(out.find(o => o.platform === 'tiktok')?.url).toBeNull()
  })
  it('the provider\'s own link wins over a built one', () => {
    const job = { targets: [{ platform: 'facebook' }], media: [] } as unknown as OutcomeJob
    const [fb] = resultsFromRemote(job, [{ platform: 'facebook', status: 'published', platformPostUrl: 'https://www.facebook.com/x/posts/y', platformPostId: '1_2' }], 'published', 'now')
    expect(fb.url).toBe('https://www.facebook.com/x/posts/y')
  })
  it('a channel kept live from before takes a link that has arrived since, and keeps its own', () => {
    const stored = [{ platform: 'facebook', status: 'published', url: null }, { platform: 'linkedin', status: 'published', url: 'https://keep' }] as never[]
    const fresh = [{ platform: 'facebook', status: 'failed', url: 'https://new' }, { platform: 'linkedin', status: 'published', url: 'https://other' }] as never[]
    const out = keepLive(stored, fresh) as { platform: string; status: string; url: string | null }[]
    expect(out[0]).toMatchObject({ status: 'published', url: 'https://new' })
    expect(out[1].url).toBe('https://keep')
  })
})

describe('files picked together go in by name (27 Oct 2026, MGMT 351–354 went out as 352, 353, 354, 351)', () => {
  it('orders a Windows multi-pick by name, numbers as numbers', async () => {
    const { inNameOrder } = await import('../app/lib/schedule-upload-core')
    expect(inNameOrder([{ name: '352.png' }, { name: '353.png' }, { name: '354.png' }, { name: '351.png' }]).map(f => f.name)).toEqual(['351.png', '352.png', '353.png', '354.png'])
    expect(inNameOrder([{ name: 'Slide 10.png' }, { name: 'slide 2.png' }]).map(f => f.name)).toEqual(['slide 2.png', 'Slide 10.png'])
  })
})
