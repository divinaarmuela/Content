import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLIENT_PREVIEW_FIELDS, PREVIEW_SPECS, POST_KIND_WORD,
  buildPostPreview, clientPreviews, firstLinkIn, foldCaption, forClient,
  previewAspect, previewKind, previewPlatform, previewSpecFor, tabTone,
} from '@/app/lib/post-preview-core'
import {
  PLATFORM_RULES, SUPPORTED_PLATFORMS, type Platform, type PostKind,
} from '@/app/lib/publish-core'

/**
 * SEEING THE POST BEFORE ANYBODY ELSE DOES.
 *
 * The whole point of the preview is that nobody has to imagine the post, so
 * the thing under test is whether the description handed to the frame is the
 * truth: the network's crop, the network's fold, the network's furniture —
 * and the publisher's own refusals, never a second set invented here.
 */

const image = (n: string) => ({ url: `https://files.example.invalid/${n}.jpg`, type: 'image' as const, name: n })
const video = (n: string) => ({ url: `https://files.example.invalid/${n}.mp4`, type: 'video' as const, name: n })

const channel = (platform: string, over: Record<string, unknown> = {}) => ({
  id: `acc-${platform}`,
  platform,
  handle: `the${platform}`,
  name: `The ${platform} account`,
  avatarUrl: null,
  ...over,
})

/* ── the table itself ───────────────────────────────────────────────────── */

describe('the one table covers every network that can be posted to', () => {
  it('a network the publisher accepts has a frame to draw it in', () => {
    for (const p of SUPPORTED_PLATFORMS) {
      expect(PREVIEW_SPECS[p], `no frame for ${p}`).toBeTruthy()
    }
  })

  it('and no frame exists for a network the publisher does not have', () => {
    for (const key of Object.keys(PREVIEW_SPECS)) {
      expect(PLATFORM_RULES[key as Platform], `${key} has a frame but no rules`).toBeTruthy()
    }
  })

  it('every post type has a shape and a fold on every network', () => {
    const kinds: PostKind[] = ['feed', 'reel', 'story', 'carousel']
    for (const p of SUPPORTED_PLATFORMS) {
      for (const k of kinds) {
        expect(PREVIEW_SPECS[p].aspect[k], `${p}/${k} aspect`).toMatch(/^[\d.]+ \/ [\d.]+$/)
        expect(typeof PREVIEW_SPECS[p].fold[k], `${p}/${k} fold`).toBe('number')
        expect(PREVIEW_SPECS[p].fold[k]).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('the crops are the ones each network actually uses', () => {
    expect(previewAspect('instagram', 'feed')).toBe('4 / 5')
    expect(previewAspect('instagram', 'reel')).toBe('9 / 16')
    expect(previewAspect('instagram', 'story')).toBe('9 / 16')
    expect(previewAspect('instagram', 'carousel')).toBe('1 / 1')
    expect(previewAspect('tiktok', 'feed')).toBe('9 / 16')
    expect(previewAspect('linkedin', 'feed')).toBe('1.91 / 1')
    expect(previewAspect('facebook', 'feed')).toBe('1.91 / 1')
    expect(previewAspect('youtube', 'reel')).toBe('9 / 16')
    expect(previewAspect('youtube', 'feed')).toBe('16 / 9')
  })

  it('"X" and "twitter" are the same network, not two', () => {
    expect(previewPlatform('x')).toBe('twitter')
    expect(previewPlatform('X')).toBe('twitter')
    expect(previewSpecFor('x')).toBe(PREVIEW_SPECS.twitter)
  })

  it('a network we have never heard of gets no frame rather than a wrong one', () => {
    expect(previewPlatform('myspace')).toBeNull()
    expect(previewSpecFor('myspace')).toBeNull()
    // …and the caller still gets a shape it can put in a style attribute
    expect(previewAspect('myspace', 'feed')).toBe('1 / 1')
  })

  it('one spelling for every post type', () => {
    expect(POST_KIND_WORD.reel).toBe('Reel')
    expect(POST_KIND_WORD.story).toBe('Story')
    expect(POST_KIND_WORD.carousel).toBe('Carousel')
    expect(POST_KIND_WORD.feed).toBe('Feed post')
  })
})

/* ── the fold ───────────────────────────────────────────────────────────── */

describe('the caption folds where the network folds it', () => {
  it('leaves a short caption whole', () => {
    const f = foldCaption('Three words here', 125)
    expect(f.folded).toBe(false)
    expect(f.shown).toBe('Three words here')
    expect(f.rest).toBe('')
  })

  it('folds a long one and keeps the rest', () => {
    const body = 'a'.repeat(40) + ' ' + 'b'.repeat(200)
    const f = foldCaption(body, 125)
    expect(f.folded).toBe(true)
    expect(f.shown.length).toBeLessThanOrEqual(125)
    // nothing is lost — the two halves still hold every letter of it
    expect((f.shown + f.rest).replace(/\s+/g, '')).toBe(body.replace(/\s+/g, ''))
  })

  it('breaks on a word, never mid-word', () => {
    const body = 'the quick brown fox jumps over the lazy dog and keeps going for ever'
    const f = foldCaption(body, 20)
    expect(f.folded).toBe(true)
    expect(f.shown).toBe('the quick brown fox')
    expect(f.rest.startsWith('jumps')).toBe(true)
  })

  it('cuts a single enormous word rather than showing nothing', () => {
    const f = foldCaption('#' + 'x'.repeat(300), 90)
    expect(f.shown.length).toBe(90)
    expect(f.folded).toBe(true)
  })

  it('a fold of nought means the network shows no writing at all', () => {
    const f = foldCaption('Words nobody will read', 0)
    expect(f.shown).toBe('')
    expect(f.rest).toBe('Words nobody will read')
    expect(f.folded).toBe(true)
  })

  it('…and nought with nothing written folds nothing', () => {
    expect(foldCaption('', 0).folded).toBe(false)
  })

  it('carries the network\'s own word for the fold', () => {
    expect(foldCaption('x'.repeat(400), 210, '…see more').more).toBe('…see more')
  })
})

describe('a link in the words', () => {
  it('finds the first one', () => {
    expect(firstLinkIn('Read it at https://example.invalid/a and https://example.invalid/b'))
      .toBe('https://example.invalid/a')
  })
  it('finds none when there is none', () => {
    expect(firstLinkIn('no links here')).toBeNull()
    expect(firstLinkIn(null)).toBeNull()
  })
  it('does not swallow the punctuation after it', () => {
    expect(firstLinkIn('see (https://example.invalid/x) now')).toBe('https://example.invalid/x')
  })
})

/* ── the post type ──────────────────────────────────────────────────────── */

describe('what the network will actually publish', () => {
  it('takes the chosen type when somebody chose one', () => {
    expect(previewKind('instagram', { kind: 'story' }, [image('a')])).toBe('story')
  })

  it('works it out the way the publisher does when nobody chose', () => {
    expect(previewKind('instagram', {}, [image('a'), image('b')])).toBe('carousel')
    expect(previewKind('instagram', {}, [video('a')])).toBe('reel')
    expect(previewKind('instagram', {}, [image('a')])).toBe('feed')
    // YouTube has no carousel — the guess is clamped to what it has
    expect(previewKind('youtube', {}, [video('a'), video('b')])).not.toBe('carousel')
  })
})

/* ── the whole preview ──────────────────────────────────────────────────── */

describe('the post, as each network will show it', () => {
  const base = {
    caption: 'Something short and sweet.',
    media: [image('one'), image('two')],
  }

  it('makes one frame per channel, in the order they were chosen', () => {
    const p = buildPostPreview({
      ...base, channels: [channel('instagram'), channel('linkedin')],
    })
    expect(p.networks.map(n => n.platform)).toEqual(['instagram', 'linkedin'])
    expect(p.networks[0].network).toBe('Instagram')
    expect(p.networks[1].network).toBe('LinkedIn')
  })

  it('nothing to look at when no channel is chosen', () => {
    expect(buildPostPreview({ ...base, channels: [] })).toEqual({ networks: [], problems: [] })
  })

  it('draws the handle with an at-sign, and falls back to the name', () => {
    const p = buildPostPreview({ ...base, channels: [
      channel('instagram', { handle: 'mdmedia' }),
      channel('linkedin', { handle: null, name: 'MD Media' }),
    ] })
    expect(p.networks[0].handle).toBe('@mdmedia')
    expect(p.networks[1].handle).toBe('MD Media')
  })

  it('never doubles an at-sign somebody already typed', () => {
    const p = buildPostPreview({ ...base, channels: [channel('instagram', { handle: '@mdmedia' })] })
    expect(p.networks[0].handle).toBe('@mdmedia')
  })

  it('folds the caption with THIS network\'s fold', () => {
    const long = 'word '.repeat(80).trim()
    const p = buildPostPreview({ caption: long, media: [image('a')], channels: [
      channel('instagram'), channel('linkedin'),
    ] })
    const ig = p.networks[0].caption!
    const li = p.networks[1].caption!
    expect(ig.folded).toBe(true)
    expect(li.folded).toBe(true)
    // LinkedIn shows more of it than Instagram does
    expect(li.shown.length).toBeGreaterThan(ig.shown.length)
    expect(li.more).toBe('…see more')
  })

  it('a Story shows no writing, and says so', () => {
    const p = buildPostPreview({
      caption: 'These words will never appear.',
      media: [image('a')],
      channels: [channel('instagram', { options: { kind: 'story' } })],
    })
    const n = p.networks[0]
    expect(n.kind).toBe('story')
    expect(n.caption!.shown).toBe('')
    expect(n.notes.join(' ')).toMatch(/no writing on a Story/i)
  })

  it('dots only where the network has them and there is more than one slide', () => {
    const many = buildPostPreview({ ...base, channels: [channel('instagram'), channel('youtube')] })
    expect(many.networks[0].dots).toBe(true)
    // YouTube has no carousel and draws no dots
    expect(many.networks[1].dots).toBe(false)
    const one = buildPostPreview({
      caption: 'x', media: [image('a')], channels: [channel('instagram')],
    })
    expect(one.networks[0].dots).toBe(false)
  })

  it('shows the first comment only where the network has one', () => {
    const p = buildPostPreview({
      ...base,
      channels: [
        channel('instagram', { options: { firstComment: '#hashtags' } }),
        channel('tiktok', { options: { firstComment: '#hashtags', tiktokConsent: true } }),
      ],
    })
    expect(p.networks[0].firstComment).toBe('#hashtags')
    // TikTok has no first comment in the provider's fields, so none is drawn
    expect(p.networks[1].firstComment).toBeNull()
  })

  it('shows a place by NAME, never by the page id', () => {
    const p = buildPostPreview({
      ...base,
      channels: [channel('instagram', {
        options: { locationId: '1234567890' }, placeName: 'Fitzroy studio',
      })],
    })
    expect(p.networks[0].place).toBe('Fitzroy studio')
    const noName = buildPostPreview({
      ...base,
      channels: [channel('instagram', { options: { locationId: '1234567890' } })],
    })
    expect(noName.networks[0].place).toBeNull()
  })

  it('draws a link card only where the network has one, and not when it is turned off', () => {
    const words = 'Read it: https://example.invalid/story'
    const p = buildPostPreview({
      caption: words,
      media: [image('a')],
      channels: [
        channel('linkedin'),
        channel('instagram'),
        channel('linkedin2', { platform: 'linkedin', options: { disableLinkPreview: true } }),
      ],
    })
    expect(p.networks[0].link).toBe('https://example.invalid/story')
    // Instagram does not draw a link card at all
    expect(p.networks[1].link).toBeNull()
    expect(p.networks[2].link).toBeNull()
  })

  it('a channel with its own words is previewed on its own words', () => {
    const p = buildPostPreview({
      caption: 'The shared caption',
      media: [image('a')],
      channels: [
        channel('instagram'),
        channel('twitter', { options: { caption: 'Short one for X' } }),
      ],
    })
    expect(p.networks[0].caption!.shown).toBe('The shared caption')
    expect(p.networks[1].caption!.shown).toBe('Short one for X')
  })

  it('a channel with its own media is previewed on its own media', () => {
    const p = buildPostPreview({
      caption: 'x',
      media: [image('shared')],
      channels: [
        channel('instagram'),
        channel('youtube', { media: [video('long-cut')], options: { title: 'A title' } }),
      ],
    })
    expect(p.networks[0].media[0].url).toContain('shared')
    expect(p.networks[1].media[0].url).toContain('long-cut')
    expect(p.networks[1].slides).toBe(1)
  })

  it('shows a headline only where the network has one', () => {
    const p = buildPostPreview({
      caption: 'x',
      media: [video('a')],
      channels: [
        channel('youtube', { options: { title: 'How we shot it' } }),
        channel('instagram', { options: { title: 'How we shot it' } }),
      ],
    })
    expect(p.networks[0].title).toBe('How we shot it')
    // Instagram has no headline — drawing one would be inventing a field
    expect(p.networks[1].title).toBeNull()
  })
})

/* ── the refusals ───────────────────────────────────────────────────────── */

describe('it invents no rules — every refusal is the publisher\'s own', () => {
  it('a caption over the network\'s limit lands on that network\'s frame', () => {
    const p = buildPostPreview({
      caption: 'x'.repeat(400),
      media: [image('a')],
      channels: [channel('twitter'), channel('linkedin')],
    })
    const x = p.networks.find(n => n.platform === 'twitter')!
    const li = p.networks.find(n => n.platform === 'linkedin')!
    expect(x.problems.join(' ')).toMatch(/280/)
    // LinkedIn takes 3,000 — the same caption is fine there
    expect(li.problems).toEqual([])
  })

  it('eleven pictures on Instagram is refused, in the publisher\'s words', () => {
    const p = buildPostPreview({
      caption: 'x',
      media: Array.from({ length: 11 }, (_, i) => image(`s${i}`)),
      channels: [channel('instagram')],
    })
    expect(p.networks[0].problems.join(' ')).toMatch(/11 .*(images|slides)/)
  })

  it('a Reel made of photographs is refused', () => {
    const p = buildPostPreview({
      caption: 'x',
      media: [image('a')],
      channels: [channel('instagram', { options: { kind: 'reel' } })],
    })
    expect(p.networks[0].problems.join(' ')).toMatch(/Reel needs exactly one video/i)
  })

  it('TikTok without the tick is refused, and the tick clears it', () => {
    const without = buildPostPreview({
      caption: 'x', media: [video('a')], channels: [channel('tiktok')],
    })
    expect(without.networks[0].problems.join(' ')).toMatch(/tick/i)
    const withIt = buildPostPreview({
      caption: 'x', media: [video('a')],
      channels: [channel('tiktok', { options: { tiktokConsent: true } })],
    })
    expect(withIt.networks[0].problems).toEqual([])
  })

  it('two channels on one network is refused rather than half-sent', () => {
    const p = buildPostPreview({
      caption: 'x', media: [image('a')],
      channels: [channel('instagram'), channel('instagram2', { platform: 'instagram' })],
    })
    expect(p.problems.join(' ')).toMatch(/Two Instagram channels/)
  })

  it('a clean post has nothing wrong with it anywhere', () => {
    const p = buildPostPreview({
      caption: 'A good caption.',
      media: [image('a'), image('b')],
      channels: [channel('instagram'), channel('linkedin')],
    })
    expect(p.problems).toEqual([])
    expect(p.networks.every(n => n.problems.length === 0)).toBe(true)
  })

  it('the tab says which network is the unhappy one', () => {
    const p = buildPostPreview({
      caption: 'x'.repeat(400),
      media: [image('a')],
      channels: [channel('twitter'), channel('linkedin')],
    })
    expect(tabTone(p.networks[0])).toBe('problem')
    expect(tabTone(p.networks[1])).toBe('ok')
  })

  it('says so plainly when a words-only network has no picture', () => {
    const p = buildPostPreview({
      caption: 'Words alone.', media: [], channels: [channel('linkedin')],
    })
    expect(p.networks[0].notes.join(' ')).toMatch(/words alone/i)
  })
})

/* ── the client's copy ──────────────────────────────────────────────────── */

describe('nothing internal reaches the client', () => {
  const built = buildPostPreview({
    caption: 'x'.repeat(400),
    media: [image('a')],
    channels: [channel('twitter')],
  })

  it('the client\'s copy carries exactly the listed fields', () => {
    const one = forClient(built.networks[0])
    expect(Object.keys(one).sort()).toEqual([...CLIENT_PREVIEW_FIELDS].sort())
  })

  it('the account id, the refusals and the notes are gone', () => {
    const one = forClient(built.networks[0]) as Record<string, unknown>
    expect('accountId' in one).toBe(false)
    expect('problems' in one).toBe(false)
    expect('notes' in one).toBe(false)
    // and nothing internal survived a round trip through JSON either
    expect(JSON.stringify(one)).not.toContain('acc-twitter')
  })

  it('but everything the client needs to recognise the post is there', () => {
    const one = forClient(built.networks[0])
    expect(one.network).toBe('X')
    expect(one.handle).toBe('@thetwitter')
    expect(one.aspect).toBe('16 / 9')
    expect(one.media).toHaveLength(1)
    expect(one.caption?.shown).toBeTruthy()
  })

  it('clientPreviews strips every frame, not just the first', () => {
    const many = buildPostPreview({
      caption: 'x', media: [image('a')],
      channels: [channel('instagram'), channel('linkedin')],
    })
    for (const one of clientPreviews(many)) {
      expect(Object.keys(one).sort()).toEqual([...CLIENT_PREVIEW_FIELDS].sort())
    }
  })
})

/* ── the wiring, read off the source ────────────────────────────────────── */

describe('the composer previews the post it is about to send', () => {
  const src = readFileSync(
    join(process.cwd(), 'app/dashboard/social/schedule/NewPostDialog.tsx'), 'utf8')

  it('builds the preview from the composer\'s own state, not a copy', () => {
    const start = src.indexOf('buildPostPreview({')
    expect(start).toBeGreaterThan(0)
    const call = src.slice(start, src.indexOf('}), [', start))
    expect(call).toContain('caption: state.caption')
    expect(call).toContain('state.slides.map')
    expect(call).toContain('state.perChannel[a.id]')
    expect(call).toContain('chosen.map')
  })

  it('re-reads it whenever any of those change', () => {
    const deps = src.slice(src.indexOf('}), [state.slides, state.caption')).slice(0, 140)
    for (const dep of ['state.slides', 'state.caption', 'state.perChannel', 'chosen']) {
      expect(deps, `the preview must follow ${dep}`).toContain(dep)
    }
  })

  it('keeps no second copy of the caption or the media for the preview', () => {
    // a useState holding slides or a caption beside the reducer is exactly how
    // a preview starts telling a different story from the post
    expect(src).not.toMatch(/useState[^\n]*previewCaption/)
    expect(src).not.toMatch(/useState[^\n]*previewSlides/)
  })

  it('sends for review through the approval that already exists', () => {
    expect(src).toContain('/send')
    expect(src).toContain("mode: what === 'direct' ? 'direct' : 'approval'")
    expect(src).toContain('client_too: clientSignsOff')
    // and answers through the item's own posting-approval route
    expect(src).toContain('/posting-approval')
  })
})

describe('the portal is handed the stripped copy and nothing else', () => {
  const portal = readFileSync(join(process.cwd(), 'app/lib/portal-data.ts'), 'utf8')
  const card = readFileSync(
    join(process.cwd(), 'app/components/portal/PortalPostApproval.tsx'), 'utf8')

  it('portal-data puts every preview through clientPreviews', () => {
    expect(portal).toContain('clientPreviews(built)')
    // the raw frames must never be assigned straight onto a portal item
    expect(portal).not.toMatch(/preview:\s*built\.networks/)
  })

  it('the client\'s card acts on the routes that already existed', () => {
    expect(card).toContain('/api/portal/act')
    expect(card).toContain('approve_post')
    expect(card).toContain('request_post_changes')
    expect(card).toContain('/posting-approval')
  })

  it('the client\'s card never prints a refusal', () => {
    expect(card).not.toContain('.problems')
  })
})
