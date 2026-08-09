import 'server-only'
import { tool } from 'ai'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { roleSatisfies, type Role } from './identity-core'

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
        let q = supabase.from('clients')
          .select('id, name, industry, contact_name, email, phone, status, created_at')
          .order('name').limit(50)
        if (status !== 'any') q = q.eq('status', status)
        if (query) q = q.or(`name.ilike.%${query}%,industry.ilike.%${query}%,contact_name.ilike.%${query}%`)
        const { data, error } = await q
        if (error) return { error: error.message }
        return { clients: data }
      },
    }),

    get_client: tool({
      description:
        'One client in full: profile, contacts, intake forms with completion, and open production work.',
      inputSchema: z.object({ client_id: z.string().uuid() }),
      execute: async ({ client_id }) => {
        const [client, contacts, forms] = await Promise.all([
          supabase.from('clients')
            .select('id, name, slug, industry, contact_name, email, phone, status, created_at')
            .eq('id', client_id).maybeSingle(),
          supabase.from('client_contacts').select('name, role, email, phone').eq('client_id', client_id),
          supabase.from('intake_forms')
            .select('id, title, template_key, status, sent_at, submitted_at')
            .eq('client_id', client_id),
        ])
        if (!client.data) return { error: 'No such client' }
        return { client: client.data, contacts: contacts.data ?? [], intake_forms: forms.data ?? [] }
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
        let q = supabase.from('leads')
          .select('id, created_at, fname, lname, email, biz, need, budget, timeline, source')
          .gte('created_at', since).order('created_at', { ascending: false }).limit(100)
        if (search) q = q.or(`fname.ilike.%${search}%,lname.ilike.%${search}%,biz.ilike.%${search}%,email.ilike.%${search}%`)
        const { data, error } = await q
        if (error) return { error: error.message }
        return { since, count: data.length, leads: data }
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
        let q = supabase.from('schedule_entries')
          .select('id, platform, scheduled_at, publish_status, published_at, content_items(title, client_id, clients(name))')
          .lte('scheduled_at', until).order('scheduled_at').limit(100)
        if (client_id) q = q.eq('content_items.client_id', client_id)
        const { data, error } = await q
        if (error) return { error: error.message }
        return { entries: data }
      },
    }),

    get_intake_status: tool({
      description:
        'Intake forms across all clients: who was sent one, who has opened it, who has submitted, completion state.',
      inputSchema: z.object({
        only: z.enum(['outstanding', 'submitted', 'all']).default('all'),
      }),
      execute: async ({ only }) => {
        let q = supabase.from('intake_forms')
          .select('id, title, template_key, status, sent_at, first_opened_at, submitted_at, clients(id, name)')
          .order('created_at', { ascending: false }).limit(100)
        if (only === 'outstanding') q = q.neq('status', 'submitted')
        if (only === 'submitted') q = q.eq('status', 'submitted')
        const { data, error } = await q
        if (error) return { error: error.message }
        return { forms: data }
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
          supabase.from('scan_mailboxes').select('email, enabled, connected_at'),
          supabase.from('scan_runs')
            .select('mailbox, status, started_at, scanned, claimed, leads_created, error')
            .gte('started_at', since).order('started_at', { ascending: false }).limit(30),
          supabase.from('email_ingest_log')
            .select('created_at, mailbox, from_email, subject, status, is_lead')
            .gte('created_at', since).order('created_at', { ascending: false }).limit(30),
        ])
        return {
          mailboxes: mailboxes.data ?? [],
          recent_runs: runs.data ?? [],
          recent_messages: picked.data ?? [],
        }
      },
    }),

    get_team: tool({
      description: 'The MD Media team: names, roles, emails.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase.from('team_users')
          .select('name, email, role, employment_type, active_status').order('name')
        if (error) return { error: error.message }
        return { team: data }
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
        const { data, error } = await supabase.from('clients')
          .update({ [field]: value }).eq('id', client_id).select('id, name').maybeSingle()
        if (error) return { error: error.message }
        if (!data) return { error: 'No such client' }
        return { updated: data.name, field, value }
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
        const { data, error } = await supabase.from('leads')
          .update({ need }).eq('id', lead_id).select('id, fname, lname').maybeSingle()
        if (error) return { error: error.message }
        if (!data) return { error: 'No such lead' }
        return { updated: `${data.fname} ${data.lname}`.trim() }
      },
    }),
  }
}
