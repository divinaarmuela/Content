import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { performTransition, logActivity, type ContentItem } from '../../../lib/workflow'
import { notify, renderEmail } from '../../../lib/mailer'
import { announceItemChange } from '../../../lib/production-live'
import type { TeamUser } from '../../../lib/authz'

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
  const { data: existing } = await supabase
    .from('team_users').select('*').eq('email', email).maybeSingle()
  if (existing) return existing as TeamUser
  const { data: created, error } = await supabase
    .from('team_users')
    .upsert({
      email,
      name: `${clientName} (client portal)`,
      role: 'client',
      client_id: clientId,
      employment_type: 'contractor',
      timezone: 'Australia/Melbourne',
      active_status: false,
    }, { onConflict: 'email' })
    .select()
    .single()
  if (error || !created) throw new Error(error?.message ?? 'Could not create the portal identity')
  return created as TeamUser
}

/** Client comments route to the client's managers — never the editor. */
async function notifyManagers(clientId: string, itemId: string, itemTitle: string, clientName: string, body: string) {
  const { data } = await supabase
    .from('team_user_clients')
    .select('team_users!team_user_clients_team_user_id_fkey(id, email, name, role, active_status)')
    .eq('client_id', clientId)
  const managers = (data ?? [])
    .map(r => r.team_users as unknown as { id: string; email: string; role: string; active_status: boolean })
    .filter(u => (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
  for (const m of managers) {
    await notify({
      actorName: clientName,
      eventType: 'client_comment',
      entityType: 'item_comment',
      entityId: `${itemId}#${Date.now()}`,
      recipientId: m.id,
      recipientEmail: m.email,
      subject: `Client comment on ${itemTitle}`,
      bodyHtml: renderEmail(
        `Client comment on ${itemTitle}`,
        `<p>${body.slice(0, 500)}</p><p style="color:#a1a1aa;font-size:12px;">From ${clientName}'s portal. Review it and assign an editor task if changes are needed.</p>`,
        'Open the item',
        `${DASHBOARD_URL}/dashboard/production/${itemId}`
      ),
    })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rawToken = String(body.token ?? '')
    const token = rawToken.split('--').pop() ?? rawToken
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    }
    const { data: client } = await supabase
      .from('clients').select('id, name').eq('share_token', token).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })

    const itemId = String(body.item_id ?? '')
    const { data: item } = await supabase
      .from('content_items').select('*').eq('id', itemId).eq('client_id', client.id).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    const action = String(body.action ?? '')
    const comment = String(body.comment ?? '').trim().slice(0, 4000)
    const authorName = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)
    const speaker = authorName ? `${authorName} · ${client.name}` : client.name
    const actor = await portalActor(client.id, client.name)

    if (action === 'comment' && !comment) {
      return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })
    }
    if (action === 'request_changes' && !comment) {
      return NextResponse.json({ error: 'Tell us what to change — a short note is enough' }, { status: 400 })
    }

    // any note the client wrote lands in the thread, client-visible
    if (comment) {
      const { error } = await supabase.from('item_comments').insert({
        item_id: item.id,
        author_id: actor.id,
        visibility: 'client',
        // sign with who at the client actually spoke
        body: authorName ? `${comment}\n— ${authorName}` : comment,
      })
      if (error) throw new Error(error.message)
      await logActivity({
        actor, clientId: client.id,
        entityType: 'content_item', entityId: item.id,
        action: 'comment_added', detail: 'client (portal)',
      })
      announceItemChange({ item_id: item.id, client_id: client.id, status: item.status, kind: 'comment' })
    }

    if (action === 'approve' || action === 'request_changes') {
      const to = action === 'approve' ? 'approved_for_scheduling' : 'client_changes_requested'
      const updated = await performTransition(actor, item as ContentItem, to)
      // any note riding along (a preferred posting date, a thank-you, a
      // condition) must reach the manager, approval or not
      if (comment) {
        void notifyManagers(client.id, item.id, item.title, speaker, comment)
      }
      return NextResponse.json({ ok: true, status: updated.status })
    }
    if (action === 'comment') {
      void notifyManagers(client.id, item.id, item.title, speaker, comment)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong'
    const status = /just updated|not allowed|cannot/i.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
