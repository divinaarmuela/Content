'use client'

import { useEffect, useState } from 'react'
import { NETWORK_LABEL } from '../../lib/publish-core'
import BrandCard from '../production/BrandCard'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useTable } from '@/lib/db-client'
import type { TeamUser } from '@/lib/db-types'
import {
  briefAfterHandover, handToGroups, personLabel, type HandTo,
} from '../../lib/hand-over-core'
import { roleLabel } from '../../lib/identity-core'
import { linkKindOf } from '../../lib/card-link-core'
import { findKindByName, normaliseKindName } from '../../lib/work-kinds-core'
import { canReadClientComments } from '../../lib/comment-access-core'
import { friendlyError } from '../../lib/support-core'
import { POST_CHANGES_LABEL, type BoardViewCard, type BoardViewer } from '../../lib/board-view-core'

/**
 * THE FEW THINGS A CARD ASKS FOR.
 *
 * Every dialog here is one box and one button. The server decides whether
 * the person may do it — these only collect the words the route needs and
 * say what happened. Nothing here touches Google Drive: a pasted link is a
 * link (CLAUDE.md trap 13).
 */

export type KindRow = { id: string; name: string; slug: string; color?: string; active?: boolean }

const field = 'h-11 rounded-full border-border bg-surface px-4'
const primary = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90'
const quiet = 'h-11 rounded-full border-border bg-surface px-5 text-[14px] font-semibold'

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string }
  return friendlyError(body.error ?? fallback, 'this page')
}

/** Paste where the work lives. The label is detected as they type. */
export function LinkDialog({ card, onClose, onSaved }: {
  card: BoardViewCard | null
  onClose: () => void
  onSaved?: () => void
}) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setUrl(card?.link_url ?? '') }, [card])
  const check = linkKindOf(url)

  const save = async () => {
    if (!card || !check.ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${card.id}/link`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not save the link'))
      const json = await res.json() as { version?: number; already?: boolean }
      toast.success(json.already ? 'That link is already on the card' : `Link saved — version ${json.version ?? 1}`)
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the link')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!card) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${card.id}/link`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readError(res, 'Could not remove the link'))
      toast.success('Link removed')
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={card !== null} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{card?.link_url ? 'Replace the link' : 'Add the link'}</DialogTitle>
          <DialogDescription>
            Paste the Google Drive or Dropbox link to the work.
            {card?.link_url ? ' Replacing it makes a new version.' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="card-link">Link</Label>
          <Input id="card-link" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://drive.google.com/…" className={field} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') void save() }} />
          <p className="text-[13px] text-muted-foreground">
            {url.trim() === '' ? 'Drive and Dropbox links are labelled for you.' : check.ok ? `This is a ${check.label} link.` : check.reason}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {card?.link_url ? (
            <Button variant="outline" disabled={busy} onClick={remove} className={quiet}>Remove link</Button>
          ) : <span />}
          <Button disabled={busy || !check.ok} onClick={save} className={primary}>
            {busy ? 'Saving…' : 'Save link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Turn a typed kind into a `work_kinds` id — adopting the one that exists,
 *  or creating it. The route decides; this is the one call. */
export async function adoptKind(name: string, kinds: readonly KindRow[]): Promise<KindRow> {
  const tidy = normaliseKindName(name)
  const existing = findKindByName(kinds, tidy)
  if (existing && existing.active !== false) return existing
  const res = await fetch('/api/production/work-kinds/adopt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tidy }),
  })
  if (!res.ok) throw new Error(await readError(res, 'Could not save that kind of work'))
  const json = await res.json() as { kind: KindRow; created?: boolean }
  return json.kind
}

/** A free-text box with the kinds so far as suggestions. */
export function KindInput({ id, value, onChange, kinds, autoFocus }: {
  id: string
  value: string
  onChange: (v: string) => void
  kinds: readonly KindRow[]
  autoFocus?: boolean
}) {
  const listId = `${id}-kinds`
  return (
    <>
      <Input id={id} list={listId} value={value} onChange={e => onChange(e.target.value)}
        placeholder="Reel, media, copy — or type a new one" className={field} autoFocus={autoFocus} />
      <datalist id={listId}>
        {kinds.filter(k => k.active !== false).map(k => <option key={k.id} value={k.name} />)}
      </datalist>
    </>
  )
}

/** Change what kind of work a card is. A kind that does not exist is created. */
export function KindDialog({ card, kinds, onClose, onSaved }: {
  card: (BoardViewCard & { work_kinds?: { name: string } | null }) | null
  kinds: readonly KindRow[]
  onClose: () => void
  onSaved?: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setName(card?.work_kinds?.name ?? '') }, [card])

  const save = async () => {
    if (!card || !normaliseKindName(name)) return
    setBusy(true)
    try {
      const kind = await adoptKind(name, kinds)
      const res = await fetch(`/api/production/items/${card.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_kind_id: kind.id }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not change the kind'))
      toast.success(`Now "${kind.name}"`)
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the kind')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={card !== null} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kind of work</DialogTitle>
          <DialogDescription>Type anything. A new word is kept for next time.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="card-kind">Kind</Label>
          <KindInput id="card-kind" value={name} onChange={setName} kinds={kinds} autoFocus />
        </div>
        <DialogFooter>
          <Button disabled={busy || !normaliseKindName(name)} onClick={save} className={primary}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ClientComment = { id: string; created_at: string; body: string; author_name: string | null }

/**
 * Send a card back with what needs changing. The client's own words are
 * shown to the manager and pre-filled, editable; the assignee gets the
 * manager's words, by bell and email, from the route.
 */
export function SendBackDialog({ card, viewer, onClose, onSent }: {
  card: BoardViewCard | null
  viewer: BoardViewer
  onClose: () => void
  onSent?: () => void
}) {
  const [note, setNote] = useState('')
  const [clientWords, setClientWords] = useState<ClientComment[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setNote('')
    setClientWords([])
    if (!card || !canReadClientComments(viewer.role)) return
    let cancelled = false
    fetch(`/api/production/items/${card.id}/client-comments`)
      .then(r => (r.ok ? r.json() : { comments: [] }))
      .then((json: { comments?: ClientComment[] }) => {
        if (cancelled) return
        const words = (json.comments ?? []).filter(c => c.body?.trim())
        setClientWords(words)
        // the newest thing the client said is the likeliest thing to change
        const latest = words[words.length - 1]
        if (latest) setNote(latest.body.trim())
      })
      .catch(() => { /* the box still works without them */ })
    return () => { cancelled = true }
  }, [card, viewer.role])

  const send = async () => {
    if (!card || !note.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${card.id}/send-back`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not send it back'))
      const json = await res.json() as { notified?: { name: string } | null }
      toast.success(json.notified ? `Sent back — ${json.notified.name} has been told what to change` : 'Sent back for changes')
      onSent?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send it back')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={card !== null} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send back for changes</DialogTitle>
          <DialogDescription>
            Say what needs changing. The person on this card is told, in your words.
          </DialogDescription>
        </DialogHeader>
        {clientWords.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-inner bg-paper p-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">The client said</span>
            {clientWords.slice(-3).map(c => (
              <p key={c.id} className="text-[14px]">{c.body}</p>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="send-back-note">What needs changing</Label>
          <Textarea id="send-back-note" value={note} onChange={e => setNote(e.target.value)}
            rows={4} autoFocus className="rounded-inner border-border bg-surface" />
        </div>
        <DialogFooter>
          <Button disabled={busy || !note.trim()} onClick={send} className={primary}>
            {busy ? 'Sending…' : 'Send back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * ASK FOR A CHANGE TO THE POST — the second of the two answers.
 *
 * The SAME route the composer and the item page use
 * (`/api/production/items/[id]/posting-approval`) and the same words
 * (`board-view-core`): this is one gate seen from a third place, not a
 * second approval flow. "Approve" needs nothing typed and so needs no
 * dialog; asking for a change needs the words, which the server refuses
 * without.
 */
export function PostChangesDialog({ card, onClose }: {
  card: BoardViewCard | null
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setNote('') }, [card])

  const send = async () => {
    if (!card || !note.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${card.id}/posting-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_changes', note }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not send it back'))
      toast.success('Sent back with your note — whoever built this post has been told')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send it back')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={card !== null} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{POST_CHANGES_LABEL}</DialogTitle>
          <DialogDescription>
            Say what should change before this post goes out. Whoever built it is told, in your words.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="post-changes-note">What should change</Label>
          <Textarea id="post-changes-note" value={note} onChange={e => setNote(e.target.value)}
            rows={4} autoFocus className="rounded-inner border-border bg-surface" />
        </div>
        <DialogFooter>
          <Button disabled={busy || !note.trim()} onClick={send} className={primary}>
            {busy ? 'Sending…' : 'Send it back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * HAND TO… — giving a card to somebody on purpose.
 *
 * Changing the Who dropdown moves a card silently. This is the deliberate
 * act: pick the person, say what you want them to do, press one button. The
 * words are APPENDED to the card's "what needs doing" — never written over
 * what is already there — so the person who takes it reads them on the board
 * card, in the side panel and in the email, without anybody having to repeat
 * themselves.
 *
 * The picker is everyone who can carry a card, grouped by what they do, with
 * the role beside the name: a scheduler is an ordinary choice here, which is
 * how work reaches the Scheduler page. It opens on nobody, so nothing is
 * handed over by an accidental press of Enter.
 *
 * One PATCH: `owner_id` and the new `brief` together, with `hand_over`
 * telling the route this was a handover, so the receiver hears about it in
 * those words rather than getting the ordinary "assigned to you".
 */
export function HandToDialog({ card, viewer, viewerName, onClose, onHanded }: {
  card: BoardViewCard | null
  viewer: BoardViewer
  /** the person handing it over, as the note will sign it */
  viewerName?: string | null
  onClose: () => void
  onHanded?: () => void
}) {
  const open = card !== null
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // the people who can carry a card, live off the same table the pages read.
  // Only while the dialog is open: a listener nobody is looking at is cost
  // without a reader.
  const { rows: team } = useTable<TeamUser>('team_users', { enabled: open })

  useEffect(() => { setTo(''); setNote('') }, [card])

  const people: HandTo[] = team
    .filter(u => u.active_status !== false && u.role !== 'client')
    .map(u => ({ id: u.id, name: u.name || u.email, email: u.email, role: u.role }))
  const groups = handToGroups(people)
  const chosen = people.find(p => p.id === to) ?? null

  const hand = async () => {
    if (!card || !chosen) return
    setBusy(true)
    try {
      const words = note.trim()
      const brief = briefAfterHandover(
        card.brief ?? null,
        personLabel({ name: viewerName ?? null }),
        words,
        new Date().toISOString(),
      )
      const res = await fetch(`/api/production/items/${card.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_id: chosen.id,
          // no words typed is not an empty brief — the field is left alone
          ...(brief === null ? {} : { brief }),
          hand_over: words || true,
        }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not hand it over'))
      // an uploaded post is handed to whoever POSTS it: the scheduler seat
      // is what every hat rule and the drawer's "With X" line read, and
      // moving only the owner changed neither (the audit of 10 Sep 2026)
      // the posting seat exists once the piece is approved (the handoff route
      // refuses any other stage); before that the owner move above is the
      // whole hand-over (review, 10 Sep 2026)
      if ((card as { adhoc_post?: unknown }).adhoc_post === true
        && (card.status === 'approved_for_scheduling' || card.status === 'scheduled')) {
        const seat = await fetch(`/api/production/items/${card.id}/handoff`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduler_ids: [chosen.id] }),
        })
        if (!seat.ok) throw new Error(await readError(seat, 'Could not hand the posting over'))
      }
      toast.success(`Handed to ${personLabel(chosen)}.`)
      onHanded?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not hand it over')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hand this to someone</DialogTitle>
          <DialogDescription>
            They become the person on it, and they are told — with whatever you write here.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="hand-to-who">Who</Label>
            <Select value={to} onValueChange={v => v && setTo(v)}>
              <SelectTrigger id="hand-to-who" className={field}>
                <SelectValue placeholder="Pick a person" />
              </SelectTrigger>
              <SelectContent>
                {groups.map(g => (
                  <SelectGroup key={g.role}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.people.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.id === viewer.id ? 'Me' : personLabel(p)} · {roleLabel(p.role)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {groups.length === 0 && (
              <p className="text-[13px] text-muted-foreground">Nobody to hand it to yet.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="hand-to-note">What you want them to do (optional)</Label>
            <Textarea id="hand-to-note" rows={4} value={note} onChange={e => setNote(e.target.value)}
              placeholder="What you want them to do — cut a 30s version for Reels…"
              className="rounded-[20px] border-border bg-surface px-4 py-3" />
            <p className="text-[13px] text-muted-foreground">
              This is added to “what needs doing” on the card. Nothing already there is replaced.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy || !chosen} onClick={hand} className={primary}>
            {busy ? 'Handing over…' : 'Hand it over'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type ClientChoice = { id: string; name: string }
export type PersonChoice = { id: string; name: string; email: string }

/**
 * A new card: one deliverable, one client, one link. Kind is free text.
 * Managers can hand it to somebody; everyone else makes it their own.
 */
export function NewCardDialog({ open, onOpenChange, clients, kinds, team, viewer, defaultClientId, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  clients: readonly ClientChoice[]
  kinds: readonly KindRow[]
  team: readonly PersonChoice[]
  viewer: BoardViewer & { name?: string }
  defaultClientId?: string
  onCreated?: (id: string) => void
}) {
  const isManager = viewer.role === 'account_manager' || viewer.role === 'super_admin'
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('')
  const [link, setLink] = useState('')
  const [brief, setBrief] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState(viewer.id)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setClientId(defaultClientId && defaultClientId !== 'all' ? defaultClientId : (clients[0]?.id ?? ''))
    setTitle(''); setKind(''); setLink(''); setBrief(''); setDue(''); setOwner(viewer.id)
  }, [open, defaultClientId, clients, viewer.id])

  const linkCheck = linkKindOf(link)
  const canSave = !!clientId && !!title.trim() && !!normaliseKindName(kind) && (link.trim() === '' || linkCheck.ok)

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      const kindRow = await adoptKind(kind, kinds)
      const res = await fetch('/api/production/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          title: title.trim(),
          work_kind_id: kindRow.id,
          owner_id: owner || null,
          ...(brief.trim() ? { brief: brief.trim() } : {}),
          ...(due ? { due_date: due } : {}),
          content_type: 'other',
          // a card made straight from a link has no shoot behind it — the
          // link is where the work is from
          adhoc_reason: link.trim() ? `The work is at ${link.trim()}` : 'Made on the board',
        }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not make the card'))
      const made = await res.json() as { id?: string }[] | { id?: string }
      const id = Array.isArray(made) ? made[0]?.id : made.id
      if (id && link.trim()) {
        const put = await fetch(`/api/production/items/${id}/link`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link.trim() }),
        })
        if (!put.ok) toast.error('The card is made, but the link did not save — add it from the card')
      }
      toast.success('Card made — it is in Draft')
      if (id) onCreated?.(id)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not make the card')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New card</DialogTitle>
          <DialogDescription>One thing to make, for one client, with a link to where it lives.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={v => v && setClientId(v)}>
              <SelectTrigger className={field}><SelectValue placeholder="Pick a client" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {/* the client's brand, the moment they are picked — so the card is
              made with the colours, fonts and voice in view (9 Sep 2026) */}
          {clientId && <BrandCard clientId={clientId} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-title">Title</Label>
            <Input id="new-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Spring reel 2" className={field} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-brief">What needs doing</Label>
            <Textarea id="new-brief" rows={3} value={brief} onChange={e => setBrief(e.target.value)}
              placeholder="What the person making this needs to know — it goes to them."
              className="rounded-[20px] border-border bg-surface px-4 py-3" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-kind">Kind of work</Label>
            <KindInput id="new-kind" value={kind} onChange={setKind} kinds={kinds} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-link">Link (optional)</Label>
            <Input id="new-link" value={link} onChange={e => setLink(e.target.value)} placeholder="https://drive.google.com/…" className={field} />
            {link.trim() !== '' && (
              <p className="text-[13px] text-muted-foreground">{linkCheck.ok ? `This is a ${linkCheck.label} link.` : linkCheck.reason}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-due">Due (optional)</Label>
              <Input id="new-due" type="date" value={due} onChange={e => setDue(e.target.value)} className={field} />
            </div>
            {isManager && team.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label>Who</Label>
                <Select value={owner} onValueChange={v => v && setOwner(v)}>
                  <SelectTrigger className={field}><SelectValue placeholder="Pick a person" /></SelectTrigger>
                  <SelectContent>
                    {team.map(p => <SelectItem key={p.id} value={p.id}>{p.id === viewer.id ? 'Me' : p.name || p.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy || !canSave} onClick={save} className={primary}>
            {busy ? 'Making…' : 'Make the card'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Delete one card. Asks first, names the card, and says what goes with it:
 * the DELETE route removes its versions, comments, approvals and posting
 * times and cancels any posting still queued. Never more than one card.
 * If the route refuses, its own sentence is shown.
 */
export function DeleteDialog({ card, onClose, onDeleted }: {
  card: BoardViewCard | null
  onClose: () => void
  onDeleted?: () => void
}) {
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (!card) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${card.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readError(res, 'Could not delete this card'))
      toast.success(`Deleted “${card.title}”`)
      onDeleted?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete this card')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={card !== null} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{card?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. Its link, versions, comments and any booked posting
            time go with it — for everyone, including the client&rsquo;s portal.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className={quiet}>Keep it</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); void remove() }}
            className="h-11 rounded-full bg-accent-red px-5 text-[14px] font-semibold text-white hover:bg-accent-red/90">
            {busy ? 'Deleting…' : 'Delete this card'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}


/**
 * POSTED ELSEWHERE — a piece that went out by hand, marked so on the board.
 *
 * Owner, 8 Sep 2026: "sometimes approved assets don't post through here, it's
 * posted through a different source — make sure it can be tagged and posted,
 * and once things are posted the column should be updated too."
 *
 * The board's "Posted" move used to go straight to the transition, which
 * refuses unless a platform is already marked posted ("Add a live link, or
 * mark a platform posted in-app, before publishing") — so the press that
 * looked like the answer was a dead end. This asks the two things the
 * machine needs first: which network, and the link if there is one (a Story
 * has none), writes the platform row through the same schedule route the
 * item page uses, and THEN makes the move. Card lands in Posted.
 */
export function PostedElsewhereDialog({ card, onClose, onPosted }: {
  card: BoardViewCard | null
  onClose: () => void
  onPosted?: () => void
}) {
  const [platform, setPlatform] = useState('instagram')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setLink(''); setPlatform('instagram') }, [card])

  const post = async () => {
    if (!card) return
    setBusy(true)
    try {
      const url = link.trim()
      const entry = await fetch(`/api/production/items/${card.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          scheduled_at: new Date().toISOString(),
          ...(url ? { live_url: url } : { mark_posted: true }),
        }),
      })
      if (!entry.ok) throw new Error(await readError(entry, 'Could not record where it went out'))
      const moved = await fetch(`/api/production/items/${card.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'published' }),
      })
      if (!moved.ok) throw new Error(await readError(moved, 'Could not mark it posted'))
      toast.success(`Marked posted on ${NETWORK_LABEL[platform] ?? platform} — now in Posted`)
      onClose()
      onPosted?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark it posted')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={card !== null} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>It went out — where?</DialogTitle>
          <DialogDescription>
            For a piece posted by hand or through another tool. Pick the network and paste the link if there is one; a Story has none, and that is fine.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="posted-platform">Network</Label>
            <select
              id="posted-platform"
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]"
            >
              {Object.entries(NETWORK_LABEL).filter(([k]) => k !== 'x').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="posted-link">Link to the live post <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="posted-link" value={link} onChange={e => setLink(e.target.value)} placeholder="https://www.instagram.com/p/…"
              className="rounded-inner border-border bg-surface" />
            <p className="text-[12px] text-muted-foreground">
              With a link, the post’s numbers and who liked it are read the same way as one we posted ourselves.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={post} className={primary}>
            {busy ? 'Marking…' : 'It’s posted'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
