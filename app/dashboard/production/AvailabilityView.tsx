'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, Unplug, X } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  bucketByDay, calendarColors, dayKey, shiftWeek, weekOf, CAL_TZ, type CalEvent,
} from '../../lib/gcal-core'
import { PROPOSAL_TAG, type ShootStatus } from '../../lib/shoot-core'
import { useRole } from '../useRole'
import ConfirmAction from '../ConfirmAction'
import EmptyState from '../EmptyState'

type Account = {
  email: string
  enabled: boolean
  connected: boolean
  connected_by: string | null
}

type Proposal = {
  id: string
  client_id: string
  title: string
  starts_at: string
  ends_at: string
  location: string | null
  note: string | null
  status: ShootStatus
  send_to: string
  clients: { name: string } | null
}

type ClientRow = { id: string; name: string; email: string | null }

const PROPOSAL_STYLE: Record<ShootStatus, string> = {
  pending: 'border border-dashed border-amber-400 bg-amber-50/60 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-700',
  accepted: 'border border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  declined: 'border border-red-200 bg-red-50/60 text-red-500 line-through dark:bg-red-950/20 dark:text-red-400/70 dark:border-red-900',
  cancelled: 'border border-zinc-200 bg-zinc-50 text-zinc-400 line-through dark:bg-zinc-900 dark:border-zinc-800',
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { timeZone: CAL_TZ, hour: 'numeric', minute: '2-digit' })

/**
 * "Propose a shoot" for a chosen day. Times are entered as Melbourne
 * wall-clock and sent with the +10:00 offset, matching how the week itself
 * is fetched. The proposal email goes to the address in the To field,
 * prefilled from the picked client's contact email.
 */
function ProposeShootDialog({ day, clients, onClose, onCreated }: {
  day: string | null
  clients: ClientRow[]
  onClose: () => void
  onCreated: () => void
}) {
  const [clientId, setClientId] = useState('')
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('12:00')
  // known addresses for the picked client: their base email + every contact,
  // deduplicated. Any number can be ticked; extra addresses are typed below.
  const [knownEmails, setKnownEmails] = useState<{ email: string; label: string }[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [customEmail, setCustomEmail] = useState('')
  const [notifyEmails, setNotifyEmails] = useState('hello@mdmmarketing.com.au')
  const [location, setLocation] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  const recipients = useMemo(() => [
    ...picked,
    ...customEmail.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  ], [picked, customEmail])

  // reset per open
  useEffect(() => {
    if (day) { setTitle(''); setLocation(''); setNote(''); setSending(false); setCustomEmail('') }
  }, [day])

  // a picked client brings their address book with them; the primary contact
  // (or the base email) starts ticked
  useEffect(() => {
    const c = clients.find(c => c.id === clientId)
    if (!c) return
    setTitle(t => t || `Content shoot — ${c.name}`)

    let stale = false
    ;(async () => {
      const seen = new Set<string>()
      const options: { email: string; label: string }[] = []
      const add = (email: string | null | undefined, label: string) => {
        const e = (email ?? '').trim().toLowerCase()
        if (!e || seen.has(e)) return
        seen.add(e)
        options.push({ email: e, label })
      }
      try {
        const res = await fetch(`/api/website/clients/${c.id}/contacts`)
        if (res.ok) {
          const contacts = await res.json() as { name?: string; email?: string; is_primary?: boolean }[]
          const sorted = [...contacts].sort((a, b) => Number(b.is_primary ?? false) - Number(a.is_primary ?? false))
          for (const ct of sorted) add(ct.email, ct.name ? `${ct.name} — ${ct.email?.toLowerCase()}` : ct.email ?? '')
        }
      } catch { /* contacts are optional — the base email below still works */ }
      add(c.email, `${c.name} — ${c.email?.toLowerCase()}`)

      // who hears the answer: this client's account managers, else hello@
      let managers: string[] = []
      try {
        const res = await fetch(`/api/clients/${c.id}/managers`)
        if (res.ok) {
          const json = await res.json() as { managers?: { email?: string }[] }
          managers = (json.managers ?? []).map(m => (m.email ?? '').toLowerCase()).filter(Boolean)
        }
      } catch { /* fall back to the default below */ }

      if (stale) return
      setKnownEmails(options)
      setPicked(new Set(options.length > 0 ? [options[0].email] : []))
      setNotifyEmails(managers.length > 0 ? managers.join(', ') : 'hello@mdmmarketing.com.au')
    })()
    return () => { stale = true }
  }, [clientId, clients])

  const toggleRecipient = (email: string) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })

  const submit = async () => {
    if (sending || !day) return
    setSending(true)
    try {
      const res = await fetch('/api/shoots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          title,
          starts_at: `${day}T${start}:00+10:00`,
          ends_at: `${day}T${end}:00+10:00`,
          send_to: recipients,
          notify_emails: notifyEmails.split(',').map(s => s.trim()).filter(Boolean),
          location, note,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send proposal')
      toast.success(`Proposal sent to ${recipients.join(', ')}`)
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send proposal')
      setSending(false)
    }
  }

  const dayLabel = day
    ? (() => { const [y, m, d] = day.split('-').map(Number)
        return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
          weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) })()
    : ''

  return (
    <Dialog open={day !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propose a shoot — {dayLabel}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Pick a client" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Content shoot" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Starts</Label>
              <Input type="time" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Ends</Label>
              <Input type="time" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Send proposal to <span className="text-xs text-zinc-400">(everyone ticked gets it)</span></Label>
            {knownEmails.length > 0 && (
              <div className="flex flex-col gap-1">
                {knownEmails.map(o => (
                  <label key={o.email} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <input
                      type="checkbox"
                      checked={picked.has(o.email)}
                      onChange={() => toggleRecipient(o.email)}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
              </div>
            )}
            <Input
              type="text" value={customEmail} onChange={e => setCustomEmail(e.target.value)}
              placeholder={knownEmails.length > 0 ? 'More emails, comma separated (optional)' : 'client@business.com, other@business.com'}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Notify on answer <span className="text-xs text-zinc-400">(prefilled with the client&rsquo;s account managers)</span></Label>
            <Input
              value={notifyEmails} onChange={e => setNotifyEmails(e.target.value)}
              placeholder="hello@mdmmarketing.com.au"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Location <span className="text-xs text-zinc-400">(optional)</span></Label>
            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Their venue, our studio…" />
          </div>
          <div className="grid gap-1.5">
            <Label>Note <span className="text-xs text-zinc-400">(optional, goes in the email)</span></Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="What we're shooting, what to have ready…" />
          </div>
          <Button onClick={() => void submit()} disabled={sending || !clientId || !title.trim() || recipients.length === 0}>
            {sending ? 'Sending…' : recipients.length > 1 ? `Send proposal to ${recipients.length} people` : 'Send proposal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

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
  // schedulers read the week; proposing, cancelling, and managing calendars
  // stay editor+ (matching the API), so those controls simply don't render
  const { can } = useRole()
  const canManage = can('editor')
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [events, setEvents] = useState<CalEvent[] | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [proposeDay, setProposeDay] = useState<string | null>(null)
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
      const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      const [evRes, prRes] = await Promise.all([
        fetch(`/api/gcal/events?${qs}`),
        fetch(`/api/shoots?${qs}`),
      ])
      const json = await evRes.json()
      if (!evRes.ok) throw new Error(json.error ?? 'Could not load events')
      setEvents(json.events)
      for (const err of json.errors ?? []) {
        toast.error(`${err.calendar}: calendar could not be read — try reconnecting it`)
        console.error('calendar error:', err)
      }
      const pr = await prRes.json()
      if (prRes.ok) setProposals(pr.proposals ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load events')
      setEvents([])
    }
  }, [days])

  useEffect(() => { loadAccounts() }, [loadAccounts])
  useEffect(() => { loadEvents() }, [loadEvents])

  // clients for the propose dialog — loaded once, reused every open
  useEffect(() => {
    fetch('/api/website/clients')
      .then(r => r.ok ? r.json() : [])
      .then((rows: ClientRow[]) => setClients(Array.isArray(rows) ? rows : []))
      .catch(() => {})
  }, [])

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
  const proposalsByDay = useMemo(() => {
    const map = new Map<string, Proposal[]>(days.map(d => [d, []]))
    for (const p of proposals) {
      const k = dayKey(p.starts_at)
      map.get(k)?.push(p)
    }
    return map
  }, [proposals, days])

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
            disabled={!canManage}
            onClick={() => canManage && patchAccount({ email: a.email, enabled: !a.enabled })}
            aria-pressed={a.enabled}
            aria-label={`${a.email} — ${a.enabled ? 'shown, tap to hide' : 'hidden, tap to show'}`}
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
            {/* the hover-only title= said "Hide this calendar" — a hidden
                calendar now says so on the chip, where a finger can read it */}
            {!a.enabled && <span className="text-[10px] uppercase tracking-wider">hidden</span>}
          </button>
        ))}

        {canManage && (
          <Button variant="outline" size="sm" asChild>
            {/* full navigation, not fetch: the route replies with a redirect to Google.
                "Add", not "Connect" — next to a connected chip, "Connect calendar"
                read as if the connect had not worked. */}
            <a href="/api/gcal/connect"><CalendarPlus className="h-3.5 w-3.5" /> Add calendar</a>
          </Button>
        )}

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
        <EmptyState
          icon={CalendarPlus}
          title="No calendars connected yet"
          body={canManage
            ? 'Connect hello@ and contact@ (sign in as each account when Google asks) and the week fills in with everyone’s commitments — empty space is shootable time.'
            : 'Once an editor or account manager connects the team calendars, the week fills in here. Empty space is shootable time.'}
          actionLabel={canManage ? 'Connect a calendar' : undefined}
          actionHref={canManage ? '/api/gcal/connect' : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {days.map(key => {
            const { dow, day } = fmtDayHeading(key)
            const list = byDay.get(key) ?? []
            const dayProposals = proposalsByDay.get(key) ?? []
            const isToday = key === today
            return (
              <Card key={key} className={isToday ? 'border-blue-300 dark:border-blue-800' : ''}>
                <CardContent className="group flex min-h-40 flex-col gap-2 p-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                      {dow}
                    </span>
                    {/* the hover-only `+` that used to live here is now a
                        labelled button at the foot of the card */}
                    <span className="font-mono text-[11px] text-zinc-400">{day}</span>
                  </div>
                  {list.length === 0 && dayProposals.length === 0 ? (
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
                        >
                          {/* the full title, wrapped — a truncated title with the
                              rest in a hover tooltip is a title a phone never reads */}
                          <p className="break-words text-xs font-medium text-zinc-800 dark:text-zinc-200">{e.title}</p>
                          <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                            {e.allDay ? 'all day' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}
                          </p>
                        </div>
                      ))}
                      {dayProposals.map(p => (
                        <div
                          key={p.id}
                          className={`rounded-md px-2 py-1.5 ${PROPOSAL_STYLE[p.status]}`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="break-words text-xs font-medium">
                              {p.title}{p.clients?.name ? ` · ${p.clients.name}` : ''}
                            </p>
                            {canManage && p.status !== 'cancelled' && (
                              // the same styled dialog every other destructive
                              // action in the app uses — this was the native
                              // browser confirm(), and the pending case asked
                              // nothing at all
                              <ConfirmAction
                                title={p.status === 'accepted'
                                  ? `Cancel the booked shoot “${p.title}”?`
                                  : `Cancel the proposal “${p.title}”?`}
                                body={p.status === 'accepted'
                                  ? `The shoot is booked. Everyone it was sent to (${p.send_to}) gets a cancellation email straight away, and the day opens up again. This cannot be undone — to move it instead, cancel and send a new proposal.`
                                  : `The client has not answered yet. Their answer link stops working and they are told it was withdrawn. To change the time, send a new proposal from another day.`}
                                confirmLabel={p.status === 'accepted' ? 'Cancel the shoot' : 'Cancel the proposal'}
                                onConfirm={async () => {
                                  const res = await fetch(`/api/shoots/${p.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ cancel: true }),
                                  })
                                  if (res.ok) { toast.success(`“${p.title}” cancelled — ${p.send_to} has been emailed`); loadEvents() }
                                  else toast.error('Could not cancel — try again')
                                }}
                              >
                                <button
                                  type="button"
                                  aria-label={p.status === 'accepted' ? `Cancel the booked shoot ${p.title}` : `Cancel the proposal ${p.title}`}
                                  className="-m-1 inline-flex shrink-0 items-center justify-center rounded p-1 opacity-60 transition-opacity hover:opacity-100 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </ConfirmAction>
                            )}
                          </div>
                          <p className="font-mono text-[10px] opacity-80">
                            {fmtTime(p.starts_at)} – {fmtTime(p.ends_at)} · {PROPOSAL_TAG[p.status]}
                          </p>
                          {p.location && (
                            <p className="break-words font-mono text-[10px] opacity-70">{p.location}</p>
                          )}
                          {/* who has it — this used to be hover-only, and "did
                              the client get it?" is the first question asked */}
                          <p className="break-words text-[10px] opacity-70">to {p.send_to}</p>
                          {p.note && <p className="break-words text-[10px] opacity-70">{p.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* The only way to propose a shoot used to be the 14px `+`
                      above, which was invisible until hover — so on a phone
                      the entire feature had no entry point, while the
                      Proposals page told people to "send one from a free day
                      in the Availability view". This is that entry point. */}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProposeDay(key)}
                      className="mt-auto w-full justify-start text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      <Plus className="h-3.5 w-3.5" /> Propose a shoot
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ProposeShootDialog
        day={proposeDay}
        clients={clients}
        onClose={() => setProposeDay(null)}
        onCreated={() => { setProposeDay(null); loadEvents() }}
      />

      {/* ── manage connected calendars ── */}
      {canManage && connected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
            {CAL_TZ.replace('_', ' ')}
          </Badge>
          {connected.map(a => (
            <ConfirmAction
              key={a.email}
              title={`Disconnect ${a.email}?`}
              body="Its events disappear from this week view until someone signs in to Google and connects it again. Nothing in the calendar itself is touched. To just hide it for now, tap its chip above instead."
              confirmLabel="Disconnect"
              onConfirm={() => patchAccount({ email: a.email, disconnect: true })}
            >
              <button
                type="button"
                className="flex min-h-11 items-center gap-1 text-zinc-400 transition-colors hover:text-red-600"
              >
                <Unplug className="h-3 w-3" /> disconnect {a.email}
              </button>
            </ConfirmAction>
          ))}
        </div>
      )}
    </div>
  )
}
