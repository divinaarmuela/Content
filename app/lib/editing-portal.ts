import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { ContentItem, ItemComment } from '@/lib/db-types'
import { portalOwnerByToken } from './portal-owner'
import { belongsToPortal, portalName } from './portal-owner-core'
import { accountManagerName } from './portal-data'
import { listFolder } from './drive-folder-list'
import { clipsOf, clipSignature, editingPortalFolder, portalStreamPath, type PortalClip } from './editing-portal-core'
import { clipApprovalsOf, type ClipApproval } from './clip-approvals-core'
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
  clips: (PortalClip & { src: string })[]
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
  const folder = editingPortalFolder(item)
  if (!folder) return null
  return { owner, item, folder }
}

export async function getEditingPortal(rawToken: string, itemId: string): Promise<EditingPortal | null> {
  const found = await editingPortalItem(rawToken, itemId)
  if (!found) return null
  const { owner, item, folder } = found
  const [listing, comments, amName] = await Promise.all([
    listFolder(folder.folderId),
    table<ItemComment>('item_comments')
      .list({ by: { item_id: item.id }, where: r => r.visibility === 'client', orderBy: [['created_at', 'asc']], limit: 300 })
      .then(rows => attachOne(rows, 'author_id', 'team_users', ['name', 'role'])),
    accountManagerName(owner.client.id),
  ])
  const status = item.status as ItemStatus
  const clips = clipsOf(listing.entries).map(c => ({ ...c, src: signedClipStream(owner.token, item.id, c) }))
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
    folder_note: clips.length === 0
      ? (listing.entries.length > 0
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
