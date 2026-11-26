'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Copy, MoreHorizontal, Pencil, Plus, Trash2, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import PageTitle from '../../ui/PageTitle'
import Chip from '../../ui/Chip'
import EmptyState from '../../EmptyState'
import {
  CAMPAIGN_STATUSES, STAGE_LABEL, clientSees, dayWords, followerWords, fromMelbourneInput, melbourneInput, seatCount, seatWords, teamMoves,
  type Campaign, type CampaignCreator, type CampaignStatus, type CreatorStage,
} from '../../../lib/creator-campaign-core'
import CreatorDialog from '../CreatorDialog'
import Pick from '../Pick'
import { AREA, FIELD, LABEL, STAGE_HELP, STAGE_ORDER, STAGE_TONE, STATUS_TONE, STATUS_WORDS, moveWords, whenWords } from '../stageWords'

/**
 * ONE CREATOR CAMPAIGN — Details · Creators · Client view. The routes decide who may open this and who may change
 * it (`may.edit`); a person added to a campaign who is not a manager looks and changes nothing. Every change carries
 * the version it was made on, so two people working at once never overwrite each other: the later one is shown the
 * campaign as it now stands.
 */

type Person = { id: string; name: string; role: string }
type Loaded = { campaign: Campaign; creators: CampaignCreator[]; client_name: string; portal_token: string | null; may: { edit: boolean; remove: boolean }; people: Person[] }
type Tab = 'creators' | 'details' | 'client'

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [data, setData] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('creators')
  const [dialog, setDialog] = useState<{ row: CampaignCreator | null } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/creators/${id}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(res.status === 404 ? 'That campaign is not here, or it is not one of yours.' : json?.error ?? 'The campaign could not be loaded'); return }
      setProblem(null); setData(json as Loaded)
    } catch {
      setProblem('The campaign could not be loaded. Check the connection and reload.')
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  const putCreator = (row: CampaignCreator) => setData(d => (d ? { ...d, creators: d.creators.some(c => c.id === row.id) ? d.creators.map(c => (c.id === row.id ? row : c)) : [...d.creators, row] } : d))
  const putCampaign = (campaign: Campaign) => setData(d => (d ? { ...d, campaign } : d))

  /** Change the campaign itself. A refusal is said; a campaign somebody else changed is replaced with how it stands. */
  const change = async (patch: Record<string, unknown>, done?: string): Promise<boolean> => {
    if (!data) return false
    setBusyId('campaign')
    try {
      const res = await fetch(`/api/creators/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expect_rev: data.campaign.rev, ...patch }) })
      const json = await res.json().catch(() => ({}))
      if (json?.campaign) putCampaign(json.campaign as Campaign)
      if (json?.fresh) putCampaign(json.fresh as Campaign)
      if (!res.ok) { toast.error(json?.error ?? 'That did not save'); return false }
      if (done) toast.success(done)
      return true
    } catch {
      toast.error('That did not save. Check the connection and try again.'); return false
    } finally {
      setBusyId(null)
    }
  }

  const move = async (row: CampaignCreator, to: CreatorStage) => {
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/creators/${id}/creators/${row.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, expect_rev: row.rev }) })
      const json = await res.json().catch(() => ({}))
      if (json?.creator) putCreator(json.creator as CampaignCreator)
      if (json?.fresh) putCreator(json.fresh as CampaignCreator)
      if (!res.ok) { toast.error(json?.error ?? 'That did not save'); return }
      toast.success(`${row.name}: ${STAGE_LABEL[to].toLowerCase()}`)
    } catch {
      toast.error('That did not save. Check the connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  const takeOff = async (row: CampaignCreator) => {
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/creators/${id}/creators/${row.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json?.error ?? 'They could not be taken off'); return }
      setData(d => (d ? { ...d, creators: d.creators.filter(c => c.id !== row.id) } : d))
      toast.success(`${row.name} taken off`)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    setBusyId('campaign')
    try {
      const res = await fetch(`/api/creators/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(json?.error ?? 'It could not be deleted'); return }
      toast.success('Campaign deleted')
      router.push('/dashboard/creators')
    } finally {
      setBusyId(null); setDeleting(false)
    }
  }

  const back = (
    <Link href="/dashboard/creators" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden /> All campaigns
    </Link>
  )
  if (problem) return <div>{back}<PageTitle title="Creator campaign" /><p role="alert" className="rounded-card border border-border bg-surface p-5 text-[14px]">{problem}</p></div>
  if (!data) return <div>{back}<PageTitle title="Creator campaign" /><Skeleton className="h-[220px] rounded-card" /></div>

  const { campaign, creators, may } = data
  const counts = seatCount(campaign, creators)
  const clientCanSee = campaign.status !== 'draft' && campaign.client_visible

  return (
    <div className="flex flex-col gap-4" data-creator-campaign>
      {back}
      <PageTitle
        title={campaign.title}
        summary={[data.client_name, whenWords(campaign.starts_at), campaign.place].filter(Boolean).join(' · ')}
        actions={may.edit && tab === 'creators' ? (
          <Button className="h-11 rounded-full px-5 text-[14px] font-semibold" onClick={() => setDialog({ row: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Add a creator
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={STATUS_TONE[campaign.status]}>{STATUS_WORDS[campaign.status]}</Chip>
        <Chip tone="surface">{seatWords(counts)}</Chip>
        {counts.waiting > 0 && <Chip tone="blue">{counts.waiting} invited, waiting</Chip>}
        {counts.open !== null && counts.open > 0 && <Chip tone="muted">{counts.open} {counts.open === 1 ? 'seat' : 'seats'} open</Chip>}
        {counts.over && <Chip tone="red">More confirmed than seats</Chip>}
        <Chip tone={clientCanSee ? 'green' : 'muted'}>{clientCanSee ? 'The client can see this' : 'Hidden from the client'}</Chip>
        {!may.edit && <Chip tone="muted">You can look, not change</Chip>}
      </div>

      <div role="tablist" aria-label="Parts of this campaign" className="flex gap-1 overflow-x-auto border-b border-border">
        {([['creators', `Creators (${creators.length})`], ['details', 'Details'], ['client', 'Client view']] as const).map(([key, label]) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-[14px] font-semibold ${tab === key ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'creators' && (
        <CreatorsTab creators={creators} mayEdit={may.edit} clientCanSee={clientCanSee} busyId={busyId}
          onAdd={() => setDialog({ row: null })} onEdit={row => setDialog({ row })} onMove={move} onTakeOff={takeOff} />
      )}
      {tab === 'details' && (
        <DetailsTab key={campaign.rev} campaign={campaign} clientName={data.client_name} people={data.people} mayEdit={may.edit} mayRemove={may.remove}
          busy={busyId === 'campaign'} onSave={change} onDelete={() => setDeleting(true)} />
      )}
      {tab === 'client' && (
        <ClientTab campaign={campaign} creators={creators} token={data.portal_token} mayEdit={may.edit} busy={busyId === 'campaign'} onChange={change} />
      )}

      {dialog && (
        <CreatorDialog campaignId={id} row={dialog.row} onClose={() => setDialog(null)}
          onSaved={row => { putCreator(row); setDialog(null) }} onStale={putCreator} />
      )}

      <Dialog open={deleting} onOpenChange={open => { if (!open) setDeleting(false) }}>
        <DialogContent className="bg-popover">
          <DialogHeader>
            <DialogTitle>Delete this campaign?</DialogTitle>
            <DialogDescription>{`${campaign.title} and its ${creators.length} ${creators.length === 1 ? 'creator' : 'creators'} come off for everyone, the client included. It cannot be brought back. The creators stay in your list for next time.`}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => setDeleting(false)}>Keep it</Button>
            <Button className="h-11 rounded-full px-5" disabled={!!busyId} onClick={() => void remove()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ── Creators ───────────────────────────────────────────────────────────── */

function CreatorsTab({ creators, mayEdit, clientCanSee, busyId, onAdd, onEdit, onMove, onTakeOff }: {
  creators: CampaignCreator[]; mayEdit: boolean; clientCanSee: boolean; busyId: string | null
  onAdd: () => void; onEdit: (row: CampaignCreator) => void; onMove: (row: CampaignCreator, to: CreatorStage) => void; onTakeOff: (row: CampaignCreator) => void
}) {
  if (creators.length === 0) {
    return <EmptyState icon={UsersRound} title="No creators yet" body="Add the creators you are thinking of. They stay the team’s own ideas until you show them to the client."
      actionLabel={mayEdit ? 'Add a creator' : undefined} onAction={mayEdit ? onAdd : undefined} />
  }
  const waiting = creators.filter(c => c.stage === 'with_client').length
  return (
    <div className="flex flex-col gap-5">
      {waiting > 0 && !clientCanSee && (
        <p role="status" className="rounded-inner border border-accent-amber/50 bg-tint-amber px-3 py-2 text-[13px]">
          {waiting} {waiting === 1 ? 'creator is' : 'creators are'} marked for the client, but the client cannot see this campaign yet. Open it to them on the Client view tab.
        </p>
      )}
      {STAGE_ORDER.map(stage => {
        const rows = creators.filter(c => c.stage === stage)
        if (rows.length === 0) return null
        return (
          <section key={stage} className="flex flex-col gap-2" data-stage={stage}>
            <h2 className="flex flex-wrap items-baseline gap-2 text-[15px] font-semibold">
              {STAGE_LABEL[stage]} <span className="text-[13px] font-normal text-muted-foreground">{rows.length} · {STAGE_HELP[stage]}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {rows.map(row => <CreatorRow key={row.id} row={row} mayEdit={mayEdit} busy={busyId === row.id} onEdit={onEdit} onMove={onMove} onTakeOff={onTakeOff} />)}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function CreatorRow({ row, mayEdit, busy, onEdit, onMove, onTakeOff }: {
  row: CampaignCreator; mayEdit: boolean; busy: boolean
  onEdit: (row: CampaignCreator) => void; onMove: (row: CampaignCreator, to: CreatorStage) => void; onTakeOff: (row: CampaignCreator) => void
}) {
  const [first, ...rest] = teamMoves(row.stage)
  const reach = [
    row.instagram ? `@${row.instagram}${followerWords(row.instagram_followers) ? ` · ${followerWords(row.instagram_followers)}` : ''}` : null,
    row.tiktok ? `TikTok @${row.tiktok}${followerWords(row.tiktok_followers) ? ` · ${followerWords(row.tiktok_followers)}` : ''}` : null,
  ].filter(Boolean).join('   ')
  return (
    <li className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 lg:flex-row lg:items-center" data-creator-row>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {row.photo_url ? <img src={row.photo_url} alt="" className="h-12 w-12 shrink-0 rounded-full border border-border object-cover" />
          : <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[15px] font-semibold">{row.name.slice(0, 1).toUpperCase()}</span>}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{row.name}</span>
            <Chip tone={STAGE_TONE[row.stage]}>{STAGE_LABEL[row.stage]}</Chip>
            <Chip tone="surface">{row.terms === 'paid' ? `Paid${row.rate ? ` · ${row.rate}` : ''}` : 'Gifted'}</Chip>
          </div>
          {reach && <p className="break-words text-[13px] text-muted-foreground">{reach}</p>}
          {row.why && <p className="whitespace-pre-wrap text-[13px]">{row.why}</p>}
          {row.client_note && <p className="text-[13px]"><span className="font-semibold">The client wrote:</span> {row.client_note}</p>}
          {row.samples.length > 0 && (
            <p className="flex flex-wrap gap-x-3 text-[13px]">
              {row.samples.map((s, i) => <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Post {i + 1}</a>)}
            </p>
          )}
        </div>
      </div>
      {mayEdit && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {first && (
            <Button className="h-11 rounded-full px-4 text-[13px] font-semibold" disabled={busy} onClick={() => onMove(row, first)}>{moveWords(row.stage, first)}</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 w-11 rounded-full p-0" aria-label={`More for ${row.name}`} disabled={busy}><MoreHorizontal className="h-4 w-4" aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              {rest.map(to => <DropdownMenuItem key={to} className="min-h-11 text-[14px]" onSelect={() => onMove(row, to)}>{moveWords(row.stage, to)}</DropdownMenuItem>)}
              <DropdownMenuItem className="min-h-11 gap-2 text-[14px]" onSelect={() => onEdit(row)}><Pencil className="h-4 w-4" aria-hidden /> Change details</DropdownMenuItem>
              {row.stage === 'idea' && (
                <DropdownMenuItem className="min-h-11 gap-2 text-[14px] text-accent-red-deep" onSelect={() => onTakeOff(row)}><Trash2 className="h-4 w-4" aria-hidden /> Take off this campaign</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  )
}

/* ── Details ────────────────────────────────────────────────────────────── */

function DetailsTab({ campaign, clientName, people, mayEdit, mayRemove, busy, onSave, onDelete }: {
  campaign: Campaign; clientName: string; people: Person[]; mayEdit: boolean; mayRemove: boolean; busy: boolean
  onSave: (patch: Record<string, unknown>, done?: string) => Promise<boolean>; onDelete: () => void
}) {
  const [title, setTitle] = useState(campaign.title)
  const [kind, setKind] = useState(campaign.kind)
  const [starts, setStarts] = useState(melbourneInput(campaign.starts_at))
  const [place, setPlace] = useState(campaign.place ?? '')
  const [seats, setSeats] = useState(campaign.seats != null ? String(campaign.seats) : '')
  const [closes, setCloses] = useState(campaign.closes_on ?? '')
  const [deliverables, setDeliverables] = useState(campaign.deliverables.join('\n'))
  const [usage, setUsage] = useState(campaign.usage_terms ?? '')
  const [status, setStatus] = useState<CampaignStatus>(campaign.status)
  const [members, setMembers] = useState<string[]>(campaign.member_ids)

  const save = () => {
    if (!title.trim()) { toast.error('Give the campaign a name'); return }
    void onSave({
      title, kind, place: place || null, seats: seats.trim() || null, closes_on: closes || null,
      starts_at: fromMelbourneInput(starts),
      deliverables: deliverables.split('\n').map(d => d.trim()).filter(Boolean), usage_terms: usage || null,
      status, member_ids: members,
    }, 'Saved')
  }
  const off = !mayEdit

  return (
    <div className="flex flex-col gap-4" data-campaign-details>
      {/* FILLS THE PAGE (the owner, 26 Nov 2026: "ui is broken" — this was a 720px strip of bare fields down the left
          of a wide screen, the team list trailing under it): the campaign in one card, who is on it in its own beside */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <section className="flex flex-col gap-3.5 rounded-card border border-border bg-surface p-4 sm:p-5" aria-label="About this campaign">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold">About this campaign</h2>
        <p className="text-[13px] text-muted-foreground">For {clientName}</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Name</span>
        <Input className="h-11" value={title} maxLength={140} disabled={off} onChange={e => setTitle(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className={LABEL}>What it is</span>
          <Pick<Campaign['kind']> label="What it is" value={kind} disabled={off} onChange={setKind}
            options={[{ value: 'event', label: 'An event creators come to' }, { value: 'content', label: 'Content creators make' }]} />
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Status</span>
          <Pick<CampaignStatus> label="Status" value={status} disabled={off} onChange={setStatus}
            options={CAMPAIGN_STATUSES.map(s => ({ value: s, label: `${STATUS_WORDS[s]}${s === 'draft' ? ' (the client sees nothing)' : s === 'closed' ? ' (the client can look, not answer)' : ''}` }))} />
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Date and time (Melbourne time)</span>
          <input type="datetime-local" className={FIELD} value={starts} disabled={off} onChange={e => setStarts(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Place</span>
          <Input className="h-11" value={place} maxLength={200} disabled={off} onChange={e => setPlace(e.target.value)} placeholder="Venue and suburb" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Seats</span>
          <Input className="h-11" inputMode="numeric" value={seats} disabled={off} onChange={e => setSeats(e.target.value)} placeholder="How many creators" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Client answers by</span>
          <input type="date" className={FIELD} value={closes} disabled={off} onChange={e => setCloses(e.target.value)} />
          <span className="text-[12px] text-muted-foreground">After this day the client can look but not answer.</span>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>What each creator delivers</span>
        <textarea className={`${AREA} min-h-[96px]`} value={deliverables} disabled={off} onChange={e => setDeliverables(e.target.value)} placeholder={'One on each line\n3 or more Instagram Stories on the day\n1 recap Reel within 7 days'} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>How the client may use the content</span>
        <Input className="h-11" value={usage} maxLength={600} disabled={off} onChange={e => setUsage(e.target.value)} placeholder="Organic reposts for 12 months, credited" />
      </label>
      </section>

      <fieldset className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface p-4 sm:p-5">
        <legend className="sr-only">Team on this campaign</legend>
        <h2 className="text-[16px] font-semibold" aria-hidden>Team on this campaign{members.length > 0 ? ` (${members.length})` : ''}</h2>
        <p className="text-[13px] text-muted-foreground">The client&rsquo;s own managers and super admins see it already. Tick anyone else who should. Somebody who is not a manager can look, not change, and also needs Creator campaigns opened to them on the Team page.</p>
        <div className="grid max-h-[420px] gap-x-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {people.map(p => (
            <label key={p.id} className="flex min-h-11 items-center gap-2 rounded-inner px-2 text-[14px] hover:bg-foreground/[0.04]">
              <input type="checkbox" className="h-4 w-4 accent-[var(--dbx-blue)]" disabled={off} checked={members.includes(p.id)}
                onChange={e => setMembers(m => (e.target.checked ? [...m, p.id] : m.filter(x => x !== p.id)))} />
              <span>{p.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      </div>

      {mayEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button className="h-11 rounded-full px-5 font-semibold" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save details'}</Button>
          {mayRemove && (
            <Button variant="outline" className="h-11 rounded-full px-4 text-accent-red-deep" disabled={busy} onClick={onDelete}><Trash2 className="h-4 w-4" aria-hidden /> Delete campaign</Button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Client view ────────────────────────────────────────────────────────── */

function ClientTab({ campaign, creators, token, mayEdit, busy, onChange }: {
  campaign: Campaign; creators: CampaignCreator[]; token: string | null; mayEdit: boolean; busy: boolean
  onChange: (patch: Record<string, unknown>, done?: string) => Promise<boolean>
}) {
  const view = useMemo(() => clientSees(campaign, creators), [campaign, creators])
  const link = token && typeof window !== 'undefined' ? `${window.location.origin}/portal/${token}/creators/${campaign.id}` : null
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); toast.success('Link copied') } catch { toast.error('Copy it from the box instead') }
  }
  const names = (rows: CampaignCreator[]) => rows.length === 0 ? 'Nobody yet' : rows.map(r => r.name).join(', ')

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3" data-campaign-client-view>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <p className="text-[15px] font-semibold">{view ? 'The client can see this campaign' : 'The client cannot see this campaign'}</p>
        <p className="text-[13px] text-muted-foreground">
          {campaign.status === 'draft' ? 'It is a draft. Make it live and show it, and the client sees the creators you marked for them.'
            : campaign.client_visible ? (campaign.status === 'closed' ? 'It is closed: the client can look, not answer.' : 'They see only the creators you showed them, never an idea.')
              : 'It is live but hidden. Show it when you are ready.'}
        </p>
        {mayEdit && (
          <div className="flex flex-wrap gap-2 pt-1">
            {campaign.status === 'draft' && (
              <Button className="h-11 rounded-full px-5 font-semibold" disabled={busy} onClick={() => void onChange({ status: 'live', client_visible: true }, 'Live. The client can see it')}>Make it live and show the client</Button>
            )}
            {campaign.status !== 'draft' && !campaign.client_visible && (
              <Button className="h-11 rounded-full px-5 font-semibold" disabled={busy} onClick={() => void onChange({ client_visible: true }, 'The client can see it')}>Show to the client</Button>
            )}
            {campaign.status !== 'draft' && campaign.client_visible && (
              <Button variant="outline" className="h-11 rounded-full px-4" disabled={busy} onClick={() => void onChange({ client_visible: false }, 'Hidden from the client')}>Hide from the client</Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <p className="text-[15px] font-semibold">The client&rsquo;s link</p>
        {link ? (
          <>
            <p className="text-[13px] text-muted-foreground">It is inside the portal link the client already has. Anyone with this link sees the client&rsquo;s portal, so send it only to the client.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly className="h-11 flex-1 text-[13px]" value={link} onFocus={e => e.currentTarget.select()} aria-label="The client's link to this campaign" />
              <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => void copy()}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
            </div>
          </>
        ) : <p className="text-[13px] text-muted-foreground">This client has no portal link yet. Make one on the client&rsquo;s page first.</p>}
      </div>

      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <p className="text-[15px] font-semibold">What the client is shown</p>
        {view ? (
          <dl className="flex flex-col gap-2 text-[14px]">
            <div><dt className={LABEL}>To choose from ({view.shortlist.length})</dt><dd>{names(view.shortlist)}</dd></div>
            <div><dt className={LABEL}>Said yes to ({view.confirmed.length})</dt><dd>{names(view.confirmed)}</dd></div>
            <div><dt className={LABEL}>Passed on ({view.passed.length})</dt><dd>{names(view.passed)}</dd></div>
            {campaign.closes_on && <div><dt className={LABEL}>Answers by</dt><dd>{dayWords(campaign.closes_on)}</dd></div>}
          </dl>
        ) : <p className="text-[13px] text-muted-foreground">Nothing yet.</p>}
      </div>
    </div>
  )
}
