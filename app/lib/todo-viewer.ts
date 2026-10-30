import 'server-only'
import { table } from '@/lib/db'
import { hiddenProjectsFor, type TodoViewer } from './todo-core'

/** The to-do viewer the routes check with: who they are, and the clients they are on (a client's project, 20 Oct 2026). */
export async function todoViewerOf(user: { id: string; role: string }): Promise<TodoViewer> {
  const [links, projects] = await Promise.all([
    table<{ id: string; team_user_id: string; client_id: string }>('team_user_clients').list({ by: { team_user_id: user.id } }).catch(() => []),
    table<{ id: string; private?: boolean | null; member_ids?: unknown }>('todo_projects' as never).list().catch(() => []),
  ])
  return { id: user.id, role: user.role, clientIds: links.map(l => l.client_id), hiddenProjects: hiddenProjectsFor(user.id, projects) }
}
