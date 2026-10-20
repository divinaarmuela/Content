import { NextResponse, after } from 'next/server'
import { resolveTags, taggableTeam } from '../../../lib/comment-tags'
import { table } from '@/lib/db'
import type { Todo as TodoRow, TodoComment, TodoField as TodoFieldRow, TodoProjectSection } from '@/lib/db-types'
import { mergeFieldValues } from '../../../lib/todo-fields-core'
import { authzErrorResponse, requireRole } from '../../../lib/authz'
import { logActivity } from '../../../lib/workflow'
import { idsOf, mayDeleteTodo, mayDependOn, mayEditTodo, sanitiseTodoPatch, todoAudience, todoChanges, todoFilesOf, toggleId } from '../../../lib/todo-core'
import { notifyTodo } from '../../../lib/todo-notify'
import { nextDue, nextTodoId, normaliseRepeat } from '../../../lib/todo-repeat-core'
import { dayKeyInZone } from '../../../lib/timezone-core'

/** One to-do: PATCH what changed (title, note, status, date, who, client, files), DELETE it. */
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ error: 'That to-do is gone' }, { status: 404 })
    if (!mayEditTodo({ id: user.id, role: user.role }, row as never)) return NextResponse.json({ error: 'Not your to-do' }, { status: 403 })
    const checked = sanitiseTodoPatch(await req.json().catch(() => ({})))
    if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })
    // DEPENDENCIES (18 Oct 2026): only real to-dos, never itself, never a loop
    if (checked.patch.blocked_by) {
      const all = await table<TodoRow>('todos').list()
      checked.patch.blocked_by = idsOf(checked.patch.blocked_by).filter(b => all.some(t => t.id === b) && mayDependOn(id, b, all as never))
    }
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { ...checked.patch, updated_at: now }
    // CUSTOM FIELDS (20 Oct 2026): the posted values merged onto what it had, each checked against its field
    if ('fields' in checked.patch) {
      const defs = await table<TodoFieldRow>('todo_fields').list()
      patch.fields = mergeFieldValues(row.fields, checked.patch.fields, defs.map(d => ({ id: d.id, name: d.name, type: d.type as never, options: (d.options ?? []) as never })))
    }
    // A PROJECT'S SECTION must be one of its own client's
    if (checked.patch.project_section_id) {
      const sec = await table<TodoProjectSection>('todo_project_sections').get(checked.patch.project_section_id)
      const clientId = 'client_id' in checked.patch ? checked.patch.client_id : row.client_id
      if (!sec || sec.client_id !== clientId) return NextResponse.json({ error: 'That section is not on this client\'s project' }, { status: 400 })
    }
    // ticking it done stamps who and when; reopening clears them
    if (checked.patch.status === 'done' && row.status !== 'done') { patch.done_at = now; patch.done_by = user.id }
    if (checked.patch.status === 'open') { patch.done_at = null; patch.done_by = null }
    const updated = await table<TodoRow>('todos').update(id, patch as never)
    // REPEATS (20 Oct 2026, as Asana does it): ticking a repeating to-do done makes the next one, due on the next
    // day its rule allows. Claimed on a fixed id (`<id>_next`), so a double tick, a re-tick after a reopen, or
    // two people at once make it once (trap 11). Same title, note, person, client, section and followers.
    const rule = normaliseRepeat('repeat' in checked.patch ? checked.patch.repeat : row.repeat)
    if (rule && checked.patch.status === 'done' && row.status !== 'done') {
      const doneOn = dayKeyInZone(new Date(), 'Australia/Melbourne') ?? now.slice(0, 10)
      const nextId = nextTodoId(id)
      const made = await table<TodoRow>('todos').claim(nextId, cur => (cur ? null : {
        id: nextId, title: row.title, note: row.note ?? null, status: 'open',
        due_date: nextDue(rule, row.due_date, doneOn),
        owner_id: row.owner_id ?? null, created_by: row.created_by ?? user.id, client_id: row.client_id ?? null,
        files: row.files ?? [], followers: row.followers ?? null, section_id: row.section_id ?? null,
        position: row.position ?? null, repeat: rule, repeat_of: id,
        created_at: now, updated_at: now, done_at: null, done_by: null,
      } as never))
      if (made.claimed) {
        await logActivity({ entityType: 'todo', entityId: nextId, action: 'todo_repeated', actor: user, newValue: (made.row as TodoRow).due_date ?? undefined, detail: String(row.title ?? '').slice(0, 200) })
      }
    }
    if (checked.patch.status && checked.patch.status !== row.status) {
      await logActivity({ entityType: 'todo', entityId: id, action: checked.patch.status === 'done' ? 'todo_done' : 'todo_reopened', actor: user, detail: String(row.title ?? '').slice(0, 200) })
      if (checked.patch.status === 'done') {
        after(() => notifyTodo({ actor: user, todo: row as never, recipientIds: todoAudience(row as never, user.id), verb: 'completed', event: 'todo_done', eventKey: `done:${now}` }).catch(e => console.error('[todos] notify failed:', e)))
      }
    }
    // THE ACTIVITY FEED (18 Oct 2026): one line per field that changed, old → new
    for (const c of todoChanges(row as never, checked.patch as never)) {
      await logActivity({ entityType: 'todo', entityId: id, action: `todo_changed:${c.field}`, actor: user, oldValue: c.from ?? undefined, newValue: c.field === 'note' ? undefined : c.to ?? undefined, detail: String(row.title ?? '').slice(0, 200) })
      if (c.field === 'owner_id' && c.to && c.to !== user.id) {
        after(() => notifyTodo({ actor: user, todo: row as never, recipientIds: [c.to as string], verb: 'assigned you', event: 'todo_assigned', eventKey: `assigned:${c.to}:${now}` }).catch(e => console.error('[todos] notify failed:', e)))
      }
    }
    // TAGS IN THE DESCRIPTION (Manal, 20 Oct 2026, her video: tagging someone "doesn't notify them"): an @Name newly
    // written into the description joins them to the to-do, so they can open it, and tells them — bell, email, Inbox
    if ('note' in checked.patch && typeof checked.patch.note === 'string') {
      const team = await taggableTeam()
      const before = new Set(resolveTags(String(row.note ?? ''), [], team, user.id).map(t => t.id))
      const added = resolveTags(checked.patch.note, [], team, user.id).map(t => t.id).filter(t => !before.has(t))
      if (added.length) {
        await table<TodoRow>('todos').claim(id, cur => {
          if (!cur) return null
          let followers: unknown = cur.followers
          for (const p of added) if (p !== cur.owner_id && p !== cur.created_by) followers = toggleId(followers, p, true)
          return { ...cur, followers } as TodoRow
        })
        after(() => notifyTodo({ actor: user, todo: row as never, recipientIds: added, verb: 'mentioned you in', event: 'todo_mentioned', eventKey: `note:${now}`, quote: checked.patch.note as string }).catch(e => console.error('[todos] notify failed:', e)))
      }
    }
    if ('blocked_by' in checked.patch) {
      const before = new Set(idsOf(row.blocked_by))
      for (const b of idsOf(checked.patch.blocked_by).filter(b => !before.has(b))) {
        await logActivity({ entityType: 'todo', entityId: id, action: 'todo_dependency', actor: user, newValue: b, detail: String(row.title ?? '').slice(0, 200) })
      }
    }
    if ('files' in checked.patch) {
      const before = new Set(todoFilesOf(row.files).map(f => f.url))
      for (const f of todoFilesOf(checked.patch.files).filter(f => !before.has(f.url))) {
        await logActivity({ entityType: 'todo', entityId: id, action: 'todo_attached', actor: user, detail: f.name.slice(0, 200) })
      }
    }
    return NextResponse.json(updated)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireRole('scheduler')   // any team role
    const { id } = await ctx.params
    const row = await table<TodoRow>('todos').get(id)
    if (!row) return NextResponse.json({ ok: true })
    if (!mayDeleteTodo({ id: user.id, role: user.role }, row as never)) return NextResponse.json({ error: 'Only the person who made it, or a super admin, can delete it' }, { status: 403 })
    await table<TodoRow>('todos').remove(id)
    // its subtasks go with it, and every comment on it or on them
    const subs = await table<TodoRow>('todos').list({ where: t => t.parent_id === id })
    await table<TodoRow>('todos').removeWhere(t => t.parent_id === id)
    const gone = new Set([id, ...subs.map(t => t.id)])
    await table<TodoComment>('todo_comments').removeWhere(c => gone.has(String(c.todo_id)))
    await logActivity({ entityType: 'todo', entityId: id, action: 'todo_deleted', actor: user, detail: String(row.title ?? '').slice(0, 200) })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
