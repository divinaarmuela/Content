import { itemPath } from '../../../lib/workflow-core'
import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ContentItem, Batch, TeamBoard } from '@/lib/db-types'
import { logActivity } from '../../../lib/workflow'
import { announceItemChange, announceBatchChange, announceTeamBoardChange } from '../../../lib/production-live'
import { portalActor, notifyManagersOfComment } from '../../../lib/portal-actor'
import { NOT_WITH_YOU, portalActions } from '../../../lib/portal-core'
import type { ItemStatus } from '../../../lib/workflow-core'
import { sanitiseCanvasCards } from '../../../lib/batch-brief-core'
import { canvasCardLabel, commentSubject, findCanvasCard, shootCommentPath } from '../../../lib/canvas-comments-core'
import { clientByPortalToken } from '../../../lib/portal-owner'
import { formatStamp, reviewPath } from '../../../lib/video-review-core'
import { clipCommentWhere } from '../../../lib/editing-portal-core'
import { clientMaySeeTeamBoard, teamBoardCommentPath, teamBoardCommentSubject } from '../../../lib/team-board-comments-core'
import { checkAnchor } from '../../../lib/plan-comments-core'
import { clientMaySee } from '../../../lib/comment-visibility-core'
import type { BatchComment, TeamBoardComment } from '@/lib/db-types'

/**
 * A comment from the portal — on a piece, on a shoot, or pinned to ONE card
 * of the shoot's planning board (`card_id`). Token-bearer auth like
 * /api/portal/act; the comment persists in the same thread the team reads,
 * and the client's managers AND the person who created the shoot are told
 * (never the editor, never the client).
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const body = await req.json()
    const rawToken = String(body.token ?? '')
    const token = rawToken.split('--').pop() ?? rawToken
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    }
    const client = await clientByPortalToken(token)
    if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })

    const kind = String(body.kind ?? '')
    const id = String(body.id ?? '')

    // RESOLVE A THREAD (29 Oct 2026) — on the plan's words or on a card of a board (a shoot's or a team board's): the
    // client may mark a first comment they can see dealt with, or open it again
    if ((kind === 'shoot' || kind === 'team_board') && body.action === 'resolve') {
      const commentId = String(body.comment_id ?? '')
      if (kind === 'shoot') {
        const foundBatch = await table<Batch>('batches').get(id)
        if (!foundBatch || foundBatch.client_id !== client.id || !foundBatch.shared_with_client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        const c = await table<BatchComment>('batch_comments').get(commentId).catch(() => null)
        const withRole = c ? await attachRole(c) : null
        if (!c || c.batch_id !== foundBatch.id || !mayResolve(c) || !withRole || !clientMaySee(withRole as never)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        await table('batch_comments').update(c.id, { resolved: body.resolved !== false })
        announceBatchChange({ batch_id: foundBatch.id, client_id: client.id, status: 'brief', kind: 'updated' })
        return NextResponse.json({ ok: true })
      }
      const board = await table<TeamBoard>('team_boards').get(id).catch(() => null)
      if (!clientMaySeeTeamBoard(board, client.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const c = await table<TeamBoardComment>('team_board_comments').get(commentId).catch(() => null)
      const withRole = c ? await attachRole(c as never) : null
      if (!c || c.board_id !== board!.id || !mayResolve(c) || !withRole || !clientMaySee(withRole as never)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await table('team_board_comments').update(c.id, { resolved: body.resolved !== false })
      announceTeamBoardChange({ board_id: board!.id, client_id: client.id })
      return NextResponse.json({ ok: true })
    }

    const text = String(body.body ?? '').trim().slice(0, 4000)
    const authorName = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)
    if (!text) return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })
    const speaker = authorName ? `${authorName} · ${client.name}` : client.name
    const actor = await portalActor(client.id, client.name)
    const signed = authorName ? `${text}\n— ${authorName}` : text

    if (kind === 'item') {
      const foundItem = await table<ContentItem>('content_items').get(id)
      const item = foundItem && foundItem.client_id === client.id ? foundItem : null
      if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // a comment is pinned to a card the client can see — a draft nobody has
      // checked is not theirs to talk about yet (same rule as the card)
      if (!portalActions(item.status as ItemStatus).comment) {
        return NextResponse.json({ error: NOT_WITH_YOU }, { status: 403 })
      }
      // ON ONE CLIP, AT ONE SECOND (the editing portal, 16 Sep 2026): the
      // same three fields the team's review page writes, so the client's
      // comment sits on the same timeline the team reads
      const videoFile = typeof body.video_file_id === 'string' && /^[A-Za-z0-9_-]{10,}$/.test(body.video_file_id) ? body.video_file_id : null
      const videoName = videoFile && typeof body.video_file_name === 'string' ? body.video_file_name.trim().slice(0, 200) || null : null
      const ts = Number(body.video_timestamp_sec)
      const videoTs = videoFile && Number.isFinite(ts) && ts >= 0 ? Math.floor(ts) : null
      await table('item_comments').insert({
        item_id: item.id, author_id: actor.id, visibility: 'client', body: signed,
        resolved: false,
        ...(videoFile ? { video_file_id: videoFile, video_file_name: videoName, video_timestamp_sec: videoTs } : {}),
      })
      await logActivity({
        actor, clientId: client.id,
        entityType: 'content_item', entityId: item.id,
        action: 'comment_added', detail: 'client (portal)',
      })
      announceItemChange({ item_id: item.id, client_id: client.id, status: item.status, kind: 'comment' })
      await notifyManagersOfComment({
        clientId: client.id, speaker,
        subjectTitle: item.title + clipCommentWhere(videoName, videoTs === null ? null : formatStamp(videoTs)),
        body: text,
        // straight to the clip, at the comment, on the team's review page
        dashboardPath: videoFile ? reviewPath(item.id, videoFile, videoName) : itemPath(item),
        // …and whoever holds the card and whoever assigned it (the owner, 3 Oct 2026: "MD Media created the card too —
        // shouldn't she be notified as well?"): the account managers alone missed the person who made the card
        alsoUserIds: [(item as { owner_id?: string | null }).owner_id, (item as { assigned_by?: string | null }).assigned_by],
      }).catch(e => console.error('portal comment notify error:', e))
      return NextResponse.json({ ok: true })
    }

    if (kind === 'shoot') {
      const foundBatch = await table<Batch>('batches').get(id)
      const batch = foundBatch && foundBatch.client_id === client.id ? foundBatch : null
      if (!batch || !batch.shared_with_client) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      // pinned to a card of the board: only a card the client can actually
      // see on it — an id that is not on the board is not a card
      const cardId = body.card_id == null ? null : String(body.card_id).slice(0, 80)
      const card = cardId ? findCanvasCard(sanitiseCanvasCards(batch.canvas_cards), cardId) : null
      if (cardId && !card) {
        return NextResponse.json({ error: 'That card is not on the board any more.' }, { status: 404 })
      }
      const cardLabel = card ? canvasCardLabel(card) : null
      // ON THE PLAN'S OWN WORDS (29 Oct 2026): the part and the words must still be in the plan; a reply answers a
      // first comment on this shoot that the client can see
      const anchor = checkAnchor(batch as never, body.anchor_part ?? null, body.anchor_quote ?? null)
      if (anchor && !anchor.ok) return NextResponse.json({ error: anchor.error }, { status: 409 })
      let parentId: string | null = null
      let parentCard: string | null = null
      if (body.parent_id) {
        const parent = await table<BatchComment>('batch_comments').get(String(body.parent_id)).catch(() => null)
        const withRole = parent ? await attachRole(parent) : null
        if (!parent || parent.batch_id !== batch.id || (parent as { parent_id?: string | null }).parent_id || !withRole || !clientMaySee(withRole as never)) {
          return NextResponse.json({ error: 'That comment is not there any more.' }, { status: 404 })
        }
        parentId = parent.id
        parentCard = parent.card_id ?? null
      }
      // words on a card are that card's own — never another card's, never a card without its id
      if (anchor?.ok && anchor.part.startsWith('card:') && anchor.part !== `card:${card?.id}`) {
        return NextResponse.json({ error: 'Select the words on the card you are commenting on.' }, { status: 409 })
      }
      try {
        await table('batch_comments').insert({
          batch_id: batch.id, author_id: actor.id, body: signed, resolved: false,
          // a reply sits where its first comment does — on its card, or on none
          card_id: parentId ? (parentCard ?? null) : (card ? card.id : null),
          ...(anchor?.ok && !parentId ? { anchor_part: anchor.part, anchor_quote: anchor.quote } : {}),
          ...(parentId ? { parent_id: parentId } : {}),
        })
      } catch {
        // the thread could not be written — say so rather than pretending the
        // comment landed
        return NextResponse.json({ error: 'Comments are not set up yet — ask your account manager.' }, { status: 503 })
      }
      await logActivity({
        actor, clientId: client.id,
        entityType: 'batch', entityId: batch.id,
        action: 'comment_added', detail: 'client (portal)',
      })
      // the manager, and whoever created the shoot — the board is theirs
      await notifyManagersOfComment({
        clientId: client.id, speaker, subjectTitle: commentSubject(batch.title, cardLabel),
        body: anchor?.ok && !parentId ? `On “${anchor.quote}”: ${text}` : text,
        dashboardPath: shootCommentPath(batch.id, card?.id),
        alsoUserIds: [batch.owner_id],
      }).catch(e => console.error('portal comment notify error:', e))
      announceBatchChange({ batch_id: batch.id, client_id: client.id, status: 'brief', kind: 'updated' })
      return NextResponse.json({ ok: true })
    }

    // A TEAM BOARD SHARED WITH THEM (22 Sep 2026): the same rows the team
    // reads on the board page, on the same card; the managers are told
    if (kind === 'team_board') {
      const board = await table<TeamBoard>('team_boards').get(id).catch(() => null)
      if (!clientMaySeeTeamBoard(board, client.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const b = board as TeamBoard & { canvas_cards?: unknown }
      const cardId = body.card_id == null ? null : String(body.card_id).slice(0, 80)
      const card = cardId ? findCanvasCard(sanitiseCanvasCards(b.canvas_cards), cardId) : null
      if (!card) return NextResponse.json({ error: cardId ? 'That card is not on the board any more.' : 'Pick a card to comment on' }, { status: cardId ? 404 : 400 })
      const cardLabel = canvasCardLabel(card)
      // ON THE CARD'S OWN WORDS, AND REPLIES (29 Oct 2026, "same goes for boards"): the words must still be on this
      // card; a reply answers a first comment on this card that the client can see
      const anchor = checkAnchor(b as never, body.anchor_part ?? null, body.anchor_quote ?? null)
      if (anchor && !anchor.ok) return NextResponse.json({ error: anchor.error }, { status: 409 })
      if (anchor?.ok && anchor.part !== `card:${card.id}`) return NextResponse.json({ error: 'Select the words on the card you are commenting on.' }, { status: 409 })
      let parentId: string | null = null
      if (body.parent_id) {
        const parent = await table<TeamBoardComment>('team_board_comments').get(String(body.parent_id)).catch(() => null)
        const withRole = parent ? await attachRole(parent as never) : null
        if (!parent || parent.board_id !== b.id || parent.card_id !== card.id || parent.parent_id || !withRole || !clientMaySee(withRole as never)) {
          return NextResponse.json({ error: 'That comment is not there any more.' }, { status: 404 })
        }
        parentId = parent.id
      }
      try {
        await table('team_board_comments').insert({
          board_id: b.id, author_id: actor.id, body: signed, resolved: false, card_id: card.id,
          ...(anchor?.ok && !parentId ? { anchor_part: anchor.part, anchor_quote: anchor.quote } : {}),
          ...(parentId ? { parent_id: parentId } : {}),
        })
      } catch {
        return NextResponse.json({ error: 'Comments are not set up yet — ask your account manager.' }, { status: 503 })
      }
      await logActivity({ actor, clientId: client.id, entityType: 'team_board', entityId: b.id, action: 'comment_added', detail: 'client (portal)' })
      await notifyManagersOfComment({
        clientId: client.id, speaker, subjectTitle: teamBoardCommentSubject(b.name, cardLabel),
        body: anchor?.ok && !parentId ? `On “${anchor.quote}”: ${text}` : text,
        dashboardPath: teamBoardCommentPath(b.id, card.id),
        alsoUserIds: [b.created_by ?? null],
      }).catch(e => console.error('portal board comment notify error:', e))
      announceTeamBoardChange({ board_id: b.id, client_id: client.id })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown thread' }, { status: 400 })
  } catch (e) {
    console.error('portal comment error:', e)
    return NextResponse.json({ error: 'Something went wrong — try again' }, { status: 500 })
  }
  })
}

/** a comment with its writer's role, as the visibility rule reads it */
async function attachRole(c: BatchComment): Promise<BatchComment & { team_users: { role?: string | null } | null }> {
  const who = c.author_id ? await table<{ id: string; role?: string | null }>('team_users').get(String(c.author_id)).catch(() => null) : null
  return { ...c, team_users: who ? { role: who.role ?? null } : null }
}

/** a thread's first comment: one on the plan's words, or one on a card of a board — a reply is resolved with its own */
function mayResolve(c: { parent_id?: string | null; anchor_part?: string | null; card_id?: string | null }): boolean {
  return !c.parent_id && (!!c.anchor_part || !!c.card_id)
}
