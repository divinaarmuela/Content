// scripts/migrate-core.mjs — pure parts of the migration, tested.
//
// Mirrors lib/db-types.ts (NATURAL_KEYS, encodeKey) and lib/db.ts
// (UNIQUE_COLUMNS) in plain JS because this script runs without TypeScript.
// Keep byte-identical in behaviour with those files — tests/migrate-core.test.ts
// pins the shape.
export const SKIPPED = ['scan_runs', 'asana_events']

// Every TableName from lib/db-types.ts except SKIPPED.
export const TABLES = [
  'agency_credentials', 'approvals', 'asana_project_map', 'asana_tasks', 'asana_webhooks',
  'asset_clicks', 'asset_versions', 'assets', 'assistant_chats', 'assistant_prefs',
  'batch_comments', 'batches', 'booking_availability', 'booking_blackouts', 'booking_resources',
  'booking_services', 'bookings', 'calendar_accounts', 'client_agreements', 'client_brand',
  'client_contacts', 'client_credentials', 'client_notes', 'clients', 'content_applications',
  'content_assets', 'content_items', 'deliverable_groups', 'drive_connection', 'drive_files',
  'email_ingest_log', 'intake_files', 'intake_forms', 'intake_settings', 'intake_templates',
  'item_comments', 'journal_posts', 'leads', 'monthly_commitments', 'monthly_updates',
  'newsletter_subscribers', 'notification_log', 'post_analytics', 'projects', 'provider_webhooks',
  'publish_jobs', 'report_settings', 'room_invite_requests', 'scan_mailboxes', 'scan_settings',
  'schedule_entries', 'shoot_proposals', 'social_accounts', 'team_invites', 'team_user_clients',
  'team_users', 'user_page_access', 'video_previews', 'webhook_deliveries', 'website',
  'work_kinds', 'workflow_activity',
]

// Copied verbatim from lib/db.ts UNIQUE_COLUMNS — keep in sync.
export const UNIQUE_COLUMNS = {
  team_users: ['email', 'clerk_user_id'],
  newsletter_subscribers: ['email'],
  video_previews: ['source_url'],
  email_ingest_log: ['gmail_message_id'],
  post_analytics: ['provider_post_id'],
  notification_log: ['dedupe_key'],
  asana_project_map: ['project_gid'],
  work_kinds: ['slug'],
  projects: ['slug'],
  intake_forms: ['token'],
  monthly_updates: ['token'],
  clients: ['share_token'],
  client_brand: ['client_id'],
  social_accounts: ['provider_account_id'],
}

export function encodeKey(s) { return String(s).replace(/[.#$\[\]\/%]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) }

// Copied verbatim from lib/db-types.ts NATURAL_KEYS — keep in sync.
// report_settings has a real `id` primary key, so it gets no entry here.
// assistant_prefs' natural key is clerk_user_id (not team_user_id/user_id).
const NATURAL_KEYS = {
  team_user_clients: r => `${r.team_user_id}__${r.client_id}`,
  user_page_access: r => `${r.team_user_id}__${encodeKey(r.href)}`,
  client_brand: r => r.client_id,
  drive_connection: () => 'singleton',
  scan_settings: () => 'singleton',
  intake_settings: () => 'singleton',
  assistant_prefs: r => r.clerk_user_id,
  intake_templates: r => encodeKey(r.key),
  scan_mailboxes: r => encodeKey(r.email),
  calendar_accounts: r => encodeKey(r.email),
  asana_project_map: r => r.project_gid,
  asana_tasks: r => r.gid,
  asana_webhooks: r => r.gid ?? r.id,
}

export function rowToNode(table, row) {
  const id = row.id != null ? String(row.id) : (NATURAL_KEYS[table] ? NATURAL_KEYS[table](row) : null)
  if (!id) throw new Error(`${table}: row has no id and no natural key: ${JSON.stringify(row).slice(0, 120)}`)
  const node = {}
  for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) node[k] = v
  if (!row.id) node.id = id
  return [id, node]
}

export function buildUniq(table, entries) {
  const out = {}
  for (const col of UNIQUE_COLUMNS[table] ?? []) for (const [id, node] of entries) if (node[col] != null) out[`${table}/${col}/${encodeKey(node[col])}`] = id
  return out
}
