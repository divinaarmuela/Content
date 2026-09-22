import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { driveFileOnBoard, portalDriveStreamUrl, portalDriveThumbnailUrl, postMediaOf } from '../app/lib/canvas-drive-core'

/**
 * A DRIVE FILE ON A BOARD THE CLIENT WAS SHOWN plays for them (the owner, 22 Sep 2026:
 * the client link to The Glass Den's posting-order board, "the files not playing — from the drive").
 */
const scope = { token: 'tok', kind: 'team_board' as const, id: 'b1' }
const clip = { id: '14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj', name: 'Glass_Den 3.mov', kind: 'video' as const, mime: 'video/quicktime', key: '' }

describe('the client’s Drive addresses', () => {
  it('carry the token, the board and the file — and nothing else the route would need to guess', () => {
    expect(portalDriveThumbnailUrl(scope, clip.id, 800)).toBe('/api/portal/drive?token=tok&kind=team_board&board=b1&id=14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj&what=thumbnail&size=800')
    expect(portalDriveStreamUrl(scope, clip)).toBe('/api/portal/drive?token=tok&kind=team_board&board=b1&id=14I9T3hpg_ia-flJKh5OqU0SAvOIvpPbj&what=stream&name=Glass_Den+3.mov')
    expect(portalDriveStreamUrl({ ...scope, kind: 'shoot' }, { ...clip, key: '0-k3y' })).toContain('kind=shoot')
    expect(portalDriveStreamUrl({ ...scope, kind: 'shoot' }, { ...clip, key: '0-k3y' })).toContain('&key=0-k3y')
  })
  it('a post’s media says which Drive file it is', () => {
    const m = postMediaOf({ platform: 'instagram', drive_files: [clip] })
    expect(m[0]).toMatchObject({ from: 'drive', driveId: clip.id, driveKey: null, name: 'Glass_Den 3.mov' })
  })
  it('a file is served only when it is on the board', () => {
    const cards = [{ drive_files: [clip] }, { drive_files: null }, {}]
    expect(driveFileOnBoard(cards, clip.id)).toBe(clip)
    expect(driveFileOnBoard(cards, '1notOnTheBoard000000000000000')).toBeNull()
    expect(driveFileOnBoard([], clip.id)).toBeNull()
  })
  it('the route gates on the token, the shared board and the file; the client’s board hands the frame its scope', () => {
    const route = readFileSync('app/api/portal/drive/route.ts', 'utf8')
    expect(route).toContain('if (!clientMaySeeTeamBoard(board, client.id)) return new Response(\'Not found\', { status: 404 })')
    expect(route).toContain("if (!batch || batch.client_id !== client.id || !batch.shared_with_client || (batch as { share_board?: boolean | null }).share_board === false) {")
    expect(route).toContain('const file = driveFileOnBoard(sanitiseCanvasCards(cards), id)')
    expect(route).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'/)
    const board = readFileSync('app/components/portal/ShootBoard.tsx', 'utf8')
    expect(board).toContain('<PortalDriveScopeProvider value={token ? { token, kind: thread, id: shootId } : null}>')
    const card = readFileSync('app/dashboard/production/shoots/[id]/CanvasCard.tsx', 'utf8')
    expect(card).toContain("const viaPortal = media.from === 'drive' && !!portal && !!scope && !!media.driveId")
    expect(card).toContain("const driveOnPortal = media.from === 'drive' && !!portal && !viaPortal")
  })
})
