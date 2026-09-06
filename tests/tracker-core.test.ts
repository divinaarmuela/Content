import { describe, it, expect } from 'vitest'
import { buildDestUrl, mintCode, zernioEventToAsset } from '../app/lib/tracker-core'

describe('mintCode', () => {
  it('is deterministic for given randoms and uses only the safe alphabet', () => {
    const code = mintCode([0.1, 0.5, 0.9], 7)
    expect(code).toHaveLength(7)
    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]+$/)
    expect(mintCode([0.1, 0.5, 0.9], 7)).toBe(code)
  })

  it('never emits ambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = mintCode([i / 50, (i * 7 % 50) / 50], 10)
      expect(code).not.toMatch(/[01oli]/)
    }
  })
})

describe('buildDestUrl', () => {
  it('appends the asset and click identity, preserving existing params', () => {
    const url = buildDestUrl('https://turnkeybuilt.com.au/contact?ref=x', 'kj3m9ab', 'clk_1')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('ref')).toBe('x')
    expect(parsed.searchParams.get('utm_source')).toBe('mdmedia')
    expect(parsed.searchParams.get('utm_content')).toBe('kj3m9ab')
    expect(parsed.searchParams.get('mdm_click')).toBe('clk_1')
  })

  it('upgrades a bare domain', () => {
    expect(buildDestUrl('turnkeybuilt.com.au', 's', 'c')).toContain('https://turnkeybuilt.com.au')
  })
})

describe('zernioEventToAsset', () => {
  const payload = {
    id: 'post_abc',
    caption: 'Kitchen reno walkthrough ✨\nFull story on our site',
    platforms: [{ platform: 'instagram', platformPostUrl: 'https://instagram.com/p/xyz' }],
    publishedAt: '2026-08-18T09:00:00Z',
  }

  it('maps a published post to a registrable asset', () => {
    const asset = zernioEventToAsset('post.published', payload)
    expect(asset).toEqual({
      providerPostId: 'post_abc',
      title: 'Kitchen reno walkthrough ✨',
      platform: 'instagram',
      postUrl: 'https://instagram.com/p/xyz',
      source: 'published',
      publishedAt: '2026-08-18T09:00:00Z',
    })
  })

  it('marks externally-published posts as external', () => {
    expect(zernioEventToAsset('post.external.created', payload)?.source).toBe('external')
  })

  it('ignores non-post and failure events', () => {
    expect(zernioEventToAsset('post.failed', payload)).toBeNull()
    expect(zernioEventToAsset('comment.received', payload)).toBeNull()
    expect(zernioEventToAsset('account.disconnected', payload)).toBeNull()
  })

  it('refuses an event with no post id and survives a sparse payload', () => {
    expect(zernioEventToAsset('post.published', {})).toBeNull()
    const sparse = zernioEventToAsset('post.published', { id: 'p1' })
    expect(sparse?.title).toBe('Untitled post')
    expect(sparse?.platform).toBeNull()
  })
})
