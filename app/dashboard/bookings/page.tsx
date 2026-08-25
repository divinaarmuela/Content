'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Trash2, Clock, DollarSign, Link as LinkIcon } from 'lucide-react'
import { minToLabel } from '../../lib/booking-core'
import BookingCalendar from './BookingCalendar'

type Service = { id: string; name: string; slug: string; duration_min: number; price_cents: number; currency: string; active: boolean; description: string | null }
type Resource = { id: string; label: string; email: string | null; active: boolean }
type Availability = { id: string; resource_id: string; weekday: number; start_min: number; end_min: number }
type Booking = {
  id: string; start_at: string; end_at: string; customer_name: string; customer_email: string
  status: string; payment_status: string; amount_cents: number
  booking_services: { name: string } | null; booking_resources: { label: string } | null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const money = (c: number, cur = 'AUD') => c === 0 ? 'Free' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur }).format(c / 100)

export default function BookingsPage() {
  const [data, setData] = useState<{
    needs_schema: boolean; services: Service[]; resources: Resource[]
    availability: Availability[]; blackouts: unknown[]; bookings: Booking[]
  } | null>(null)
  const [svcDraft, setSvcDraft] = useState({ name: '', duration_min: '60', price: '' })
  const [resDraft, setResDraft] = useState({ label: '', email: '' })
  const [busy, setBusy] = useState(false)
  /** the month grid answers "what does that week look like"; the list is the
   *  audit trail. Calendar first, because that is the question people ask. */
  const [view, setView] = useState<'calendar' | 'list'>('calendar')

  const load = useCallback(async () => {
    const res = await fetch('/api/booking/admin')
    if (res.ok) setData(await res.json())
    else setData({ needs_schema: true, services: [], resources: [], availability: [], blackouts: [], bookings: [] })
  }, [])
  useEffect(() => { void load() }, [load])

  const post = async (payload: Record<string, unknown>, ok: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/booking/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(ok)
      void load()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
      return false
    } finally { setBusy(false) }
  }

  if (data === null) return <div className="grid gap-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28" />)}</div>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Bookings</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Services people can book, who&rsquo;s available, and every appointment. The public page and the shareable link both run off this.
        </p>
      </div>

      {data.needs_schema && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-300">
            Run <span className="font-mono">supabase/booking.sql</span> in the SQL editor to switch bookings on.
          </CardContent>
        </Card>
      )}

      {/* ── Services ── */}
      <section className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Services (booking types)</p>
        <Card><CardContent className="flex flex-col gap-2 p-4">
          {data.services.length === 0 && <p className="text-sm text-zinc-400">No services yet — add one below.</p>}
          {data.services.map(s => (
            <div key={s.id} className="flex items-center gap-3 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
              <span className="text-sm font-medium">{s.name}</span>
              <span className="flex items-center gap-1 font-mono text-xs text-zinc-500"><Clock className="h-3 w-3" />{s.duration_min}m</span>
              <span className="flex items-center gap-1 font-mono text-xs text-zinc-500"><DollarSign className="h-3 w-3" />{money(s.price_cents, s.currency)}</span>
              {!s.active && <span className="rounded bg-zinc-100 px-1.5 text-[10px] uppercase text-zinc-500 dark:bg-zinc-800">archived</span>}
              {/* the whole point of a booking type is the link you send people */}
              <button
                className="ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => {
                  const url = `${window.location.origin}/book/${s.slug}`
                  void navigator.clipboard.writeText(url)
                    .then(() => toast.success('Booking link copied'))
                    .catch(() => toast.error(url))
                }}>
                <LinkIcon className="h-3.5 w-3.5" /> Copy link
              </button>
              <a href={`/book/${s.slug}`} target="_blank" rel="noreferrer noopener"
                className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">Preview</a>
              <button className="text-zinc-400 hover:text-rose-600" onClick={() => void post({ action: 'delete_service', id: s.id }, 'Service removed')} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <div className="mt-1 flex flex-wrap gap-2">
            <Input value={svcDraft.name} placeholder="Service name (e.g. Podcast studio hour)" className="max-w-xs" onChange={e => setSvcDraft(d => ({ ...d, name: e.target.value }))} />
            <Input value={svcDraft.duration_min} type="number" placeholder="mins" className="w-24" onChange={e => setSvcDraft(d => ({ ...d, duration_min: e.target.value }))} />
            <Input value={svcDraft.price} type="number" placeholder="price $" className="w-28" onChange={e => setSvcDraft(d => ({ ...d, price: e.target.value }))} />
            <Button size="sm" disabled={busy || !svcDraft.name.trim()} onClick={async () => {
              if (await post({ action: 'create_service', name: svcDraft.name, duration_min: Number(svcDraft.duration_min), price_cents: Math.round(Number(svcDraft.price || 0) * 100) }, 'Service added')) setSvcDraft({ name: '', duration_min: '60', price: '' })
            }}><Plus className="h-3.5 w-3.5" /> Add service</Button>
          </div>
        </CardContent></Card>
      </section>

      {/* ── Resources + availability ── */}
      <section className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Who&rsquo;s bookable · availability</p>
        <Card><CardContent className="flex flex-col gap-4 p-4">
          {data.resources.length === 0 && <p className="text-sm text-zinc-400">Add a bookable person or mailbox (e.g. tech@, hello@, contact@).</p>}
          {data.resources.map(r => (
            <ResourceRow key={r.id} resource={r} availability={data.availability.filter(a => a.resource_id === r.id)} onSave={post} busy={busy} />
          ))}
          <div className="mt-1 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <Input value={resDraft.label} placeholder="Label (e.g. Tech — tech@)" className="max-w-xs" onChange={e => setResDraft(d => ({ ...d, label: e.target.value }))} />
            <Input value={resDraft.email} placeholder="email (optional)" className="max-w-xs" onChange={e => setResDraft(d => ({ ...d, email: e.target.value }))} />
            <Button size="sm" disabled={busy || !resDraft.label.trim()} onClick={async () => {
              if (await post({ action: 'create_resource', label: resDraft.label, email: resDraft.email }, 'Resource added')) setResDraft({ label: '', email: '' })
            }}><Plus className="h-3.5 w-3.5" /> Add resource</Button>
          </div>
        </CardContent></Card>
      </section>

      {/* ── Bookings ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Bookings</p>
          <div className="ml-auto flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(['calendar', 'list'] as const).map(v => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
                  view === v ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500'
                }`}>
                {v}
              </button>
            ))}
          </div>
        </div>

        {view === 'calendar' && (
          <Card><CardContent className="p-4">
            <BookingCalendar bookings={data.bookings} />
          </CardContent></Card>
        )}

        {view === 'list' && (
        <Card><CardContent className="flex flex-col gap-1 p-4">
          {data.bookings.length === 0 && <p className="text-sm text-zinc-400">No bookings yet.</p>}
          {data.bookings.map(b => (
            <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 py-2 text-sm last:border-0 dark:border-zinc-800">
              <span className="font-mono text-xs text-zinc-500">{new Date(b.start_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="font-medium">{b.customer_name}</span>
              <span className="text-zinc-500">{b.booking_services?.name} · {b.booking_resources?.label}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${b.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>{b.payment_status}</span>
              {b.status === 'cancelled'
                ? <span className="ml-auto text-xs text-zinc-400">cancelled</span>
                : <button className="ml-auto text-xs text-rose-600 hover:underline" onClick={() => void post({ action: 'cancel_booking', id: b.id }, 'Booking cancelled')}>Cancel</button>}
            </div>
          ))}
        </CardContent></Card>
        )}
      </section>
    </div>
  )
}

function ResourceRow({ resource, availability, onSave, busy }: {
  resource: Resource; availability: Availability[]
  onSave: (p: Record<string, unknown>, ok: string) => Promise<boolean>; busy: boolean
}) {
  // one simple start/end per weekday (the common case); blank = closed
  const [grid, setGrid] = useState(() => DAYS.map((_, wd) => {
    const a = availability.find(x => x.weekday === wd)
    return { on: !!a, start: a ? minToLabel(a.start_min).replace(/ (am|pm)/, '') : '9:00', end: a ? minToLabel(a.end_min).replace(/ (am|pm)/, '') : '17:00' }
  }))

  const save = async () => {
    const windows = grid.map((g, wd) => {
      if (!g.on) return null
      const [sh, sm] = g.start.split(':').map(Number)
      const [eh, em] = g.end.split(':').map(Number)
      return { weekday: wd, start_min: sh * 60 + (sm || 0), end_min: eh * 60 + (em || 0) }
    }).filter(Boolean)
    await onSave({ action: 'set_availability', resource_id: resource.id, windows }, `${resource.label} hours saved`)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{resource.label}</span>
        {resource.email && <span className="text-xs text-zinc-400">{resource.email}</span>}
        <button className="ml-auto text-zinc-400 hover:text-rose-600" onClick={() => void onSave({ action: 'delete_resource', id: resource.id }, 'Resource removed')} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        {grid.map((g, wd) => (
          <label key={wd} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${g.on ? 'border-zinc-300 dark:border-zinc-600' : 'border-zinc-100 opacity-50 dark:border-zinc-800'}`}>
            <input type="checkbox" checked={g.on} onChange={e => setGrid(gr => gr.map((x, i) => i === wd ? { ...x, on: e.target.checked } : x))} />
            <span className="w-8 font-medium">{DAYS[wd]}</span>
            {g.on && (
              <>
                <input value={g.start} className="w-14 bg-transparent font-mono outline-none" onChange={e => setGrid(gr => gr.map((x, i) => i === wd ? { ...x, start: e.target.value } : x))} />
                <span>–</span>
                <input value={g.end} className="w-14 bg-transparent font-mono outline-none" onChange={e => setGrid(gr => gr.map((x, i) => i === wd ? { ...x, end: e.target.value } : x))} />
              </>
            )}
          </label>
        ))}
      </div>
      <Button size="sm" variant="outline" className="w-fit" disabled={busy} onClick={() => void save()}>Save hours</Button>
    </div>
  )
}
