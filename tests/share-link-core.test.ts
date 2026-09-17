import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isShareToken, maySharePublicly, sharedFilesOf, sharePath, shareWords, SHAREABLE_STATUSES } from '../app/lib/share-link-core'

describe('share-link-core — the public link for the accepted version (17 Sep 2026)', () => {
  it('opens once the client has accepted, and not before', () => {
    expect(SHAREABLE_STATUSES).toEqual(['approved_for_scheduling', 'scheduled', 'published'])
    for (const s of SHAREABLE_STATUSES) expect(maySharePublicly({ status: s })).toBe(true)
    for (const s of ['draft_uploaded', 'quality_check', 'client_review', 'client_changes_requested', 'revision_required', '', null]) expect(maySharePublicly({ status: s })).toBe(false)
    expect(maySharePublicly(null)).toBe(false)
  })

  it('the acceptance stamp outlives the hand-over to a scheduler, and a send-back switches it off', () => {
    // handed to a scheduler: the status is Draft again for the posting job, the stamp says accepted
    expect(maySharePublicly({ status: 'draft_uploaded', accepted_at: '2026-09-17T05:37:00.000Z', accepted_round: 1 })).toBe(true)
    expect(maySharePublicly({ status: 'draft_uploaded', accepted_at: '2026-09-17T05:37:00.000Z', accepted_round: 2, edit_round: 2 })).toBe(true)
    // sent back after acceptance: round 2 opened, round 1 was the accepted one
    expect(maySharePublicly({ status: 'revision_required', accepted_at: '2026-09-17T05:37:00.000Z', accepted_round: 1, edit_round: 2 })).toBe(false)
    expect(maySharePublicly({ status: 'draft_uploaded', accepted_at: '', accepted_round: 1 })).toBe(false)
    // the transition writes the stamp beside the status
    const workflow = readFileSync('app/lib/workflow.ts', 'utf8')
    expect(workflow).toContain("...(to === 'approved_for_scheduling' ? { accepted_at: new Date().toISOString(), accepted_round: roundOf(item as never) } : {}),")
  })

  it('shares the current round only: uploaded files and finished copies, never the folder to work from, never an older version', () => {
    const item = {
      id: 'card', edit_round: 2,
      final_files: [
        { id: 'u1', name: 'v1.png', url: 'https://m/v1.png', mime: 'image/png', size: 10, version: 1, uploaded_at: 'x' },
        { id: 'u2', name: 'v2.png', url: 'https://m/v2.png', mime: 'image/png', size: 20, version: 2, uploaded_at: 'x' },
      ],
    }
    const pulls = [
      { scope_id: 'card', purpose: 'folder', files: [{ id: 'f1', name: 'raw.mov', mime: 'video/quicktime', size: 1, done: 1, url: 'https://m/raw.mov', status: 'done', version: 1 }] },
      { scope_id: 'card', purpose: 'finished', files: [
        { id: 'c1', name: 'cut-v1.mp4', mime: 'video/mp4', size: 1, done: 1, url: 'https://m/cut1.mp4', status: 'done', version: 1 },
        { id: 'c2', name: 'cut-v2.mp4', mime: 'video/mp4', size: 5, done: 5, url: 'https://m/cut2.mp4', status: 'done', version: 2 },
        { id: 'c3', name: 'still-copying.mp4', mime: 'video/mp4', size: 5, done: 1, url: null, status: 'copying', version: 2 },
        { id: 'u2', name: 'v2.png', mime: 'image/png', size: 20, done: 20, url: 'https://m/v2.png', status: 'done', version: 2 },
      ] },
      { scope_id: 'other-card', purpose: 'finished', files: [{ id: 'z', name: 'z.mp4', mime: 'video/mp4', size: 1, done: 1, url: 'https://m/z.mp4', status: 'done', version: 2 }] },
    ]
    expect(sharedFilesOf(item, pulls).map(f => f.id)).toEqual(['u2', 'c2'])
    expect(sharedFilesOf({ id: 'card' }, [])).toEqual([])
  })

  it('the token, the path and the words', () => {
    expect(isShareToken('ab'.repeat(16))).toBe(true)
    expect(isShareToken('AB'.repeat(16))).toBe(false)
    expect(isShareToken('../x')).toBe(false)
    expect(sharePath('ab'.repeat(16))).toBe(`/share/${'ab'.repeat(16)}`)
    expect(shareWords([], 2)).toContain('still being copied in')
    expect(shareWords([{ id: 'a', name: 'a', url: 'u', mime: null, size: null }], 3)).toBe('Version 3, accepted. 1 file — press Download on each.')
  })

  it('the routes and the page: one token per card, a public GET, sign-in nowhere on the page', () => {
    const mint = readFileSync('app/api/production/items/[id]/share/route.ts', 'utf8')
    expect(mint).toContain('if (!maySharePublicly(item)) {')
    expect(mint).toContain("token = randomBytes(16).toString('hex')")
    expect(mint).toContain('export async function DELETE')
    const pub = readFileSync('app/api/share/[token]/route.ts', 'utf8')
    expect(pub).not.toContain('requireSignedIn')
    expect(pub).toContain('if (!item || !maySharePublicly(item))')
    const page = readFileSync('app/share/[token]/page.tsx', 'utf8')
    expect(page).not.toContain('requireSignedIn')
    expect(page).toContain('robots: { index: false, follow: false }')
    const dl = readFileSync('app/api/assets/download/route.ts', 'utf8')
    expect(dl).toContain('if (!sharedFilesOf(item as never, pulls as never).some(f => f.url === url)) return new Response')
    const card = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(card).toContain('<ShareAcceptedLink item={item as never} />')
    // public on purpose: not in the PROTECTED list — but the download route is in the
    // matcher, so the middleware runs and a signed-in download can ask who is calling
    const middleware = readFileSync('middleware.ts', 'utf8')
    const protectedList = middleware.split('const isProtectedRoute = createRouteMatcher([')[1].split('])')[0]
    expect(protectedList).not.toContain('/share')
    expect(protectedList).not.toContain('/api/share')
    expect(protectedList).not.toContain('/api/assets')
    expect(middleware).toContain("'/api/assets/:path*',")
  })
})
