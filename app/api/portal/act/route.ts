import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Client, TeamUser as TeamUserRow, TeamUserClient, ContentItem as ContentItemRow } from '@/lib/db-types'
import { performTransition, logActivity, type ContentItem } from '../../../lib/workflow'
import { notify, renderEmail, escapeHtml } from '../../../lib/mailer'
import { announceItemChange } from '../../../lib/production-live'
import { actOnPostingApproval } from '../../../lib/posting-approval'
import { AuthzError, type TeamUser } from '../../../lib/authz'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

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
async function notifyManagers(clientId: string, itemId: string, itemTitle: string, clientName: string, body: string) {
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
        `${DASHBOARD_URL}/dashboard/production/${itemId}`
      ),
    })
  }
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const body = await req.json()
    const rawToken = String(body.token ?? '')
    const token = rawToken.split('--').pop() ?? rawToken
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    }
    const client = (await table<Client>('clients').list({
      where: c => c.share_token === token, limit: 1,
    }))[0]
    if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })

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

    if (action === 'comment' && !comment) {
      return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })
    }
    if (action === 'request_changes' && !comment) {
      return NextResponse.json({ error: 'Tell us what to change — a short note is enough' }, { status: 400 })
    }

    // ── the FINAL POST — the caption and timing, distinct from the asset
    //    the client approved earlier. Their yes (or their note) lands on the
    //    same columns the dashboard's gate uses, through the same function,
    //    wearing the client hat. ──
    if (action === 'approve_post' || action === 'request_post_changes') {
      if (action === 'request_post_changes' && !comment) {
        return NextResponse.json({ error: 'Tell us what to change — a short note is enough' }, { status: 400 })
      }
      try {
        await actOnPostingApproval(actor, item as never, {
          action: action === 'approve_post' ? 'approve' : 'request_changes',
          note: comment || undefined,
        })
      } catch (err) {
        if (err instanceof AuthzError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
      // the client's answer is the calendar's answer too
      const { syncFromItem } = await import('../../../lib/social-schedule')
      await syncFromItem(item.id).catch(e =>
        console.error('schedule mirror failed:', (e as Error).message))
      // whatever they wrote also reaches the thread, client-visible, and the
      // client's managers — the same promise every portal note gets
      if (comment) {
        await table('item_comments').insert({
          item_id: item.id,
          author_id: actor.id,
          visibility: 'client',
          body: authorName ? `${comment}\n— ${authorName}` : comment,
          resolved: false,
        })
        await notifyManagers(client.id, item.id, item.title, speaker, comment).catch(e =>
          console.error('portal manager notify error:', e))
      }
      return NextResponse.json({ ok: true })
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
        await notifyManagers(client.id, item.id, item.title, speaker, comment).catch(e =>
          console.error('portal manager notify error:', e))
        // an APPROVAL note often carries the "when" — the schedulers who'll
        // actually set the date must hear it too (they never see comments)
        if (action === 'approve') {
          await (async () => {
            const schedulers = await table<TeamUserRow>('team_users').list({
              by: { active_status: true }, where: u => u.role === 'scheduler',
            })
            for (const s of schedulers) {
              await notify({
                actorName: speaker,
                actorEmail: 'portal+client@mdmmarketing.com.au',
                eventType: 'approval_note',
                entityType: 'content_item',
                entityId: `${item.id}#note`,
                recipientId: s.id,
                recipientEmail: s.email,
                subject: `Approved with a note: ${item.title}`,
                bodyHtml: renderEmail(
                  `Approved with a note: ${item.title}`,
                  `<p><strong>${escapeHtml(item.title)}</strong> was approved by ${escapeHtml(speaker)} with this note — it may say when they want it posted:</p><p>“${escapeHtml(comment.slice(0, 500))}”</p>`,
                  'Open the item',
                  `${DASHBOARD_URL}/dashboard/production/${item.id}`
                ),
              })
            }
          })().catch(e => console.error('approval-note scheduler notify error:', e))
        }
      }
      return NextResponse.json({ ok: true, status: transitioned?.status })
    }
    if (action === 'comment') {
      await notifyManagers(client.id, item.id, item.title, speaker, comment).catch(e =>
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
