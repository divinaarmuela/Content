import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dueWords, mayViewEveryone, queueCount, queueFor } from '../app/lib/acq-queue-core'

/** MY QUEUE (the acquisition blueprint, §10 "Task & Notification view"; built 22 Sep 2026). */
const NOW = Date.parse('2026-09-22T08:00:00.000Z')
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString()
const joy = { id: 'joy', role: 'quality_checker' }
const manal = { id: 'manal', role: 'account_manager' }

const prospects = [
  // outreach has a 21-day limit in the blueprint's clock; entered 25 days ago → 4 days over
  { id: 'p1', business: 'The Glass Den', stage: 'outreach', stage_entered_at: day(-25), created_at: day(-30), owner_id: 'joy' },
  { id: 'p2', business: 'Crestline', stage: 'engaged', stage_entered_at: day(-1), created_at: day(-5), owner_id: 'manal' },
]
const todos = [
  { id: 't1', prospect_id: 'p1', title: 'Day 3 · Nudge', note: 'Short DM', status: 'open', due_date: day(1), owner_id: 'joy', created_at: day(-3) },
  { id: 't2', prospect_id: 'p1', title: 'Day 1 · Follow up', note: '', status: 'done', due_date: day(-2), owner_id: 'joy', created_at: day(-3) },
  { id: 't3', prospect_id: 'p2', title: 'Book the discovery call', note: '', status: 'open', due_date: day(-2), owner_id: 'manal', created_at: day(-3) },
  { id: 't4', prospect_id: null, title: 'Unrelated', note: '', status: 'open', due_date: null, owner_id: 'joy', created_at: day(-3) },
]
const events = [
  { id: 'e1', prospect_id: 'p1', kind: 'call_booked', at: day(-0.5), detail: 'Tue 3 pm?', confirmed: false, dismissed_at: null, source: 'agent', confidence: 0.7 },
  { id: 'e2', prospect_id: 'p1', kind: 'reply', at: day(-1), detail: 'ok', confirmed: true, dismissed_at: null, source: 'agent' },
  { id: 'e3', prospect_id: 'p2', kind: 'deposit_paid', at: day(-1), detail: 'Paid $500', confirmed: false, dismissed_at: null, source: 'agent', confidence: 0.9 },
]

describe('what waits on me', () => {
  it('my open tasks on prospects, soonest first; done ones and ones with no prospect are not here', () => {
    const g = queueFor({ viewer: joy, prospects, todos, events, now: NOW })
    expect(g[0].key).toBe('task')
    expect(g[0].items.map(i => i.todo_id)).toEqual(['t1'])
    expect(g[0].items[0]).toMatchObject({ business: 'The Glass Den', title: 'Day 3 · Nudge', words: 'Short DM' })
  })
  it('the agent’s unsure findings on my prospects, with how sure it was', () => {
    const g = queueFor({ viewer: joy, prospects, todos, events, now: NOW })
    expect(g[1].items.map(i => i.event_id)).toEqual(['e1'])
    expect(g[1].items[0].title).toBe('Booked the discovery call? · 70% sure')
  })
  it('my prospects over their stage clock', () => {
    const g = queueFor({ viewer: joy, prospects, todos, events, now: NOW })
    expect(g[2].items.map(i => i.prospect_id)).toEqual(['p1'])
    expect(g[2].items[0].title).toMatch(/^Outreach sent · \d+ days over$/)
    expect(queueCount(g)).toBe(3)
  })
  it('a manager may look at everyone’s; anyone else only ever sees their own', () => {
    expect(mayViewEveryone(manal)).toBe(true)
    expect(mayViewEveryone(joy)).toBe(false)
    const all = queueFor({ viewer: manal, prospects, todos, events, now: NOW, everyone: true })
    expect(all[0].items.map(i => i.todo_id)).toEqual(['t3', 't1'])
    expect(all[1].items.map(i => i.event_id)).toEqual(['e3', 'e1'])
    const notAllowed = queueFor({ viewer: joy, prospects, todos, events, now: NOW, everyone: true })
    expect(notAllowed[0].items.map(i => i.todo_id)).toEqual(['t1'])
    expect(queueFor({ viewer: null, prospects, todos, events, now: NOW }).every(g => g.items.length === 0)).toBe(true)
  })
  it('a due line says overdue after a day', () => {
    const fmt = (iso: string) => iso.slice(0, 10)
    expect(dueWords(day(1), NOW, fmt)).toBe(`Due ${day(1).slice(0, 10)}`)
    expect(dueWords(day(-2), NOW, fmt)).toBe(`Overdue since ${day(-2).slice(0, 10)}`)
    expect(dueWords(null, NOW, fmt)).toBeNull()
  })
})

describe('the view is wired', () => {
  it('a fifth acquisition view, first in the rail, drawing the three lists with Done, Confirm and Dismiss', () => {
    const acq = readFileSync('app/dashboard/leads/acquisition/Acquisition.tsx', 'utf8')
    expect(acq).toContain("{ key: 'queue', label: 'My queue', href: '/dashboard/leads/acquisition/queue' }")
    expect(acq).toContain("useTable<Todo>('todos')")
    expect(acq).toContain("onDone={id => call(`/api/todos/${id}`, 'PATCH', { status: 'done' }, 'Done')}")
    expect(readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')).toContain("{ href: '/dashboard/leads/acquisition/queue',     label: 'My queue',  icon: ListChecks }")
    expect(readFileSync('app/dashboard/leads/acquisition/queue/page.tsx', 'utf8')).toContain('<Acquisition view="queue" />')
    const view = readFileSync('app/dashboard/leads/acquisition/QueueView.tsx', 'utf8')
    expect(view).toContain('onAnswer(it.prospect_id, it.event_id!, true)')
    expect(view).toContain('onAnswer(it.prospect_id, it.event_id!, false)')
  })
})
