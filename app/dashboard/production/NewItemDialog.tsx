'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Plus } from 'lucide-react'
import { KIND_COLORS } from '../../lib/work-kinds-core'
import { plannedSummary, plannedTarget } from '../../lib/deliverable-group-core'
import { DRAFTING_LANE } from '../../lib/section-names'
import { useRole } from '../useRole'
import { useIsMobile } from '../useIsMobile'
import { toastOpen } from '../toastLink'
import HelpHint from '../HelpHint'
import { completedIn, uploadFiles } from '../uploadQueue'
import type { TeamMember } from './workHooks'
import { UploadOverall, UploadRows, useUploadGroup } from '../UploadRows'
import ExportWarnings, {
  exportWarningsFor, type ExportWarning,
} from '../../components/media/ExportWarnings'

export type ClientRow = { id: string; name: string }
export type Batch = {
  id: string; title: string; client_id: string; shoot_date?: string | null
  status?: 'brief' | 'locked' | 'shot' | 'wrapped'
  clients?: { name: string } | null
  content_items?: { count: number }[]
}

const CONTENT_TYPES = ['reel', 'carousel', 'story', 'static', 'video', 'other']

/** Job titles as people say them. */
const ROLE_WORD: Record<string, string> = {
  super_admin: 'super admin',
  account_manager: 'account manager',
  scheduler: 'scheduler',
  editor: 'editor',
}

const BLANK = {
  client_id: '', batch_id: '', title: '', content_type: 'reel', priority: 'normal', due_date: '', count: 1,
  owner_id: '', work_kind_id: '', raw_assets_url: '', brief: '', brief_url: '',
  deliverables: [] as { type: string; qty: number }[],
  // one deliverable card can hold a MIX of formats — 2 reels + 2 carousels +
  // 2 videos. One row {reel,1} is the plain single-item default.
  formats: [{ type: 'reel', qty: 1 }] as { type: string; qty: number }[],
  raw_assets: [] as { url: string; name: string }[],
}

/**
 * "New work" — the one dialog every work page opens.
 *
 * It used to live inside the production board, which meant the Editor and
 * Scheduler pages could not create anything without copying 200 lines of it.
 * The page says WHICH kind of thing is being made (`presetKind`) and what it
 * already knows (`preset`); the dialog owns everything else — the AI work-kind
 * hint, the uploads, the manager-only fields.
 */
export default function NewItemDialog({
  open, onOpenChange, onCreated, presetKind, preset, clients, batches, briefedBatchIds, team: teamProp,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** the rows the server actually created — the caller may need to widen a
   *  filter so the person can see what they just made */
  onCreated: (created?: { id: string; owner_id?: string | null }[]) => void
  presetKind?: 'shoot_brief' | 'task'
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
  const assetFileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // a phone gets the form in two screens — the details, then the files —
  // because thirteen fields and a drop zone on one 390px screen is a scroll
  // with the Create button somewhere past the bottom of it
  const mobile = useIsMobile()
  const [step, setStep] = useState<'details' | 'files'>('details')
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetWarnings, setAssetWarnings] = useState<ExportWarning[]>([])
  /** the batch of file rows this Files box is showing, if any */
  const [assetGroup, setAssetGroup] = useState<string | null>(null)
  const assetUploads = useUploadGroup(assetGroup)
  // AI work-kind suggestion: fires ~1s after the title/brief stops changing;
  // only a hint — applying it is always the human's click
  const [kindHint, setKindHint] = useState<
    { match: 'existing'; kind_id: string; name: string } | { match: 'new'; name: string; color: string } | null
  >(null)
  const kindTouchedRef = useRef(false)
  // making a task type on the spot: null = the dropdown as usual, a string =
  // the name field is open. A type is data, and the dialog is where the gap
  // in the data is noticed.
  const [newKindName, setNewKindName] = useState<string | null>(null)
  const [newKindBusy, setNewKindBusy] = useState(false)
  const onAssetFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const chosen = Array.from(files)
    setAssetBusy(true)
    // a header read on the chooser's own machine: says which of these will
    // not preview in a browser, without standing in the way of any of them
    void exportWarningsFor(chosen).then(setAssetWarnings)
    // straight to R2, same as deliverables — the API body cap never sees them.
    // Through the shared queue rather than a bare loop: four at a time instead
    // of one, and every file gets a bar, a speed, a cancel and a retry
    // instead of the word "Uploading…" over the whole batch.
    const { group, done } = uploadFiles(chosen)
    setAssetGroup(group)
    try {
      await done
    } catch (e) {
      // the rows say which file and why, and offer it back — a toast repeating
      // it would be the only part of the failure that cannot be acted on
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setAssetBusy(false)
      if (assetFileRef.current) assetFileRef.current.value = ''
    }
  }

  /**
   * Files that landed become part of the draft.
   *
   * Driven by the store rather than by the upload call's return value, so a
   * file that failed and was then RETRIED is added too. Taking the list from
   * the batch promise alone would leave Retry showing a green tick on a file
   * the item was then created without — a quieter lie than the one this
   * replaced, and a harder one to notice.
   */
  useEffect(() => {
    const landed = assetGroup ? completedIn(assetGroup) : []
    if (landed.length === 0) return
    setDraft(d => {
      const have = new Set(d.raw_assets.map(a => a.url))
      const add = landed.filter(l => !have.has(l.url))
      return add.length === 0 ? d : { ...d, raw_assets: [...d.raw_assets, ...add] }
    })
  }, [assetUploads, assetGroup])
  useEffect(() => {
    if (!open || kindTouchedRef.current) return
    const title = draft.title.trim()
    const brief = draft.brief.trim()
    if (title.length < 4 && brief.length < 12) { setKindHint(null); return }
    const t = window.setTimeout(() => {
      void fetch('/api/production/work-kinds/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, brief }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(j => setKindHint(j?.suggestion ?? null))
        .catch(() => setKindHint(null))
    }, 900)
    return () => window.clearTimeout(t)
  }, [open, draft.title, draft.brief])

  // managers assign the job to an editor at creation; the editor gets the
  // job-pack email (brief + raw assets + due date)
  const { can } = useRole()
  const isManager = can('account_manager')
  // the page usually hands the team in (it fetched `/api/team` already); the
  // fetch below is only the fallback for a caller that has none — and it
  // never fires while the dialog is closed
  const [fetchedTeam, setFetchedTeam] = useState<TeamMember[]>([])
  const team = teamProp ?? fetchedTeam
  const [kinds, setKinds] = useState<{ id: string; slug: string; name: string; color: string; uses_media: boolean; default_roles: string[]; active: boolean }[]>([])
  const teamFetchedRef = useRef(false)
  useEffect(() => {
    if (!open || !isManager || teamProp || teamFetchedRef.current) return
    teamFetchedRef.current = true
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then(json => setFetchedTeam(
        (json.members ?? [])
          // anyone on the team can carry a task — clients never
          .filter((m: { role: string; active_status?: boolean }) => m.role !== 'client' && m.active_status !== false)
          .map((m: TeamMember) => ({ id: m.id, name: m.name, email: m.email, role: m.role })),
      ))
      .catch(() => setFetchedTeam([]))
  }, [open, isManager, teamProp])
  // A TASK is internal work, not client-confidential: the dropdown offers
  // EVERY active client, not just the ones this person is rostered on — the
  // owner's rule ("any team member, any client").
  //
  // A SHOOT PLAN is the same, and used not to be. The page passes the list it
  // built from `/api/website/clients?scope=mine`, which for an account manager
  // is their `team_user_clients` roster plus whatever they already hold. But
  // planning a shoot is precisely how work for a NEW client begins — and that
  // client is, by definition, not yet on anybody's roster, so the one role
  // allowed to create a plan could not find them in the picker. Nothing was
  // forbidding it: `canCreateItemsUnder` asks for the account_manager role and
  // nothing about which client. The permission was there; the list was not.
  //
  // Ordinary items keep the scoped list — those attach to work that already
  // exists, so the client is already on it. Fetched once, on first open.
  const wantsEveryClient = presetKind === 'task' || presetKind === 'shoot_brief'
  const [allClients, setAllClients] = useState<(ClientRow & { status?: string })[]>([])
  const allClientsFetchedRef = useRef(false)
  useEffect(() => {
    if (!open || !wantsEveryClient || allClientsFetchedRef.current) return
    allClientsFetchedRef.current = true
    fetch('/api/website/clients')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: (ClientRow & { status?: string })[]) => setAllClients(
        (Array.isArray(rows) ? rows : []).filter(c => (c.status ?? 'active') === 'active'),
      ))
      .catch(() => setAllClients([]))
  }, [open, wantsEveryClient])
  const kindsFetchedRef = useRef(false)
  useEffect(() => {
    // the kinds shape the form, so they load on first open — not on a page
    // that merely renders the (closed) dialog
    if (!open || kindsFetchedRef.current) return
    kindsFetchedRef.current = true
    fetch('/api/production/work-kinds?active=1')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setKinds(j?.kinds ?? []))
      .catch(() => {})
  }, [open])

  /** Mint a task type from here and select it. Tasks have nothing to post, so
   *  the new kind uses no media — that is what keeps it off the Scheduler and
   *  out of the client's agreement. AM-gated, exactly like the API. */
  const createKind = async () => {
    const name = (newKindName ?? '').trim()
    if (!name || newKindBusy) return
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
    if (!slug) { toast.error('Give the type a name with some letters in it'); return }
    setNewKindBusy(true)
    try {
      const res = await fetch('/api/production/work-kinds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug, name, default_roles: [], uses_media: false,
          // a colour per type so the board stays readable; cycles the palette
          color: KIND_COLORS[kinds.length % KIND_COLORS.length],
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) { toast.error(j?.error ?? 'Could not create the work type'); return }
      setKinds(ks => [...ks, j])
      kindTouchedRef.current = true
      setDraft(d => ({ ...d, work_kind_id: j.id }))
      setNewKindName(null)
      toast.success(`New kind of work "${name}" added — it is selected`)
    } catch {
      toast.error('Could not create the work type')
    } finally {
      setNewKindBusy(false)
    }
  }

  const [adhocReason, setAdhocReason] = useState('')
  // does this need the client's sign-off, or can a manager finish it in-house?
  // An asset says yes by default; an internal task never asks the client.
  const [clientApproval, setClientApproval] = useState(true)

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

  // A brief is made from the Production page, an asset from the Editor page —
  // never by accident from the other one. Preset: lock the kind and hide the
  // chooser. No preset: the brief kind is not in the list at all.
  const briefKind = kinds.find(k => k.slug === 'shoot_brief') ?? null
  // a TASK (research, strategy, copy) is any kind with no media that is not
  // a brief; it is made from Production and never offered on the Editor page
  const taskKinds = kinds.filter(k => k.slug !== 'shoot_brief' && !k.uses_media)
  const selectableKinds = presetKind === 'shoot_brief' ? kinds
    : presetKind === 'task' ? taskKinds
    : kinds.filter(k => k.slug !== 'shoot_brief' && k.uses_media)
  useEffect(() => {
    if (presetKind === 'task') {
      const first = taskKinds[0]
      if (first) setDraft(d => (taskKinds.some(k => k.id === d.work_kind_id) ? d : { ...d, work_kind_id: first.id }))
      return
    }
    if (presetKind !== 'shoot_brief' || !briefKind) return
    setDraft(d => (d.work_kind_id === briefKind.id ? d : { ...d, work_kind_id: briefKind.id }))
  }, [presetKind, briefKind, taskKinds])

  // Leaving the work type alone sends no work_kind_id at all, and the server
  // resolves that to the 'edit' kind — so the row that means "I didn't choose"
  // has to be labelled with the kind that actually gets used, not with
  // whatever happens to sort first.
  const defaultKind = (presetKind === 'task' ? null : kinds.find(k => k.slug === 'edit')) ?? selectableKinds[0] ?? null

  // the chosen work kind reshapes the dialog: a shoot BRIEF is planned, not
  // produced — no footage fields, its own gate, deliverables instead of type
  const selectedKind = kinds.find(k => k.id === draft.work_kind_id) ?? defaultKind
  const isBriefKind = selectedKind?.slug === 'shoot_brief'
  const isTaskKind = presetKind === 'task'
  const hidesMedia = selectedKind ? !selectedKind.uses_media : false

  /** an asset with no shoot behind it needs a reason, and the reason is logged.
   *  Editors too, not just managers: footage often arrives with no shoot — the
   *  client sends it, an old shoot supplies it — and the editor is who has it. */
  const needsAdhocReason = !isBriefKind && !isTaskKind && !draft.batch_id
  /** a non-manager with no locked shoot to pick cannot create an asset at all */
  const shootChoices = batches
    .filter(b => ['locked', 'shot'].includes(b.status ?? 'shot'))
    .filter(b => !draft.client_id || b.client_id === draft.client_id)
  // the shoots a BRIEF may attach to: this client's, not finished, and not
  // already carrying one (the DB has a one-brief-per-shoot unique index)
  const briefableShoots = batches.filter(b =>
    (!draft.client_id || b.client_id === draft.client_id)
    && (b.status ?? 'brief') !== 'wrapped'
    && !(briefedBatchIds ?? []).includes(b.id))
  // nobody is blocked on "no shoot ready" any more — the no-shoot path is
  // open to everyone who makes work, with a reason

  const createItems = async () => {
    if (!draft.client_id || !draft.title.trim()) return toast.error('Client and title are required')
    if (isBriefKind && draft.deliverables.length === 0) {
      return toast.error('Add at least one deliverable — the plan is the promise of what gets made.')
    }
    if (needsAdhocReason && !adhocReason.trim()) {
      return toast.error('Say where the footage is from — it goes in the log.')
    }
    setNewBusy(true)
    try {
      // a regular item card can hold a MIX of formats (2 reels + 2 carousels +
      // 2 videos); each row's type repeated qty times is the pieces in order.
      // Tasks and briefs keep their single count.
      const isRegular = !isBriefKind && !isTaskKind
      const formatSeq: string[] = isRegular
        ? draft.formats.flatMap(f => Array.from({ length: Math.max(1, Math.floor(f.qty) || 1) }, () => f.type))
        : []
      // a quantity applies to assets AND tasks — "5 write-ups" is one promise
      let count = isBriefKind ? 1
        : isRegular ? Math.min(Math.max(1, formatSeq.length), 30)
        : Math.min(Math.max(1, draft.count), 30)
      const typeAt = (i: number) => isTaskKind ? 'other' : isRegular ? (formatSeq[i] ?? formatSeq[0] ?? 'reel') : draft.content_type

      // ── a QUANTITY is a promise, not N cards ──
      // "5 feeds + 2 stories" makes ONE group with target 7: the board shows
      // one card ("… 0 of 7") that fills as pieces are added. If the groups
      // table is not migrated yet the server says so, and we fall back to
      // creating the numbered items exactly as before — never a dead end.
      //
      // This used to skip the group whenever files or a folder link were
      // attached, on the reasoning that the work already existed rather than
      // being promised. But whether the footage is in hand has nothing to do
      // with whether the seven pieces are one job: attaching a folder to
      // "5 feeds + 2 stories" scattered SEVEN cards across the board for a
      // single promise, which is the opposite of what the grouping is for.
      // So the group is made either way, and the pieces are filed under it.
      // A TASK is the exception, and stays one: "5 write-ups" with a reference
      // doc attached is one task holding that doc, which is what the hint under
      // the count already promises. Grouping it would have created a card of 5
      // holding exactly one piece, because the task collapse to count = 1 runs
      // after the group is made.
      const workAttached = draft.raw_assets.length > 0 || Boolean(draft.raw_assets_url.trim())
      let groupId: string | null = null
      if (count > 1 && !(isTaskKind && workAttached)) {
        const res = await fetch('/api/production/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: draft.client_id,
            batch_id: isTaskKind ? null : draft.batch_id || null,
            content_type: isTaskKind ? 'other' : isRegular ? (draft.formats[0]?.type ?? 'reel') : draft.content_type,
            title: draft.title.trim(),
            target: count,
            // the mix of formats, so the card fills per type. Single-format
            // regular items send one row; the server tolerates the column
            // being absent and falls back to a single-format group.
            ...(isRegular ? { planned: draft.formats } : {}),
            // a task group remembers its kind, so every piece added later is
            // a task too — never an asset that would reach the Scheduler
            ...(isTaskKind ? { work_kind_id: draft.work_kind_id || defaultKind?.id || undefined } : {}),
            adhoc_reason: adhocReason.trim() || undefined,
          }),
        })
        const json = await res.json().catch(() => null)
        if (res.ok) {
          groupId = typeof json?.id === 'string' ? json.id : null
          // nothing in hand yet: the card IS the deliverable, and the pieces
          // arrive later from the board. With work attached we carry on and
          // create them now — under this group, so they fold into one card.
          if (!workAttached) {
            toastOpen(
              `"${draft.title.trim()}" created — one card, 0 of ${count}. Add pieces from the ${isTaskKind ? 'Production' : 'Editor'} board.`,
              isTaskKind ? '/dashboard/production' : '/dashboard/editor', router.push,
            )
            onOpenChange(false)
            setDraft({ ...BLANK })
            setAdhocReason('')
            setAssetWarnings([])
            setClientApproval(true)
            setStep('details')
            onCreated()
            return
          }
        } else {
          // 503 = the table is not migrated; 404/405 = the endpoint is not
          // deployed yet. Either way the feature is off — fall back: a task
          // becomes ONE task, assets become the numbered items as before.
          if (![503, 404, 405].includes(res.status)) {
            throw new Error(json?.error ?? 'Could not create the group')
          }
          if (isTaskKind) count = 1
        }
      }

      // a task that did not become a group is always ONE task — attached
      // files belong to it, and five copies of a file help nobody
      if (isTaskKind) count = 1
      const payload = Array.from({ length: count }, (_, i) => ({
        client_id: draft.client_id,
        batch_id: draft.batch_id || null,
        title: count === 1 ? draft.title.trim() : `${draft.title.trim()} ${String(i + 1).padStart(2, '0')}`,
        content_type: typeAt(i),
        priority: draft.priority,
        due_date: draft.due_date || null,
        ...(draft.owner_id ? { owner_id: draft.owner_id } : {}),
        ...(draft.work_kind_id ? { work_kind_id: draft.work_kind_id } : {}),
        ...(isBriefKind ? {
          brief_url: draft.brief_url.trim() || null,
          planned_deliverables: draft.deliverables,
          // an explicitly chosen shoot, or null to create one with the brief
          batch_id: draft.batch_id || null,
        } : {}),
        ...(isTaskKind ? { batch_id: null } : {}),
        // filed under the promise they fulfil, so the board draws ONE card
        // that reads "5 of 7" rather than seven cards for one job
        ...(groupId ? { group_id: groupId } : {}),
        raw_assets_url: draft.raw_assets_url.trim() || null,
        brief: draft.brief.trim() || null,
        raw_assets: draft.raw_assets,
        // a task is finished in-house; a brief always goes to the client
        client_approval_required: isTaskKind ? false : isBriefKind ? true : clientApproval,
      }))
      const res = await fetch('/api/production/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload, ...(draft.batch_id ? {} : { adhoc_reason: adhocReason.trim() }) }),
      })
      const created = await res.json().catch(() => null)
      if (!res.ok) throw new Error(created?.error ?? 'Create failed')
      // where it went, and a way to go there: one item opens itself, several
      // open the board they landed on
      const firstId = Array.isArray(created) && created[0]?.id ? String(created[0].id) : null
      const message = isTaskKind ? 'Task created — it is on the Production board'
        : isBriefKind ? 'Shoot plan created — it is on the Production board'
        : count === 1 ? `Item created — it is on the Editor board, in ${DRAFTING_LANE}`
        // grouped: one card holding the pieces, which is what the board draws
        : groupId ? `"${draft.title.trim()}" created — one card holding all ${count} pieces, on the Editor board`
        : `${count} items created — they are on the Editor board, in ${DRAFTING_LANE}`
      const href = count === 1 && firstId
        ? `/dashboard/production/${firstId}`
        : isTaskKind || isBriefKind ? '/dashboard/production' : '/dashboard/editor'
      toastOpen(message, href, router.push)
      onOpenChange(false)
      setDraft({ ...BLANK })
      setAdhocReason('')
      setAssetWarnings([])
      setClientApproval(true)
      setStep('details')
      onCreated(Array.isArray(created) ? created : undefined)
    } catch (e) {
      // "Failed to fetch" is the RESPONSE dying, not the request — the server
      // may well have created everything. Check before inviting a retry that
      // would duplicate the batch.
      if (e instanceof TypeError) {
        toast.message('Network hiccup — checking whether they were created…')
        onCreated()
        toast.message('Board refreshed. If your items are there, do NOT create them again.')
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
    : isBriefKind && draft.deliverables.length === 0 ? 'Add at least one deliverable.'
    : needsAdhocReason && !adhocReason.trim() ? 'Say where the footage is from.'
    : null
  /** the Files box exists for assets and tasks; a shoot plan has none */
  const hasFilesStep = !hidesMedia || isTaskKind
  const showDetails = !mobile || !hasFilesStep || step === 'details'
  const showFiles = hasFilesStep && (!mobile || step === 'files')
  // for a regular item the promise is the formats list; a mix of 6 pieces with
  // no files makes ONE card, so the button says so
  const regularTotal = plannedTarget(draft.formats)
  // a quantity is one card whether or not the files are in hand — the button
  // has to promise what the create actually does, and it used to say
  // "Create 7 items" for something that has made one card since the grouping
  // stopped keying off the attachments
  const regularCard = regularTotal > 1
  const filesInHand = draft.raw_assets.length > 0 || Boolean(draft.raw_assets_url.trim())
  const what = isBriefKind ? 'shoot plan' : isTaskKind ? 'task' : 'item'
  const createLabel = isBriefKind ? 'Create the shoot plan'
    : isTaskKind ? (draft.count > 1 ? `Create it — 0 of ${draft.count}` : 'Create the task')
    : regularCard ? `Create the card — ${filesInHand ? regularTotal : 0} of ${regularTotal}`
    : `Create ${what}`

  return (
    <Dialog open={open} onOpenChange={o => { if (newBusy) return; onOpenChange(o); kindTouchedRef.current = false; setKindHint(null); setNewKindName(null); setStep('details') }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {/* a quantity is ONE card, so the title stays singular */}
            {isBriefKind ? <>New shoot plan <HelpHint term="shoot_plan" /></> : isTaskKind ? 'New task' : <>New item <HelpHint term="item" /></>}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isBriefKind ? 'The concept and shot list the client signs off before we film. * required'
              : isTaskKind ? 'Research, strategy or copy — work with nothing to post. * required'
              : `Lands on the Editor board in ${DRAFTING_LANE}, ready for an editor. * required`}
          </DialogDescription>
          {mobile && hasFilesStep && (
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Step {step === 'details' ? '1 of 2 — the details' : '2 of 2 — the files'}
            </p>
          )}
        </DialogHeader>
        <div className={`grid gap-4 sm:grid-cols-2 ${showDetails ? '' : 'hidden'}`}>
          <div className="grid gap-1.5">
            <Label>Client *</Label>
            <Select value={draft.client_id} onValueChange={v => v && setDraft(d => ({ ...d, client_id: v, batch_id: '' }))}>
              <SelectTrigger><SelectValue placeholder="Choose client" /></SelectTrigger>
              <SelectContent>
                {/* the full registry where the work can be for anyone, and
                    the page's scoped list otherwise. Falling back to `clients`
                    matters: the registry call can fail, and a picker with the
                    roster in it beats a picker with nothing in it. */}
                {(wantsEveryClient && allClients.length > 0 ? allClients : clients).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isTaskKind ? (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                A task can be for any client — it never leaves the team.
              </p>
            ) : isBriefKind ? (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Any client — planning a shoot is often the first work a new
                client has, so this is not limited to the ones you run.
              </p>
            ) : null}
          </div>
          {/* a plan belongs to a shoot. Without this picker "New shoot plan"
              silently created a SECOND shoot beside the one already there. */}
          {isBriefKind && (
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
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {!draft.client_id
                  ? 'Choose a client to see their shoots.'
                  : briefableShoots.length === 0
                    ? 'This client has no shoot waiting for a plan — one will be created with it.'
                    : draft.batch_id
                      ? 'The plan attaches to that shoot; no new shoot is created.'
                      : 'A new shoot will be created with this plan.'}
              </p>
            </div>
          )}
          {!isBriefKind && !isTaskKind && (
          <div className="grid gap-1.5">
            <Label>Shoot <HelpHint term="shoot" /></Label>
            <Select value={draft.batch_id || 'none'} onValueChange={v => setDraft(d => ({ ...d, batch_id: v === 'none' ? '' : v ?? '' }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No shoot — footage from elsewhere</SelectItem>
                {shootChoices.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsAdhocReason && (
              <div className="grid gap-1">
                <Label className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  Where is the footage from? *
                </Label>
                <Input value={adhocReason} placeholder="e.g. the client sent phone footage via WeTransfer"
                  onChange={e => setAdhocReason(e.target.value)} className="text-xs" />
                {/* the no-shoot path, explained in one sentence */}
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  Items usually come from a shoot; when the footage came from somewhere else, say where, and it is kept with the item.
                </p>
              </div>
            )}
          </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Title * {(draft.count > 1 || regularTotal > 1) && <span className="text-xs text-zinc-400">(numbered automatically)</span>}</Label>
            <Input value={draft.title} placeholder={isTaskKind ? "e.g. Competitor research — October" : isBriefKind ? "e.g. October clinic day" : "e.g. May shoot — BTS reel"} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
          </div>
          {/* ONE card, a MIX of formats. One row {reel,1} = a single plain
              item, exactly as before; add rows to promise 2 reels + 2
              carousels + 2 videos in one card that fills up per type. */}
          {!isBriefKind && !isTaskKind && (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Formats <span className="text-xs font-normal text-zinc-400">(what this card is — add a row for each kind)</span></Label>
            {draft.formats.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={f.type} onValueChange={v => v && setDraft(d => ({
                  ...d, formats: d.formats.map((x, j) => j === i ? { ...x, type: v } : x),
                }))}>
                  <SelectTrigger className="flex-1 capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTENT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" min={1} max={30} value={f.qty} className="w-20 text-center font-mono"
                  aria-label="How many"
                  onChange={e => setDraft(d => ({
                    ...d, formats: d.formats.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x),
                  }))} />
                {draft.formats.length > 1 && (
                  <button type="button" aria-label="Remove format"
                    onClick={() => setDraft(d => ({ ...d, formats: d.formats.filter((_, j) => j !== i) }))}
                    className="flex h-11 w-11 items-center justify-center text-zinc-400 hover:text-red-500">&#10005;</button>
                )}
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="w-fit text-zinc-500"
              onClick={() => setDraft(d => ({ ...d, formats: [...d.formats, { type: 'reel', qty: 1 }] }))}>
              <Plus className="h-3.5 w-3.5" /> Add another format
            </Button>
            {/* live plain-words summary — the whole promise in one line.
                It is one line now, not two: attached files no longer change
                the outcome, so the dialog no longer predicts two of them. */}
            {plannedTarget(draft.formats) > 1 && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                One card — {plannedSummary(draft.formats)}.{' '}
                {draft.raw_assets.length > 0 || draft.raw_assets_url.trim()
                  ? 'The pieces are made now, and everything you attached goes on every one of them.'
                  : 'Add pieces on the Editor board.'}
              </p>
            )}
          </div>
          )}
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
            <Label>{isBriefKind ? 'Target shoot date' : 'Due date'}</Label>
            <Input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))} className="font-mono" />
            {/* the picker's own order follows the BROWSER's locale, which is
                not ours to set — so echo the date back in words. An Australian
                typing 09/15 for 15 September sees it immediately. */}
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {draft.due_date
                ? new Date(`${draft.due_date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
                : 'Shown in words once picked.'}
            </p>
          </div>
          {isTaskKind && (
          <div className="grid gap-1.5">
            <Label>How many pieces? <span className="text-xs font-normal text-zinc-400">(more than one makes a single card that fills up — &ldquo;2 of 5&rdquo;)</span></Label>
            <Input type="number" min={1} max={30} value={draft.count}
              onChange={e => setDraft(d => ({ ...d, count: Number(e.target.value) || 1 }))} className="font-mono" />
            {draft.count > 1 && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                One card on the Production board with {draft.count} pieces inside. Attached files make it a single task instead.
              </p>
            )}
          </div>
          )}
          {selectableKinds.length > 0 && presetKind !== 'shoot_brief' && (
            <div className="grid gap-1.5">
              <Label>
                Kind of work{isTaskKind ? ' *' : ''}
                <span className="ml-1 text-xs font-normal text-zinc-400">
                  {isTaskKind ? '' : '(optional)'}
                </span>
              </Label>
              {/* the first row IS the default kind, so an id equal to it selects that row;
                  in task mode the default is a real task type, never the asset fallback */}
              <Select value={draft.work_kind_id && draft.work_kind_id !== defaultKind?.id ? draft.work_kind_id : 'default'}
                onValueChange={v => {
                  if (v === '__new__') { setKindHint(null); setNewKindName(''); return }
                  kindTouchedRef.current = true
                  setKindHint(null)
                  setNewKindName(null)
                  setDraft(d => ({ ...d, work_kind_id: v === 'default' ? (isTaskKind ? (defaultKind?.id ?? '') : '') : v ?? '' }))
                }}>
                <SelectTrigger className={newKindName !== null ? 'hidden' : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{defaultKind?.name ?? 'Video edit'}</SelectItem>
                  {selectableKinds.filter(k => k.id !== defaultKind?.id)
                    .map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                  {isTaskKind && isManager && <SelectItem value="__new__">+ New type&hellip;</SelectItem>}
                </SelectContent>
              </Select>
              {newKindName !== null && (
                <div className="flex items-center gap-1.5">
                  <Input
                    autoFocus
                    value={newKindName}
                    maxLength={80}
                    placeholder="Name the type, e.g. Market research"
                    className="min-w-0 flex-1"
                    onChange={e => setNewKindName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void createKind() } if (e.key === 'Escape') setNewKindName(null) }}
                  />
                  <Button type="button" size="sm" disabled={newKindBusy || !newKindName.trim()}
                    onClick={() => void createKind()}>
                    {newKindBusy ? '…' : 'Add'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={newKindBusy} aria-label="Cancel"
                    onClick={() => setNewKindName(null)}>
                    ✕
                  </Button>
                </div>
              )}
              {isTaskKind && (
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  What kind of work this is. Managers can add a kind from the list.
                </p>
              )}
              {kindHint && kindHint.match === 'existing' && kindHint.kind_id !== (draft.work_kind_id || defaultKind?.id) && (
                <button type="button"
                  className="flex w-fit items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                  onClick={() => { kindTouchedRef.current = true; setDraft(d => ({ ...d, work_kind_id: kindHint.kind_id })); setKindHint(null) }}>
                  ✦ Looks like <span className="font-semibold">{kindHint.name}</span> — click to use
                </button>
              )}
              {kindHint && kindHint.match === 'new' && isManager && (
                <button type="button"
                  className="flex w-fit items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                  onClick={async () => {
                    const hint = kindHint
                    setKindHint(null)
                    kindTouchedRef.current = true
                    const slug = hint.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
                    const res = await fetch('/api/production/work-kinds', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      // a type minted from the task dialog is a task type: no media, so it
                      // lands on Production and never on the Scheduler or the agreement
                      body: JSON.stringify({ slug, name: hint.name, color: hint.color, default_roles: [], uses_media: !isTaskKind }),
                    })
                    const j = await res.json().catch(() => null)
                    if (!res.ok) { toast.error(j?.error ?? 'Could not create the work type'); return }
                    setKinds(ks => [...ks, j])
                    setDraft(d => ({ ...d, work_kind_id: j.id }))
                    toast.success(`New kind of work "${hint.name}" added — it is selected`)
                  }}>
                  ✦ New type? Create <span className="font-semibold">{kindHint.name}</span> and use it
                </button>
              )}
            </div>
          )}
          {isManager && (
            <div className="grid gap-1.5">
              <Label>Who&rsquo;s doing this?</Label>
              <Select value={draft.owner_id || 'none'} onValueChange={v => setDraft(d => ({ ...d, owner_id: v === 'none' ? '' : v ?? '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody yet — anyone can pick it up</SelectItem>
                  {(() => {
                    const kind = selectedKind
                    const suggested = kind ? team.filter(m => kind.default_roles.includes(m.role)) : []
                    const ids = new Set(suggested.map(m => m.id))
                    const rest = team.filter(m => !ids.has(m.id))
                    return (
                      <>
                        {suggested.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Suggested for this work type</SelectLabel>
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
          {/* does the client have to sign this off, or can we finish it in
              house? A task never asks; a brief always does. */}
          {!isTaskKind && !isBriefKind && (
            <label className="flex items-center gap-2.5 self-end pb-1.5 text-sm sm:col-span-2">
              <Switch checked={clientApproval} onCheckedChange={setClientApproval} />
              <span>
                Client must approve this
                <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
                  Off means an account manager can approve it without sending it out.
                </span>
              </span>
            </label>
          )}
          {!hidesMedia && (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Folder link <span className="text-xs font-normal text-zinc-400">(Google Drive — what the editor works from)</span></Label>
            <Input value={draft.raw_assets_url} placeholder="https://drive.google.com/drive/folders/…"
              onChange={e => setDraft(d => ({ ...d, raw_assets_url: e.target.value }))} className="font-mono text-xs" />
          </div>
          )}
          {isBriefKind && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Plan link <span className="text-xs font-normal text-zinc-400">(Milanote or anywhere — or write the concept and shot list on the shoot page)</span></Label>
              <Input value={draft.brief_url} placeholder="https://app.milanote.com/…"
                onChange={e => setDraft(d => ({ ...d, brief_url: e.target.value }))} className="font-mono text-xs" />
            </div>
          )}
          {isBriefKind && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Deliverables <HelpHint term="deliverable" /> * <span className="text-xs font-normal text-zinc-400">(what the shoot must produce)</span></Label>
              {draft.deliverables.map((d0, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={d0.type} onValueChange={v => v && setDraft(d => ({
                    ...d, deliverables: d.deliverables.map((x, j) => j === i ? { ...x, type: v } : x),
                  }))}>
                    <SelectTrigger className="flex-1 capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" min={1} value={d0.qty} className="w-20 text-center font-mono"
                    onChange={e => setDraft(d => ({
                      ...d, deliverables: d.deliverables.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x),
                    }))} />
                  <button type="button" aria-label="Remove deliverable"
                    onClick={() => setDraft(d => ({ ...d, deliverables: d.deliverables.filter((_, j) => j !== i) }))}
                    className="flex h-11 w-11 items-center justify-center text-zinc-400 hover:text-red-500">&#10005;</button>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" className="w-fit text-zinc-500"
                onClick={() => setDraft(d => ({ ...d, deliverables: [...d.deliverables, { type: 'reel', qty: 1 }] }))}>
                <Plus className="h-3.5 w-3.5" /> Add deliverable
              </Button>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{isBriefKind ? 'Note to reviewer' : isTaskKind ? 'What needs doing' : 'Editing notes'} <span className="text-xs font-normal text-zinc-400">{isBriefKind ? '(context for whoever reviews the plan)' : isTaskKind ? '(the ask, in a few lines — sent to whoever takes it)' : '(what the edit should be — sent to the editor)'}</span></Label>
            <Textarea rows={3} value={draft.brief} placeholder={isBriefKind ? 'Going with the garden concept — see the moodboard for tone…' : isTaskKind ? 'e.g. Pull the top five competitors’ last 30 days of posts and note what is working.' : 'Hook in the first 2s, use the b-roll from cam B, end on the offer…'}
              onChange={e => setDraft(d => ({ ...d, brief: e.target.value }))} />
          </div>
        </div>
        {showFiles && (
          <div className="grid gap-1.5">
            <Label>Files <span className="text-xs font-normal text-zinc-400">{isTaskKind ? '(anything the task needs — docs, decks, references; as many as you like)' : '(footage for the editor — or use the folder link for full shoots)'}</span></Label>
            {/* the drop zone is the path; the button is the same path for a
                thumb. Rows underneath say what is happening to each file. */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); void onAssetFiles(e.dataTransfer.files) }}
              onClick={() => assetFileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                dragging ? 'border-blue-400 bg-blue-50/60 dark:border-blue-600 dark:bg-blue-950/30'
                  : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
              }`}>
              <p className="text-sm font-medium">{assetBusy ? 'Uploading…' : 'Choose files, or drag them here'}</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Any size — they go straight to our storage. You can skip this and add files later.</p>
            </div>
            {draft.raw_assets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.raw_assets.map(a => (
                  <Badge key={a.url} variant="secondary" className="gap-1 font-normal">
                    <span className="max-w-40 truncate">{a.name}</span>
                    <button type="button" aria-label={`Remove ${a.name}`}
                      onClick={() => setDraft(d => ({ ...d, raw_assets: d.raw_assets.filter(x => x.url !== a.url) }))}
                      className="text-zinc-400 hover:text-red-500">✕</button>
                  </Badge>
                ))}
              </div>
            )}
            {/* what is actually happening to the files, per file: name, size,
                bar, %, speed, time left, cancel, and Retry with the reason */}
            {assetUploads.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <UploadOverall uploads={assetUploads} />
                <UploadRows uploads={assetUploads} />
              </div>
            )}
            <ExportWarnings items={assetWarnings} onDismiss={() => setAssetWarnings([])} />
            {/* sr-only, not hidden: display:none file inputs can silently
                refuse a programmatic .click() on some browsers */}
            <input ref={assetFileRef} type="file" multiple className="sr-only"
              onChange={e => void onAssetFiles(e.target.files)} />
          </div>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {mobile && hasFilesStep && step === 'files' && (
            <Button variant="outline" className="min-h-11" onClick={() => setStep('details')} disabled={newBusy}>Back</Button>
          )}
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={newBusy}>Cancel</Button>
          {mobile && hasFilesStep && step === 'details' ? (
            <Button className="min-h-11" onClick={() => setStep('files')} disabled={missing !== null}>Next: files</Button>
          ) : (
            <Button className="min-h-11" onClick={createItems} disabled={newBusy || assetBusy || missing !== null}>
              {newBusy ? 'Creating…' : assetBusy ? 'Waiting for the files…' : createLabel}
            </Button>
          )}
        </DialogFooter>
        {/* the reason the button is grey, said where the person is looking —
            not as a toast after twelve fields are filled in */}
        {missing && (
          <p className="-mt-2 text-right text-xs text-amber-600 dark:text-amber-400">{missing}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
