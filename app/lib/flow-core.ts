/**
 * FLOWS — the pure half of the ManyChat-style flow builder (30 Sep 2026).
 *
 * A "flow" is our model of one Zernio WORKFLOW: a graph of steps on one
 * connected account. This file has no I/O. It converts our model to and from
 * Zernio's node/edge JSON, validates it, lays it out, and says it in plain
 * English. app/lib/flows.ts does the reading and writing.
 *
 * What Zernio's workflows API is, read from its OpenAPI spec (1.164.0,
 * https://docs.zernio.com/api/openapi, components.schemas.WorkflowNode /
 * WorkflowEdge, and https://docs.zernio.com/workflows):
 *
 *   - one `trigger` node whose `config.triggerType` is `inbound_message` (a DM,
 *     optional keywords + matchType + onlyFirstMessage), `api_call` (started by
 *     a backend) or `whatsapp_event` (WhatsApp only). THERE IS NO COMMENT,
 *     NEW-FOLLOWER OR STORY TRIGGER on a workflow.
 *   - a comment→DM automation's button can START a workflow: a postback button
 *     whose payload is `zernio:workflow:<workflowId>` (Create comment
 *     automation, docs.zernio.com). That is how a comment reaches a flow, and
 *     it is the only trigger this builder saves: the person had to comment on
 *     a post an automation a person switched on is watching, AND tap its button.
 *   - `send_message` sends text or media on every platform; `template` and
 *     `interactive` (buttons, lists) are WhatsApp only — so an Instagram flow
 *     message has NO buttons or quick replies. Branching on a reply is
 *     `wait_for_reply` (edges `reply` / `timeout`) then `condition`.
 *   - edges pick a branch with `sourceHandle`: condition → a rule id or
 *     `default`; wait_for_reply → `reply` | `timeout`; a_b_split → `a` | `b`;
 *     webhook / ai / enroll_sequence / start_call have their own.
 *   - created in `draft`; graph edits only while `draft` or `paused`.
 *
 * NOT VERIFIED against the live API (the key on this machine is a placeholder):
 * the response shapes are the spec's (`{ success, workflow }`, `{ success,
 * workflows, pagination }`, `id`) but no real payload has been read — the
 * readers also accept `_id` and a bare object; and whether a postback starts a
 * workflow whose trigger is `api_call` (the docs say "the workflow must be
 * active on this account", nothing about its trigger type).
 */

export const FLOW_PLATFORMS = ['instagram', 'facebook', 'whatsapp', 'telegram', 'twitter', 'bluesky', 'reddit'] as const
export type FlowPlatform = typeof FLOW_PLATFORMS[number]
export const isFlowPlatform = (p: unknown): p is FlowPlatform =>
  typeof p === 'string' && (FLOW_PLATFORMS as readonly string[]).includes(p.toLowerCase())

/** Comment automations — the only way a comment reaches a flow — exist on these two. */
export const COMMENT_PLATFORMS: readonly FlowPlatform[] = ['instagram', 'facebook']

/* ── the model ──────────────────────────────────────────────────────────── */

/**
 * How a flow starts.
 *   comment_button — someone commented on a post, got the automation's DM,
 *                    and tapped its button. Saved as Zernio's `api_call`.
 *   dm_keyword     — any DM with a keyword. NEEDS THE OWNER'S DECISION:
 *                    it answers a prospect nobody picked. Modelled, never saved.
 *   whatsapp_event — WhatsApp status events. WhatsApp is parked. Never saved.
 */
export type TriggerKind = 'comment_button' | 'dm_keyword' | 'whatsapp_event'
export const SAVABLE_TRIGGERS: readonly TriggerKind[] = ['comment_button']

export type MatchType = 'any' | 'contains' | 'exact' | 'regex'
export const MATCH_TYPES: readonly MatchType[] = ['any', 'contains', 'exact', 'regex']
export const WHATSAPP_EVENTS = ['message_sent', 'message_delivered', 'message_read', 'message_failed', 'reaction'] as const
/** Zernio's WhatsApp event names, in words */
export const WHATSAPP_EVENT_WORDS: Record<string, string> = {
  message_sent: 'message sent', message_delivered: 'message delivered', message_read: 'message read',
  message_failed: 'message failed', reaction: 'reaction',
}

/** Zernio's node types this builder keeps but does not edit, in words; anything newer is "a Zernio step". */
export const KEPT_WORDS: Record<string, string> = {
  webhook: 'webhook', ai: 'AI reply', set_variable: 'set a value', set_field: 'save to contact', enroll_sequence: 'add to a sequence',
  start_call: 'WhatsApp call', send_message: 'special message', handoff: 'assigned hand-off', condition: 'condition', trigger: 'start',
}
export const keptWords = (type: string): string => KEPT_WORDS[type] ?? 'Zernio'

export type Trigger = {
  kind: TriggerKind
  keywords: string[]
  matchType: MatchType
  onlyFirstMessage: boolean
  eventType: string | null
}

/** Triggers people ask for that Zernio's workflows do not have — shown greyed, with the reason. */
export const UNAVAILABLE_TRIGGERS: readonly { label: string; why: string }[] = [
  { label: 'New follower', why: 'Zernio\'s workflows have no new-follower trigger.' },
  { label: 'Story reply', why: 'Zernio answers story replies only as a comment automation (trigger: story_reply), not as a workflow trigger.' },
]

export const CONDITION_OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'exists', 'not_exists', 'matches',
] as const
export type ConditionOperator = typeof CONDITION_OPERATORS[number]
export type ConditionRule = { id: string; variable: string; operator: ConditionOperator; value: string }

export type MediaType = 'image' | 'video' | 'audio' | 'document'
export const MEDIA_TYPES: readonly MediaType[] = ['image', 'video', 'audio', 'document']

type Base = { id: string; label: string | null; position: { x: number; y: number } | null }
export type FlowStep = Base & (
  | { kind: 'trigger'; trigger: Trigger }
  | { kind: 'message'; text: string; media: { type: MediaType; url: string; caption: string } | null }
  | { kind: 'wait_reply'; timeoutMinutes: number; saveAs: string }
  | { kind: 'delay'; minutes: number }
  | { kind: 'condition'; rules: ConditionRule[] }
  | { kind: 'tag'; action: 'add' | 'remove'; tag: string }
  | { kind: 'ab_split'; percentage: number }
  | { kind: 'handoff'; note: string }
  | { kind: 'end' }
  /** a node this builder does not edit (webhook, ai, set_field, a WhatsApp
   *  template…): carried through a save unchanged, so opening a flow made in
   *  Zernio's own builder and saving it never loses anything */
  | { kind: 'kept'; zernioType: string; config: Record<string, unknown> }
)
export type StepKind = FlowStep['kind']

export type FlowLink = { id: string; from: string; to: string; branch: string | null }

export type Flow = {
  name: string
  description: string
  platform: FlowPlatform
  steps: FlowStep[]
  links: FlowLink[]
}

/* ── limits ─────────────────────────────────────────────────────────────── */

/** Zernio: delayMinutes and timeoutMinutes, max 43200 (30 days). */
export const MAX_MINUTES = 43_200
/** Zernio: node label 1–80. */
export const LABEL_LIMIT = 80
export const NAME_LIMIT = 100
export const TAG_LIMIT = 50

/**
 * One DM's text, per network. Instagram's 1000 is the one this repo already
 * enforces for comment automations (comment-automation-core DM_LIMIT); the
 * rest are each network's documented DM limit. Zernio may add its own —
 * NOT VERIFIED.
 */
export const MESSAGE_LIMITS: Record<FlowPlatform, number> = {
  instagram: 1000, facebook: 2000, whatsapp: 4096, telegram: 4096, twitter: 10_000, bluesky: 1000, reddit: 10_000,
}

/* ── Zernio's JSON ──────────────────────────────────────────────────────── */

export type ZernioNode = {
  id: string
  type: string
  config?: Record<string, unknown>
  position?: { x: number; y: number }
  label?: string
}
export type ZernioEdge = { id: string; source: string; target: string; sourceHandle?: string | null }
export type ZernioGraph = { nodes: ZernioNode[]; edges: ZernioEdge[]; entryNodeId: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

function readPosition(v: unknown): { x: number; y: number } | null {
  const p = rec(v)
  return typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null
}

function readTrigger(config: Record<string, unknown>): Trigger {
  const type = str(config.triggerType) || 'inbound_message'
  const kind: TriggerKind = type === 'api_call' ? 'comment_button' : type === 'whatsapp_event' ? 'whatsapp_event' : 'dm_keyword'
  const match = str(config.matchType) as MatchType
  return {
    kind,
    keywords: Array.isArray(config.keywords) ? config.keywords.map(String).filter(Boolean) : [],
    matchType: MATCH_TYPES.includes(match) ? match : 'any',
    onlyFirstMessage: config.onlyFirstMessage === true,
    eventType: str(config.eventType) || null,
  }
}

/** One Zernio node → one step. Anything this builder does not edit becomes `kept`, whole. */
export function stepFromNode(n: ZernioNode): FlowStep {
  const config = rec(n.config)
  const base: Base = { id: String(n.id), label: n.label ? String(n.label) : null, position: readPosition(n.position) }
  const kept = (): FlowStep => ({ ...base, kind: 'kept', zernioType: String(n.type), config })
  switch (n.type) {
    case 'trigger':
      return { ...base, kind: 'trigger', trigger: readTrigger(config) }
    case 'send_message': {
      const type = str(config.messageType) || 'text'
      if (type === 'text') {
        // a text node that also carries anything else is not ours to rewrite
        const extra = Object.keys(config).filter(k => !['messageType', 'text'].includes(k))
        return extra.length ? kept() : { ...base, kind: 'message', text: str(config.text), media: null }
      }
      if (type === 'media') {
        const m = rec(config.media)
        const mt = str(m.mediaType) as MediaType
        if (!MEDIA_TYPES.includes(mt)) return kept()
        return { ...base, kind: 'message', text: str(config.text), media: { type: mt, url: str(m.url), caption: str(m.caption) } }
      }
      return kept()  // template / interactive — WhatsApp only, not edited here
    }
    case 'wait_for_reply':
      return { ...base, kind: 'wait_reply', timeoutMinutes: num(config.timeoutMinutes, 60), saveAs: str(config.saveAs) }
    case 'delay':
      return { ...base, kind: 'delay', minutes: num(config.delayMinutes, 60) }
    case 'condition': {
      const rules = Array.isArray(config.rules) ? config.rules.map(rec) : []
      const ok = rules.every(r => (CONDITION_OPERATORS as readonly string[]).includes(str(r.operator)))
      if (!ok) return kept()
      return {
        ...base, kind: 'condition',
        rules: rules.map(r => ({
          id: str(r.id), variable: str(r.variable), operator: str(r.operator) as ConditionOperator,
          value: r.value === undefined || r.value === null ? '' : String(r.value),
        })),
      }
    }
    case 'add_tag':
    case 'remove_tag':
      return { ...base, kind: 'tag', action: n.type === 'add_tag' ? 'add' : 'remove', tag: str(config.tag) }
    case 'a_b_split':
      return { ...base, kind: 'ab_split', percentage: num(config.percentage, 50) }
    case 'handoff': {
      // assignTo is Zernio's to resolve; a node that sets it is kept as it is
      if (config.assignTo !== undefined && config.assignTo !== null && config.assignTo !== '') return kept()
      return { ...base, kind: 'handoff', note: str(config.note) }
    }
    case 'end':
      return { ...base, kind: 'end' }
    default:
      return kept()
  }
}

/** One step → one Zernio node. */
export function nodeFromStep(s: FlowStep): ZernioNode {
  const node = (type: string, config?: Record<string, unknown>): ZernioNode => ({
    id: s.id, type,
    ...(config ? { config } : {}),
    ...(s.position ? { position: { x: s.position.x, y: s.position.y } } : {}),
    ...(s.label ? { label: s.label } : {}),
  })
  switch (s.kind) {
    case 'trigger': {
      const t = s.trigger
      if (t.kind === 'comment_button') return node('trigger', { triggerType: 'api_call' })
      if (t.kind === 'whatsapp_event') return node('trigger', { triggerType: 'whatsapp_event', eventType: t.eventType ?? 'message_read' })
      return node('trigger', {
        triggerType: 'inbound_message', keywords: [...t.keywords], matchType: t.matchType, onlyFirstMessage: t.onlyFirstMessage,
      })
    }
    case 'message':
      return s.media
        ? node('send_message', {
          messageType: 'media', ...(s.text ? { text: s.text } : {}),
          media: { mediaType: s.media.type, url: s.media.url, ...(s.media.caption ? { caption: s.media.caption } : {}) },
        })
        : node('send_message', { messageType: 'text', text: s.text })
    case 'wait_reply':
      return node('wait_for_reply', { timeoutMinutes: s.timeoutMinutes, ...(s.saveAs ? { saveAs: s.saveAs } : {}) })
    case 'delay':
      return node('delay', { delayMinutes: s.minutes })
    case 'condition':
      return node('condition', {
        rules: s.rules.map(r => ({
          id: r.id, variable: r.variable, operator: r.operator,
          ...(r.operator === 'exists' || r.operator === 'not_exists' ? {} : { value: r.value }),
        })),
      })
    case 'tag':
      return node(s.action === 'add' ? 'add_tag' : 'remove_tag', { tag: s.tag })
    case 'ab_split':
      return node('a_b_split', { percentage: s.percentage })
    case 'handoff':
      return node('handoff', s.note ? { note: s.note } : {})
    case 'end':
      return node('end')
    case 'kept':
      return node(s.zernioType, Object.keys(s.config).length ? { ...s.config } : undefined)
  }
}

/** Our flow → the body fields Zernio's create / update take. */
export function toZernio(flow: Flow): ZernioGraph {
  const trigger = flow.steps.find(s => s.kind === 'trigger')
  return {
    nodes: flow.steps.map(nodeFromStep),
    edges: flow.links.map(l => ({ id: l.id, source: l.from, target: l.to, ...(l.branch ? { sourceHandle: l.branch } : {}) })),
    entryNodeId: trigger?.id ?? '',
  }
}

/** A workflow as Zernio answers it (GET /v1/workflows/{id}) → our flow. Tolerant of either wrapper. */
export function fromZernio(raw: unknown): Flow {
  const w = readWorkflowObject(raw)
  const nodes = Array.isArray(w.nodes) ? (w.nodes as unknown[]).map(rec) : []
  const edges = Array.isArray(w.edges) ? (w.edges as unknown[]).map(rec) : []
  const platform = str(w.platform).toLowerCase()
  return {
    name: str(w.name),
    description: str(w.description),
    platform: isFlowPlatform(platform) ? platform : 'instagram',
    steps: nodes.filter(n => n.id !== undefined && n.type).map(n => stepFromNode({
      id: String(n.id), type: String(n.type), config: rec(n.config),
      position: readPosition(n.position) ?? undefined, label: n.label ? String(n.label) : undefined,
    })),
    links: edges.filter(e => e.source !== undefined && e.target !== undefined).map((e, i) => ({
      id: e.id !== undefined && e.id !== null && e.id !== '' ? String(e.id) : `e_${i + 1}`,
      from: String(e.source), to: String(e.target),
      branch: typeof e.sourceHandle === 'string' && e.sourceHandle ? e.sourceHandle : null,
    })),
  }
}

/** `{ workflow: {...} }`, `{ data: {...} }` or the object itself. */
export function readWorkflowObject(raw: unknown): Record<string, unknown> {
  const r = rec(raw)
  if (r.workflow && typeof r.workflow === 'object') return rec(r.workflow)
  if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) return rec(r.data)
  return r
}

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'unknown'
export type WorkflowSummaryRow = {
  id: string
  name: string
  status: WorkflowStatus
  platform: string
  accountId: string | null
  profileId: string | null
  updatedAt: string | null
  /** Zernio's own counters (GET /v1/workflows and /v1/workflows/{id}: totalStarted / totalCompleted / totalExited) */
  runs: number | null
  completed: number | null
  exited: number | null
}

const readStatus = (v: unknown): WorkflowStatus => {
  const s = str(v).toLowerCase()
  return s === 'draft' || s === 'active' || s === 'paused' ? s : 'unknown'
}

/** The id / status / account of one workflow object, whatever its wrapper. */
export function readWorkflowMeta(raw: unknown): WorkflowSummaryRow {
  const w = readWorkflowObject(raw)
  const acc = w.accountId
  const accountId = typeof acc === 'string' ? acc : acc && typeof acc === 'object' ? str(rec(acc)._id) || str(rec(acc).id) || null : null
  const prof = w.profileId
  const profileId = typeof prof === 'string' ? prof : prof && typeof prof === 'object' ? str(rec(prof)._id) || str(rec(prof).id) || null : null
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id: str(w._id) || str(w.id),
    name: str(w.name) || 'Untitled flow',
    status: readStatus(w.status),
    platform: str(w.platform).toLowerCase(),
    accountId: accountId || null,
    profileId: profileId || null,
    updatedAt: str(w.updatedAt) || str(w.createdAt) || null,
    runs: count(w.totalStarted),
    completed: count(w.totalCompleted),
    exited: count(w.totalExited),
  }
}

/* ── numbers (read only) ────────────────────────────────────────────────── */

/**
 * What Zernio's workflows API reports, per its OpenAPI 1.164.0:
 *   per flow  — totalStarted / totalCompleted / totalExited on the workflow;
 *   per run   — GET /v1/workflows/{id}/executions: status (running, waiting,
 *               completed, exited, failed), currentNodeId, stepCount, lastError;
 *   per step  — only inside one run's timeline, GET …/executions/{e}/events
 *               (node_completed / node_failed, the branch taken), 90 days kept.
 * NOT reported for a workflow at all: delivered, read, or clicks per message
 * (those exist for comment automations and on single inbox messages, not per
 * flow step). So per-step numbers here are counted over a SAMPLE of recent
 * runs, and say so.
 */
export type RunStatus = 'running' | 'waiting' | 'completed' | 'exited' | 'failed' | 'unknown'
export type RunRow = {
  id: string; status: RunStatus; currentNodeId: string | null; stepCount: number | null
  lastError: string | null; createdAt: string | null; completedAt: string | null
}

export function readRuns(raw: unknown): { runs: RunRow[]; total: number | null } {
  const r = rec(raw)
  const list = Array.isArray(raw) ? raw : Array.isArray(r.executions) ? r.executions : Array.isArray(r.data) ? r.data : []
  const runs = (list as unknown[]).map(rec).map(e => {
    const s = str(e.status) as RunStatus
    return {
      id: str(e.id) || str(e._id),
      status: (['running', 'waiting', 'completed', 'exited', 'failed'] as const).includes(s as never) ? s : 'unknown',
      currentNodeId: str(e.currentNodeId) || null,
      stepCount: typeof e.stepCount === 'number' ? e.stepCount : null,
      lastError: str(e.lastError) || null,
      createdAt: str(e.createdAt) || null,
      completedAt: str(e.completedAt) || null,
    } satisfies RunRow
  }).filter(e => e.id)
  const total = rec(r.pagination).total
  return { runs, total: typeof total === 'number' ? total : null }
}

export type RunEvent = { action: string; nodeId: string | null; sourceHandle: string | null; status: string | null }

export function readRunEvents(raw: unknown): RunEvent[] {
  const r = rec(raw)
  const list = Array.isArray(r.events) ? r.events : Array.isArray(raw) ? raw : []
  return (list as unknown[]).map(rec).map(e => ({
    action: str(e.action), nodeId: str(e.nodeId) || null,
    sourceHandle: typeof e.sourceHandle === 'string' && e.sourceHandle ? e.sourceHandle : null,
    status: str(e.status) || null,
  }))
}

export type StepStats = {
  /** runs that got to this step (a node_started or node_completed for it) */
  reached: number
  completed: number
  failed: number
  /** runs sitting at this step now (waiting for a reply or a timer) */
  waiting: number
  /** runs that left by each output, keyed by handle ('next' for the single output) */
  branches: Record<string, number>
}

/**
 * Per-step counts over a set of runs and their timelines. Each run counts at
 * most once per step, however many events it logged there.
 */
export function aggregateStepStats(runs: { run: RunRow; events: RunEvent[] }[]): Record<string, StepStats> {
  const out: Record<string, StepStats> = {}
  const at = (id: string) => (out[id] ??= { reached: 0, completed: 0, failed: 0, waiting: 0, branches: {} })
  for (const { run, events } of runs) {
    const reached = new Set<string>(), completed = new Set<string>(), failed = new Set<string>()
    const branch = new Map<string, string>()
    for (const e of events) {
      if (!e.nodeId) continue
      if (e.action === 'node_started' || e.action === 'node_completed' || e.action === 'node_failed') reached.add(e.nodeId)
      if (e.action === 'node_completed') { completed.add(e.nodeId); branch.set(e.nodeId, e.sourceHandle ?? 'next') }
      if (e.action === 'node_failed') failed.add(e.nodeId)
    }
    for (const id of reached) at(id).reached++
    for (const id of completed) at(id).completed++
    for (const id of failed) at(id).failed++
    for (const [id, h] of branch) { const s = at(id); s.branches[h] = (s.branches[h] ?? 0) + 1 }
    if ((run.status === 'waiting' || run.status === 'running') && run.currentNodeId) at(run.currentNodeId).waiting++
  }
  return out
}

export type FlowTotals = { started: number | null; completed: number | null; exited: number | null; completionRate: number | null }

export function flowTotals(meta: Pick<WorkflowSummaryRow, 'runs' | 'completed' | 'exited'>): FlowTotals {
  const rate = meta.runs && meta.completed !== null ? Math.round((meta.completed / meta.runs) * 100) : null
  return { started: meta.runs, completed: meta.completed, exited: meta.exited, completionRate: rate }
}

/** GET /v1/workflows → rows. Tolerant of `{ workflows }`, `{ data }` or a bare array. */
export function readWorkflowList(raw: unknown): WorkflowSummaryRow[] {
  const r = rec(raw)
  const list = Array.isArray(raw) ? raw : Array.isArray(r.workflows) ? r.workflows : Array.isArray(r.data) ? r.data : []
  return (list as unknown[]).map(readWorkflowMeta).filter(w => w.id)
}

/* ── branches ───────────────────────────────────────────────────────────── */

export type Branch = { handle: string | null; label: string }

/** The outputs a step has. `null` handle = its single output. */
export function branchesOf(step: FlowStep): Branch[] {
  switch (step.kind) {
    case 'wait_reply': return [{ handle: 'reply', label: 'They reply' }, { handle: 'timeout', label: 'No reply' }]
    case 'condition': return [
      ...step.rules.map((r, i) => ({ handle: r.id, label: ruleLabel(r) || `Rule ${i + 1}` })),
      { handle: 'default', label: 'Otherwise' },
    ]
    case 'ab_split': return [{ handle: 'a', label: `A · ${step.percentage}%` }, { handle: 'b', label: `B · ${100 - step.percentage}%` }]
    case 'end':
    case 'handoff':
      return []
    case 'kept': {
      const known: Record<string, string[]> = {
        webhook: ['success', 'error'], ai: ['success', 'error'], enroll_sequence: ['success', 'error'],
        start_call: ['success', 'permission_required', 'failed'],
      }
      const hs = known[step.zernioType]
      return hs ? hs.map(h => ({ handle: h, label: h })) : [{ handle: null, label: 'Next' }]
    }
    default: return [{ handle: null, label: 'Next' }]
  }
}

function ruleLabel(r: ConditionRule): string {
  const v = r.variable || '…'
  const words: Record<ConditionOperator, string> = {
    equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain',
    starts_with: 'starts with', ends_with: 'ends with', exists: 'is set', not_exists: 'is not set', matches: 'matches',
  }
  return r.operator === 'exists' || r.operator === 'not_exists' ? `${v} ${words[r.operator]}` : `${v} ${words[r.operator]} “${r.value}”`
}

/** May a link leave `step` by `branch`? (A kept node's own handles are Zernio's to check.) */
export function isValidBranch(step: FlowStep, branch: string | null): boolean {
  if (step.kind === 'kept' && ['ai'].includes(step.zernioType) && branch?.startsWith('tool:')) return true
  return branchesOf(step).some(b => b.handle === branch)
}

/* ── validation ─────────────────────────────────────────────────────────── */

export type FlowIssue = {
  code: string
  message: string
  stepId: string | null
  /** true = Save refuses. Warnings (a kept node) do not block. */
  blocks: boolean
  /** a refusal that is not a mistake: the owner has not said yes to it yet */
  needsOwner?: boolean
}

const MINUTES_OK = (m: number) => Number.isInteger(m) && m >= 1 && m <= MAX_MINUTES

export function validateFlow(flow: Flow): FlowIssue[] {
  const issues: FlowIssue[] = []
  const err = (code: string, message: string, stepId: string | null = null) =>
    issues.push({ code, message, stepId, blocks: true })

  const name = flow.name.trim()
  if (!name) err('name_missing', 'Give the flow a name.')
  else if (name.length > NAME_LIMIT) err('name_long', `The name must be ${NAME_LIMIT} characters or fewer.`)
  if (!isFlowPlatform(flow.platform)) err('platform', 'Zernio runs flows on Instagram, Facebook, WhatsApp, Telegram, X, Bluesky and Reddit only.')

  const ids = new Set<string>()
  for (const s of flow.steps) {
    if (!s.id.trim()) err('step_id', 'A step has no id.')
    else if (ids.has(s.id)) err('duplicate_id', `Two steps share the id “${s.id}”.`, s.id)
    ids.add(s.id)
    if (s.label !== null && (s.label.trim().length === 0 || s.label.length > LABEL_LIMIT)) {
      err('label', `A step's name must be 1 to ${LABEL_LIMIT} characters.`, s.id)
    }
  }

  const triggers = flow.steps.filter(s => s.kind === 'trigger')
  if (triggers.length === 0) err('no_trigger', 'A flow needs one starting step.')
  if (triggers.length > 1) err('many_triggers', 'A flow has exactly one starting step.', triggers[1].id)
  const trigger = triggers[0] as (FlowStep & { kind: 'trigger' }) | undefined

  if (trigger) {
    const t = trigger.trigger
    if (!SAVABLE_TRIGGERS.includes(t.kind)) {
      issues.push({
        code: 'trigger_needs_owner', stepId: trigger.id, blocks: true, needsOwner: true,
        message: t.kind === 'dm_keyword'
          ? 'Starting on any DM with a keyword answers people nobody picked — that needs the owner\'s decision, so it cannot be saved yet.'
          : 'WhatsApp is parked — starting on a WhatsApp event needs the owner\'s decision, so it cannot be saved yet.',
      })
    }
    if (t.kind === 'comment_button' && !COMMENT_PLATFORMS.includes(flow.platform)) {
      err('trigger_platform', 'A flow started from a comment runs on Instagram or Facebook only.', trigger.id)
    }
    if (t.kind === 'dm_keyword' && t.matchType !== 'any' && t.keywords.length === 0) {
      err('keywords', 'Add at least one keyword, or match any message.', trigger.id)
    }
    if (t.kind === 'dm_keyword' && t.matchType === 'regex') {
      for (const k of t.keywords) if (!regexOk(k)) err('regex', `“${k}” is not a valid pattern.`, trigger.id)
    }
  }

  // per-step content
  const limit = MESSAGE_LIMITS[flow.platform] ?? 1000
  for (const s of flow.steps) {
    switch (s.kind) {
      case 'message': {
        if (!s.media && !s.text.trim()) err('message_empty', 'A message needs some text.', s.id)
        if (s.text.length > limit) err('message_long', `A message on ${platformName(flow.platform)} must be ${limit} characters or fewer (this one is ${s.text.length}).`, s.id)
        if (s.media) {
          if (!/^https:\/\/\S+$/i.test(s.media.url.trim())) err('media_url', 'A picture or file needs a web address starting https://.', s.id)
          if (s.media.caption.length > limit) err('caption_long', `A caption must be ${limit} characters or fewer.`, s.id)
        }
        break
      }
      case 'wait_reply':
        if (!MINUTES_OK(s.timeoutMinutes)) err('timeout', `Wait between 1 minute and 30 days (${MAX_MINUTES} minutes).`, s.id)
        if (s.saveAs && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.saveAs)) err('save_as', 'Save the reply under a name made of letters, numbers and _.', s.id)
        break
      case 'delay':
        if (!MINUTES_OK(s.minutes)) err('delay', `A delay is between 1 minute and 30 days (${MAX_MINUTES} minutes).`, s.id)
        break
      case 'condition': {
        if (s.rules.length === 0) err('rules_empty', 'A condition needs at least one rule.', s.id)
        const seen = new Set<string>()
        for (const r of s.rules) {
          if (!r.id || r.id === 'default') err('rule_id', 'A rule needs its own id (not “default”).', s.id)
          else if (seen.has(r.id)) err('rule_dup', 'Two rules share an id.', s.id)
          seen.add(r.id)
          if (!r.variable.trim()) err('rule_variable', 'Say what each rule checks (for example lastMessage).', s.id)
          const needsValue = r.operator !== 'exists' && r.operator !== 'not_exists'
          if (needsValue && !r.value.trim()) err('rule_value', 'Each rule needs a value to compare with.', s.id)
          if (r.operator === 'matches' && !regexOk(r.value)) err('regex', `“${r.value}” is not a valid pattern.`, s.id)
        }
        break
      }
      case 'tag':
        if (!s.tag.trim()) err('tag_empty', 'Name the tag.', s.id)
        else if (s.tag.length > TAG_LIMIT) err('tag_long', `A tag is ${TAG_LIMIT} characters or fewer.`, s.id)
        break
      case 'ab_split':
        if (!(s.percentage >= 0 && s.percentage <= 100)) err('percentage', 'The split is between 0 and 100%.', s.id)
        break
      case 'kept':
        issues.push({
          code: 'kept', stepId: s.id, blocks: false,
          message: `“${s.label ?? s.zernioType}” is a ${keptWords(s.zernioType)} step made in Zernio — it is kept exactly as it is and cannot be edited here.`,
        })
        if (s.zernioType === 'start_call' && flow.platform !== 'whatsapp') err('whatsapp_only', 'A call step runs on WhatsApp only.', s.id)
        break
    }
  }

  // links
  const byId = new Map(flow.steps.map(s => [s.id, s]))
  const usedHandles = new Set<string>()
  for (const l of flow.links) {
    const from = byId.get(l.from)
    const to = byId.get(l.to)
    if (!from || !to) { err('dangling', 'A connection points at a step that is not there.', from?.id ?? null); continue }
    if (to.kind === 'trigger') err('into_trigger', 'Nothing can lead back into the starting step.', from.id)
    if (l.from === l.to) err('self_link', 'A step cannot lead to itself.', from.id)
    if (!isValidBranch(from, l.branch)) err('branch', `“${stepTitle(from)}” has no “${l.branch ?? 'next'}” output.`, from.id)
    const key = `${l.from}::${l.branch ?? ''}`
    if (usedHandles.has(key)) err('fan_out', `“${stepTitle(from)}” leads two places from the same output — pick one.`, from.id)
    usedHandles.add(key)
  }

  // shape: reachable from the trigger, no loops
  if (trigger) {
    const reached = reachable(flow, trigger.id)
    for (const s of flow.steps) {
      if (!reached.has(s.id)) err('orphan', `“${stepTitle(s)}” is not connected to the start — connect it or delete it.`, s.id)
    }
    if (flow.steps.length === 1) err('only_trigger', 'Add at least one step after the start.', trigger.id)
    const loop = findCycle(flow)
    if (loop) err('loop', `The flow loops back at “${stepTitle(byId.get(loop)!)}” — a flow here runs top to bottom, never in a circle, so nobody is messaged over and over.`, loop)
  }

  return issues
}

export const canSave = (issues: FlowIssue[]) => !issues.some(i => i.blocks)

function regexOk(p: string): boolean {
  try { new RegExp(p); return true } catch { return false }
}

export function reachable(flow: Flow, from: string): Set<string> {
  const out = new Set<string>([from])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const l of flow.links) if (l.from === cur && !out.has(l.to)) { out.add(l.to); queue.push(l.to) }
  }
  return out
}

/** A step that sits on a loop, or null. */
export function findCycle(flow: Flow): string | null {
  const state = new Map<string, 1 | 2>()
  const next = (id: string) => flow.links.filter(l => l.from === id).map(l => l.to)
  const visit = (id: string): string | null => {
    state.set(id, 1)
    for (const n of next(id)) {
      const s = state.get(n)
      if (s === 1) return n
      if (s === undefined) { const hit = visit(n); if (hit) return hit }
    }
    state.set(id, 2)
    return null
  }
  for (const s of flow.steps) {
    if (!state.has(s.id)) { const hit = visit(s.id); if (hit) return hit }
  }
  return null
}

/* ── words ──────────────────────────────────────────────────────────────── */

export function platformName(p: string): string {
  const names: Record<string, string> = {
    instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', telegram: 'Telegram',
    twitter: 'X', bluesky: 'Bluesky', reddit: 'Reddit',
  }
  return names[p] ?? p
}

export const STEP_WORDS: Record<StepKind, string> = {
  trigger: 'Start', message: 'Send a message', wait_reply: 'Wait for a reply', delay: 'Wait',
  condition: 'Condition', tag: 'Tag', ab_split: 'A/B split', handoff: 'Hand to a person', end: 'End', kept: 'Zernio step',
}

export function minutesWords(m: number): string {
  if (m % 1440 === 0) { const d = m / 1440; return `${d} day${d === 1 ? '' : 's'}` }
  if (m % 60 === 0) { const h = m / 60; return `${h} hour${h === 1 ? '' : 's'}` }
  return `${m} minute${m === 1 ? '' : 's'}`
}

export function triggerWords(t: Trigger, platform: FlowPlatform): string {
  if (t.kind === 'comment_button') {
    return `When someone comments on a post on ${platformName(platform)}, gets the automation's DM and taps its button`
  }
  if (t.kind === 'whatsapp_event') return `When a WhatsApp ${WHATSAPP_EVENT_WORDS[t.eventType ?? ''] ?? 'status'} event arrives`
  const kw = t.keywords.map(k => `“${k}”`).join(', ')
  const first = t.onlyFirstMessage ? ' (first message only)' : ''
  if (t.matchType === 'any' || !kw) return `When anyone sends a DM${first}`
  const how = t.matchType === 'exact' ? 'is exactly' : t.matchType === 'regex' ? 'matches' : 'contains'
  return `When a DM ${how} ${kw}${first}`
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function stepTitle(s: FlowStep): string {
  if (s.label) return s.label
  switch (s.kind) {
    case 'message': return s.media ? `Send ${s.media.type}` : 'Send a message'
    case 'kept': return `${keptWords(s.zernioType)} step`
    default: return STEP_WORDS[s.kind]
  }
}

/** One step, one sentence. */
export function stepWords(s: FlowStep, platform: FlowPlatform): string {
  switch (s.kind) {
    case 'trigger': return triggerWords(s.trigger, platform)
    case 'message': {
      const text = s.text.trim() ? `“${clip(s.text.trim())}”` : ''
      if (s.media) return `Send ${s.media.type === 'image' ? 'a picture' : `a ${s.media.type}`}${text ? ` with ${text}` : ''}`
      return `Send ${text || 'an empty message'}`
    }
    case 'wait_reply': return `Wait up to ${minutesWords(s.timeoutMinutes)} for a reply${s.saveAs ? ` (kept as {{${s.saveAs}}})` : ''}`
    case 'delay': return `Wait ${minutesWords(s.minutes)}`
    case 'condition': return `Check ${s.rules.map(ruleLabel).join(', then ') || 'nothing'}`
    case 'tag': return `${s.action === 'add' ? 'Tag them' : 'Remove the tag'} “${s.tag}”`
    case 'ab_split': return `Split at random: ${s.percentage}% A, ${100 - s.percentage}% B`
    case 'handoff': return `Hand the conversation to a person${s.note ? ` — “${clip(s.note, 60)}”` : ''}`
    case 'end': return 'End'
    case 'kept': return `A ${keptWords(s.zernioType)} step (kept as made in Zernio)`
  }
}

/**
 * The whole flow in plain English, one line per step, indented under each
 * branch — what the list shows under a flow's name, and what the owner reads
 * before saying yes to switching one on.
 */
export function summariseFlow(flow: Flow): string[] {
  const byId = new Map(flow.steps.map(s => [s.id, s]))
  const trigger = flow.steps.find(s => s.kind === 'trigger')
  if (!trigger) return ['No starting step yet.']
  const lines: string[] = []
  const seen = new Set<string>()
  const walk = (id: string, depth: number) => {
    const s = byId.get(id)
    if (!s) return
    const pad = '  '.repeat(depth)
    if (seen.has(id)) { lines.push(`${pad}→ back to “${stepTitle(s)}”`); return }
    seen.add(id)
    lines.push(`${pad}${stepWords(s, flow.platform)}${s.kind === 'trigger' ? ':' : '.'}`)
    const out = branchesOf(s)
    const links = flow.links.filter(l => l.from === id)
    if (out.length === 1 && out[0].handle === null) {
      const l = links.find(x => x.branch === null)
      if (l) walk(l.to, depth)
      return
    }
    for (const b of out) {
      const l = links.find(x => x.branch === b.handle)
      if (!l) continue
      lines.push(`${pad}  If ${b.label.toLowerCase()}:`)
      walk(l.to, depth + 2)
    }
  }
  walk(trigger.id, 0)
  return lines
}

/* ── editing helpers (pure) ─────────────────────────────────────────────── */

/** A fresh id for a new step: `<kind>_<n>`, never one already used. */
export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let n = 1
  while (used.has(`${prefix}_${n}`)) n++
  return `${prefix}_${n}`
}

export function blankStep(kind: Exclude<StepKind, 'trigger' | 'kept'>, id: string): FlowStep {
  const base: Base = { id, label: null, position: null }
  switch (kind) {
    case 'message': return { ...base, kind, text: '', media: null }
    case 'wait_reply': return { ...base, kind, timeoutMinutes: 1440, saveAs: 'reply' }
    case 'delay': return { ...base, kind, minutes: 60 }
    case 'condition': return { ...base, kind, rules: [{ id: 'r1', variable: 'reply', operator: 'contains', value: 'yes' }] }
    case 'tag': return { ...base, kind, action: 'add', tag: '' }
    case 'ab_split': return { ...base, kind, percentage: 50 }
    case 'handoff': return { ...base, kind, note: '' }
    case 'end': return { ...base, kind }
  }
}

/** A new flow: the comment-button start, one message, the end — connected. */
export function starterFlow(platform: FlowPlatform, name = 'New flow'): Flow {
  return {
    name, description: '', platform,
    steps: [
      { id: 'start', label: null, position: { x: 0, y: 0 }, kind: 'trigger', trigger: { kind: 'comment_button', keywords: [], matchType: 'any', onlyFirstMessage: false, eventType: null } },
      { id: 'message_1', label: null, position: { x: 0, y: 160 }, kind: 'message', text: 'Thanks for tapping! Here is the link you asked for: ', media: null },
      { id: 'end_1', label: null, position: { x: 0, y: 320 }, kind: 'end' },
    ],
    links: [
      { id: 'e_1', from: 'start', to: 'message_1', branch: null },
      { id: 'e_2', from: 'message_1', to: 'end_1', branch: null },
    ],
  }
}

/** The first output of `from` with nothing attached, or null when every output is taken. */
export function freeBranch(flow: Flow, fromId: string): string | null | undefined {
  const s = flow.steps.find(x => x.id === fromId)
  if (!s) return undefined
  const taken = new Set(flow.links.filter(l => l.from === fromId).map(l => l.branch ?? ''))
  const b = branchesOf(s).find(x => !taken.has(x.handle ?? ''))
  return b ? b.handle : undefined
}

/**
 * Add a step after `afterId` on its first free output (or unattached when it
 * has none), placed under it. Returns the new flow and the new step's id.
 */
export function addStepAfter(flow: Flow, afterId: string | null, kind: Exclude<StepKind, 'trigger' | 'kept'>): { flow: Flow; id: string } {
  const id = newId(kind, flow.steps.map(s => s.id))
  const step = blankStep(kind, id)
  const after = afterId ? flow.steps.find(s => s.id === afterId) : undefined
  const branch = after ? freeBranch(flow, after.id) : undefined
  const siblings = after ? flow.links.filter(l => l.from === after.id).length : 0
  const base = after?.position ?? { x: 0, y: Math.max(0, ...flow.steps.map(s => s.position?.y ?? 0)) }
  step.position = { x: base.x + siblings * 280, y: base.y + 170 }
  const links = [...flow.links]
  if (after && branch !== undefined) {
    links.push({ id: newId('e', links.map(l => l.id)), from: after.id, to: id, branch })
  }
  return { flow: { ...flow, steps: [...flow.steps, step], links }, id }
}

/** Remove a step (never the start) and every connection touching it. */
export function removeStep(flow: Flow, id: string): Flow {
  const s = flow.steps.find(x => x.id === id)
  if (!s || s.kind === 'trigger') return flow
  return { ...flow, steps: flow.steps.filter(x => x.id !== id), links: flow.links.filter(l => l.from !== id && l.to !== id) }
}

/**
 * Connect `from`'s `branch` output to `to`. One output leads to one place, so
 * an existing link from the same output is replaced. Refuses (returns the
 * flow unchanged) a link into the start, to itself, or from an output the
 * step does not have.
 */
export function connect(flow: Flow, from: string, branch: string | null, to: string): Flow {
  const a = flow.steps.find(s => s.id === from)
  const b = flow.steps.find(s => s.id === to)
  if (!a || !b || b.kind === 'trigger' || from === to || !isValidBranch(a, branch)) return flow
  const links = flow.links.filter(l => !(l.from === from && (l.branch ?? null) === branch))
  links.push({ id: newId('e', flow.links.map(l => l.id)), from, branch, to })
  return { ...flow, links }
}

/** Replace one step (same id), and drop links from branches it no longer has (a deleted condition rule). */
export function updateStep(flow: Flow, next: FlowStep): Flow {
  const steps = flow.steps.map(s => (s.id === next.id ? next : s))
  const links = flow.links.filter(l => l.from !== next.id || isValidBranch(next, l.branch))
  return { ...flow, steps, links }
}

/** Give every step without a position one, row by row from the start (Zernio ignores positions; a flow made by API may have none). */
export function autoLayout(flow: Flow): Flow {
  if (flow.steps.every(s => s.position)) return flow
  const trigger = flow.steps.find(s => s.kind === 'trigger')
  const depth = new Map<string, number>()
  if (trigger) {
    depth.set(trigger.id, 0)
    const queue = [trigger.id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const l of flow.links) {
        if (l.from === cur && !depth.has(l.to)) { depth.set(l.to, depth.get(cur)! + 1); queue.push(l.to) }
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values())
  const perRow = new Map<number, number>()
  const steps = flow.steps.map(s => {
    if (s.position) return s
    const d = depth.get(s.id) ?? maxDepth + 1
    const col = perRow.get(d) ?? 0
    perRow.set(d, col + 1)
    return { ...s, position: { x: col * 280, y: d * 170 } }
  })
  return { ...flow, steps }
}

/* ── the phone preview ──────────────────────────────────────────────────── */

/** The steps from the start to `id`, following the links (the first path found). */
export function pathTo(flow: Flow, id: string): { step: FlowStep; via: string | null }[] {
  const trigger = flow.steps.find(s => s.kind === 'trigger')
  if (!trigger) return []
  const parent = new Map<string, { from: string; branch: string | null }>()
  const seen = new Set([trigger.id])
  const queue = [trigger.id]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === id) break
    for (const l of flow.links) {
      if (l.from === cur && !seen.has(l.to)) { seen.add(l.to); parent.set(l.to, { from: cur, branch: l.branch }); queue.push(l.to) }
    }
  }
  if (!seen.has(id)) return []
  const out: { step: FlowStep; via: string | null }[] = []
  let cur: string | undefined = id
  while (cur) {
    const here: string = cur
    const p = parent.get(here)
    out.unshift({ step: flow.steps.find(x => x.id === here)!, via: p?.branch ?? null })
    cur = p?.from
  }
  return out
}

export type Bubble =
  | { from: 'them'; text: string }
  | { from: 'us'; text: string; media: { type: MediaType; url: string } | null }
  | { from: 'note'; text: string }

/**
 * What the person sees, down the path to the selected step: our messages as
 * bubbles on the right, their reply (or silence) on the left, waits and
 * branches as small notes. Only what the flow SENDS is a bubble.
 */
export function previewBubbles(flow: Flow, selectedId: string | null): Bubble[] {
  const trigger = flow.steps.find(s => s.kind === 'trigger')
  if (!trigger) return []
  let target = selectedId && flow.steps.some(s => s.id === selectedId) ? selectedId : null
  if (!target) {
    // no selection: follow the first output from the start to the end
    let cur: string | undefined = trigger.id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur); target = cur
      const nextLink: FlowLink | undefined = flow.links.find(l => l.from === cur)
      cur = nextLink?.to
    }
  }
  const path = pathTo(flow, target!)
  const out: Bubble[] = []
  for (const { step, via } of path) {
    if (via) {
      const prev = path[path.findIndex(p => p.step.id === step.id) - 1]?.step
      const b = prev ? branchesOf(prev).find(x => x.handle === via) : undefined
      if (prev?.kind === 'wait_reply') out.push(via === 'reply' ? { from: 'them', text: 'Their reply' } : { from: 'note', text: `No reply for ${minutesWords(prev.timeoutMinutes)}` })
      else if (b) out.push({ from: 'note', text: b.label })
    }
    switch (step.kind) {
      case 'trigger':
        out.push({ from: 'note', text: step.trigger.kind === 'comment_button' ? 'They commented, got the DM and tapped the button' : triggerWords(step.trigger, flow.platform) })
        if (step.trigger.kind === 'dm_keyword') out.push({ from: 'them', text: step.trigger.keywords[0] ?? 'Hi' })
        break
      case 'message':
        out.push({ from: 'us', text: step.media ? (step.media.caption || step.text) : step.text, media: step.media ? { type: step.media.type, url: step.media.url } : null })
        break
      case 'delay': out.push({ from: 'note', text: `${minutesWords(step.minutes)} later` }); break
      case 'handoff': out.push({ from: 'note', text: 'Handed to a person on the team' }); break
      case 'end': out.push({ from: 'note', text: 'Flow ends' }); break
      default: break
    }
  }
  return out
}
