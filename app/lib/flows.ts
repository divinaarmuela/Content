import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import { encodeKey, type Client, type SocialAccount } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { getPublisher } from './publisher'
import { accessibleClientIds } from './production-access'
import { takeClaimLock, releaseClaimLock } from './claim-lock'
import {
  aggregateStepStats, autoLayout, canSave, flowTotals, fromZernio, isFlowPlatform, readRunEvents, readRuns, readWorkflowList,
  readWorkflowMeta, summariseFlow, toZernio, validateFlow,
  type Flow, type FlowIssue, type FlowPlatform, type FlowTotals, type RunEvent, type RunRow, type StepStats, type WorkflowStatus,
} from './flow-core'

/**
 * FLOWS — the I/O half of the flow builder. The rules are flow-core.ts.
 *
 * Zernio calls, all through app/lib/publisher.ts:
 *   GET   /v1/workflows?profileId=   listWorkflows
 *   GET   /v1/workflows/{id}         getWorkflow
 *   POST  /v1/workflows              createWorkflow  (Zernio makes it a DRAFT)
 *   PATCH /v1/workflows/{id}         updateWorkflow  (only while draft/paused)
 *   GET   /v1/workflows/{id}/executions               workflowRuns       (numbers)
 *   GET   /v1/workflows/{id}/executions/{run}/events  workflowRunEvents  (numbers)
 *
 * And, on purpose, never: /activate, /pause, DELETE, or POST /executions.
 * Switching a flow on waits for the owner's go-ahead; the publisher has no
 * method for it, and tests/flows-routes.test.ts drives every route with the
 * network mocked to prove no request to those paths is ever made.
 *
 * The browser sends a flow as Zernio's own node/edge JSON; the server reads
 * it back through the same tolerant reader it uses on Zernio's answers, takes
 * the platform from the ACCOUNT (never the browser), validates it, and writes
 * the re-built graph. A "kept" node (webhook, AI, a WhatsApp template…) can
 * only be one that was already in Zernio's copy, unchanged — so this page can
 * never be used to slip a webhook into a client's DMs.
 */

type Fail = { ok: false; error: string; status: number; issues?: FlowIssue[] }
const fail = (error: string, status = 400, issues?: FlowIssue[]): Fail => ({ ok: false, error, status, ...(issues ? { issues } : {}) })

async function mayTouchClient(user: TeamUser, clientId: string): Promise<boolean> {
  const allowed = await accessibleClientIds(user)
  return allowed === null || allowed.includes(clientId)
}

const usableAccount = (a: SocialAccount) => a.active !== false && !!a.provider_account_id && isFlowPlatform(String(a.platform).toLowerCase())

/* ── setup: which clients and accounts can hold a flow ─────────────────── */

export type FlowAccount = { id: string; platform: string; username: string | null; name: string | null }
export type FlowClient = { id: string; name: string; problem: string | null; accounts: FlowAccount[] }

export async function flowSetup(user: TeamUser): Promise<FlowClient[]> {
  const allowed = await accessibleClientIds(user)
  const [clients, accounts] = await Promise.all([
    table<Client>('clients').list(),
    table<SocialAccount>('social_accounts').list(),
  ])
  const out: FlowClient[] = []
  for (const c of clients) {
    if (allowed !== null && !allowed.includes(c.id)) continue
    const mine = accounts.filter(a => a.client_id === c.id && usableAccount(a))
    if (mine.length === 0) continue
    out.push({
      id: c.id, name: c.name,
      problem: c.social_profile_id ? null : 'This client has no Zernio profile yet — link its accounts on the Schedule access page first.',
      accounts: mine.map(a => ({ id: a.id, platform: String(a.platform).toLowerCase(), username: a.username, name: a.name })),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/* ── one client's flows ─────────────────────────────────────────────────── */

export type FlowRow = {
  id: string
  name: string
  status: WorkflowStatus
  platform: string
  account: FlowAccount | null
  updated_at: string | null
  runs: number | null
  completed: number | null
}

export async function listClientFlows(user: TeamUser, clientId: string):
  Promise<{ ok: true; rows: FlowRow[]; read: boolean } | Fail> {
  if (!clientId) return fail('Pick a client')
  if (!(await mayTouchClient(user, clientId))) return fail('That client is not one of yours', 403)
  const client = await table<Client>('clients').get(clientId)
  if (!client) return fail('That client is not there any more', 404)
  if (!client.social_profile_id) return { ok: true, rows: [], read: true }
  const accounts = await table<SocialAccount>('social_accounts').list({ where: a => a.client_id === client.id })
  const byProvider = new Map(accounts.map(a => [a.provider_account_id, a]))
  const raw = await getPublisher().listWorkflows(client.social_profile_id)
  if (raw === null) return { ok: true, rows: [], read: false }
  const rows: FlowRow[] = []
  for (const w of readWorkflowList(raw)) {
    const acc = w.accountId ? byProvider.get(w.accountId) : undefined
    // a workflow on an account that is not this client's is not shown under this client
    if (!acc) continue
    rows.push({
      id: w.id, name: w.name, status: w.status, platform: w.platform || String(acc.platform).toLowerCase(),
      account: { id: acc.id, platform: String(acc.platform).toLowerCase(), username: acc.username, name: acc.name },
      updated_at: w.updatedAt, runs: w.runs, completed: w.completed,
    })
  }
  return { ok: true, rows, read: true }
}

/* ── one flow ───────────────────────────────────────────────────────────── */

type Located = { raw: unknown; meta: ReturnType<typeof readWorkflowMeta>; client: Client; account: SocialAccount }

/** Zernio's copy of one workflow, and the client + account it belongs to HERE — or a refusal. */
async function locate(user: TeamUser, id: string): Promise<{ ok: true } & Located | Fail> {
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail('That is not a flow id', 400)
  const raw = await getPublisher().getWorkflow(id)
  if (raw === null) return fail('Zernio did not return that flow', 404)
  const meta = readWorkflowMeta(raw)
  if (!meta.accountId) return fail('That flow names no account', 404)
  const accounts = await table<SocialAccount>('social_accounts').list({ where: a => a.provider_account_id === meta.accountId })
  const account = accounts.find(a => a.client_id)
  if (!account?.client_id) return fail('That flow is on an account no client here owns', 404)
  if (!(await mayTouchClient(user, account.client_id))) return fail('That client is not one of yours', 403)
  const client = await table<Client>('clients').get(account.client_id)
  if (!client) return fail('That client is not there any more', 404)
  return { ok: true, raw, meta, client, account }
}

export type FlowView = {
  id: string
  status: WorkflowStatus
  editable: boolean
  client: { id: string; name: string }
  account: FlowAccount
  flow: Flow
  issues: FlowIssue[]
  summary: string[]
}

export async function readFlow(user: TeamUser, id: string): Promise<{ ok: true; view: FlowView } | Fail> {
  const got = await locate(user, id)
  if (!got.ok) return got
  const platform = String(got.account.platform).toLowerCase()
  const flow = autoLayout({ ...fromZernio(got.raw), platform: (isFlowPlatform(platform) ? platform : 'instagram') as FlowPlatform })
  return {
    ok: true,
    view: {
      id: got.meta.id || id,
      status: got.meta.status,
      editable: isEditableStatus(got.meta.status),
      client: { id: got.client.id, name: got.client.name },
      account: { id: got.account.id, platform, username: got.account.username, name: got.account.name },
      flow, issues: validateFlow(flow), summary: summariseFlow(flow),
    },
  }
}

/* ── numbers (read only) ────────────────────────────────────────────────── */

/** How many recent runs the per-step numbers are counted over — one timeline request each. */
export const STATS_SAMPLE = 25

export type FlowStatsView = {
  totals: FlowTotals
  /** runs Zernio says exist (pagination.total), and how many the per-step counts cover */
  runs_total: number | null
  sampled: number
  /** timelines that could not be read (counted out of `sampled`) */
  unread: number
  steps: Record<string, StepStats>
  recent: RunRow[]
}

/**
 * A flow's numbers. Totals are Zernio's own counters; per-step counts are
 * aggregated over the latest STATS_SAMPLE runs' timelines. Every call is a
 * GET — nothing here starts, stops or changes a run.
 */
export async function flowStats(user: TeamUser, id: string): Promise<{ ok: true; stats: FlowStatsView } | Fail> {
  const got = await locate(user, id)
  if (!got.ok) return got
  const publisher = getPublisher()
  const wfId = got.meta.id || id
  const { runs, total } = readRuns(await publisher.workflowRuns(wfId, STATS_SAMPLE))
  const sample = runs.slice(0, STATS_SAMPLE)
  let unread = 0
  const timelines: { run: RunRow; events: RunEvent[] }[] = []
  // a few at a time, so one page view is not 25 parallel requests on the key
  for (let i = 0; i < sample.length; i += 5) {
    const batch = await Promise.all(sample.slice(i, i + 5).map(async run => {
      const raw = await publisher.workflowRunEvents(wfId, run.id).catch(() => null)
      if (raw === null) unread++
      return { run, events: raw === null ? [] : readRunEvents(raw) }
    }))
    timelines.push(...batch)
  }
  return {
    ok: true,
    stats: {
      totals: flowTotals(got.meta), runs_total: total, sampled: sample.length, unread,
      steps: aggregateStepStats(timelines), recent: sample.slice(0, 10),
    },
  }
}

/** Zernio accepts graph edits on a draft or a paused workflow; this page changes nothing that is on. */
export const isEditableStatus = (s: WorkflowStatus) => s === 'draft' || s === 'paused'

/* ── saving ─────────────────────────────────────────────────────────────── */

type SaveInput = { name: string; description: string; nodes: unknown[]; edges: unknown[] }

function readSaveInput(raw: unknown): SaveInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const f = (r.flow && typeof r.flow === 'object' ? r.flow : r) as Record<string, unknown>
  if (!Array.isArray(f.nodes) || !Array.isArray(f.edges)) return null
  if (f.nodes.length > 200 || f.edges.length > 400) return null
  return {
    name: typeof f.name === 'string' ? f.name.trim() : '',
    description: typeof f.description === 'string' ? f.description.slice(0, 500) : '',
    nodes: f.nodes, edges: f.edges,
  }
}

/** The browser's graph, read as a flow on `platform` — the platform is the account's, never the browser's. */
function flowFrom(input: SaveInput, platform: FlowPlatform): Flow {
  return { ...fromZernio({ name: input.name, description: input.description, nodes: input.nodes, edges: input.edges }), platform }
}

/** Every kept node in `next` must be in `current`, byte for byte (type, config). */
export function keptNodesUnchanged(next: Flow, current: Flow | null): boolean {
  const had = new Map((current?.steps ?? []).filter(s => s.kind === 'kept').map(s => [s.id, s]))
  for (const s of next.steps) {
    if (s.kind !== 'kept') continue
    const was = had.get(s.id)
    if (!was || was.kind !== 'kept' || was.zernioType !== s.zernioType || JSON.stringify(was.config) !== JSON.stringify(s.config)) return false
  }
  return true
}

function checked(flow: Flow): Fail | null {
  const issues = validateFlow(flow)
  if (canSave(issues)) return null
  const owner = issues.find(i => i.blocks && i.needsOwner)
  return fail(owner ? owner.message : (issues.find(i => i.blocks)?.message ?? 'The flow is not ready to save'), owner ? 403 : 400, issues)
}

const createLockKey = (draftKey: string) => `flow_create__${encodeKey(draftKey)}`
const CREATED = 'created:'

/**
 * A new flow, made at Zernio as a DRAFT (Zernio's default for a create; this
 * sends no status). One create per `draft_key`: the page mints the key once
 * per new flow, and the lock — a compare-and-set, not a check-then-write —
 * makes a double click, a retry or a second tab come back with the first
 * one's id instead of a second workflow.
 */
export async function createFlow(user: TeamUser, body: unknown):
  Promise<{ ok: true; id: string; status: WorkflowStatus; again: boolean } | Fail> {
  const r = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const clientId = typeof r.client_id === 'string' ? r.client_id : ''
  const accountId = typeof r.account_id === 'string' ? r.account_id : ''
  const draftKey = typeof r.draft_key === 'string' ? r.draft_key.trim() : ''
  if (!draftKey || draftKey.length > 80) return fail('Missing draft key — reload the page')
  const input = readSaveInput(r)
  if (!input) return fail('That is not a flow')
  if (!clientId || !accountId) return fail('Pick a client and an account')
  if (!(await mayTouchClient(user, clientId))) return fail('That client is not one of yours', 403)

  const [client, account] = await Promise.all([
    table<Client>('clients').get(clientId),
    table<SocialAccount>('social_accounts').get(accountId),
  ])
  if (!client) return fail('That client is not there any more', 404)
  if (!account || account.client_id !== client.id) return fail('That account is not one of this client\'s')
  if (!usableAccount(account)) return fail('That account is not connected, or Zernio cannot run a flow on it')
  if (!client.social_profile_id) return fail('This client has no Zernio profile yet — link its accounts on the Schedule access page first.')
  const platform = String(account.platform).toLowerCase() as FlowPlatform

  const flow = flowFrom(input, platform)
  if (!keptNodesUnchanged(flow, null)) return fail('A new flow cannot carry steps this page does not make')
  const bad = checked(flow)
  if (bad) return bad

  const key = createLockKey(draftKey)
  const holder = `req:${randomUUID()}`
  const lock = await takeClaimLock(key, holder, async h => h.startsWith(CREATED))
  if (!lock.ok) {
    if (lock.holder.startsWith(CREATED)) return { ok: true, id: lock.holder.slice(CREATED.length), status: 'draft', again: true }
    return fail('This flow is already being saved — wait a moment', 409)
  }

  let made: unknown
  try {
    made = await getPublisher().createWorkflow({
      profileId: client.social_profile_id, accountId: account.provider_account_id, platform,
      name: flow.name, description: flow.description, ...toZernio(flow),
    })
  } catch (e) {
    await releaseClaimLock(key, holder).catch(() => {})
    return fail(`Zernio refused the flow: ${e instanceof Error ? e.message : String(e)}`, 502)
  }
  const meta = readWorkflowMeta(made)
  if (!meta.id) {
    await releaseClaimLock(key, holder).catch(() => {})
    return fail('Zernio made the flow but returned no id — refresh the list before saving again', 502)
  }
  // the lock now names the workflow, so a repeat of this draft finds it; the
  // hand-over is decisive ('free') only from THIS request's own holder
  await takeClaimLock(key, `${CREATED}${meta.id}`, async h => (h === holder ? 'free' : true)).catch(() => {})
  return { ok: true, id: meta.id, status: meta.status === 'unknown' ? 'draft' : meta.status, again: false }
}

/**
 * Change a draft or paused flow's name, words and graph. Never its account,
 * never its status. A flow that is ON is refused here: Zernio would refuse the
 * graph edit anyway, and pausing it first is a decision about a live flow this
 * page does not make.
 */
export async function updateFlow(user: TeamUser, id: string, body: unknown):
  Promise<{ ok: true; id: string; status: WorkflowStatus } | Fail> {
  const input = readSaveInput(body)
  if (!input) return fail('That is not a flow')
  const got = await locate(user, id)
  if (!got.ok) return got
  if (!isEditableStatus(got.meta.status)) {
    return fail(got.meta.status === 'active'
      ? 'This flow is switched on at Zernio — it is not changed from here while it is on.'
      : 'Zernio did not say this flow is a draft or paused, so it is not changed from here.', 409)
  }
  const platform = String(got.account.platform).toLowerCase() as FlowPlatform
  const flow = flowFrom(input, platform)
  if (!keptNodesUnchanged(flow, fromZernio(got.raw))) return fail('Steps made in Zernio can be kept or deleted here, not changed or added')
  const bad = checked(flow)
  if (bad) return bad
  try {
    await getPublisher().updateWorkflow(got.meta.id || id, { name: flow.name, description: flow.description, ...toZernio(flow) })
  } catch (e) {
    return fail(`Zernio refused the change: ${e instanceof Error ? e.message : String(e)}`, 502)
  }
  return { ok: true, id: got.meta.id || id, status: got.meta.status }
}
