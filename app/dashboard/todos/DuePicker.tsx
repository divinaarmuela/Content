'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, Repeat, X } from 'lucide-react'
import {
  MONTH_DAYS, REPEAT_FREQS, REPEAT_LABEL, WEEKDAY_LETTER, dayWords, normaliseRepeat, repeatWords, type RepeatFreq, type TodoRepeat,
} from '../../lib/todo-repeat-core'
import { dueTone, shortDue } from './todo-words'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * THE DUE DATE, AS ASANA SHOWS IT (Manal, 20 Oct 2026, with a photo of Asana's picker): a chip with the date and,
 * when it repeats, the repeat mark; pressed, a month to pick from, then "Repeats" — Daily, Weekly, Monthly, Yearly,
 * Periodically, Custom — and for Weekly the days it falls on, M T W T F S S. Ticking a repeating task done makes the
 * next one (api/todos/[id], todo-repeat-core).
 *
 * Its own small panel rather than a popover package: one more dependency for one picker was not worth it. It sits
 * on the popover surface so it does not vanish into the page in dark mode (trap 3).
 */
export default function DuePicker({ due, repeat, today, done, editable, onChange }: {
  due: string | null
  repeat: TodoRepeat | null
  today: string
  done: boolean
  editable: boolean
  onChange: (patch: { due_date?: string | null; repeat?: TodoRepeat | null }) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const rule = normaliseRepeat(repeat)
  /**
   * WHERE THE PANEL SITS (20 Oct 2026, the owner: "why its broken like that?" — drawn inside the task panel, its
   * bottom half went under the panel's comment box and Repeats could not be reached). It is drawn at the top of the
   * dashboard instead, fixed under the date — or above it, when there is more room above — no taller than the room
   * there is, scrolling inside itself if the screen is short.
   */
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const measure = useCallback(() => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const gap = 6, edge = 8, width = 300
    const below = window.innerHeight - r.bottom - gap - edge
    const above = r.top - gap - edge
    const left = Math.max(edge, Math.min(r.left, window.innerWidth - width - edge))
    setPlace(below >= 420 || below >= above
      ? { left, top: r.bottom + gap, maxHeight: below }
      : { left, bottom: window.innerHeight - r.top + gap, maxHeight: above })
  }, [])
  useLayoutEffect(() => { if (open) measure() }, [open, measure])
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [open, measure])
  const [month, setMonth] = useState(() => (due ?? today).slice(0, 7))

  useEffect(() => {
    if (!open) return
    // a press inside a dropdown's own list (drawn outside this box) is not a press away
    const away = (e: MouseEvent) => {
      const t = e.target as Element
      if (box.current?.contains(t) || panel.current?.contains(t) || t.closest?.('[data-radix-popper-content-wrapper]')) return
      setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  // the month as Asana draws it: weeks from Monday, the days either side greyed
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const first = new Date(Date.UTC(y, m - 1, 1))
    const lead = (first.getUTCDay() + 6) % 7
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1, 1 - lead + i))
      return { key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 }
    })
  }, [month])
  const monthName = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }, [month])
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7))
  }

  // a month's day starts on the task's own: due the 20th → "On day 20" (past the 28th → Last, as Asana's list does)
  const dueDay = (): number | 'last' => { const d = Number((due ?? today).slice(8, 10)); return d > 28 ? 'last' : d }
  const setFreq = (f: RepeatFreq | 'never') => onChange({ repeat: f === 'never' ? null : normaliseRepeat({ ...(rule ?? {}), freq: f, ...(f === 'monthly' && !rule?.day ? { day: dueDay() } : {}) }) })
  const byMonth = rule?.freq === 'monthly' || (rule?.freq === 'custom' && rule.unit === 'month')
  const setRule = (patch: Partial<TodoRepeat>) => rule && onChange({ repeat: normaliseRepeat({ ...rule, ...patch }) })

  return (
    <div ref={box} className="relative flex items-center gap-1">
      <button type="button" disabled={!editable} onClick={() => setOpen(o => !o)} aria-expanded={open}
        aria-label={`Due date: ${due ? shortDue(due, today) : 'none'}${rule ? `, ${repeatWords(rule)}` : ''}`}
        className={`flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2 text-[14px] hover:border-border disabled:hover:border-transparent ${due ? dueTone(due, today, done) : 'text-muted-foreground'}`}>
        <Calendar className="h-3.5 w-3.5" aria-hidden />
        {due ? shortDue(due, today) : 'No due date'}
        {rule && <Repeat className="h-3.5 w-3.5" aria-label={repeatWords(rule)} />}
      </button>
      {(due || rule) && editable && (
        <button type="button" aria-label="Remove the due date and repeat" onClick={() => onChange({ due_date: null, repeat: null })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}

      {open && place && createPortal(
        <div ref={panel} role="dialog" aria-label="Due date and repeat"
          style={{ position: 'fixed', left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
          className="z-[60] flex w-[300px] flex-col gap-3 overflow-y-auto overscroll-contain rounded-inner border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="flex items-center gap-2">
            <input type="date" value={due ?? ''} onChange={e => { onChange({ due_date: e.target.value || null }); if (e.target.value) setMonth(e.target.value.slice(0, 7)) }}
              aria-label="Due date" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-[13px]" />
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <span className="text-[13px] font-semibold">{monthName}</span>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[12px]">
            {WEEKDAY_LETTER.map((l, i) => <span key={i} className="py-1 font-semibold text-muted-foreground">{l}</span>)}
            {cells.map(c => {
              const picked = c.key === due
              return (
                <button key={c.key} type="button" onClick={() => onChange({ due_date: c.key })} aria-pressed={picked}
                  aria-label={c.key}
                  className={`flex h-8 items-center justify-center rounded-full ${picked ? 'bg-foreground font-semibold text-background' : c.key === today ? 'ring-1 ring-foreground/40' : ''} ${c.inMonth ? '' : 'text-muted-foreground/50'} hover:bg-muted`}>
                  {c.day}
                </button>
              )
            })}
          </div>

          {/* REPEATS — Asana's own words and order */}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2 text-[13px] font-semibold">
              <span className="flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" aria-hidden /> Repeats</span>
              <Select value={rule?.freq ?? 'never'} onValueChange={v => setFreq(v as RepeatFreq | 'never')}>
                <SelectTrigger aria-label="Repeats" className="h-8 w-36 rounded-md border-border bg-background px-2 text-[13px] font-normal"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  {REPEAT_FREQS.map(f => <SelectItem key={f} value={f}>{REPEAT_LABEL[f]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {rule?.freq === 'weekly' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-muted-foreground">On these days</span>
                <div className="flex justify-between">
                  {WEEKDAY_LETTER.map((l, i) => {
                    const on = rule.days?.includes(i) ?? false
                    return (
                      <label key={i} className="flex flex-col items-center gap-0.5 text-[11px] font-semibold">
                        <input type="checkbox" checked={on} className="h-4 w-4 accent-foreground"
                          aria-label={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}
                          onChange={() => setRule({ days: on ? (rule.days ?? []).filter(d => d !== i) : [...(rule.days ?? []), i] })} />
                        {l}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            {(rule?.freq === 'periodically' || rule?.freq === 'custom') && (
              <div className="flex items-center gap-2 text-[13px]">
                <span>{rule.freq === 'periodically' ? 'Repeat' : 'Every'}</span>
                <input type="number" min={1} max={365} value={rule.every ?? 1} onChange={e => setRule({ every: Number(e.target.value) })}
                  aria-label="How many" className="h-8 w-16 rounded-md border border-border bg-background px-2" />
                {rule.freq === 'periodically'
                  ? <span>days after it&rsquo;s done</span>
                  : (
                    <Select value={rule.unit ?? 'week'} onValueChange={v => setRule({ unit: v as TodoRepeat['unit'], ...(v === 'month' && !rule.day ? { day: dueDay() } : {}) })}>
                      <SelectTrigger aria-label="Days, weeks, months or years" className="h-8 w-28 rounded-md border-border bg-background px-2 text-[13px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">days</SelectItem><SelectItem value="week">weeks</SelectItem>
                        <SelectItem value="month">months</SelectItem><SelectItem value="year">years</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
              </div>
            )}
            {/* ON DAY — Asana's "Every 1 Month · On day 20" (Manal, 20 Oct 2026): 1–28, then Last */}
            {byMonth && (
              <div className="flex items-center gap-2 text-[13px]">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-foreground"><span className="h-1.5 w-1.5 rounded-full bg-foreground" /></span>
                <span>On day</span>
                <Select value={String(rule?.day ?? dueDay())} onValueChange={v => setRule({ day: v === 'last' ? 'last' : Number(v) })}>
                  <SelectTrigger aria-label="Day of the month" className="h-8 w-24 rounded-md border-border bg-background px-2 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {MONTH_DAYS.map(d => <SelectItem key={String(d)} value={String(d)}>{d === 'last' ? 'Last' : d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">({dayWords(rule?.day ?? dueDay())})</span>
              </div>
            )}
            {rule && <p className="text-[12px] text-muted-foreground">{repeatWords(rule)} — ticking it done makes the next one.</p>}
          </div>
        </div>
      , box.current?.closest('.dbx') ?? document.body)}
    </div>
  )
}
