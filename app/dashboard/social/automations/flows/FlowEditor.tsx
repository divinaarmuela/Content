'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, applyNodeChanges,
  type Node, type Edge, type NodeProps, type NodeChange, type EdgeChange, type Connection, type ColorMode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ArrowLeft, BarChart3, Clock, GitBranch, Hand, Lock, MessageCircle, MessageSquareReply, Play, RefreshCw, Save, Shuffle, Square, Tag,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import {
  addStepAfter, branchesOf, canSave, connect, previewBubbles, removeStep, stepTitle, stepWords, summariseFlow, toZernio,
  updateStep, validateFlow, platformName,
  type Flow, type FlowIssue, type FlowPlatform, type FlowStep, type FlowTotals, type RunRow, type RunStatus, type StepKind, type StepStats,
  type WorkflowStatus,
} from '@/app/lib/flow-core'
import { PhonePreview, StepPanel } from './StepPanel'

/**
 * THE FLOW CANVAS — ManyChat's pattern: a start card, message cards, waits,
 * conditions and splits joined by arrows; zoom and pan, a mini-map, a side
 * panel for the chosen card and a phone showing what the person sees down
 * the path to it. Our Flow (app/lib/flow-core.ts) is the only state; the
 * canvas is drawn from it.
 *
 * Save makes or changes a Zernio DRAFT. There is no working "switch on": the
 * button is drawn disabled, because switching a flow on waits for the owner.
 */

export type EditorAccount = { id: string; platform: string; username: string | null; name: string | null }

const ICONS: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  trigger: Play, message: MessageCircle, wait_reply: MessageSquareReply, delay: Clock, condition: GitBranch,
  tag: Tag, ab_split: Shuffle, handoff: Hand, end: Square, kept: Wrench,
}

const ADDABLE: { kind: Exclude<StepKind, 'trigger' | 'kept'>; label: string }[] = [
  { kind: 'message', label: 'Message' }, { kind: 'wait_reply', label: 'Wait for reply' }, { kind: 'delay', label: 'Delay' },
  { kind: 'condition', label: 'Condition' }, { kind: 'tag', label: 'Tag' }, { kind: 'ab_split', label: 'A/B split' },
  { kind: 'handoff', label: 'Hand to a person' }, { kind: 'end', label: 'End' },
]

const handleId = (h: string | null) => h ?? 'next'
const branchOf = (h: string | null | undefined) => (!h || h === 'next' ? null : h)

type StepData = { step: FlowStep; platform: FlowPlatform; problems: FlowIssue[]; numbers: StepStats | null }

type StatsView = {
  totals: FlowTotals; runs_total: number | null; sampled: number; unread: number
  steps: Record<string, StepStats>; recent: RunRow[]
}

const RUN_WORDS: Record<RunStatus, string> = {
  running: 'Running', waiting: 'Waiting', completed: 'Completed', exited: 'Stopped early', failed: 'Failed', unknown: 'Unknown',
}

const StepNode = memo(function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const { step, platform, problems, numbers } = data
  const Icon = ICONS[step.kind]
  const outs = branchesOf(step)
  const blocking = problems.some(p => p.blocks && !p.needsOwner)
  const owner = problems.some(p => p.needsOwner)
  const tone = step.kind === 'trigger' ? 'bg-tint-green' : step.kind === 'message' ? 'bg-tint-blue' : step.kind === 'kept' ? 'bg-muted' : 'bg-card'
  return (
    <div className={`w-[240px] rounded-card border ${selected ? 'border-foreground ring-2 ring-foreground/20' : 'border-border'} ${tone} text-foreground shadow-sm`}>
      {step.kind !== 'trigger' && <Handle type="target" position={Position.Top} className="!h-3 !w-3 !bg-foreground" />}
      <div className="flex items-center gap-2 px-3 pt-3">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-secondary-13 font-semibold">{stepTitle(step)}</span>
        {(blocking || owner) && (
          <span className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ${blocking ? 'bg-accent-red' : 'bg-accent-amber'}`}
            title={blocking ? 'Needs fixing' : 'Needs the owner'} />
        )}
      </div>
      <p className="line-clamp-3 px-3 pb-3 pt-1 text-[12px] leading-snug text-muted-foreground">{stepWords(step, platform)}</p>
      {numbers && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 border-t border-border px-3 py-1.5 text-[11px] font-medium">
          <span>{numbers.reached} reached</span>
          {numbers.completed !== numbers.reached && <span>{numbers.completed} done</span>}
          {numbers.waiting > 0 && <span>{numbers.waiting} waiting</span>}
          {numbers.failed > 0 && <span className="text-accent-red">{numbers.failed} failed</span>}
        </div>
      )}
      {outs.length > 1 && (
        <div className="flex justify-around border-t border-border px-1 py-1.5">
          {outs.map(o => <span key={handleId(o.handle)} className="max-w-[80px] truncate text-[10px] font-medium">{o.label}</span>)}
        </div>
      )}
      {outs.map((o, i) => (
        <Handle
          key={handleId(o.handle)} id={handleId(o.handle)} type="source" position={Position.Bottom}
          style={{ left: `${((i + 1) / (outs.length + 1)) * 100}%` }} className="!h-3 !w-3 !bg-foreground"
        />
      ))}
    </div>
  )
})

const NODE_TYPES = { step: StepNode }

/** The dashboard's own theme (a class on <html>), for the canvas's controls and mini-map. */
function useColorMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>('light')
  useEffect(() => {
    const el = document.documentElement
    const read = () => setMode(el.classList.contains('dark') ? 'dark' : 'light')
    read()
    const obs = new MutationObserver(read)
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return mode
}

const STATUS_WORDS: Record<WorkflowStatus | 'new', { text: string; cls: string }> = {
  new: { text: 'Not saved yet', cls: 'bg-foreground/[0.06]' },
  draft: { text: 'Draft · off', cls: 'bg-foreground/[0.06]' },
  paused: { text: 'Paused · off', cls: 'bg-tint-amber' },
  active: { text: 'On at Zernio', cls: 'bg-tint-green' },
  unknown: { text: 'Status unknown', cls: 'bg-tint-amber' },
}

function Canvas(props: {
  initial: Flow
  id: string | null
  status: WorkflowStatus | 'new'
  editable: boolean
  canManage: boolean
  clientId: string
  clientName: string
  account: EditorAccount
  onBack: () => void
  onSaved: (id: string) => void
}) {
  const { account, clientId, clientName, onBack, onSaved } = props
  const [flow, setFlow] = useState<Flow>(props.initial)
  const [id, setId] = useState<string | null>(props.id)
  const [status, setStatus] = useState<WorkflowStatus | 'new'>(props.status)
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const draftKey = useRef<string>(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
  const colorMode = useColorMode()
  const readOnly = !props.canManage || !props.editable

  // the numbers: read only, and only for a flow Zernio already has
  const [stats, setStats] = useState<StatsView | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [showNumbers, setShowNumbers] = useState(true)
  const loadStats = useCallback(async (wf: string) => {
    setStatsError(null)
    try {
      const r = await fetch(`/api/social/flows/${encodeURIComponent(wf)}/stats`)
      const b = await r.json().catch(() => ({}))
      if (!r.ok) { setStatsError(b.error ?? 'Could not read the numbers'); return }
      setStats(b as StatsView)
    } catch { setStatsError('Could not reach the server') }
  }, [])
  useEffect(() => { if (id) void loadStats(id) }, [id, loadStats])

  const issues = useMemo(() => validateFlow(flow), [flow])
  const summary = useMemo(() => summariseFlow(flow), [flow])
  const bubbles = useMemo(() => previewBubbles(flow, selected), [flow, selected])
  const savable = canSave(issues)

  const change = useCallback((next: Flow | ((f: Flow) => Flow)) => {
    setFlow(next)
    setDirty(true)
  }, [])

  // the canvas's own node list: rebuilt from the flow, keeping what the canvas
  // measured and where a card is mid-drag
  const [nodes, setNodes] = useState<Node<StepData>[]>([])
  useEffect(() => {
    setNodes(prev => {
      const had = new Map(prev.map(n => [n.id, n]))
      return flow.steps.map(s => ({
        ...(had.get(s.id) ?? {}),
        id: s.id, type: 'step',
        position: s.position ?? had.get(s.id)?.position ?? { x: 0, y: 0 },
        data: {
          step: s, platform: flow.platform, problems: issues.filter(i => i.stepId === s.id),
          numbers: showNumbers && stats ? (stats.steps[s.id] ?? { reached: 0, completed: 0, failed: 0, waiting: 0, branches: {} }) : null,
        },
        selected: s.id === selected,
        deletable: !readOnly && s.kind !== 'trigger',
      }))
    })
  }, [flow, issues, selected, readOnly, showNumbers, stats])

  const edges: Edge[] = useMemo(() => flow.links.map(l => {
    const from = flow.steps.find(s => s.id === l.from)
    const words = from && branchesOf(from).length > 1 ? branchesOf(from).find(b => b.handle === l.branch)?.label : undefined
    const n = showNumbers && stats ? stats.steps[l.from]?.branches[handleId(l.branch)] ?? 0 : null
    const label = n === null ? words : `${words ? `${words} · ` : ''}${n}`
    return {
      id: l.id, source: l.from, target: l.to, sourceHandle: handleId(l.branch), type: 'smoothstep',
      label, deletable: !readOnly, labelStyle: { fontSize: 11 },
    }
  }), [flow, readOnly, showNumbers, stats])

  const onNodesChange = useCallback((changes: NodeChange<Node<StepData>>[]) => {
    setNodes(ns => applyNodeChanges(changes, ns))
    for (const c of changes) {
      if (c.type === 'position' && c.position && c.dragging === false && !readOnly) {
        const pos = c.position
        change(f => ({ ...f, steps: f.steps.map(s => (s.id === c.id ? { ...s, position: { x: Math.round(pos.x), y: Math.round(pos.y) } } : s)) }))
      }
      if (c.type === 'select' && c.selected) setSelected(c.id)
      if (c.type === 'remove' && !readOnly) {
        change(f => removeStep(f, c.id))
        setSelected(s => (s === c.id ? null : s))
      }
    }
  }, [change, readOnly])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (readOnly) return
    const gone = new Set(changes.filter(c => c.type === 'remove').map(c => c.id))
    if (gone.size) change(f => ({ ...f, links: f.links.filter(l => !gone.has(l.id)) }))
  }, [change, readOnly])

  const onConnect = useCallback((c: Connection) => {
    if (readOnly || !c.source || !c.target) return
    change(f => connect(f, c.source, branchOf(c.sourceHandle), c.target))
  }, [change, readOnly])

  const add = (kind: Exclude<StepKind, 'trigger' | 'kept'>) => {
    const after = selected ?? flow.steps[flow.steps.length - 1]?.id ?? null
    const made = addStepAfter(flow, after, kind)
    change(made.flow)
    setSelected(made.id)
  }

  const save = async () => {
    if (readOnly || !savable || saving) return
    setSaving(true)
    try {
      const graph = { name: flow.name, description: flow.description, ...toZernio(flow) }
      const res = id
        ? await fetch(`/api/social/flows/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow: graph }) })
        : await fetch('/api/social/flows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_key: draftKey.current, client_id: clientId, account_id: account.id, flow: graph }),
        })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Could not save the flow'); return }
      setId(body.id)
      setStatus(body.status ?? 'draft')
      setDirty(false)
      toast.success('Saved at Zernio as a draft — it is off.')
      onSaved(body.id)
    } catch {
      toast.error('Could not reach the server — nothing was saved')
    } finally {
      setSaving(false)
    }
  }

  const step = selected ? flow.steps.find(s => s.id === selected) ?? null : null
  const blocking = issues.filter(i => i.blocks)
  const handle = account.username ? `@${account.username}` : account.name ?? 'Account'
  const st = STATUS_WORDS[status]

  return (
    <div className="grid gap-4">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => {
          if (dirty && !window.confirm('Leave without saving? Your changes to this flow will be lost.')) return
          onBack()
        }}>
          <ArrowLeft className="h-4 w-4" /> Flows
        </Button>
        <Input
          aria-label="Flow name" className="h-9 max-w-xs font-semibold" value={flow.name} disabled={readOnly}
          onChange={e => change(f => ({ ...f, name: e.target.value }))}
        />
        <span className="text-secondary-13 text-muted-foreground">{clientName} · {platformName(flow.platform)} {handle}</span>
        <span className={`rounded-full px-2.5 py-1 text-chip-12 ${st.cls}`}>{st.text}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {props.canManage && (
            <Button size="sm" onClick={save} disabled={readOnly || !savable || saving || (!dirty && !!id)}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : id ? 'Save draft' : 'Save as draft'}
            </Button>
          )}
          {/* never wired: switching a flow on waits for the owner */}
          <Button size="sm" variant="outline" disabled title="Switching a flow on waits for the owner's go-ahead">
            <Lock className="h-4 w-4" /> Switch on (needs the owner&apos;s go-ahead)
          </Button>
        </div>
      </div>

      {status === 'active' && (
        <p className="rounded-inner bg-tint-amber px-3 py-2 text-secondary-13">
          This flow is switched on at Zernio. It is shown read-only — nothing here changes a flow that is on.
        </p>
      )}
      {!props.canManage && (
        <p className="rounded-inner bg-foreground/[0.06] px-3 py-2 text-secondary-13">You can look; an account manager makes and changes flows.</p>
      )}
      {!readOnly && blocking.length > 0 && (
        <ul className="grid gap-1 rounded-inner bg-tint-red px-3 py-2 text-secondary-13">
          <li className="font-semibold">Before it can be saved:</li>
          {blocking.map((i, n) => (
            <li key={n}>
              {i.needsOwner && <strong>Needs the owner&apos;s decision. </strong>}
              {i.stepId ? <button className="underline" onClick={() => setSelected(i.stepId)}>{i.message}</button> : i.message}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-secondary-13 text-muted-foreground">
            Add after {step ? `“${stepTitle(step)}”` : 'the last step'}:
          </span>
          {ADDABLE.map(a => {
            const Icon = ICONS[a.kind]
            return (
              <Button key={a.kind} size="sm" variant="outline" onClick={() => add(a.kind)}>
                <Icon className="h-4 w-4" /> {a.label}
              </Button>
            )
          })}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-4">
          <div className="h-[65vh] min-h-[420px] overflow-hidden rounded-card border border-border bg-background">
            <ReactFlow<Node<StepData>, Edge>
              nodes={nodes} edges={edges} nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
              onPaneClick={() => setSelected(null)}
              nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              colorMode={colorMode} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="!hidden md:!block" />
            </ReactFlow>
          </div>
          <NumbersCard
            id={id} stats={stats} error={statsError} show={showNumbers}
            onToggle={() => setShowNumbers(v => !v)} onRefresh={() => { if (id) void loadStats(id) }}
          />
          <div className="rounded-card border border-border bg-card p-4">
            <h3 className="text-card-title">In plain English</h3>
            <div className="mt-2 grid gap-0.5 text-secondary-13">
              {summary.map((line, i) => (
                <p key={i} style={{ paddingLeft: `${(line.length - line.trimStart().length) * 8}px` }}>{line.trim()}</p>
              ))}
            </div>
          </div>
        </div>

        <div className="grid content-start gap-4">
          {step ? (
            <StepPanel
              step={step} platform={flow.platform} issues={issues} readOnly={readOnly}
              onChange={next => change(f => updateStep(f, next))}
              onDelete={() => { change(f => removeStep(f, step.id)); setSelected(null) }}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="rounded-card border border-dashed border-border p-4 text-secondary-13 text-muted-foreground">
              Click a card to change it. Drag from a card&apos;s bottom dot to another card to connect them; select an arrow
              and press Delete to remove it.
            </p>
          )}
          <div className="grid gap-2">
            <p className="text-secondary-13 font-medium">What they see{step ? ` up to “${stepTitle(step)}”` : ''}</p>
            <PhonePreview bubbles={bubbles} handle={handle} platform={flow.platform} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A flow's numbers, as far as Zernio reports them. ManyChat shows sent /
 * delivered / read / clicked per message; Zernio's workflows API reports none
 * of those per step (OpenAPI 1.164.0) — only runs started / completed /
 * exited per flow, and each run's step-by-step timeline. This card says so
 * rather than drawing zeros that look like data.
 */
function NumbersCard({ id, stats, error, show, onToggle, onRefresh }: {
  id: string | null; stats: StatsView | null; error: string | null; show: boolean
  onToggle: () => void; onRefresh: () => void
}) {
  const t = stats?.totals
  const n = (v: number | null) => (v === null ? '—' : String(v))
  return (
    <div className="grid gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4" />
        <h3 className="text-card-title">Numbers</h3>
        {id && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={onToggle}>{show ? 'Hide on cards' : 'Show on cards'}</Button>
            <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCw className="h-4 w-4" /> Refresh</Button>
          </div>
        )}
      </div>
      {!id && <p className="text-secondary-13 text-muted-foreground">A flow has numbers once it is saved and has run.</p>}
      {id && error && <p className="rounded-inner bg-tint-amber px-3 py-2 text-secondary-13">{error}</p>}
      {id && !error && !stats && <p className="text-secondary-13 text-muted-foreground">Reading Zernio…</p>}
      {stats && t && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ['Started', n(t.started)],
              ['Completed', n(t.completed)],
              ['Stopped early', n(t.exited)],
              ['Completion', t.completionRate === null ? '—' : `${t.completionRate}%`],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-inner bg-foreground/[0.04] px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{k}</p>
                <p className="text-section-title">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-secondary-13 text-muted-foreground">
            Totals are Zernio&apos;s own counters. The numbers on each card count the latest {stats.sampled} run
            {stats.sampled === 1 ? '' : 's'}{stats.runs_total !== null ? ` of ${stats.runs_total}` : ''}
            {stats.unread ? ` (${stats.unread} could not be read)` : ''}; Zernio keeps each run&apos;s steps for 90 days.
          </p>
          {stats.recent.length > 0 && (
            <ul className="grid gap-1 text-secondary-13">
              {stats.recent.map(r => (
                <li key={r.id} className="flex flex-wrap gap-2">
                  <span className="font-medium">{RUN_WORDS[r.status]}</span>
                  {r.createdAt && (
                    <span className="text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  )}
                  {r.stepCount !== null && <span className="text-muted-foreground">{r.stepCount} steps</span>}
                  {r.lastError && <span className="text-accent-red">{r.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-secondary-13 text-muted-foreground">
            Not available for a flow: delivered, read or clicks per message — Zernio&apos;s workflows do not report them. The
            comment automation that leads here reports triggered, DMs sent, delivered, read and link clicks on
            the <Link className="underline" href="/dashboard/social/automations">Automations</Link> page.
          </p>
        </>
      )}
    </div>
  )
}

export default function FlowEditor(props: React.ComponentProps<typeof Canvas>) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
