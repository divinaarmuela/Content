'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import PageTitle from '../ui/PageTitle'
import TintCard from '../ui/TintCard'
import Stat from '../ui/Stat'
import Chip, { type ChipTone } from '../ui/Chip'
import EmptyState from '../EmptyState'
import {
  PRICE_LIST, RETAINER_COMMISSION_MONTHS, STAGE_WORDS, UPSELL_STAGES, commissionOf, mayChangeUpsell, mayDeleteUpsell,
  money, priceCheck, priceItem, upsellTotals, type Upsell, type UpsellStage,
} from '../../lib/upsell-core'

/**
 * UPSELLS — pitched versus won (Divina, via the owner, 25 Nov 2026: "a simple dashboard tracker that shows client
 * pitched versus won. Log of clients, service, amount, stage, is paid … They get commission when the client has
 * paid for the upsell"). A super admin's page, and the named people's it is opened to on the Team page; the routes
 * refuse everyone else. Rules, the price list and the commission sums are upsell-core's — this page only draws.
 */

type Me = { id: string; name: string; role: string; seesAll: boolean; mayLogForOthers: boolean; mayMarkPaid: boolean }
type Named = { id: string; name: string }
type Loaded = { rows: Upsell[]; clients: Named[]; people: Named[]; me: Me }

const STAGE_TONE: Record<UpsellStage, ChipTone> = { logged: 'muted', pitched: 'amber', won: 'green', lost: 'red' }
const FIELD = 'h-11 w-full rounded-inner border border-border bg-surface px-3 text-[14px] text-foreground outline-none focus:border-foreground'
const LABEL = 'text-[13px] font-semibold'
const CATEGORIES = [...new Set(PRICE_LIST.map(p => p.category))]

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '')
const amountWords = (u: Pick<Upsell, 'amount' | 'billing'>) => `${money(u.amount)}${u.billing === 'monthly' ? ' a month' : ''}`
/** "$3,000 one-off · $1,850 a month" — the two kinds of money, never added together */
const twoMoneys = (oneOff: number, monthly: number) => [oneOff > 0 ? `${money(oneOff)} one-off` : null, monthly > 0 ? `${money(monthly)} a month` : null].filter(Boolean).join(' · ') || '$0'

export default function UpsellsPage() {
  const [data, setData] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [who, setWho] = useState('all')
  const [stage, setStage] = useState<'all' | UpsellStage>('all')
  const [form, setForm] = useState<{ row: Upsell | null } | null>(null)
  const [deleting, setDeleting] = useState<Upsell | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/upsells', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(json?.error ?? 'The tracker could not be loaded'); return }
      setProblem(null)
      setData(json as Loaded)
    } catch {
      setProblem('The tracker could not be loaded — check the connection and reload')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const put = (row: Upsell) => setData(d => (d ? { ...d, rows: d.rows.some(r => r.id === row.id) ? d.rows.map(r => (r.id === row.id ? row : r)) : [row, ...d.rows] } : d))

  /** One change to one row. A refusal is said; a row somebody else changed is replaced with how it stands now. */
  const change = async (row: Upsell, patch: Record<string, unknown>, done?: string): Promise<boolean> => {
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/upsells/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expect_rev: row.rev, ...patch }) })
      const json = await res.json().catch(() => ({}))
      if (json?.row) put(json.row as Upsell)
      if (!res.ok) { toast.error(json?.error ?? 'That did not save'); return false }
      if (done) toast.success(done)
      return true
    } catch {
      toast.error('That did not save — check the connection and try again')
      return false
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (row: Upsell) => {
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/upsells/${row.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json?.error ?? 'It could not be deleted'); return }
      setData(d => (d ? { ...d, rows: d.rows.filter(r => r.id !== row.id) } : d))
      toast.success('Deleted')
    } finally {
      setBusyId(null); setDeleting(null)
    }
  }

  const shown = useMemo(() => (data?.rows ?? []).filter(r => (who === 'all' || r.pitched_by === who) && (stage === 'all' || r.stage === stage)), [data, who, stage])
  // the tiles answer "pitched versus won" for the person picked, whatever stage the list below is narrowed to
  const totals = useMemo(() => upsellTotals((data?.rows ?? []).filter(r => who === 'all' || r.pitched_by === who)), [data, who])

  if (problem) {
    return (
      <div>
        <PageTitle title="Upsells" />
        <p role="alert" className="rounded-card border border-border bg-surface p-5 text-[14px]">{problem}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div>
        <PageTitle title="Upsells" />
        <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[132px] rounded-card" />)}</div>
      </div>
    )
  }

  const { me } = data
  const whoName = who === 'all' ? null : data.people.find(p => p.id === who)?.name ?? null

  return (
    <div className="flex flex-col gap-5" data-upsells>
      <PageTitle
        title="Upsells"
        summary={me.seesAll
          ? 'Add-ons pitched to existing clients: what was pitched, what was won, and the commission once the client has paid. You see everyone\u2019s.'
          : 'The add-ons you pitched to existing clients: what was pitched, what was won, and your commission once the client has paid. Only you see these.'}
        actions={(
          <Button className="h-11 rounded-full px-5 text-[14px] font-semibold" onClick={() => setForm({ row: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Log an upsell
          </Button>
        )}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-upsell-totals>
        <TintCard tone="surface" title={whoName ? `Pitched by ${whoName}` : 'Pitched'}>
          <Stat value={totals.pitched} label={totals.pitched === 1 ? 'upsell put to a client' : 'upsells put to clients'} />
          <p className="text-[13px] text-muted-foreground">{twoMoneys(totals.pitchedOneOff, totals.pitchedMonthly)}{totals.logged > 0 ? ` · ${totals.logged} more logged as ${totals.logged === 1 ? 'an idea' : 'ideas'}` : ''}</p>
        </TintCard>
        <TintCard tone="green" title="Won">
          <Stat value={`${totals.won} of ${totals.pitched}`} label="pitched upsells won" />
          <p className="text-[13px]">{twoMoneys(totals.wonOneOff, totals.wonMonthly)}{totals.lost > 0 ? ` · ${totals.lost} lost` : ''}</p>
        </TintCard>
        <TintCard tone="amber" title="Waiting on the client">
          <Stat value={totals.waiting} label={totals.waiting === 1 ? 'pitch with no answer yet' : 'pitches with no answer yet'} />
          <p className="text-[13px]">{money(totals.paidOneOff)} of one-off work paid so far</p>
        </TintCard>
        <TintCard tone="blue" title="Commission">
          <Stat value={money(totals.commissionEarned)} label="earned — the client has paid" />
          <p className="text-[13px]">{money(totals.commissionPending)} more once clients pay</p>
        </TintCard>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* only the two who keep the tracker see everyone's; anybody else has only their own, so nothing to choose */}
        {me.seesAll && <label className="flex min-w-[180px] flex-col gap-1">
          <span className={LABEL}>Whose</span>
          <select className={FIELD} value={who} onChange={e => setWho(e.target.value)} aria-label="Whose upsells">
            <option value="all">Everyone</option>
            {data.people.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === me.id ? ' (you)' : ''}</option>)}
          </select>
        </label>}
        <label className="flex min-w-[180px] flex-col gap-1">
          <span className={LABEL}>Stage</span>
          <select className={FIELD} value={stage} onChange={e => setStage(e.target.value as 'all' | UpsellStage)} aria-label="Stage">
            <option value="all">Every stage</option>
            {UPSELL_STAGES.map(s => <option key={s} value={s}>{STAGE_WORDS[s]}</option>)}
          </select>
        </label>
        <p className="ml-auto text-[13px] text-muted-foreground">Prices are AUD, ex GST. Commission is 10%: on one-off work once paid, and on the first {RETAINER_COMMISSION_MONTHS} paid months of an added monthly fee.</p>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title={data.rows.length === 0 ? 'No upsells logged yet' : 'Nothing matches those filters'}
          body={data.rows.length === 0
            ? 'Log an add-on before you raise it with the client, so the price is agreed and it is clear who raised it first.'
            : me.seesAll ? 'Change Whose or Stage above to see the rest.' : 'Change Stage above to see the rest.'}
          actionLabel={data.rows.length === 0 ? 'Log an upsell' : undefined}
          onAction={data.rows.length === 0 ? () => setForm({ row: null }) : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-2.5" data-upsell-list>
          {shown.map(row => {
            const mine = mayChangeUpsell(me, row)
            const check = priceCheck(priceItem(row.service_key), row.amount)
            const c = commissionOf(row)
            const busy = busyId === row.id
            return (
              <li key={row.id} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 lg:flex-row lg:items-center lg:gap-5" data-upsell={row.id}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[16px] font-semibold">{row.client_name}</span>
                    <Chip tone={STAGE_TONE[row.stage]}>{STAGE_WORDS[row.stage]}</Chip>
                    {row.stage === 'won' && (row.billing === 'monthly'
                      ? <Chip tone={row.months_paid > 0 ? 'green' : 'surface'}>{row.months_paid} of {RETAINER_COMMISSION_MONTHS} months paid</Chip>
                      : <Chip tone={row.paid ? 'green' : 'surface'}>{row.paid ? `Paid${row.paid_at ? ` ${day(row.paid_at)}` : ''}` : 'Not paid yet'}</Chip>)}
                    {check === 'below' && <Chip tone="amber">Under the list price — needs Divina’s sign-off</Chip>}
                  </div>
                  <p className="text-[14px]">{row.service_name} <span className="text-muted-foreground">· {row.category}</span></p>
                  <p className="text-[13px] text-muted-foreground">
                    {row.pitched_by_name} · logged {day(row.logged_at)}
                    {row.pitched_at ? ` · pitched ${day(row.pitched_at)}` : ''}
                    {row.won_at ? ` · won ${day(row.won_at)}` : ''}
                    {row.stage === 'lost' && row.lost_at ? ` · lost ${day(row.lost_at)}` : ''}
                  </p>
                  {row.notes && <p className="whitespace-pre-wrap text-[13px]">{row.notes}</p>}
                </div>

                <div className="flex shrink-0 flex-col gap-0.5 lg:w-[190px] lg:text-right">
                  <span className="text-[18px] font-semibold tabular-nums">{amountWords(row)}</span>
                  {row.stage === 'won' && (
                    <span className="text-[12px] text-muted-foreground">
                      Commission: {money(c.earned)} earned{c.pending > 0 ? `, ${money(c.pending)} to come` : ''}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {mine && (
                    <select className={`${FIELD} w-[150px]`} value={row.stage} disabled={busy} aria-label={`Stage of ${row.service_name} for ${row.client_name}`}
                      onChange={e => void change(row, { stage: e.target.value }, `Now ${STAGE_WORDS[e.target.value as UpsellStage].toLowerCase()}`)}>
                      {UPSELL_STAGES.map(s => <option key={s} value={s}>{STAGE_WORDS[s]}</option>)}
                    </select>
                  )}
                  {me.mayMarkPaid && row.stage === 'won' && (row.billing === 'monthly' ? (
                    <select className={`${FIELD} w-[170px]`} value={row.months_paid} disabled={busy} aria-label="Months the client has paid"
                      onChange={e => void change(row, { months_paid: Number(e.target.value) }, 'Months paid saved')}>
                      {Array.from({ length: RETAINER_COMMISSION_MONTHS + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? 'No month paid yet' : `${n} ${n === 1 ? 'month' : 'months'} paid`}</option>)}
                    </select>
                  ) : (
                    <Button variant={row.paid ? 'outline' : 'default'} className="h-11 rounded-full px-4 text-[13px] font-semibold" disabled={busy}
                      onClick={() => void change(row, { paid: !row.paid }, row.paid ? 'Marked not paid' : 'Marked paid')}>
                      {row.paid ? 'Undo paid' : 'Client has paid'}
                    </Button>
                  ))}
                  {mine && (
                    <Button variant="outline" className="h-11 w-11 rounded-full p-0" aria-label={`Edit ${row.service_name} for ${row.client_name}`} disabled={busy} onClick={() => setForm({ row })}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                  {mayDeleteUpsell(me, row) && (
                    <Button variant="outline" className="h-11 w-11 rounded-full p-0 text-accent-red-deep" aria-label={`Delete ${row.service_name} for ${row.client_name}`} disabled={busy} onClick={() => setDeleting(row)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {form && (
        <UpsellForm
          row={form.row} me={me} clients={data.clients} people={data.people}
          onClose={() => setForm(null)}
          onSaved={row => { put(row); setForm(null) }}
          change={change}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null) }}>
        <DialogContent className="bg-popover">
          <DialogHeader>
            <DialogTitle>Delete this upsell?</DialogTitle>
            <DialogDescription>{deleting ? `${deleting.service_name} for ${deleting.client_name}, ${amountWords(deleting)}. It comes off the tracker for everyone and cannot be brought back.` : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button className="h-11 rounded-full px-5" disabled={!!busyId} onClick={() => deleting && void remove(deleting)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Log a new upsell, or change one: the client, the service off the price list, the amount, where it is up to. */
function UpsellForm({ row, me, clients, people, onClose, onSaved, change }: {
  row: Upsell | null
  me: Me
  clients: Named[]
  people: Named[]
  onClose: () => void
  onSaved: (row: Upsell) => void
  change: (row: Upsell, patch: Record<string, unknown>, done?: string) => Promise<boolean>
}) {
  const [clientId, setClientId] = useState(row?.client_id ?? '')
  const [serviceKey, setServiceKey] = useState(row ? (row.service_key ?? 'other') : '')
  const [otherName, setOtherName] = useState(row && !row.service_key ? row.service_name : '')
  const [otherBilling, setOtherBilling] = useState<'one_off' | 'monthly'>(row && !row.service_key ? row.billing : 'one_off')
  const [amount, setAmount] = useState(row ? String(row.amount) : '')
  const [stage, setStage] = useState<UpsellStage>(row?.stage ?? 'logged')
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [pitchedBy, setPitchedBy] = useState(row?.pitched_by ?? me.id)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const item = priceItem(serviceKey)
  const typed = Number(amount.replace(/[$,\s]/g, ''))
  const check = item && Number.isFinite(typed) && typed > 0 ? priceCheck(item, typed) : 'ok'
  const monthly = item ? item.billing === 'monthly' : otherBilling === 'monthly'

  const save = async () => {
    setProblem(null)
    const service = serviceKey === 'other' ? { service_key: 'other', service_name: otherName, billing: otherBilling } : { service_key: serviceKey }
    if (!row && !clientId) { setProblem('Choose the client'); return }
    if (!serviceKey || (serviceKey === 'other' && !otherName.trim())) { setProblem('Choose the service'); return }
    if (!(typed > 0)) { setProblem('Enter the amount, in dollars'); return }
    setBusy(true)
    try {
      if (row) {
        if (await change(row, { ...service, amount: typed, notes, stage }, 'Saved')) onClose()
        return
      }
      const res = await fetch('/api/upsells', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, ...service, amount: typed, notes, stage, ...(pitchedBy !== me.id ? { pitched_by: pitchedBy } : {}) }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(json?.error ?? 'That did not save'); return }
      toast.success('Logged')
      onSaved(json.row as Upsell)
    } catch {
      setProblem('That did not save — check the connection and try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-popover sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{row ? 'Change this upsell' : 'Log an upsell'}</DialogTitle>
          <DialogDescription>Log it before you pitch it. Check the client’s signed agreement first: work already in scope does not count.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Client</span>
            {row ? <p className="text-[14px]">{row.client_name}</p> : (
              <select className={FIELD} value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">Choose a client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Service</span>
            <select className={FIELD} value={serviceKey} onChange={e => setServiceKey(e.target.value)}>
              <option value="">Choose from the price list…</option>
              {CATEGORIES.map(cat => (
                <optgroup key={cat} label={cat}>
                  {PRICE_LIST.filter(p => p.category === cat).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
                </optgroup>
              ))}
              <option value="other">Something not on the list…</option>
            </select>
          </label>
          {item && (
            <p className="-mt-2 text-[13px] text-muted-foreground" data-price-range>
              List price {money(item.low)} – {money(item.high)} {item.unit}, ex GST. The low end is the approved starting point.
            </p>
          )}
          {serviceKey === 'other' && (
            <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>What is it</span>
                <Input className="h-11" value={otherName} maxLength={140} onChange={e => setOtherName(e.target.value)} placeholder="In a few words" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Billed</span>
                <select className={FIELD} value={otherBilling} onChange={e => setOtherBilling(e.target.value as 'one_off' | 'monthly')}>
                  <option value="one_off">Once</option>
                  <option value="monthly">Every month</option>
                </select>
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className={LABEL}>{monthly ? 'Added monthly fee, ex GST' : 'Amount, ex GST'}</span>
            <Input className="h-11" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={item ? String(item.low) : 'Dollars'} />
          </label>
          {check === 'below' && (
            <p className="-mt-2 rounded-inner border border-accent-amber/50 bg-tint-amber px-3 py-2 text-[13px]" role="status">
              That is under the list price. No discounts without Divina’s sign-off, and commission is not paid on margin already cut.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Where it is up to</span>
              <select className={FIELD} value={stage} onChange={e => setStage(e.target.value as UpsellStage)}>
                {UPSELL_STAGES.map(s => <option key={s} value={s}>{STAGE_WORDS[s]}</option>)}
              </select>
            </label>
            {!row && me.mayLogForOthers && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Whose upsell</span>
                <select className={FIELD} value={pitchedBy} onChange={e => setPitchedBy(e.target.value)}>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === me.id ? ' (you)' : ''}</option>)}
                </select>
              </label>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Notes</span>
            <textarea className="min-h-[84px] w-full rounded-inner border border-border bg-surface p-3 text-[14px] outline-none focus:border-foreground" maxLength={1000}
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="Who approved the price, what the client said" />
          </label>

          {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px] font-medium">{problem}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 rounded-full px-4" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button className="h-11 rounded-full px-5 font-semibold" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : row ? 'Save' : 'Log it'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
