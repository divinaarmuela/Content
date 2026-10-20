import 'server-only'
import { table } from '@/lib/db'
import type { TodoViewer } from './todo-core'

/** The to-do viewer the routes check with: who they are, and the clients they are on (a client's project, 20 Oct 2026). */
export async function todoViewerOf(user: { id: string; role: string }): Promise<TodoViewer> {
  const links = await table<{ id: string; team_user_id: string; client_id: string }>('team_user_clients').list({ by: { team_user_id: user.id } }).catch(() => [])
  return { id: user.id, role: user.role, clientIds: links.map(l => l.client_id) }
}
