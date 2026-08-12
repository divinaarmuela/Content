'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CalendarPlus, ChevronLeft, ChevronRight, Unplug } from 'lucide-react'
import {
  bucketByDay, calendarColors, dayKey, shiftWeek, weekOf, CAL_TZ, type CalEvent,
} from '../../lib/gcal-core'

type Account = {
  email: string
  enabled: boolean
  connected: boolean
  connected_by: string | null
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { timeZone: CAL_TZ, hour: 'numeric', minute: '2-digit' })

const fmtDayHeading = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return {
    dow: date.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' }),
    day: date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  }
}

/**
 * Shoot planning: the week across every connected Google Calendar, so "when
 * are we free" is answered by looking, not by opening three calendars. Each
 * calendar toggles on and off; empty days read as free at a glance.
 */
export default function AvailabilityView() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [events, setEvents] = useState<CalEvent[] | null>(null)
  const [anchor, setAnchor] = useState(() => dayKey(new Date().toISOString()))

  const days = useMemo(() => weekOf(anchor), [anchor])
  const today = dayKey(new Date().toISOString())

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/gcal/accounts')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load calendars')
      setAccounts(json.accounts)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load calendars')
      setAccounts([])
    }
  }, [])

  const loadEvents = useCallback(async () => {
    setEvents(null)
    try {
      // the week in Melbourne time: from midnight Monday to midnight next Monday
      const from = `${days[0]}T00:00:00+10:00`
      const to = `${shiftWeek(days[0], 1)}T00:00:00+10:00`
      const res = await fetch(`/api/gcal/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load events')
      setEvents(json.events)
      for (const err of json.errors ?? []) {
        toast.error(`${err.calendar}: calendar could not be read — try reconnecting it`)
        console.error('calendar error:', err)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load events')
      setEvents([])
    }
  }, [days])

  useEffect(() => { loadAccounts() }, [loadAccounts])
  useEffect(() => { loadEvents() }, [loadEvents])

  // surface the OAuth callback result once, then clean the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const cal = params.get('cal')
    if (!cal) return
    if (cal === 'connected') toast.success(`Calendar connected: ${params.get('detail') ?? ''}`)
    else toast.error(`Calendar not connected (${cal})`)
    params.delete('cal'); params.delete('detail')
    const qs = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    loadAccounts()
  }, [loadAccounts])

  const patchAccount = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/gcal/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Update failed')
      setAccounts(json.accounts)
      loadEvents()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const colors = useMemo(
    () => calendarColors((accounts ?? []).map(a => a.email)),
    [accounts],
  )
  const enabledEmails = useMemo(
    () => new Set((accounts ?? []).filter(a => a.enabled && a.connected).map(a => a.email)),
    [accounts],
  )
  const byDay = useMemo(
    () => bucketByDay((events ?? []).filter(e => enabledEmails.has(e.calendar)), days),
    [events, days, enabledEmails],
  )

  const connected = (accounts ?? []).filter(a => a.connected)
  const loading = accounts === null || events === null

  return (
    <div className="flex flex-col gap-4">
      {/* ── calendar chips + week nav ── */}
      <div className="flex flex-wrap items-center gap-2">
        {connected.map(a => (
          <button
            key={a.email}
            type="button"
            onClick={() => patchAccount({ email: a.email, enabled: !a.enabled })}
            title={a.enabled ? 'Hide this calendar' : 'Show this calendar'}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              a.enabled
                ? 'border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                : 'border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-600'
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: a.enabled ? colors[a.email] : 'transparent', boxShadow: a.enabled ? 'none' : `inset 0 0 0 1.5px ${colors[a.email]}` }}
            />
            {a.email}
          </button>
        ))}

        <Button variant="outline" size="sm" asChild>
          {/* full navigation, not fetch: the route replies with a redirect to Google */}
          <a href="/api/gcal/connect"><CalendarPlus className="h-3.5 w-3.5" /> Connect calendar</a>
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous week"
            onClick={() => setAnchor(a => shiftWeek(a, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8"
            onClick={() => setAnchor(dayKey(new Date().toISOString()))}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next week"
            onClick={() => setAnchor(a => shiftWeek(a, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── the week ── */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : connected.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
              No calendars connected yet. Connect hello@ and contact@ (sign in as each
              account when Google asks) and the week fills in with everyone&rsquo;s commitments —
              empty space is shootable time.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href="/api/gcal/connect"><CalendarPlus className="h-3.5 w-3.5" /> Connect a calendar</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {days.map(key => {
            const { dow, day } = fmtDayHeading(key)
            const list = byDay.get(key) ?? []
            const isToday = key === today
            return (
              <Card key={key} className={isToday ? 'border-blue-300 dark:border-blue-800' : ''}>
                <CardContent className="flex min-h-40 flex-col gap-2 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                      {dow}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-400">{day}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="my-auto text-center font-mono text-[11px] uppercase tracking-widest text-emerald-600/70 dark:text-emerald-500/60">
                      free
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {list.map((e, i) => (
                        <div
                          key={i}
                          className="rounded-md border-l-2 bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/60"
                          style={{ borderLeftColor: colors[e.calendar] }}
                          title={`${e.title} — ${e.calendar}`}
                        >
                          <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{e.title}</p>
                          <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                            {e.allDay ? 'all day' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── manage connected calendars ── */}
      {connected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
            {CAL_TZ.replace('_', ' ')}
          </Badge>
          {connected.map(a => (
            <button
              key={a.email}
              type="button"
              onClick={() => {
                if (confirm(`Disconnect ${a.email}? Its events disappear until someone reconnects it.`)) {
                  patchAccount({ email: a.email, disconnect: true })
                }
              }}
              className="flex items-center gap-1 text-zinc-400 transition-colors hover:text-red-600"
            >
              <Unplug className="h-3 w-3" /> disconnect {a.email}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
