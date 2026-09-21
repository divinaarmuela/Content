import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { ContentItem, DrivePull, ItemComment } from '@/lib/db-types'
import { portalOwnerByToken } from './portal-owner'
import { belongsToPortal, portalName } from './portal-owner-core'
import { accountManagerName } from './portal-data'
import { listFolder, type FolderListing } from './drive-folder-list'
import { driveFileMeta } from './drive-stream'
import { previewsFor } from './stream'
import { streamBaseUrl } from './stream-core'
import { clipsOf, clipSignature, editingPortalFolder, portalHasWork, portalStreamPath, type PortalClip, clientMayApprove, clientSeenRound } from './editing-portal-core'
import { finalFilesOf, assetIdOf } from './final-files-core'
import { clipApprovalsOf, type ClipApproval } from './clip-approvals-core'
import { filesOf, pullId } from './drive-pull-core'
import { fileRound, roundOf, roundsOf } from './edit-round-core'
import { kindOf } from './files-core'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import { clientStatusWord } from './portal-words'

/**
 * THE EDITING PORTAL'S DATA (the owner, 16 Sep 2026): one editing card, the
 * clips of its finished edit, the client's own comments on them (and only
 * the client's — the team's notes stay on the team's page), and which clips
 * the client has approved. The token is the client's, or one of their
 * people's; the card has to be theirs and on their portal.
 */
export type EditingPortalComment = {
  id: string
  created_at: string
  body: string
  author_name: string
  video_file_id: string | null
  video_timestamp_sec: number | null
}

export type EditingPortal = {
  token: string
  client: { id: string; name: string }
  /** the name the portal wears — the business, or the person */
  portal_name: string
  am_name: string | null
  item: { id: string; title: string; status: ItemStatus; status_label: string; content_type: string | null }
  folder: { url: string; id: string }
  clips: (PortalClip & { src: string; version: number; stream: { base: string; duration: number } | null; asset_id: string | null; carries: boolean; retired_round?: number | null })[]
  /** the card is with the client now: they may approve. False while it is being revised — they may still comment */
  can_approve: boolean
  /** the rounds the clips span, newest first — Version 2, Version 1 */
  rounds: number[]
  /** the card's current round */
  round: number
  /** the folder could not be listed — the words for the page */
  folder_note: string | null
  comments: EditingPortalComment[]
  approvals: ClipApproval[]
}

const SECRET = () => process.env.CREDENTIALS_KEY ?? ''

export function signedClipStream(token: string, itemId: string, clip: { id: string; name: string }): string {
  return portalStreamPath(token, itemId, clip, clipSignature(SECRET(), itemId, clip.id))
}

/** the card, if this token may see it on the editing portal */
export async function editingPortalItem(rawToken: string, itemId: string) {
  const owner = await portalOwnerByToken(rawToken)
  if (!owner) return null
  const item = await table<ContentItem>('content_items').get(itemId)
  if (!item || item.client_id !== owner.client.id) return null
  if (!belongsToPortal(item, owner.scope)) return null
  if (!portalHasWork(item as never)) return null
  // a card handed in as files has no folder — its uploads are the work (17 Sep 2026)
  const folder = editingPortalFolder(item) ?? { url: '', folderId: 'uploads', kind: 'folder' as const }
  return { owner, item, folder }
}

export async function getEditingPortal(rawToken: string, itemId: string): Promise<EditingPortal | null> {
  const found = await editingPortalItem(rawToken, itemId)
  if (!found) return null
  const { owner, item, folder } = found
  const [listing, comments, amName, pull] = await Promise.all([
    // a folder is listed; one file is asked for by name (16 Sep 2026)
    folder.folderId === 'uploads'
      ? Promise.resolve<FolderListing>({ entries: [], more: false, source: 'account', accountFailure: null })
      : folder.kind === 'file'
      ? driveFileMeta(folder.folderId).then((m): FolderListing => ({
          entries: m ? [{ id: folder.folderId, name: m.name, mimeType: m.mime, size: m.size, modified: null, ownerName: null, ownerEmail: null, hasThumbnail: false, webViewLink: null }] : [],
          more: false, source: 'account', accountFailure: null,
        }))
      : listFolder(folder.folderId),
    table<ItemComment>('item_comments')
      .list({ by: { item_id: item.id }, where: r => r.visibility === 'client', orderBy: [['created_at', 'asc']], limit: 300 })
      .then(rows => attachOne(rows, 'author_id', 'team_users', ['name', 'role'])),
    accountManagerName(owner.client.id),
    folder.folderId === 'uploads' ? Promise.resolve(null) : table<DrivePull>('drive_pulls').get(pullId(folder.folderId, item.id)).catch(() => null),
  ])
  const status = item.status as ItemStatus
  // OUR COPIES FIRST (the pull, 16 Sep 2026): a clip already landed in our
  // storage plays from there — fast, and whatever Drive's sharing says today
  // FILES UPLOADED ONTO THE CARD come first (the Designer page, 17 Sep 2026):
  // pictures shown, clips played, each under the round it was handed in
  // NEVER MORE THAN THE CLIENT WAS GIVEN (editing-portal-core.ts): a version still with the team is not theirs yet
  const seen = clientSeenRound(item as never)
  const uploadedAll = finalFilesOf(item).filter(f => f.version <= seen)
  const assetOf = new Map(uploadedAll.map(f => [f.id, assetIdOf(f)]))
  const retiredOf = new Map(uploadedAll.filter(f => typeof f.retired_round === 'number').map(f => [f.id, f.retired_round as number]))
  const upRounds = new Set(uploadedAll.map(f => f.version))
  const uploaded = uploadedAll.filter(f => ['video', 'image'].includes(kindOf(f.mime, f.name))).map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, done: f.size ?? 0, url: f.url, status: 'done' as const, version: f.version }))
  // A CARD THAT BEGAN AS A LINK AND WENT ON AS FILES keeps its link rounds: Version 1 from the folder, Version 2 uploaded
  const fromLink = filesOf(pull).filter(f => f.status === 'done' && !!f.url && kindOf(f.mime, f.name) === 'video' && fileRound(f) <= seen && !upRounds.has(fileRound(f)))
  const pulled = [...fromLink, ...uploaded]
  const round = roundOf(item)
  // the preview copies of the pulled clips, for the strip's stills and hover frames
  const videos = pulled.filter(f => kindOf(f.mime, f.name) === 'video')
  const previews = videos.length > 0 ? await previewsFor(videos.map(f => f.url as string)).catch(() => new Map()) : new Map()
  const clips = pulled.length > 0
    ? pulled.map(f => {
        const kind = kindOf(f.mime, f.name) === 'image' ? 'image' as const : 'video' as const
        const p = previews.get(f.url as string)
        const base = p && p.state === 'ready' ? streamBaseUrl(p) : null
        return { id: f.id, name: f.name, asset_id: assetOf.get(f.id) ?? null, carries: assetOf.has(f.id), retired_round: retiredOf.get(f.id) ?? null, thumb: kind === 'image' ? f.url as string : null, kind, src: f.url as string, version: fileRound(f), stream: base && typeof p?.duration_sec === 'number' && p.duration_sec > 0 ? { base, duration: p.duration_sec } : null }
      })
    : clipsOf(listing.entries).map(c => ({ ...c, asset_id: null, carries: false, retired_round: null, src: signedClipStream(owner.token, item.id, c), version: Math.min(round, seen), stream: null }))
  const rounds = roundsOf(clips)
  return {
    token: owner.token,
    client: { id: owner.client.id, name: owner.client.name },
    portal_name: portalName(owner.client.name, owner.scope),
    am_name: amName,
    item: {
      id: item.id, title: item.title, status,
      status_label: clientStatusWord(status, CLIENT_LABELS[status]),
      content_type: item.content_type ?? null,
    },
    folder: { url: folder.url, id: folder.folderId },
    clips,
    can_approve: clientMayApprove(item as never),
    rounds,
    round,
    folder_note: clips.length === 0
      ? (folder.folderId === 'uploads'
          ? 'Nothing handed in for this version yet.'
          : listing.entries.length > 0
          ? 'There are no videos in the finished edit yet.'
          : 'The finished edit could not be listed here yet — open it in Drive above.')
      : null,
    comments: (comments as unknown as (ItemComment & { team_users?: { name: string | null; role: string | null } | null })[]).map(c => {
      // the client's own comments are signed "— Name" by the portal; the
      // name is who at the client spoke, or the client itself
      const m = /\n— ([^\n]+)$/.exec(String(c.body ?? ''))
      const teamAuthor = c.team_users && c.team_users.role !== 'client' ? (c.team_users.name ?? null) : null
      return {
        id: c.id, created_at: c.created_at,
        body: m ? String(c.body).slice(0, m.index) : String(c.body ?? ''),
        author_name: m ? m[1] : teamAuthor ?? owner.client.name,
        video_file_id: typeof c.video_file_id === 'string' ? c.video_file_id : null,
        video_timestamp_sec: typeof c.video_timestamp_sec === 'number' ? c.video_timestamp_sec : null,
      }
    }),
    approvals: clipApprovalsOf(item),
  }
}
