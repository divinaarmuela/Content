'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, Repeat, X } from 'lucide-react'
import {
  MONTH_DAYS, MONTH_NTHS, REPEAT_FREQS, REPEAT_LABEL, WEEKDAY_LETTER, WEEKDAY_NAMES, dayWords, normaliseRepeat, repeatWords, upcomingDues,
  type MonthNth, type RepeatFreq, type TodoRepeat,
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
export default function DuePicker({ due: savedDue, repeat: savedRepeat, today, done, editable, onChange: save }: {
  due: string | null
  repeat: TodoRepeat | null
  today: string
  done: boolean
  editable: boolean
  onChange: (patch: { due_date?: string | null; repeat?: TodoRepeat | null }) => void | Promise<unknown>
}) {
  /**
   * SHOWN AT ONCE, SAVED BEHIND (the owner, 21 Oct 2026: "when choosing custom it takes time to update … laggy"): each
   * pick used to wait for the save AND the database to send the task back before the picker moved, and a second tick
   * made in that wait was built on the old rule and lost the first. The picker now keeps its own copy, changes it on
   * the click, and saves one after another; it takes the saved task back only when nothing of its own is still saving.
   */
  const [local, setLocal] = useState<{ due: string | null; repeat: TodoRepeat | null }>({ due: savedDue, repeat: savedRepeat })
  const latest = useRef(local)
  const pending = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const savedKey = JSON.stringify([savedDue, savedRepeat])
  const saved = useRef({ due: savedDue, repeat: savedRepeat })
  saved.current = { due: savedDue, repeat: savedRepeat }
  const failed = useRef(false)
  useEffect(() => {
    if (pending.current > 0) return
    const next = { due: savedDue, repeat: savedRepeat }
    latest.current = next
    setLocal(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])
  const onChange = (patch: { due_date?: string | null; repeat?: TodoRepeat | null }) => {
    const next = {
      due: 'due_date' in patch ? patch.due_date ?? null : latest.current.due,
      repeat: 'repeat' in patch ? patch.repeat ?? null : latest.current.repeat,
    }
    latest.current = next
    setLocal(next)
    pending.current++
    // a save that fails (it says so in a toast) puts the picker back to what the task really holds
    queue.current = queue.current.then(() => save(patch)).then(r => { if (r === false) failed.current = true }, () => { failed.current = true })
      .finally(() => {
        if (--pending.current === 0 && failed.current) { failed.current = false; latest.current = saved.current; setLocal(saved.current) }
      })
  }
  const due = local.due
  const repeat = local.repeat
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
    const gap = 6, edge = 8, width = 320
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
  // the task's own weekday, Monday = 0 — Asana ticks it when Custom weeks opens (Manal's video, 21 Oct 2026: due Wed → W)
  const dueWeekday = () => { const [y, m, d] = (due ?? today).split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 }
  const setFreq = (f: RepeatFreq | 'never') => onChange({ repeat: f === 'never' ? null : normaliseRepeat({
    ...(rule ?? {}), freq: f,
    ...(f === 'monthly' && !rule?.day ? { day: dueDay() } : {}),
    ...(f === 'custom' && (rule?.unit ?? 'week') === 'week' && !rule?.days?.length ? { days: [dueWeekday()] } : {}),
  }) })
  const byMonth = rule?.freq === 'monthly' || (rule?.freq === 'custom' && rule.unit === 'month')
  // "On the …": the task's own weekday and which one of the month it is — due Tue 20 Oct → the third Tuesday
  const dueNth = (): { nth: MonthNth; weekday: number } => {
    const d = due ?? today
    const day = Number(d.slice(8, 10))
    const [y, m] = d.split('-').map(Number)
    const wd = (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { nth: day + 7 > daysIn ? 'last' : (Math.ceil(day / 7) as MonthNth), weekday: wd }
  }
  // WHEN IT COMES ROUND (Manal, 20 Oct 2026: "I can't see … when it's gonna pop up next"): its next dates, marked
  const coming = useMemo(() => new Set(upcomingDues(rule, due, 24)), [rule, due])
  const setRule = (patch: Partial<TodoRepeat>) => { const cur = normaliseRepeat(latest.current.repeat); if (cur) onChange({ repeat: normaliseRepeat({ ...cur, ...patch }) }) }

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
          className="z-[60] flex w-[320px] flex-col gap-3 overflow-y-auto overscroll-contain rounded-inner border border-border bg-popover p-3 text-popover-foreground shadow-lg">
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
              const again = coming.has(c.key)
              return (
                <button key={c.key} type="button" onClick={() => onChange({ due_date: c.key })} aria-pressed={picked}
                  aria-label={again ? `${c.key} — it repeats on this day` : c.key}
                  className={`relative flex h-8 items-center justify-center rounded-full ${picked ? 'bg-foreground font-semibold text-background' : again ? 'bg-accent-blue/15 font-semibold text-accent-blue-deep' : c.key === today ? 'ring-1 ring-foreground/40' : ''} ${c.inMonth ? '' : 'text-muted-foreground/50'} hover:bg-muted`}>
                  {c.day}
                  {again && <span aria-hidden className="absolute bottom-0.5 h-1 w-1 rounded-full bg-accent-blue" />}
                </button>
              )
            })}
          </div>
          {coming.size > 0 && (
            <p className="-mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span aria-hidden className="h-2 w-2 rounded-full bg-accent-blue" /> It comes round again on the blue days
            </p>
          )}

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

            {/* "on these days" — for Weekly, and for Custom every N weeks (Manal, 21 Oct 2026), where it is optional */}
            {(rule?.freq === 'weekly' || (rule?.freq === 'custom' && (rule.unit ?? 'week') === 'week')) && (
              <div className={`flex flex-col gap-1.5 ${rule.freq === 'custom' ? 'order-1' : ''}`}>
                <span className="text-[12px] font-semibold text-muted-foreground">On these days</span>
                <div className="flex justify-between">
                  {WEEKDAY_LETTER.map((l, i) => {
                    const on = rule.days?.includes(i) ?? false
                    return (
                      <label key={i} className="flex flex-col items-center gap-0.5 text-[11px] font-semibold">
                        <input type="checkbox" checked={on} className="h-4 w-4 accent-foreground"
                          aria-label={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}
                          onChange={() => { const now = normaliseRepeat(latest.current.repeat)?.days ?? []; setRule({ days: now.includes(i) ? now.filter(d => d !== i) : [...now, i] }) }} />
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
                {rule.freq === 'periodically'
                  ? <>
                    <input type="number" min={1} max={365} value={rule.every ?? 1} onChange={e => setRule({ every: Number(e.target.value) })}
                      aria-label="How many" className="h-8 w-16 rounded-md border border-border bg-background px-2" />
                    <span>days after it&rsquo;s done</span>
                  </>
                  : (
                    /* CUSTOM AS ASANA HAS IT (Manal's video, 21 Oct 2026): "Every [2 ▾] [Weeks ▾]" — a list of numbers,
                       and Weeks or Months only. A rule saved earlier by days or years keeps its own word in the list. */
                    <span className="ml-auto flex items-center gap-2">
                      <Select value={String(rule.every ?? 1)} onValueChange={v => setRule({ every: Number(v) })}>
                        <SelectTrigger aria-label="How many" className="h-8 w-16 rounded-md border-border bg-background px-2 text-[13px]"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {Array.from({ length: Math.max(30, rule.every ?? 1) }, (_, i) => i + 1).map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={rule.unit ?? 'week'} onValueChange={v => setRule({
                        unit: v as TodoRepeat['unit'],
                        ...(v === 'month' && !rule.day ? { day: dueDay() } : {}),
                        ...(v === 'week' && !rule.days?.length ? { days: [dueWeekday()] } : {}),
                      })}>
                        <SelectTrigger aria-label="Weeks or months" className="h-8 w-28 rounded-md border-border bg-background px-2 text-[13px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {rule.unit === 'day' && <SelectItem value="day">Days</SelectItem>}
                          <SelectItem value="week">Weeks</SelectItem>
                          <SelectItem value="month">Months</SelectItem>
                          {rule.unit === 'year' && <SelectItem value="year">Years</SelectItem>}
                        </SelectContent>
                      </Select>
                    </span>
                  )}
              </div>
            )}
            {/* ON THE … / ON DAY — Asana's two (Manal, 20 Oct 2026): "On the [Last] [Monday]" for clients who work by
                weekday, "On day [20]" for those who work by date (1–28, then Last) */}
            {byMonth && rule && (
              <div role="radiogroup" aria-label="Which day of the month" className="flex flex-col gap-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <label className="flex shrink-0 cursor-pointer items-center gap-2">
                    <input type="radio" name="month-by" className="h-4 w-4 accent-foreground" checked={!!rule.on}
                      onChange={() => setRule({ on: rule.on ?? dueNth(), day: undefined })} />
                    On the
                  </label>
                  <Select value={String((rule.on ?? dueNth()).nth)} onValueChange={v => setRule({ on: { ...(rule.on ?? dueNth()), nth: (v === 'last' ? 'last' : Number(v)) as MonthNth }, day: undefined })}>
                    <SelectTrigger aria-label="Which one of the month" className="h-8 w-[5.5rem] rounded-md border-border bg-background px-2 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{MONTH_NTHS.map(n => <SelectItem key={String(n.key)} value={String(n.key)}>{n.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={String((rule.on ?? dueNth()).weekday)} onValueChange={v => setRule({ on: { ...(rule.on ?? dueNth()), weekday: Number(v) }, day: undefined })}>
                    <SelectTrigger aria-label="Which weekday" className="h-8 w-[7.5rem] rounded-md border-border bg-background px-2 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{WEEKDAY_NAMES.map((n, i) => <SelectItem key={n} value={String(i)}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="month-by" className="h-4 w-4 accent-foreground" checked={!rule.on}
                      onChange={() => setRule({ on: undefined, day: rule.day ?? dueDay() })} />
                    On day
                  </label>
                  <Select value={String(rule.day ?? dueDay())} onValueChange={v => setRule({ on: undefined, day: v === 'last' ? 'last' : Number(v) })}>
                    <SelectTrigger aria-label="Day of the month" className="h-8 w-24 rounded-md border-border bg-background px-2 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {MONTH_DAYS.map(d => <SelectItem key={String(d)} value={String(d)}>{d === 'last' ? 'Last' : d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!rule.on && <span className="text-muted-foreground">({dayWords(rule.day ?? dueDay())})</span>}
                </div>
              </div>
            )}
            {rule && <p className="order-2 text-[12px] text-muted-foreground">{repeatWords(rule)} — ticking it done makes the next one.</p>}
          </div>
        </div>
      , box.current?.closest('.dbx') ?? document.body)}
    </div>
  )
}
