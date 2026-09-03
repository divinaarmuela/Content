import 'server-only'
import { tool } from 'ai'
import { z } from 'zod'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  Client, ClientContact, EmailIngestLog, IntakeForm, Lead,
  ScanMailbox, ScanRun, ScheduleEntry, TeamUser,
} from '@/lib/db-types'
import { roleSatisfies, type Role } from './identity-core'
import { asanaConfigured, tasksForAssignee } from './asana'

/**
 * The assistant's toolbox.
 *
 * Deliberately NOT text-to-SQL: the model never composes a query. Each tool is
 * a fixed, typed read or write over the same tables the dashboard's own API
 * routes use, so the assistant can only reach what a signed-in team member
 * could reach by clicking. Writes are few, narrow, and marked
 * `needsApproval` — the route streams an approval request to the browser and
 * nothing executes until the person clicks Approve.
 *
 * Tools are built per-request, closed over the caller's role, so a future
 * role-restricted tool has the caller in scope. Results are shaped down to
 * what the answer needs — notes, tokens, and credentials never enter the
 * model's context at all.
 */

const iso = (d: Date) => d.toISOString()

export function assistantTools(role: Role) {
  return {
    search_clients: tool({
      description:
        'Search clients by name, industry, contact or status. Empty query lists everyone.',
      inputSchema: z.object({
        query: z.string().default(''),
        status: z.enum(['active', 'paused', 'archived', 'any']).default('any'),
      }),
      execute: async ({ query, status }) => {
        const needle = query.toLowerCase()
        const like = (v: string | null | undefined) => !!v && v.toLowerCase().includes(needle)
        const clients = await table<Client>('clients').list({
          where: c => (status === 'any' || c.status === status)
            && (!query || like(c.name) || like(c.industry) || like(c.contact_name)),
          orderBy: [['name', 'asc']],
          limit: 50,
        })
        return { clients }
      },
    }),

    get_client: tool({
      description:
        'One client in full: profile, contacts, intake forms with completion, and open production work.',
      inputSchema: z.object({ client_id: z.string().uuid() }),
      execute: async ({ client_id }) => {
        const [client, contacts, forms] = await Promise.all([
          table<Client>('clients').get(client_id),
          table<ClientContact>('client_contacts').list({ by: { client_id } }),
          table<IntakeForm>('intake_forms').list({ by: { client_id } }),
        ])
        if (!client) return { error: 'No such client' }
        return { client, contacts, intake_forms: forms }
      },
    }),

    get_leads: tool({
      description:
        'Leads in a date range, with source (web form or inbox scanner). Defaults to the last 30 days.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(365).default(30),
        search: z.string().default(''),
      }),
      execute: async ({ days, search }) => {
        const since = iso(new Date(Date.now() - days * 86_400_000))
        const needle = search.toLowerCase()
        const like = (v: string | null | undefined) => !!v && v.toLowerCase().includes(needle)
        const leads = await table<Lead>('leads').list({
          where: l => l.created_at >= since
            && (!search || like(l.fname) || like(l.lname) || like(l.biz) || like(l.email)),
          orderBy: [['created_at', 'desc']],
          limit: 100,
        })
        return { since, count: leads.length, leads }
      },
    }),

    get_schedule: tool({
      description:
        'Scheduled content: what is due to publish, per client or overall. Times are UTC; present them in Melbourne time.',
      inputSchema: z.object({
        client_id: z.string().uuid().optional(),
        days_ahead: z.number().int().min(1).max(90).default(14),
      }),
      execute: async ({ client_id, days_ahead }) => {
        const until = iso(new Date(Date.now() + days_ahead * 86_400_000))
        const rows = await table<ScheduleEntry>('schedule_entries').list({
          where: e => e.scheduled_at != null && e.scheduled_at <= until,
          orderBy: [['scheduled_at', 'asc']],
          limit: 100,
        })
        // the item, and the item's client name — the same two levels the
        // dashboard shows against a scheduled post
        const withItem = await attachOne(rows, 'item_id', 'content_items', ['title', 'client_id'])
        const items = withItem.map(r => r.content_items as { title: string; client_id: string } | null)
        const named = await attachOne(
          items.filter((i): i is { title: string; client_id: string } => !!i),
          'client_id', 'clients', ['name'],
        )
        const byClient = new Map(named.map(i => [i.client_id, i.clients]))
        const entries = withItem.map(r => {
          const item = r.content_items as { title: string; client_id: string } | null
          // a client filter narrows the ITEM, exactly as the embedded filter
          // did: an entry whose item belongs to somebody else keeps its row
          // and loses its item
          const keep = item && (!client_id || item.client_id === client_id)
          return {
            ...r,
            content_items: keep ? { ...item, clients: byClient.get(item.client_id) ?? null } : null,
          }
        })
        return { entries }
      },
    }),

    get_intake_status: tool({
      description:
        'Intake forms across all clients: who was sent one, who has opened it, who has submitted, completion state.',
      inputSchema: z.object({
        only: z.enum(['outstanding', 'submitted', 'all']).default('all'),
      }),
      execute: async ({ only }) => {
        const rows = await table<IntakeForm>('intake_forms').list({
          where: f => only === 'all'
            || (only === 'submitted' ? f.status === 'submitted' : f.status !== 'submitted'),
          orderBy: [['created_at', 'desc']],
          limit: 100,
        })
        const forms = await attachOne(rows, 'client_id', 'clients', ['id', 'name'])
        return { forms }
      },
    }),

    get_intake_answers: tool({
      description:
        'Read what a client has actually written in an intake form so far, question by question, ' +
        'including partially filled forms: answered questions with their answers, and which are still blank. ' +
        'Defaults to the client\'s most recent form; pass form_id for a specific one.',
      inputSchema: z.object({
        client_id: z.string().uuid(),
        form_id: z.string().uuid().optional(),
      }),
      execute: async ({ client_id, form_id }) => {
        const data = await table<IntakeForm>('intake_forms').list({
          by: { client_id },
          where: f => !form_id || f.id === form_id,
          orderBy: [['created_at', 'desc']],
          limit: 1,
        })
        const form = data[0]
        if (!form) return { error: 'This client has no intake form' }

        const answers = (form.answers ?? {}) as Record<string, unknown>
        const def = form.definition as {
          sections?: { title: string; blocks?: { id: string; type: string; label: string }[] }[]
        }
        const sections = (def.sections ?? []).map(s => ({
          title: s.title,
          questions: (s.blocks ?? [])
            .filter(b => b.type !== 'guidance')
            .map(b => {
              const v = answers[b.id]
              return {
                question: b.label,
                answer: v === undefined || v === '' ? null
                  : Array.isArray(v) ? v.join(', ') : String(v),
              }
            }),
        }))
        const flat = sections.flatMap(s => s.questions)
        return {
          form: { id: form.id, title: form.title, status: form.status, submitted_at: form.submitted_at },
          answered: flat.filter(x => x.answer !== null).length,
          total: flat.length,
          sections,
        }
      },
    }),

    get_scanner_status: tool({
      description:
        'Inbox scanner health: connected mailboxes, most recent runs, and what the scanner picked up lately.',
      inputSchema: z.object({
        hours: z.number().int().min(1).max(168).default(24),
      }),
      execute: async ({ hours }) => {
        const since = iso(new Date(Date.now() - hours * 3_600_000))
        const [mailboxes, runs, picked] = await Promise.all([
          table<ScanMailbox>('scan_mailboxes').list(),
          table<ScanRun>('scan_runs').list({
            where: r => r.started_at >= since,
            orderBy: [['started_at', 'desc']],
            limit: 30,
          }),
          table<EmailIngestLog>('email_ingest_log').list({
            where: r => r.created_at >= since,
            orderBy: [['created_at', 'desc']],
            limit: 30,
          }),
        ])
        return {
          mailboxes,
          recent_runs: runs,
          recent_messages: picked,
        }
      },
    }),

    get_team: tool({
      description: 'The MD Media team: names, roles, emails.',
      inputSchema: z.object({}),
      execute: async () => {
        const team = await table<TeamUser>('team_users').list({ orderBy: [['name', 'asc']] })
        return { team }
      },
    }),

    get_asana_tasks: tool({
      description:
        'One team member\'s Asana tasks: open tasks with due dates, and what they completed recently. ' +
        'Requires a specific team member; if the user has not named one, ask them which team member ' +
        'before calling this. If the name is ambiguous or unknown, the result lists who is available.',
      inputSchema: z.object({
        team_member: z.string().min(1).describe('Name or email of the team member'),
        completed_days: z.number().int().min(1).max(30).default(7),
      }),
      execute: async ({ team_member, completed_days }) => {
        if (!asanaConfigured()) return { error: 'Asana is not connected' }
        const workspace = process.env.ASANA_WORKSPACE_GID
        if (!workspace) return { error: 'Asana workspace is not configured' }

        const members = await table<TeamUser>('team_users').list({
          by: { active_status: true },
          where: m => m.asana_user_gid != null,
        })

        const q = team_member.toLowerCase()
        const hits = members.filter(m =>
          m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q))
        if (hits.length !== 1) {
          return {
            error: hits.length === 0
              ? `No team member matching "${team_member}" is linked to Asana`
              : `"${team_member}" matches more than one person; ask the user which one`,
            available: members.map(m => m.name || m.email),
          }
        }

        const since = new Date(Date.now() - completed_days * 86_400_000).toISOString()
        const tasks = await tasksForAssignee(hits[0].asana_user_gid!, workspace, since)
          .catch((e: Error) => e)
        if (tasks instanceof Error) return { error: `Asana said: ${tasks.message}` }

        const today = new Date().toISOString().slice(0, 10)
        const shape = (t: typeof tasks[number]) => ({
          name: t.name,
          due_on: t.due_on,
          overdue: Boolean(!t.completed && t.due_on && t.due_on < today),
          projects: (t.projects ?? []).map(p => p.name).filter(Boolean),
          url: t.permalink_url,
        })
        return {
          member: hits[0].name || hits[0].email,
          open: tasks.filter(t => !t.completed).map(shape).slice(0, 50),
          completed_recently: tasks.filter(t => t.completed)
            .map(t => ({ name: t.name, completed_at: t.completed_at })).slice(0, 30),
        }
      },
    }),

    update_client: tool({
      description:
        'Change a client profile field: status, industry, contact name, email or phone. Requires human approval before it runs.',
      inputSchema: z.object({
        client_id: z.string().uuid(),
        field: z.enum(['status', 'industry', 'contact_name', 'email', 'phone']),
        value: z.string(),
      }),
      needsApproval: true,
      execute: async ({ client_id, field, value }) => {
        if (!roleSatisfies(role, 'editor')) return { error: 'Your role cannot edit clients' }
        if (field === 'status' && !['active', 'paused', 'archived'].includes(value)) {
          return { error: 'Status must be active, paused or archived' }
        }
        const updated = await table<Client>('clients')
          .update(client_id, { [field]: value } as Partial<Client>)
        if (!updated) return { error: 'No such client' }
        return { updated: updated.name, field, value }
      },
    }),

    update_lead_note: tool({
      description:
        'Update what a lead needs (the "need" field) after a call. Requires human approval before it runs.',
      inputSchema: z.object({
        lead_id: z.string().uuid(),
        need: z.string().max(2000),
      }),
      needsApproval: true,
      execute: async ({ lead_id, need }) => {
        if (!roleSatisfies(role, 'editor')) return { error: 'Your role cannot edit leads' }
        const updated = await table<Lead>('leads').update(lead_id, { need })
        if (!updated) return { error: 'No such lead' }
        return { updated: `${updated.fname} ${updated.lname}`.trim() }
      },
    }),
  }
}
