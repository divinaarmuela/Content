import { describe, expect, it } from 'vitest'
import {
  addStepAfter, autoLayout, canSave, connect, findCycle, fromZernio, nodeFromStep, pathTo, previewBubbles, removeStep,
  starterFlow, stepFromNode, summariseFlow, toZernio, updateStep, validateFlow, readWorkflowList, readWorkflowMeta,
  MESSAGE_LIMITS, MAX_MINUTES, aggregateStepStats, flowTotals, readRuns, readRunEvents, type Flow, type FlowStep, type ZernioNode,
} from '../app/lib/flow-core'

/**
 * THE FLOW BUILDER'S PURE HALF (30 Sep 2026). Our flow ↔ Zernio's workflow graph
 * (the shapes are components.schemas.WorkflowNode / WorkflowEdge in Zernio's
 * OpenAPI 1.164.0), validation, and the plain-English summary.
 */

/** A graph shaped like Zernio's own "First workflow" docs example, plus every node kind we edit. */
const ZERNIO_GRAPH = {
  _id: 'wf1', name: 'Guide funnel', description: 'd', status: 'draft', platform: 'instagram', accountId: 'zacc1', profileId: 'zprof',
  nodes: [
    { id: 'n_trigger', type: 'trigger', config: { triggerType: 'api_call' }, position: { x: 0, y: 0 } },
    { id: 'n_ask', type: 'send_message', config: { messageType: 'text', text: 'Want the guide? Reply YES' }, position: { x: 0, y: 150 }, label: 'Ask' },
    { id: 'n_wait', type: 'wait_for_reply', config: { timeoutMinutes: 1440, saveAs: 'answer' }, position: { x: 0, y: 300 } },
    { id: 'n_cond', type: 'condition', config: { rules: [{ id: 'yes', variable: 'answer', operator: 'contains', value: 'yes' }] }, position: { x: 0, y: 450 } },
    { id: 'n_pic', type: 'send_message', config: { messageType: 'media', text: 'Here', media: { mediaType: 'image', url: 'https://x.invalid/a.png', caption: 'The guide' } }, position: { x: 0, y: 600 } },
    { id: 'n_tag', type: 'add_tag', config: { tag: 'guide' }, position: { x: 0, y: 750 } },
    { id: 'n_delay', type: 'delay', config: { delayMinutes: 60 }, position: { x: 300, y: 600 } },
    { id: 'n_split', type: 'a_b_split', config: { percentage: 30 }, position: { x: 300, y: 750 } },
    { id: 'n_hand', type: 'handoff', config: { note: 'call them' }, position: { x: 300, y: 900 } },
    { id: 'n_hook', type: 'webhook', config: { url: 'https://hooks.invalid/x', method: 'POST' }, position: { x: 600, y: 900 } },
    { id: 'n_end', type: 'end', position: { x: 0, y: 900 } },
  ],
  edges: [
    { id: 'e1', source: 'n_trigger', target: 'n_ask' },
    { id: 'e2', source: 'n_ask', target: 'n_wait' },
    { id: 'e3', source: 'n_wait', target: 'n_cond', sourceHandle: 'reply' },
    { id: 'e4', source: 'n_wait', target: 'n_delay', sourceHandle: 'timeout' },
    { id: 'e5', source: 'n_cond', target: 'n_pic', sourceHandle: 'yes' },
    { id: 'e6', source: 'n_cond', target: 'n_end', sourceHandle: 'default' },
    { id: 'e7', source: 'n_pic', target: 'n_tag' },
    { id: 'e8', source: 'n_delay', target: 'n_split' },
    { id: 'e9', source: 'n_split', target: 'n_hand', sourceHandle: 'a' },
    { id: 'e10', source: 'n_split', target: 'n_hook', sourceHandle: 'b' },
  ],
  entryNodeId: 'n_trigger',
}

describe('Zernio graph ↔ our flow', () => {
  it('reads every node kind and writes the same graph back (round trip)', () => {
    const flow = fromZernio({ workflow: ZERNIO_GRAPH })
    expect(flow.name).toBe('Guide funnel')
    expect(flow.platform).toBe('instagram')
    expect(flow.steps.map(s => s.kind)).toEqual([
      'trigger', 'message', 'wait_reply', 'condition', 'message', 'tag', 'delay', 'ab_split', 'handoff', 'kept', 'end',
    ])
    const back = toZernio(flow)
    expect(back.entryNodeId).toBe('n_trigger')
    expect(back.nodes).toEqual(ZERNIO_GRAPH.nodes)
    expect(back.edges).toEqual(ZERNIO_GRAPH.edges)
  })

  it('our flow → Zernio → our flow is the identity', () => {
    const flow = autoLayout(fromZernio(ZERNIO_GRAPH))
    expect(fromZernio({ ...toZernio(flow), name: flow.name, description: flow.description, platform: flow.platform })).toEqual(flow)
  })

  it('the comment-button start is Zernio\'s api_call trigger — never an inbound-DM trigger', () => {
    const start = starterFlow('instagram').steps[0]
    expect(nodeFromStep(start)).toEqual({ id: 'start', type: 'trigger', config: { triggerType: 'api_call' }, position: { x: 0, y: 0 } })
  })

  it('a DM-keyword start writes inbound_message with its keywords', () => {
    const n = { id: 't', type: 'trigger', config: { triggerType: 'inbound_message', keywords: ['hi'], matchType: 'contains', onlyFirstMessage: true } }
    const s = stepFromNode(n)
    expect(s.kind === 'trigger' && s.trigger.kind).toBe('dm_keyword')
    expect(nodeFromStep(s)).toEqual(n)
  })

  it('a trigger with no triggerType is Zernio\'s default, inbound_message', () => {
    const s = stepFromNode({ id: 't', type: 'trigger', config: {} })
    expect(s.kind === 'trigger' && s.trigger.kind).toBe('dm_keyword')
  })

  it('keeps what it does not edit, whole: WhatsApp templates, interactive messages, AI, a handoff with assignTo', () => {
    const odd: ZernioNode[] = [
      { id: 'a', type: 'send_message', config: { messageType: 'template', template: { name: 'x', language: 'en' } } },
      { id: 'b', type: 'send_message', config: { messageType: 'interactive', interactive: { type: 'button' } } },
      { id: 'c', type: 'ai', config: { provider: 'anthropic', model: 'm', saveAs: 'out' } },
      { id: 'd', type: 'handoff', config: { note: 'n', assignTo: 'u1' } },
      { id: 'e', type: 'condition', config: { rules: [{ id: 'r', variable: 'v', operator: 'greater_than', value: 1 }] } },
      { id: 'f', type: 'some_future_node', config: { x: 1 } },
    ]
    for (const n of odd) {
      const s = stepFromNode(n)
      expect(s.kind).toBe('kept')
      expect(nodeFromStep(s)).toEqual(n)
    }
  })

  it('reads a list whatever its wrapper, and the id from _id or id', () => {
    expect(readWorkflowList({ workflows: [{ _id: 'a', name: 'A', status: 'active', accountId: 'z1' }] })[0])
      .toMatchObject({ id: 'a', status: 'active', accountId: 'z1' })
    expect(readWorkflowList([{ id: 'b', status: 'paused', accountId: { _id: 'z2' } }])[0]).toMatchObject({ id: 'b', status: 'paused', accountId: 'z2', name: 'Untitled flow' })
    expect(readWorkflowList({ data: [{ nope: 1 }] })).toEqual([])
    expect(readWorkflowMeta({ workflow: { _id: 'c', status: 'weird' } }).status).toBe('unknown')
  })
})

const valid = (): Flow => fromZernio(ZERNIO_GRAPH)
const codes = (f: Flow) => validateFlow(f).filter(i => i.blocks).map(i => i.code)

describe('validation', () => {
  it('the example flow saves (the kept webhook is a warning, not a refusal)', () => {
    const issues = validateFlow(valid())
    expect(canSave(issues)).toBe(true)
    expect(issues.map(i => i.code)).toEqual(['kept'])
  })

  it('the starter flow saves as it is', () => {
    expect(canSave(validateFlow(starterFlow('instagram')))).toBe(true)
    expect(canSave(validateFlow(starterFlow('facebook')))).toBe(true)
  })

  it('a DM-keyword start is refused as needing the owner, never as a plain mistake', () => {
    const f = valid()
    const t = f.steps[0] as FlowStep & { kind: 'trigger' }
    t.trigger = { ...t.trigger, kind: 'dm_keyword', keywords: ['guide'], matchType: 'contains' }
    const issues = validateFlow(f)
    const owner = issues.find(i => i.code === 'trigger_needs_owner')
    expect(owner).toMatchObject({ blocks: true, needsOwner: true })
    expect(canSave(issues)).toBe(false)
  })

  it('a WhatsApp-event start is refused as needing the owner too', () => {
    const f = { ...valid(), platform: 'whatsapp' as const }
    const t = f.steps[0] as FlowStep & { kind: 'trigger' }
    t.trigger = { ...t.trigger, kind: 'whatsapp_event', eventType: 'message_read' }
    expect(validateFlow(f).find(i => i.code === 'trigger_needs_owner')?.needsOwner).toBe(true)
  })

  it('a comment start only runs on Instagram or Facebook', () => {
    expect(codes({ ...starterFlow('instagram'), platform: 'telegram' })).toContain('trigger_platform')
  })

  it('exactly one start, and nothing leads into it', () => {
    const f = valid()
    expect(codes({ ...f, steps: f.steps.filter(s => s.kind !== 'trigger'), links: f.links.filter(l => l.from !== 'n_trigger') })).toContain('no_trigger')
    const two = { ...f, steps: [...f.steps, { ...f.steps[0], id: 't2' }] }
    expect(codes(two)).toContain('many_triggers')
    expect(codes({ ...f, links: [...f.links, { id: 'x', from: 'n_tag', to: 'n_trigger', branch: null }] })).toContain('into_trigger')
  })

  it('no orphans: a step nothing leads to is named', () => {
    const f = valid()
    const issues = validateFlow({ ...f, links: f.links.filter(l => l.id !== 'e7') })
    expect(issues.find(i => i.code === 'orphan')?.stepId).toBe('n_tag')
  })

  it('no loops, even though Zernio\'s spec does not forbid them', () => {
    const f = valid()
    const loop = { ...f, links: [...f.links, { id: 'x', from: 'n_tag', to: 'n_ask', branch: null }] }
    expect(findCycle(loop)).not.toBeNull()
    expect(codes(loop)).toContain('loop')
    expect(findCycle(f)).toBeNull()
  })

  it('one output leads one place, and only outputs the step has', () => {
    const f = valid()
    expect(codes({ ...f, links: [...f.links, { id: 'x', from: 'n_ask', to: 'n_end', branch: null }] })).toContain('fan_out')
    expect(codes({ ...f, links: [...f.links, { id: 'x', from: 'n_wait', to: 'n_end', branch: 'maybe' }] })).toContain('branch')
    expect(codes({ ...f, links: [...f.links, { id: 'x', from: 'n_end', to: 'n_tag', branch: null }] })).toContain('branch')
    expect(codes({ ...f, links: [...f.links, { id: 'x', from: 'n_tag', to: 'gone', branch: null }] })).toContain('dangling')
  })

  it('message length follows the network: 1000 on Instagram, 2000 on Facebook', () => {
    const f = starterFlow('instagram')
    const msg = f.steps[1] as FlowStep & { kind: 'message' }
    msg.text = 'x'.repeat(MESSAGE_LIMITS.instagram + 1)
    expect(codes(f)).toContain('message_long')
    expect(codes({ ...f, platform: 'facebook' })).not.toContain('message_long')
    msg.text = '   '
    expect(codes(f)).toContain('message_empty')
  })

  it('a picture needs an https address', () => {
    const f = valid()
    const pic = f.steps.find(s => s.id === 'n_pic') as FlowStep & { kind: 'message' }
    pic.media = { ...pic.media!, url: 'http://x.invalid/a.png' }
    expect(codes(f)).toContain('media_url')
  })

  it('waits and delays are 1 minute to 30 days, whole minutes', () => {
    const f = valid()
    const d = f.steps.find(s => s.id === 'n_delay') as FlowStep & { kind: 'delay' }
    d.minutes = MAX_MINUTES + 1
    expect(codes(f)).toContain('delay')
    d.minutes = 0.5
    expect(codes(f)).toContain('delay')
    const w = f.steps.find(s => s.id === 'n_wait') as FlowStep & { kind: 'wait_reply' }
    w.timeoutMinutes = 0
    expect(codes(f)).toContain('timeout')
  })

  it('condition rules need a variable, a value (unless exists) and a real pattern', () => {
    const f = valid()
    const c = f.steps.find(s => s.id === 'n_cond') as FlowStep & { kind: 'condition' }
    c.rules = [{ id: 'yes', variable: '', operator: 'matches', value: '(' }]
    expect(codes(f)).toEqual(expect.arrayContaining(['rule_variable', 'regex']))
    c.rules = [{ id: 'yes', variable: 'answer', operator: 'exists', value: '' }]
    expect(codes(f)).toEqual([])
    c.rules = []
    expect(codes(f)).toContain('rules_empty')
  })

  it('a name is required', () => {
    expect(codes({ ...valid(), name: ' ' })).toContain('name_missing')
  })

  it('a start with nothing after it cannot be saved', () => {
    const f = starterFlow('instagram')
    expect(codes({ ...f, steps: [f.steps[0]], links: [] })).toContain('only_trigger')
  })
})

describe('the plain-English summary', () => {
  it('walks the flow from the start, branch by branch', () => {
    expect(summariseFlow(valid())).toEqual([
      'When someone comments on a post on Instagram, gets the automation\'s DM and taps its button:',
      'Send “Want the guide? Reply YES”.',
      'Wait up to 1 day for a reply (kept as {{answer}}).',
      '  If they reply:',
      '    Check answer contains “yes”.',
      '      If answer contains “yes”:',
      '        Send a picture with “Here”.',
      '        Tag them “guide”.',
      '      If otherwise:',
      '        End.',
      '  If no reply:',
      '    Wait 1 hour.',
      '    Split at random: 30% A, 70% B.',
      '      If a · 30%:',
      '        Hand the conversation to a person — “call them”.',
      '      If b · 70%:',
      '        A webhook step (kept as made in Zernio).',
    ])
  })

  it('says so when there is no start', () => {
    expect(summariseFlow({ ...valid(), steps: [] })).toEqual(['No starting step yet.'])
  })
})

describe('editing', () => {
  it('adds a step on the first free output, connected, with a fresh id', () => {
    const f = starterFlow('instagram')
    const { flow, id } = addStepAfter(removeStep(f, 'end_1'), 'message_1', 'wait_reply')
    expect(id).toBe('wait_reply_1')
    expect(flow.links.find(l => l.to === id)).toMatchObject({ from: 'message_1', branch: null })
    const two = addStepAfter(flow, id, 'message')
    expect(two.flow.links.find(l => l.to === two.id)?.branch).toBe('reply')
    const three = addStepAfter(two.flow, id, 'end')
    expect(three.flow.links.find(l => l.to === three.id)?.branch).toBe('timeout')
    // both outputs taken: the new step is added unconnected
    const four = addStepAfter(three.flow, id, 'delay')
    expect(four.flow.links.some(l => l.to === four.id)).toBe(false)
  })

  it('never removes the start; removing a step drops its connections', () => {
    const f = starterFlow('instagram')
    expect(removeStep(f, 'start')).toBe(f)
    const g = removeStep(f, 'message_1')
    expect(g.links).toEqual([])
  })

  it('connect replaces the link from the same output and refuses links into the start', () => {
    const f = starterFlow('instagram')
    const g = connect(f, 'start', null, 'end_1')
    expect(g.links.filter(l => l.from === 'start')).toEqual([expect.objectContaining({ to: 'end_1' })])
    expect(connect(f, 'message_1', null, 'start')).toBe(f)
    expect(connect(f, 'message_1', 'reply', 'end_1')).toBe(f)
  })

  it('deleting a condition rule drops the link that left from it', () => {
    const f = valid()
    const c = f.steps.find(s => s.id === 'n_cond') as FlowStep & { kind: 'condition' }
    const g = updateStep(f, { ...c, rules: [{ id: 'other', variable: 'answer', operator: 'exists', value: '' }] })
    expect(g.links.some(l => l.from === 'n_cond' && l.branch === 'yes')).toBe(false)
    expect(g.links.some(l => l.from === 'n_cond' && l.branch === 'default')).toBe(true)
  })

  it('lays out a flow that came with no positions, row by row from the start', () => {
    const bare = fromZernio({ ...ZERNIO_GRAPH, nodes: ZERNIO_GRAPH.nodes.map(({ position: _p, ...n }) => n) })
    const laid = autoLayout(bare)
    expect(laid.steps.every(s => s.position)).toBe(true)
    expect(laid.steps.find(s => s.id === 'n_trigger')?.position).toEqual({ x: 0, y: 0 })
    expect(laid.steps.find(s => s.id === 'n_ask')?.position?.y).toBe(170)
  })
})

describe('the phone preview', () => {
  it('shows what the person sees down the path to the chosen step', () => {
    const f = valid()
    expect(pathTo(f, 'n_tag').map(p => p.step.id)).toEqual(['n_trigger', 'n_ask', 'n_wait', 'n_cond', 'n_pic', 'n_tag'])
    expect(previewBubbles(f, 'n_pic')).toEqual([
      { from: 'note', text: 'They commented, got the DM and tapped the button' },
      { from: 'us', text: 'Want the guide? Reply YES', media: null },
      { from: 'them', text: 'Their reply' },
      { from: 'note', text: 'answer contains “yes”' },
      { from: 'us', text: 'The guide', media: { type: 'image', url: 'https://x.invalid/a.png' } },
    ])
  })

  it('a timeout branch reads as silence', () => {
    expect(previewBubbles(valid(), 'n_delay')).toContainEqual({ from: 'note', text: 'No reply for 1 day' })
  })

  it('with nothing chosen it follows the first path to its end', () => {
    const bubbles = previewBubbles(starterFlow('instagram'), null)
    expect(bubbles[bubbles.length - 1]).toEqual({ from: 'note', text: 'Flow ends' })
  })
})

describe('the numbers (read only)', () => {
  it('reads Zernio\'s per-flow counters off the workflow', () => {
    const meta = readWorkflowMeta({ success: true, workflow: { id: 'w', status: 'active', totalStarted: 40, totalCompleted: 30, totalExited: 6 } })
    expect(meta).toMatchObject({ id: 'w', runs: 40, completed: 30, exited: 6 })
    expect(flowTotals(meta)).toEqual({ started: 40, completed: 30, exited: 6, completionRate: 75 })
    expect(flowTotals(readWorkflowMeta({ id: 'x' }))).toEqual({ started: null, completed: null, exited: null, completionRate: null })
  })

  it('reads runs and their total', () => {
    const { runs, total } = readRuns({ executions: [
      { id: 'r1', status: 'waiting', currentNodeId: 'n_wait', stepCount: 3, lastError: null, createdAt: '2026-09-30T01:00:00Z' },
      { id: 'r2', status: 'strange' },
      { status: 'completed' },
    ], pagination: { total: 57 } })
    expect(total).toBe(57)
    expect(runs.map(r => [r.id, r.status])).toEqual([['r1', 'waiting'], ['r2', 'unknown']])
  })

  it('counts each run once per step, the branch it left by, and where runs are waiting', () => {
    const ev = (action: string, nodeId: string, sourceHandle: string | null = null) => ({ action, nodeId, sourceHandle, status: null })
    const run = (id: string, status: string, currentNodeId: string | null = null) =>
      readRuns({ executions: [{ id, status, currentNodeId }] }).runs[0]
    const stats = aggregateStepStats([
      { run: run('r1', 'completed'), events: [
        ev('execution_started', 'n_trigger'), ev('node_started', 'n_ask'), ev('node_completed', 'n_ask'),
        ev('node_started', 'n_wait'), ev('node_completed', 'n_wait', 'reply'), ev('node_completed', 'n_wait', 'reply'),
      ] },
      { run: run('r2', 'waiting', 'n_wait'), events: [ev('node_completed', 'n_ask'), ev('node_started', 'n_wait')] },
      { run: run('r3', 'failed'), events: [ev('node_started', 'n_ask'), ev('node_failed', 'n_ask')] },
    ])
    expect(stats.n_ask).toEqual({ reached: 3, completed: 2, failed: 1, waiting: 0, branches: { next: 2 } })
    expect(stats.n_wait).toEqual({ reached: 2, completed: 1, failed: 0, waiting: 1, branches: { reply: 1 } })
    expect(readRunEvents({ events: [{ action: 'node_completed', nodeId: 'a', sourceHandle: 'yes' }] }))
      .toEqual([{ action: 'node_completed', nodeId: 'a', sourceHandle: 'yes', status: null }])
  })
})
