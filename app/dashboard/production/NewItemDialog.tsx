'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRole } from '../useRole'
import { toastOpen } from '../toastLink'
import HelpHint from '../HelpHint'
import type { TeamMember } from './workHooks'

export type ClientRow = { id: string; name: string }
export type Batch = {
  id: string; title: string; client_id: string; shoot_date?: string | null
  status?: 'brief' | 'locked' | 'shot' | 'wrapped'
  clients?: { name: string } | null
  content_items?: { count: number }[]
}

/** Job titles as people say them. */
const ROLE_WORD: Record<string, string> = {
  super_admin: 'super admin',
  account_manager: 'account manager',
  scheduler: 'scheduler',
  editor: 'editor',
}

type WorkKind = { id: string; slug: string; name: string; default_roles: string[] }

// One shoot, one card: a client, the shoot it belongs to (or a new one), a
// title, what needs doing, and the link to the plan. No quantities, no format
// rows, no files — the work that comes out of the shoot is added later as
// ordinary cards pointed at it.
const BLANK = {
  client_id: '', batch_id: '', title: '', priority: 'normal', due_date: '',
  owner_id: '', brief: '', brief_url: '',
}

/**
 * "New shoot plan" — the one form the Production page opens for a shoot.
 *
 * This file used to be the dialog for everything (a regular card, a task, a
 * shoot plan) with three forms folded into one component. Only the shoot
 * plan was ever opened from here — a card is made with `NewCardDialog` on
 * the board — so the other two forms are gone, and what is left is the plan.
 * The page says what it already knows (`preset`); the dialog owns the rest.
 */
export default function NewShootPlanDialog({
  open, onOpenChange, onCreated, preset, clients, batches, briefedBatchIds, team: teamProp,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** the rows the server actually created — the caller may need to widen a
   *  filter so the person can see what they just made */
  onCreated: (created?: { id: string; owner_id?: string | null }[]) => void
  preset?: { client_id?: string; batch_id?: string }
  clients: ClientRow[]
  batches: Batch[]
  /** shoots that already have a shoot plan — they cannot take a second one */
  briefedBatchIds?: string[]
  /** the assignable members the PAGE already fetched (useTeamMembers) — pass
   *  it so the dialog does not ask `/api/team` a second time */
  team?: TeamMember[]
}) {
  const router = useRouter()
  const [newBusy, setNewBusy] = useState(false)
  const [draft, setDraft] = useState({ ...BLANK })

  // managers assign the plan to somebody at creation; that person gets the
  // job-pack email (what needs doing + the target date)
  const { can } = useRole()
  const isManager = can('account_manager')
  // the page usually hands the team in (it fetched `/api/team` already); the
  // fetch below is only the fallback for a caller that has none — and it
  // never fires while the dialog is closed
  const [fetchedTeam, setFetchedTeam] = useState<TeamMember[]>([])
  const team = teamProp ?? fetchedTeam
  const teamFetchedRef = useRef(false)
  useEffect(() => {
    if (!open || !isManager || teamProp || teamFetchedRef.current) return
    teamFetchedRef.current = true
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then(json => setFetchedTeam(
        (json.members ?? [])
          // anyone on the team can carry a plan — clients never
          .filter((m: { role: string; active_status?: boolean }) => m.role !== 'client' && m.active_status !== false)
          .map((m: TeamMember) => ({ id: m.id, name: m.name, email: m.email, role: m.role })),
      ))
      .catch(() => setFetchedTeam([]))
  }, [open, isManager, teamProp])

  // A SHOOT PLAN can be for any active client, not only the ones this person
  // runs: planning a shoot is precisely how work for a NEW client begins, and
  // that client is, by definition, not yet on anybody's roster. The page's
  // scoped list is the fallback when the registry call fails — a picker with
  // the roster in it beats a picker with nothing in it. Fetched once, on
  // first open.
  const [allClients, setAllClients] = useState<(ClientRow & { status?: string })[]>([])
  const allClientsFetchedRef = useRef(false)
  useEffect(() => {
    if (!open || allClientsFetchedRef.current) return
    allClientsFetchedRef.current = true
    fetch('/api/website/clients')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: (ClientRow & { status?: string })[]) => setAllClients(
        (Array.isArray(rows) ? rows : []).filter(c => (c.status ?? 'active') === 'active'),
      ))
      .catch(() => setAllClients([]))
  }, [open])

  // the shoot-plan kind is what makes the server treat this card as a plan
  // (it rides the item pipeline under the `shoot_brief` kind). Loaded on
  // first open, never on a page that merely renders the closed dialog.
  const [kinds, setKinds] = useState<WorkKind[]>([])
  const kindsFetchedRef = useRef(false)
  useEffect(() => {
    if (!open || kindsFetchedRef.current) return
    kindsFetchedRef.current = true
    fetch('/api/production/work-kinds?active=1')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setKinds(j?.kinds ?? []))
      .catch(() => {})
  }, [open])
  const briefKind = kinds.find(k => k.slug === 'shoot_brief') ?? null

  // What the caller already knows, folded in when the dialog opens. The two
  // fields are read out as primitives on purpose: an inline `preset={{…}}`
  // object is a new identity every render, and depending on it would loop.
  const presetClient = preset?.client_id
  const presetBatch = preset?.batch_id
  useEffect(() => {
    if (!open || (!presetClient && !presetBatch)) return
    setDraft(d => ({
      ...d,
      client_id: presetClient ?? d.client_id,
      batch_id: presetBatch ?? d.batch_id,
    }))
  }, [open, presetClient, presetBatch])

  // the shoots a plan may attach to: this client's, not finished, and not
  // already carrying one (the DB has a one-plan-per-shoot unique index)
  const briefableShoots = batches.filter(b =>
    (!draft.client_id || b.client_id === draft.client_id)
    && (b.status ?? 'brief') !== 'wrapped'
    && !(briefedBatchIds ?? []).includes(b.id))

  const createPlan = async () => {
    if (!draft.client_id || !draft.title.trim()) return toast.error('Client and title are required')
    if (!briefKind) return toast.error('Still loading — try again in a moment')
    setNewBusy(true)
    try {
      // ONE card, one request
      const payload = [{
        client_id: draft.client_id,
        // an explicitly chosen shoot, or null to create one with the plan
        batch_id: draft.batch_id || null,
        title: draft.title.trim(),
        priority: draft.priority,
        due_date: draft.due_date || null,
        ...(draft.owner_id ? { owner_id: draft.owner_id } : {}),
        work_kind_id: briefKind.id,
        brief_url: draft.brief_url.trim() || null,
        brief: draft.brief.trim() || null,
        // a plan always goes to the client
        client_approval_required: true,
      }]
      const res = await fetch('/api/production/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      })
      const created = await res.json().catch(() => null)
      if (!res.ok) throw new Error(created?.error ?? 'Create failed')
      // the server answers 207 when a write in the body did not land; with
      // one card that means "not saved", and it is said as such
      const partial = res.status === 207 && created && !Array.isArray(created)
      const rows = (Array.isArray(created)
        ? created
        : partial
          ? (created.created ?? [])
          : []) as { id: string; owner_id?: string | null; batch_id?: string | null }[]
      const failed = (partial ? created.failed ?? [] : []) as { title: string }[]
      // where it went, and a way to go there: the plan lives on its shoot's
      // page, so that is where the toast opens
      const first = rows[0]
      const href = first?.batch_id
        ? `/dashboard/production/shoots/${first.batch_id}`
        : first?.id ? `/dashboard/production/${first.id}` : '/dashboard/production'
      if (failed.length > 0) {
        toast.error('The shoot plan could not be saved. Try again.', { duration: 12_000 })
      } else {
        toastOpen('Shoot plan created — it is on the Production board', href, router.push)
      }
      onOpenChange(false)
      setDraft({ ...BLANK })
      onCreated(rows.length > 0 ? rows : undefined)
    } catch (e) {
      // "Failed to fetch" is the RESPONSE dying, not the request — the server
      // may well have created it. Check before inviting a retry that would
      // make a second shoot.
      if (e instanceof TypeError) {
        toast.message('Network hiccup — checking whether it was created…')
        onCreated()
        toast.message('Board refreshed. If your shoot plan is there, do NOT create it again.')
      } else {
        toast.error(e instanceof Error ? e.message : 'Create failed')
      }
    } finally {
      setNewBusy(false)
    }
  }

  /** What still stops Create, in one line under the button. */
  const missing: string | null = !draft.client_id ? 'Choose a client first.'
    : !draft.title.trim() ? 'Give it a title.'
    : null

  return (
    <Dialog open={open} onOpenChange={o => { if (newBusy) return; onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New shoot plan <HelpHint term="shoot_plan" /></DialogTitle>
          <DialogDescription className="text-secondary-13">
            One shoot, one card. * required
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Client *</Label>
            <Select value={draft.client_id} onValueChange={v => v && setDraft(d => ({ ...d, client_id: v, batch_id: '' }))}>
              <SelectTrigger><SelectValue placeholder="Choose client" /></SelectTrigger>
              <SelectContent>
                {(allClients.length > 0 ? allClients : clients).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground">Any client, not only the ones you run.</p>
          </div>
          {/* a plan belongs to a shoot. Without this picker "New shoot plan"
              silently created a SECOND shoot beside the one already there. */}
          <div className="grid gap-1.5">
            <Label>Which shoot? <HelpHint term="shoot" /></Label>
            <Select value={draft.batch_id || 'new'}
              onValueChange={v => setDraft(d => ({ ...d, batch_id: v === 'new' ? '' : v ?? '' }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">…or start a new shoot</SelectItem>
                {briefableShoots.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground">
              {!draft.client_id
                ? 'Choose a client to see their shoots.'
                : briefableShoots.length === 0
                  ? 'A new shoot is created with it.'
                  : draft.batch_id
                    ? 'Attaches to that shoot.'
                    : 'A new shoot is created with it.'}
            </p>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Title *</Label>
            <Input value={draft.title} placeholder="e.g. October clinic day" onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
          </div>
          {/* the requirement, right under the title. Stored as `brief`, and
              it goes to whoever is assigned. */}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>What needs doing</Label>
            <Textarea rows={3} value={draft.brief}
              placeholder="Going with the garden concept — see the moodboard for tone…"
              onChange={e => setDraft(d => ({ ...d, brief: e.target.value }))} />
            <p className="text-[12px] text-muted-foreground">What the person making this needs to know — it goes to them.</p>
          </div>
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <Select value={draft.priority} onValueChange={v => v && setDraft(d => ({ ...d, priority: v }))}>
              <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['low', 'normal', 'high', 'urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Target shoot date</Label>
            <Input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))} className="font-mono" />
            {/* the picker's order follows the browser's locale — echo the
                date back in words so 09/15 is seen as 15 September */}
            {draft.due_date && (
              <p className="text-[12px] text-muted-foreground">
                {new Date(`${draft.due_date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>
          {isManager && (
            <div className="grid gap-1.5">
              <Label>Who&rsquo;s doing this?</Label>
              <Select value={draft.owner_id || 'none'} onValueChange={v => setDraft(d => ({ ...d, owner_id: v === 'none' ? '' : v ?? '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody yet — anyone can pick it up</SelectItem>
                  {(() => {
                    const suggested = briefKind ? team.filter(m => briefKind.default_roles.includes(m.role)) : []
                    const ids = new Set(suggested.map(m => m.id))
                    const rest = team.filter(m => !ids.has(m.id))
                    return (
                      <>
                        {suggested.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Usually plans shoots</SelectLabel>
                            {suggested.map(m => (
                              <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {rest.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name || m.email} · {ROLE_WORD[m.role] ?? m.role}
                          </SelectItem>
                        ))}
                      </>
                    )
                  })()}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Plan link <span className="text-secondary-13 font-normal text-muted-foreground">(Milanote or anywhere)</span></Label>
            <Input value={draft.brief_url} placeholder="https://app.milanote.com/…"
              onChange={e => setDraft(d => ({ ...d, brief_url: e.target.value }))} className="font-mono text-secondary-13" />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 rounded-full border-border bg-surface px-5 text-[14px] font-semibold" onClick={() => onOpenChange(false)} disabled={newBusy}>Cancel</Button>
          <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90" onClick={createPlan} disabled={newBusy || missing !== null}>
            {newBusy ? 'Creating…' : 'Create the shoot plan'}
          </Button>
        </DialogFooter>
        {/* the reason the button is grey, said where the person is looking —
            not as a toast after the form is filled in */}
        {missing && (
          <p className="-mt-2 text-right text-secondary-13 text-accent-amber">{missing}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
