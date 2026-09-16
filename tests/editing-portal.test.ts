import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clipCommentWhere, clipSignature, clipSignatureOk, clipsOf, editingPortalFolder, editingPortalPath, portalStreamPath,
} from '../app/lib/editing-portal-core'
import {
  approvedClipsWords, clipApproval, clipApprovalsOf, withClipApproved, withClipUnapproved,
} from '../app/lib/clip-approvals-core'

/**
 * THE EDITING PORTAL (the owner, 16 Sep 2026: "build a portal for each
 * editing card — the videos on the left and the comment section on the
 * right; comments only, for the client to log each video; each video gets
 * a nice Approved button so the team sees which files in Drive to work
 * from; even though the client approves all items it does not send back to
 * draft — the AM or super admin presses the button").
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('which cards get one, and where it lives', () => {
  const edit = { status: 'client_review', link_url: 'https://drive.google.com/drive/folders/1OItqlh84b0qwO_7fe66v6r1CPecvjd_V', link_kind: 'drive', link_final: true }
  it('an edit with the client whose finished edit is a Drive folder; never an uploaded post, a draft, or a Dropbox link', () => {
    expect(editingPortalFolder(edit)).toEqual({ url: edit.link_url, folderId: '1OItqlh84b0qwO_7fe66v6r1CPecvjd_V', kind: 'folder' })
    // one Drive file is a finished edit too (16 Sep 2026)
    expect(editingPortalFolder({ ...edit, link_url: 'https://drive.google.com/file/d/1sM6wtEVG6wRpbTENrt1Tjz-Zn0ucGFDj/view?usp=sharing' })).toEqual({ url: 'https://drive.google.com/file/d/1sM6wtEVG6wRpbTENrt1Tjz-Zn0ucGFDj/view?usp=sharing', folderId: '1sM6wtEVG6wRpbTENrt1Tjz-Zn0ucGFDj', kind: 'file' })
    expect(editingPortalFolder({ ...edit, status: 'approved_for_scheduling' })).not.toBeNull()
    expect(editingPortalFolder({ ...edit, adhoc_post: true })).toBeNull()
    expect(editingPortalFolder({ ...edit, status: 'draft_uploaded' })).toBeNull()
    expect(editingPortalFolder({ ...edit, status: 'quality_check' })).toBeNull()
    expect(editingPortalFolder({ ...edit, link_url: 'https://www.dropbox.com/scl/fo/abc', link_kind: 'dropbox' })).toBeNull()
    expect(editingPortalFolder({ ...edit, link_url: null })).toBeNull()
  })
  it('the page address, and the clips: the videos of the folder, in the order given, with Drive’s public picture when there is one', () => {
    expect(editingPortalPath('tok-1', 'item 1')).toBe('/portal/tok-1/edit/item%201')
    const entries = [
      { id: 'v1', name: 'Script 1.mov', mimeType: 'video/quicktime', size: 1, modified: null, ownerName: null, ownerEmail: null, hasThumbnail: true, webViewLink: null, thumbUrl: 'https://lh3/x' },
      { id: 'p1', name: 'still.jpg', mimeType: 'image/jpeg', size: 1, modified: null, ownerName: null, ownerEmail: null, hasThumbnail: true, webViewLink: null },
      { id: 'f1', name: 'MXF', mimeType: 'application/vnd.google-apps.folder', size: null, modified: null, ownerName: null, ownerEmail: null, hasThumbnail: false, webViewLink: null },
      { id: 'v2', name: 'Script 2.mp4', mimeType: 'video/mp4', size: 1, modified: null, ownerName: null, ownerEmail: null, hasThumbnail: true, webViewLink: null },
    ]
    expect(clipsOf(entries)).toEqual([{ id: 'v1', name: 'Script 1.mov', thumb: 'https://lh3/x' }, { id: 'v2', name: 'Script 2.mp4', thumb: null }])
  })
  it('a signed clip: the stream address carries a signature over the card and the file, and a changed file or card fails it', () => {
    const sig = clipSignature('secret', 'item-1', 'file-1')
    expect(sig).toHaveLength(40)
    expect(clipSignatureOk('secret', 'item-1', 'file-1', sig)).toBe(true)
    expect(clipSignatureOk('secret', 'item-1', 'file-2', sig)).toBe(false)
    expect(clipSignatureOk('secret', 'item-2', 'file-1', sig)).toBe(false)
    expect(clipSignatureOk('other', 'item-1', 'file-1', sig)).toBe(false)
    expect(clipSignatureOk('secret', 'item-1', 'file-1', null)).toBe(false)
    expect(portalStreamPath('tok', 'item-1', { id: 'file-1', name: 'Script 1.mov' }, sig))
      .toBe(`/api/portal/stream?token=tok&item=item-1&id=file-1&name=Script+1.mov&sig=${sig}`)
  })
  it('the manager’s notice says where on which clip', () => {
    expect(clipCommentWhere('Script 1.mov', '1:23')).toBe(' — at 1:23 on Script 1.mov')
    expect(clipCommentWhere('Script 1.mov', null)).toBe(' — on Script 1.mov')
    expect(clipCommentWhere(null, '1:23')).toBe('')
  })
})

describe('the client’s tick per clip (pure)', () => {
  const a = { file_id: 'v1', name: 'Script 1.mov', at: '2026-09-16T00:00:00Z', by: 'Karly' }
  it('reads only well-formed ticks off the card; approving twice keeps one; taking it back removes it', () => {
    expect(clipApprovalsOf({ clip_approvals: [a, { file_id: '', at: 'x' }, null, 'junk'] })).toEqual([a])
    expect(clipApprovalsOf({ clip_approvals: null })).toEqual([])
    expect(clipApprovalsOf(null)).toEqual([])
    const twice = withClipApproved(withClipApproved([], a), { ...a, at: '2026-09-16T01:00:00Z' })
    expect(twice).toHaveLength(1)
    expect(twice[0].at).toBe('2026-09-16T01:00:00Z')
    expect(withClipUnapproved(twice, 'v1')).toEqual([])
    expect(clipApproval(twice, 'v1')?.by).toBe('Karly')
    expect(clipApproval(twice, 'v9')).toBeNull()
  })
  it('the one line on the card', () => {
    expect(approvedClipsWords(0, 6)).toBeNull()
    expect(approvedClipsWords(2, 6)).toBe('2 of 6 clips approved by the client')
    expect(approvedClipsWords(6, 6)).toBe('All 6 clips approved by the client')
    expect(approvedClipsWords(1, 1)).toBe('All 1 clip approved by the client')
  })
})

describe('the routes and the pages (source pins)', () => {
  it('the portal’s clip route only ticks — it never moves the card, and it tells the managers', () => {
    const s = src('app/api/portal/clip/route.ts')
    expect(s).not.toContain('performTransition')
    expect(s).not.toMatch(/update\([^)]*status/)
    expect(s).toContain("await table<ContentItem>('content_items').update(item.id, { clip_approvals: next, updated_at: at })")
    expect(s).toContain('await notifyManagersOfComment({')
    expect(s).toContain("action: decision === 'approve' ? 'clip_approved' : 'clip_unapproved'")
  })
  it('the portal’s stream is token-bearer and signed, then the same read-only bytes as the team’s', () => {
    const s = src('app/api/portal/stream/route.ts')
    expect(s).toContain('export async function GET(')
    expect(s).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)\(/)
    expect(s).toContain("if (!secret || !clipSignatureOk(secret, itemId, id, search.get('sig'))) return new Response('Not found', { status: 404 })")
    expect(s).toContain('const found = await editingPortalItem(token, itemId)')
    expect(s).toContain("return await streamDriveFile(id, req.headers.get('range'), search.get('name'))")
    const lib = src('app/lib/drive-stream.ts')
    expect(lib).toContain("const PUBLIC_DOWNLOAD = 'https://drive.usercontent.google.com/download'")
    expect(lib).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'/)
  })
  it('the portal’s comment carries the clip and the second, and the manager is sent to the clip', () => {
    const s = src('app/api/portal/comment/route.ts')
    expect(s).toContain('...(videoFile ? { video_file_id: videoFile, video_file_name: videoName, video_timestamp_sec: videoTs } : {}),')
    expect(s).toContain('dashboardPath: videoFile ? reviewPath(item.id, videoFile, videoName) : itemPath(item),')
    expect(s).not.toContain('approval-note scheduler notify')
  })
  it('the editing portal page: clips left, comments right, an Approved button per clip, no status buttons; the client sees only their own comments', () => {
    const page = src('app/portal/[token]/edit/[id]/page.tsx')
    expect(page).toContain('<EditingReview data={data} />')
    // the same light/dark toggle as every portal page; no way back to the board (16 Sep 2026)
    expect(page).toContain('<PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>')
    expect(page).not.toContain('Your board')
    expect(page).not.toContain('PortalCardView')
    expect(page).not.toContain('/api/portal/act')
    const c = src('app/components/portal/EditingReview.tsx')
    expect(c).toContain("fetch('/api/portal/clip'")
    expect(c).toContain("fetch('/api/portal/comment'")
    expect(c).toContain('video_file_id: clip.id, video_file_name: clip.name')
    expect(c).not.toContain('/api/portal/act')
    expect(c).toContain('Approve this clip')
    const lib = src('app/lib/editing-portal.ts')
    expect(lib).toContain("where: r => r.visibility === 'client'")
    expect(lib).toContain('if (!belongsToPortal(item, owner.scope)) return null')
  })
  it('the team sees the client’s comments on the same timeline, marked, and a tick on the approved clips', () => {
    const review = src('app/dashboard/editor/[id]/video/[fileId]/page.tsx')
    expect(review).toContain("const fromClient = (uid: string | null | undefined) => team.find(t => t.id === uid)?.role === 'client'")
    expect(review).toContain('{fromClient(c.author_id) && <span')
    const page = src('app/dashboard/editor/[id]/page.tsx')
    expect(page).toContain('approvedIds={clipApprovalsOf(item).map(a => a.file_id)}')
    expect(page).toContain('editingPortalPath(client.share_token, id)')
    const tiles = src('app/dashboard/board/DriveFolderFiles.tsx')
    expect(tiles).toContain('{approvedIds?.includes(t.id) && (')
    // the client's "ready for you" email opens the editing portal for an edit
    const w = src('app/lib/workflow.ts')
    expect(w).toContain("editingPortalFolder({ ...item, status: to } as never) ? editingPortalPath(clientShareToken, item.id)")
  })
  it('the source working folder is called that, everywhere a person changes it', () => {
    expect(src('app/dashboard/board/FilesToWorkFrom.tsx')).toContain("{folder ? 'Change the source working folder' : 'Add the source working folder'}")
    expect(src('app/dashboard/board/BoardDialogs.tsx')).toContain("{card?.link_url ? 'Change the source working folder' : 'Source working folder'}")
  })
})

describe('the clip a phone can play (16 Sep 2026)', () => {
  it('the portal and the review page hand the player the Stream preview when there is one, the copy otherwise', () => {
    const hook = src('app/components/media/useHlsSource.ts')
    expect(hook).toContain("return base ? `${base}/manifest/video.m3u8` : null")
    expect(hook).toContain("if (el.canPlayType('application/vnd.apple.mpegurl')) {")
    expect(hook).toContain("void import('hls.js')")
    const portal = src('app/components/portal/EditingReview.tsx')
    expect(portal).toContain('useHlsSource(video, clip ? (clip.stream ? hlsManifestUrl(clip.stream.base) : clip.src) : null)')
    expect(portal).not.toContain('preload="metadata" src={clip.src}')
    const review = src('app/dashboard/editor/[id]/video/[fileId]/page.tsx')
    expect(review).toContain('useHlsSource(video, isImage ? null : streamBase ? hlsManifestUrl(streamBase) : (copyUrl ??')
  })
})
