'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Trash2, Clock, DollarSign, Link as LinkIcon, ImagePlus } from 'lucide-react'
import { minToLabel } from '../../lib/booking-core'
import BookingCalendar from './BookingCalendar'
import { uploadMedia } from '../uploadMedia'
import { useProductionLive } from '../production/useProductionLive'
import { bookingUrl, bookingIndexUrl } from '../../lib/site-urls'

type Service = { id: string; name: string; slug: string; duration_min: number; price_cents: number; currency: string; active: boolean; description: string | null; image_url?: string | null; location?: string | null; resource_id?: string | null; requires_payment?: boolean; category?: string | null }
type Resource = { id: string; label: string; email: string | null; active: boolean }
type Availability = { id: string; resource_id: string; weekday: number; start_min: number; end_min: number }
type Booking = {
  id: string; start_at: string; end_at: string; customer_name: string; customer_email: string
  status: string; payment_status: string; amount_cents: number
  booking_services: { name: string } | null; booking_resources: { label: string } | null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Share links always point at the PUBLIC site — app.* is the staff login,
 *  and window.location.origin here would hand out exactly that. */
const copy = (url: string, ok: string) =>
  navigator.clipboard.writeText(url).then(() => toast.success(ok)).catch(() => toast.error(url))
const money = (c: number, cur = 'AUD') => c === 0 ? 'Free' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur }).format(c / 100)

/** The service's photo — what a customer actually sees first on the booking
 *  page. Uploads straight to R2, same path as every other media upload. */
function ServiceImage({
  service, onSave,
}: {
  service: Service
  onSave: (payload: Record<string, unknown>, ok: string) => Promise<boolean | undefined>
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        title={service.image_url ? 'Change photo' : 'Add a photo'}
        className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-50 text-zinc-400 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
        {service.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={service.image_url} alt="" className="h-full w-full object-cover" />
          : busy ? <span className="text-[9px]">…</span> : <ImagePlus className="h-4 w-4" />}
      </button>
      {/* Invisible by inline style, not by a utility class: `sr-only` still
          left "No file chosen" rendering here, and `display:none` can make a
          scripted .click() refuse to open the picker. This does both jobs. */}
      <input ref={ref} type="file" accept="image/*"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            const { url } = await uploadMedia(file, { purpose: 'production' })
            await onSave({ action: 'update_service', id: service.id, image_url: url }, 'Photo updated')
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Upload failed')
          } finally { setBusy(false) }
        }} />
    </>
  )
}

/**
 * One service, editable in place.
 *
 * Everything a customer sees lives here — which studio it belongs to, the
 * copy, the price, the photo — because the page previously only let you
 * create and delete, which meant fixing a typo was a delete-and-retype and
 * setting a studio was impossible.
 */
function ServiceRow({ service, onSave, busy, studios, resources }: {
  service: Service
  onSave: (p: Record<string, unknown>, ok: string) => Promise<boolean | undefined>
  busy: boolean
  studios: string[]
  resources: Resource[]
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    name: service.name,
    category: service.category ?? '',
    duration_min: String(service.duration_min),
    price: (service.price_cents / 100).toString(),
    description: service.description ?? '',
    location: service.location ?? '',
    requires_payment: service.requires_payment === true,
    active: service.active,
    resource_id: service.resource_id ?? (resources[0]?.id ?? ''),
  })
  const dirty =
    draft.name !== service.name
    || draft.category !== (service.category ?? '')
    || Number(draft.duration_min) !== service.duration_min
    || Math.round(Number(draft.price || 0) * 100) !== service.price_cents
    || draft.description !== (service.description ?? '')
    || draft.location !== (service.location ?? '')
    || draft.requires_payment !== (service.requires_payment === true)
    || draft.active !== service.active
    || draft.resource_id !== (service.resource_id ?? (resources[0]?.id ?? ''))

  const save = async () => {
    const ok = await onSave({
      action: 'update_service', id: service.id,
      name: draft.name,
      category: draft.category,
      duration_min: Number(draft.duration_min),
      price_cents: Math.round(Number(draft.price || 0) * 100),
      description: draft.description,
      location: draft.location,
      requires_payment: draft.requires_payment,
      active: draft.active,
      resource_id: draft.resource_id || null,
    }, 'Saved')
    if (ok) setOpen(false)
  }

  return (
    <div className="flex flex-col border-b border-zinc-100 last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-3 py-2">
        <ServiceImage service={service} onSave={onSave} />
        <button type="button" onClick={() => setOpen(o => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="truncate text-sm font-medium">{service.name}</span>
          {service.category && (
            <span className="hidden shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 sm:inline dark:bg-zinc-800">
              {service.category}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-zinc-500"><Clock className="h-3 w-3" />{service.duration_min}m</span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-zinc-500"><DollarSign className="h-3 w-3" />{money(service.price_cents, service.currency)}</span>
          {!service.active && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[10px] uppercase text-zinc-500 dark:bg-zinc-800">hidden</span>}
        </button>

        <button className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={() => void copy(bookingUrl(service.slug), 'Booking link copied')}>
          <LinkIcon className="h-3.5 w-3.5" /> Copy link
        </button>
        <a href={bookingUrl(service.slug)} target="_blank" rel="noreferrer noopener"
          className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">Preview</a>
        <Button size="sm" variant={open ? 'default' : 'outline'} className="h-7 text-xs"
          onClick={() => setOpen(o => !o)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 pb-4 pl-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-zinc-500">Name
              <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">Group it under
              <Input list="booking-studios" placeholder="e.g. MD House Podcast Studio"
                value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} />
              <datalist id="booking-studios">
                {studios.map(c => <option key={c} value={c} />)}
              </datalist>
            </label>
            {/* Which calendar it consumes. Two services on the SAME room must
                share a resource or they will double-book it; two services in
                different rooms must not, or one blocks the other. */}
            <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">
              Which room/calendar it books
              <select value={draft.resource_id}
                onChange={e => setDraft(d => ({ ...d, resource_id: e.target.value }))}
                className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800">
                {resources.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">Minutes
              <Input type="number" min={5} value={draft.duration_min}
                onChange={e => setDraft(d => ({ ...d, duration_min: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">Price (AUD)
              <Input type="number" min={0} step="0.01" value={draft.price}
                onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500 sm:col-span-2">Where it happens
              <Input placeholder="Altona North, VIC" value={draft.location}
                onChange={e => setDraft(d => ({ ...d, location: e.target.value }))} />
            </label>
          </div>

          <label className="grid gap-1 text-xs text-zinc-500">
            What&rsquo;s included
            <span className="text-[11px] text-zinc-400">
              A line in CAPS becomes a heading; a line starting with &ldquo;-&rdquo; becomes a bullet.
            </span>
            <textarea rows={10} value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className="w-full resize-y rounded-md border border-zinc-200 bg-transparent p-2.5 font-mono text-xs leading-relaxed outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600" />
          </label>

          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={draft.requires_payment}
                onChange={e => setDraft(d => ({ ...d, requires_payment: e.target.checked }))} />
              Take payment when booking
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={draft.active}
                onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))} />
              Show on the public page
            </label>
            <Button size="sm" className="ml-auto" disabled={busy || !dirty} onClick={() => void save()}>
              {dirty ? 'Save changes' : 'Saved'}
            </Button>
            <button className="text-zinc-400 hover:text-rose-600"
              onClick={() => void onSave({ action: 'delete_service', id: service.id }, 'Service removed')}
              aria-label="Delete service">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Move a booking from the dashboard.
 *
 * The customer is emailed the new time automatically — a reschedule nobody
 * told them about is worse than no reschedule. The server refuses a slot
 * someone else holds, so two people moving bookings at once cannot collide.
 */
function MoveBooking({ booking, onSave, busy }: {
  booking: Booking
  onSave: (p: Record<string, unknown>, ok: string) => Promise<boolean | undefined>
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  // datetime-local wants local wall-clock, not an ISO instant
  const local = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [when, setWhen] = useState(() => local(booking.start_at))

  if (!open) {
    return (
      <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        onClick={() => { setWhen(local(booking.start_at)); setOpen(true) }}>
        Move
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
        className="h-8 w-52 text-xs" />
      <Button size="sm" className="h-8 text-xs" disabled={busy}
        onClick={async () => {
          const at = new Date(when)
          if (Number.isNaN(at.getTime())) { toast.error('Pick a valid date and time'); return }
          const ok = await onSave(
            { action: 'reschedule_booking', id: booking.id, start_at: at.toISOString() },
            'Moved — the customer has been emailed',
          )
          if (ok) setOpen(false)
        }}>
        Save
      </Button>
      <button className="text-xs text-zinc-400" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  )
}

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
  // a booking taken on the public page shows up here without a refresh
  useProductionLive(load)

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
          Services people can book, when you&rsquo;re open, and every appointment.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline"
            onClick={() => void copy(bookingIndexUrl(), 'Booking link copied — this one shows everything')}>
            <LinkIcon className="h-3.5 w-3.5" /> Copy the booking link
          </Button>
          <a href={bookingIndexUrl()} target="_blank" rel="noreferrer noopener"
            className="text-xs text-zinc-400 underline-offset-4 hover:underline">
            {bookingIndexUrl().replace(/^https:\/\//, '')}
          </a>
        </div>
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
            <ServiceRow key={s.id} service={s} onSave={post} busy={busy}
              resources={data.resources}
              studios={[...new Set(data.services.map(x => x.category).filter(Boolean) as string[])]} />
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
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Opening hours</p>
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
                : (
                  <span className="ml-auto flex items-center gap-3">
                    <MoveBooking booking={b} onSave={post} busy={busy} />
                    <button className="text-xs text-rose-600 hover:underline"
                      onClick={() => void post({ action: 'cancel_booking', id: b.id }, 'Booking cancelled')}>Cancel</button>
                  </span>
                )}
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
  /** One row per weekday: on/off plus a real time picker. Free-text "9:00"
   *  boxes read as ambiguous (9am or 9pm?) and had to be typed twice a day —
   *  <input type="time"> is unambiguous and takes one click. */
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const toMin = (v: string) => {
    const [h, m] = v.split(':').map(Number)
    return Number.isFinite(h) ? h * 60 + (m || 0) : null
  }
  const [grid, setGrid] = useState(() => DAYS.map((_, wd) => {
    const a = availability.find(x => x.weekday === wd)
    return { on: !!a, start: a ? hhmm(a.start_min) : '09:00', end: a ? hhmm(a.end_min) : '17:00' }
  }))
  const [dirty, setDirty] = useState(false)
  const edit = (wd: number, patch: Partial<{ on: boolean; start: string; end: string }>) => {
    setDirty(true)
    setGrid(gr => gr.map((x, i) => (i === wd ? { ...x, ...patch } : x)))
  }

  const save = async () => {
    const windows = grid.map((g, wd) => {
      if (!g.on) return null
      const s = toMin(g.start); const e = toMin(g.end)
      if (s === null || e === null || e <= s) return null
      return { weekday: wd, start_min: s, end_min: e }
    }).filter(Boolean)
    if (await onSave({ action: 'set_availability', resource_id: resource.id, windows }, 'Hours saved')) {
      setDirty(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* the email is how alerts route, not something to read here */}
        <span className="text-sm font-medium">{resource.label}</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500"
          onClick={() => { setDirty(true); setGrid(DAYS.map((_, wd) => ({ on: wd >= 1 && wd <= 5, start: '09:00', end: '17:00' }))) }}>
          Weekdays 9–5
        </Button>
        <button className="ml-auto text-zinc-400 hover:text-rose-600" onClick={() => void onSave({ action: 'delete_resource', id: resource.id }, 'Removed')} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      <div className="flex flex-col gap-1">
        {grid.map((g, wd) => (
          <div key={wd} className="flex items-center gap-3 text-sm">
            <label className="flex w-28 shrink-0 cursor-pointer items-center gap-2">
              <input type="checkbox" checked={g.on} className="h-3.5 w-3.5 accent-blue-600"
                onChange={e => edit(wd, { on: e.target.checked })} />
              <span className={g.on ? '' : 'text-zinc-400'}>{DAYS[wd]}</span>
            </label>
            {g.on ? (
              <>
                <input type="time" value={g.start} step={900}
                  onChange={e => edit(wd, { start: e.target.value })}
                  className="rounded border border-zinc-200 bg-transparent px-2 py-1 font-mono text-xs dark:border-zinc-700" />
                <span className="text-zinc-400">to</span>
                <input type="time" value={g.end} step={900}
                  onChange={e => edit(wd, { end: e.target.value })}
                  className="rounded border border-zinc-200 bg-transparent px-2 py-1 font-mono text-xs dark:border-zinc-700" />
              </>
            ) : (
              <span className="text-xs text-zinc-400">Closed</span>
            )}
          </div>
        ))}
      </div>

      <Button size="sm" className="w-fit" disabled={busy || !dirty} onClick={() => void save()}>
        {dirty ? 'Save hours' : 'Saved'}
      </Button>
    </div>
  )
}
