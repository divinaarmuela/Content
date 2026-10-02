import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  Batch, Client, PostComment, PostVersion, TeamUser as TeamUserRow, TeamUserClient, ContentItem as ContentItemRow, WorkKind,
} from '@/lib/db-types'
import { performTransition, logActivity, type ContentItem } from '../../../lib/workflow'
import { itemPath, type ItemStatus } from '../../../lib/workflow-core'
import {
  NOT_WITH_YOU, clientMayNote, clientPostView, planDecidable, portalActions, readFrozenPost, reviewFiles,
} from '../../../lib/portal-core'
import { notify, renderEmail, escapeHtml } from '../../../lib/mailer'
import { announceBatchChange, announceItemChange } from '../../../lib/production-live'
import { AuthzError, requireRole, type TeamUser } from '../../../lib/authz'
import { clientDecisionOpen, clientDecisionPatch } from '../../../lib/shoot-sop-core'
import { notifyClientPlanDecision } from '../../../lib/shoot-sop-notify'
import { DASHBOARD_URL } from '../../../lib/app-url'
import { portalOwnerByToken } from '../../../lib/portal-owner'
import { belongsToPortal, type PortalScope } from '../../../lib/portal-owner-core'
import { postVersionId, readPostState, type PostState } from '../../../lib/post-stage-core'
import { refusalStatus, type PostActRefused } from '../../../lib/post-act-contract'
import { clientActOnPost } from '../../../lib/post-stage'
import { ANSWER_NOTE_NEEDED, onePortal } from '../../../lib/one-portal-core'


/**
 * Client actions from the share-link portal: approve, request changes,
 * comment. The share token IS the client's authority — the same bearer model
 * as the shoot answer page — so no login is required, and every action still
 * runs through the exact same state machine and notification fan-out as the
 * dashboard. The gatekeeper rule holds: nothing here ever notifies an editor
 * directly.
 */

/** The client's standing portal identity: one hidden team_users row per
 *  client (role client, inactive so no notification audience ever emails
 *  it), satisfying every actor/author foreign key with an honest name. */
async function portalActor(clientId: string, clientName: string): Promise<TeamUser> {
  const email = `portal+${clientId}@mdmmarketing.com.au`
  const users = table<TeamUserRow>('team_users')
  const existing = (await users.list({ where: u => u.email === email, limit: 1 }))[0]
  if (existing) return existing as unknown as TeamUser
  const created = await users.upsert({
    email,
    name: `${clientName} (client portal)`,
    role: 'client',
    client_id: clientId,
    employment_type: 'contractor',
    timezone: 'Australia/Melbourne',
    active_status: false,
  }, { onConflict: 'email' })
  if (!created) throw new Error('Could not create the portal identity')
  return created as unknown as TeamUser
}

/** Client comments route to the client's managers — never the editor. */
async function notifyManagers(clientId: string, item: { id: string; adhoc_post?: unknown }, itemTitle: string, clientName: string, body: string) {
  const itemId = item.id
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } })
  const data = await attachOne(links, 'team_user_id', 'team_users',
    ['id', 'email', 'name', 'role', 'active_status'])
  const managers = data
    .map(r => r.team_users as unknown as { id: string; email: string; role: string; active_status: boolean } | null)
    .filter((u): u is { id: string; email: string; role: string; active_status: boolean } =>
      !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
  for (const m of managers) {
    await notify({
      actorName: clientName,
      actorEmail: 'portal+client@mdmmarketing.com.au',
      eventType: 'client_comment',
      entityType: 'item_comment',
      entityId: `${itemId}#${Date.now()}`,
      recipientId: m.id,
      recipientEmail: m.email,
      subject: `Client comment on ${itemTitle}`,
      bodyHtml: renderEmail(
        `Client comment on ${itemTitle}`,
        `<p>${escapeHtml(body.slice(0, 500))}</p><p style="color:#a1a1aa;font-size:12px;">From ${escapeHtml(clientName)}'s portal. Review it and assign an editor task if changes are needed.</p>`,
        'Open the item',
        `${DASHBOARD_URL}${itemPath(item, (m as { role?: string | null }).role)}`
      ),
    })
  }
}

/* ── THE CLIENT AND A POST (the posting rebuild, 29 Sep 2026) ──────────────
 *
 * Three things a client may do to a post, and only while it is WITH THEM, for
 * the version they were sent, before its approve-by time (SPEC §4.4, audit
 * V5, P3, P9): approve it, ask for a change (with words), or leave a note on
 * one of its files or on the whole post (decision 9). The decisions go to the
 * one writer (`clientActOnPost`, package P1), which runs the same rules inside
 * a claim — this route asks first only so the client reads plain words, never
 * a stage name. A note is written only once the move it came with landed, so
 * a refused answer never leaves a note behind claiming it happened.
 */

type PostBody = Record<string, unknown>

/** The client's words for a refusal. A stage name or a hat is the team's language, not theirs. */
function refusalForClient(r: PostActRefused): { error: string; status: number } {
  const status = refusalStatus(r.code)
  if (r.code === 'missed' || r.code === 'version' || r.code === 'note') return { error: r.reason, status }
  if (r.code === 'not_found' || r.code === 'wrong_stage' || r.code === 'not_allowed') return { error: NOT_WITH_YOU, status }
  return { error: 'That did not go through — reload the page and try again.', status }
}

/** Is this post on THIS portal? A person's portal holds only their own pieces' posts. */
async function postOnPortal(post: PostState, scope: PortalScope): Promise<boolean> {
  if (!post.source_item_id) return scope.kind === 'business'
  const item = await table<ContentItemRow>('content_items').get(post.source_item_id).catch(() => null)
  // the piece was deleted: the post stays the business's (audit S9)
  if (!item) return scope.kind === 'business'
  return belongsToPortal(item as { for_contact_id?: string | null }, scope)
}

/**
 * THE ONE PORTAL'S ANSWER (docs/ONE_PORTAL_SPEC.md R3-R8): the client's word on a BOOKED post — Approve, or Not
 * approved with a note. Its own branch, so today's "approve before booking" path is untouched; refused for a
 * client not on the one portal. A "wait" post that came off unanswered is approved through `client_ok_book`.
 */
async function answerBookedPost(body: PostBody, client: Client, scope: PortalScope): Promise<NextResponse> {
  if (!onePortal(client)) return NextResponse.json({ error: NOT_WITH_YOU }, { status: 404 })
  const postId = String(body.post_id ?? '')
  const verdict = body.action === 'client_not_approved' ? 'not_approved' : 'approved'
  const version = typeof body.version === 'number' ? body.version : Number(body.version)
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: 'This page did not say which version you saw — reload it and try again.' }, { status: 400 })
  }
  const note = String(body.note ?? '').trim().slice(0, 2000)
  const name = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)
  // a name on every answer (one portal L2): the link has no login, so the answer says who gave it
  if (!name) return NextResponse.json({ error: 'Add your name so the team knows who answered.' }, { status: 400 })
  if (verdict === 'not_approved' && !note) return NextResponse.json({ error: ANSWER_NOTE_NEEDED }, { status: 400 })

  const row = await table('social_posts').get(postId, { fresh: true }).catch(() => null)
  const post = readPostState(row as Record<string, unknown> | null)
  if (!post || post.client_id !== client.id || !(await postOnPortal(post, scope))) {
    return NextResponse.json({ error: NOT_WITH_YOU }, { status: 404 })
  }
  const action = verdict === 'not_approved' ? 'client_not_approved' : post.stage === 'ready' ? 'client_ok_book' : 'client_ok'
  const result = await clientActOnPost(client.id, post.id, { action, version, note: note || null, answered_by: name })
  if (!result.ok) {
    // the engine's refusals for this path are written for the client already (one-portal-core ANSWER_*)
    const plain = ['live', 'note', 'version', 'time', 'wrong_stage', 'invalid', 'jobs'].includes(result.code)
    return NextResponse.json({ error: plain ? result.reason : 'That did not go through — reload the page and try again.', code: result.code }, { status: refusalStatus(result.code) })
  }
  // their words also sit in the post's Client thread, for this version
  if (note) {
    const actor = await portalActor(client.id, client.name)
    const at = new Date().toISOString()
    await table<PostComment>('post_comments').insert({
      id: `${post.id}_r${result.post.rev}_client`,
      post_id: post.id, client_id: client.id, version,
      file_url: null, slide_index: null, visibility: 'client',
      author_id: actor.id, author_name: name, author_role: 'client',
      body: note, assigned_to: null, resolved_at: null, resolved_by: null,
      created_at: at, updated_at: at,
    } as PostComment).catch(e => console.error('one portal answer note:', e))
  }
  return NextResponse.json({ ok: true, stage: result.stage, scheduled_for: result.post.scheduled_for })
}

async function actOnClientPost(body: PostBody, client: Client, scope: PortalScope): Promise<NextResponse> {
  if (body.action === 'client_ok' || body.action === 'client_not_approved') return answerBookedPost(body, client, scope)
  const postId = String(body.post_id ?? '')
  const action = String(body.action ?? '')
  if (action !== 'client_approve' && action !== 'client_ask_change' && action !== 'post_note') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  const version = typeof body.version === 'number' ? body.version : Number(body.version)
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: 'This page did not say which version you saw — reload it and try again.' }, { status: 400 })
  }
  const note = String(body.note ?? body.comment ?? '').trim().slice(0, 2000)
  const authorName = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)

  const row = await table('social_posts').get(postId, { fresh: true }).catch(() => null)
  const post = readPostState(row as Record<string, unknown> | null)
  if (!post || post.client_id !== client.id || !(await postOnPortal(post, scope))) {
    return NextResponse.json({ error: NOT_WITH_YOU }, { status: 404 })
  }
  const now = new Date()
  const view = clientPostView(post, now)
  // asked here in the client's words; the writer asks again inside its claim
  if (!view || view.state === 'missed' || !view.canAnswer) {
    return NextResponse.json({ error: view?.state === 'missed' ? view.headline : NOT_WITH_YOU }, { status: 409 })
  }
  if (view.version !== version) {
    return NextResponse.json({ error: 'This is not the version you looked at — it has changed since. Reload and look again.' }, { status: 409 })
  }
  const actor = await portalActor(client.id, client.name)
  const speaker = authorName || client.name
  const at = now.toISOString()
  const noteRow = (fileUrl: string | null, slideIndex: number | null, bodyText: string, id?: string): Omit<PostComment, 'id'> & { id?: string } => ({
    ...(id ? { id } : {}),
    post_id: post.id, client_id: client.id, version,
    file_url: fileUrl, slide_index: slideIndex,
    // the client's words are the Client thread by definition (decision 9)
    visibility: 'client',
    author_id: actor.id, author_name: speaker, author_role: 'client',
    body: bodyText, assigned_to: null, resolved_at: null, resolved_by: null,
    created_at: at, updated_at: at,
  })

  if (action === 'post_note') {
    if (!note) return NextResponse.json({ error: 'Write a note first' }, { status: 400 })
    const fileUrl = typeof body.file_url === 'string' && body.file_url ? body.file_url : null
    const frozen = readFrozenPost(await table<PostVersion>('post_versions').get(postVersionId(post.id, version)).catch(() => null) as Record<string, unknown> | null)
    const files = frozen ? reviewFiles(frozen) : []
    if (!clientMayNote(view, files, fileUrl)) {
      return NextResponse.json({ error: 'That file is not on this version — reload the page and try again.' }, { status: 409 })
    }
    const index = fileUrl ? files.findIndex(f => f.url === fileUrl) : -1
    const saved = await table<PostComment>('post_comments').insert(noteRow(fileUrl, index >= 0 ? index : null, note))
    return NextResponse.json({ ok: true, note_id: saved.id })
  }

  if (action === 'client_ask_change' && !note) {
    return NextResponse.json({ error: 'Tell us what to change — a short note is enough' }, { status: 400 })
  }
  const result = await clientActOnPost(client.id, post.id, { action, version, note: note || null })
  if (!result.ok) {
    const { error, status } = refusalForClient(result)
    return NextResponse.json({ error, code: result.code }, { status })
  }
  // their words also sit in the post's Client thread, on the whole post, for this version
  if (note) {
    await table<PostComment>('post_comments')
      .insert(noteRow(null, null, note, `${post.id}_r${result.post.rev}_client`))
      .catch(e => console.error('portal post note:', e))
  }
  return NextResponse.json({ ok: true, stage: result.stage })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const body = await req.json()
    const rawToken = String(body.token ?? '')
    const token = rawToken.split('--').pop() ?? rawToken
    let client: Client | null = null
    // whose portal: the business's, or one person's (a person sees only their own pieces' posts)
    let scope: PortalScope = { kind: 'business' }
    if (/^[0-9a-f-]{36}$/i.test(token)) {
      const owner = await portalOwnerByToken(token)
      client = owner?.client ?? null
      if (owner) scope = owner.scope
    } else if (body.shoot_id || body.post_id) {
      // the signed-in portal has no token: the client's own login is the authority
      try {
        const me = await requireRole('client')
        client = me.client_id ? await table<Client>('clients').get(me.client_id) : null
      } catch { client = null }
    }
    if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })

    // ── THE PLAN ON THE SHOOT ITSELF (13 Sep 2026): shared from the shoot
    //    page, approved or sent back here, no plan document in between ──
    if (body.shoot_id && (body.action === 'approve' || body.action === 'request_changes')) {
      const shootId = String(body.shoot_id)
      const batches = table<Batch>('batches')
      const shoot = await batches.get(shootId)
      if (!shoot || shoot.client_id !== client.id) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
      if (!clientDecisionOpen(shoot)) return NextResponse.json({ error: NOT_WITH_YOU }, { status: 403 })
      const noteText = String(body.comment ?? '').trim().slice(0, 2000)
      if (body.action === 'request_changes' && !noteText) {
        return NextResponse.json({ error: 'Tell us what to change — a short note is enough' }, { status: 400 })
      }
      const decision = body.action === 'approve' ? 'approved' : 'changes'
      const now = new Date().toISOString()
      const done = await batches.claim(shootId, cur => cur && clientDecisionOpen(cur) ? { ...cur, ...(clientDecisionPatch(decision, noteText || null, now) as Partial<Batch>) } : null)
      if (!done.claimed) return NextResponse.json({ error: NOT_WITH_YOU }, { status: 409 })
      const speakerName = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)
      const who = speakerName ? `${speakerName} · ${client.name}` : client.name
      const actorRow = await portalActor(client.id, client.name)
      await logActivity({
        actor: actorRow, clientId: client.id, entityType: 'batch', entityId: shootId,
        action: decision === 'approved' ? 'sop_client_approved' : 'sop_client_changes', detail: noteText || undefined,
      })
      // their words also land in the shoot's own thread, where the team reads it
      if (noteText) {
        await table('batch_comments').insert({ batch_id: shootId, author_id: actorRow.id, body: speakerName ? `${noteText}\n— ${speakerName}` : noteText, card_id: null, resolved: false })
          .catch(e => console.error('shoot note from the portal:', e))
      }
      await notifyClientPlanDecision(done.row, decision, noteText || null, who).catch(e => console.error('client plan answer notify:', e))
      announceBatchChange({ batch_id: shootId, client_id: client.id, status: done.row.status ?? 'brief', kind: 'updated' })
      return NextResponse.json({ ok: true, decision })
    }

    // ── A POST (the posting rebuild, 29 Sep 2026): its own branch, its own
    //    rules. Never the edit card's fields; the one writer decides. ──
    if (body.post_id) return await actOnClientPost(body, client, scope)

    const itemId = String(body.item_id ?? '')
    const found = await table<ContentItemRow>('content_items').get(itemId)
    const item = found && found.client_id === client.id ? found : null
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    const action = String(body.action ?? '')
    const comment = String(body.comment ?? '').trim().slice(0, 4000)
    // A note the client already filed somewhere else — the shoot's own thread,
    // for an approved plan. It is NOT written to the item's thread a second
    // time; it travels only so the manager's approval email carries the words
    // that came with the yes.
    const note = String(body.note ?? '').trim().slice(0, 2000)
    const authorName = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)
    const speaker = authorName ? `${authorName} · ${client.name}` : client.name
    const actor = await portalActor(client.id, client.name)

    // THE CARD DECIDES WHAT IT OFFERS, AND SO DOES THIS ROUTE — from the same
    // rule. A card that is not with the client cannot be approved by guessing
    // its id, and a draft nobody has checked has no thread for them yet. The
    // state machine would refuse the move anyway; this says why, in the
    // client's words, before it gets there.
    const offered = portalActions(item.status as ItemStatus)
    if ((action === 'approve' && !offered.approve)
      || (action === 'request_changes' && !offered.askForChange)
      || (action === 'comment' && !offered.comment)) {
      return NextResponse.json({ error: NOT_WITH_YOU }, { status: 403 })
    }
    // …and a shoot PLAN can only be decided on when the shoot was actually
    // shared with them: the brief item may sit at client_review while the
    // manager has not yet chosen to show the plan. Same rule as the card.
    if ((action === 'approve' || action === 'request_changes') && item.work_kind_id && item.batch_id) {
      const kind = await table<WorkKind>('work_kinds').get(item.work_kind_id).catch(() => null)
      if (kind?.slug === 'shoot_brief') {
        const batch = await table<Batch>('batches').get(item.batch_id).catch(() => null)
        if (!planDecidable(batch?.shared_with_client === true, item.status)) {
          return NextResponse.json({ error: NOT_WITH_YOU }, { status: 403 })
        }
      }
    }

    if (action === 'comment' && !comment) {
      return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })
    }
    if (action === 'request_changes' && !comment) {
      return NextResponse.json({ error: 'Tell us what to change — a short note is enough' }, { status: 400 })
    }

    // THE OLD POST DOORS ARE SHUT (the posting rebuild): a post is answered by
    // its own id and the version the client saw, never by its edit card's id —
    // that is how an internal-only post was approved from a guessed id (audit V5).
    if (action === 'approve_post' || action === 'request_post_changes') {
      return NextResponse.json({ error: 'This page is out of date — reload it and try again.' }, { status: 409 })
    }

    // for approve/request_changes, validate the transition FIRST: a refused
    // state change (someone acted concurrently) must not leave an orphan note
    // in the thread claiming an action that never happened
    let transitioned: { status?: string } | null = null
    if (action === 'approve' || action === 'request_changes') {
      const to = action === 'approve' ? 'approved_for_scheduling' : 'client_changes_requested'
      transitioned = await performTransition(actor, item as ContentItem, to, {
        note: note || undefined,
      })
    }

    // any note the client wrote lands in the thread, client-visible
    if (comment) {
      await table('item_comments').insert({
        item_id: item.id,
        author_id: actor.id,
        visibility: 'client',
        // sign with who at the client actually spoke
        body: authorName ? `${comment}\n— ${authorName}` : comment,
        resolved: false,
      })
      await logActivity({
        actor, clientId: client.id,
        entityType: 'content_item', entityId: item.id,
        action: 'comment_added', detail: 'client (portal)',
      })
      announceItemChange({ item_id: item.id, client_id: client.id, status: item.status, kind: 'comment' })
    }

    if (action === 'approve' || action === 'request_changes') {
      // any note riding along (a preferred posting date, a thank-you, a
      // condition) must reach the manager, approval or not
      if (comment) {
        // AWAITED: on serverless the invocation freezes the moment we return,
        // so fire-and-forget here silently lost the emails
        await notifyManagers(client.id, item, item.title, speaker, comment).catch(e =>
          console.error('portal manager notify error:', e))
        // (the note used to be relayed to every scheduler as well — no longer:
        // no scheduler is on the card until a manager hands it over, 15 Sep 2026)
      }
      return NextResponse.json({ ok: true, status: transitioned?.status })
    }
    if (action === 'comment') {
      await notifyManagers(client.id, item, item.title, speaker, comment).catch(e =>
        console.error('portal manager notify error:', e))
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong'
    // surface the transition's own safe copy (concurrent action) as 409;
    // never leak a raw DB/Postgres error string to the public caller
    const conflict = /just updated|not allowed|cannot/i.test(message)
    if (!conflict) console.error('portal act error:', e)
    return NextResponse.json(
      { error: conflict ? message : 'Something went wrong — try again' },
      { status: conflict ? 409 : 500 },
    )
  }
  })
}
