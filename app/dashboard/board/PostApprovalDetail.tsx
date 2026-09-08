'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, MessageCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRow, useTable } from '@/lib/db-client'
import type { AssetVersion, Client, ContentItem, ItemComment, TeamUser, WorkKind } from '@/lib/db-types'
import { Button } from '@/components/ui/button'
import Chip from '../ui/Chip'
import { useRole } from '../useRole'
import { useCardActs } from './useCardActs'
import { cardActions, type BoardViewCard } from '../../lib/board-view-core'
import { STATUS_LABELS, type ItemStatus } from '../../lib/workflow-core'
import { whatHappensNext } from '../../lib/email-voice-core'
import { slidesOf, slideTypeFromUrl, type Slide } from '../../lib/version-files-core'
import { slideTag, splitSlideTag, tagComment } from '../../lib/slide-comment-core'
import { canReadClientComments } from '../../lib/comment-access-core'
import { uploadFiles } from '../uploadQueue'

/**
 * THE POST APPROVAL DRAWER — a post uploaded for approval, opened from its
 * card.
 *
 * The owner, 8 Sep 2026: "the drawer is wrong as well — when we click the
 * Post approval card the drawer needs redesign and explanation … I should
 * be able to re-upload the files there, like choose which to replace … I
 * don't need an enlarged page that takes me to a different old page … make
 * it make sense."
 *
 * So, top to bottom, and nothing else:
 *
 *   1. what it is and where it is — the title, the client, the column it is
 *      in, and one sentence on what happens next;
 *   2. the decision — the same buttons the card offers this person
 *      (`cardActions`: Send for approval, Approve, Send to client, Send back,
 *      Posted), wired to the same routes;
 *   3. every asset at full size, each with Replace and Remove, and Add
 *      another — a replaced file is a new version of the piece, so the
 *      history and the portal follow;
 *   4. what was said — the client's comments (labelled by the asset they are
 *      about) and the team's notes, with a box to add one.
 *
 * No link to the Production card page: this IS the page for such a post.
 *
 * …AND THE EDITOR'S CARD (9 Sep 2026, "now do the same for the editor
 * part"): a piece of production work opens in the same drawer. Same shape,
 * three more lines — what needs doing (the brief), when it is due, who it is
 * with — and its files are written as versions through the item's own
 * versions route, so the numbering and the history are the ordinary ones.
 */
export default function PostApprovalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { me } = useRole()
  const { row: item } = useRow<ContentItem>('content_items', id)
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: versions } = useTable<AssetVersion>('asset_versions', { by: byItem })
  const { rows: comments } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)
  const { row: kind } = useRow<WorkKind>('work_kinds', item?.work_kind_id ?? null)
  const adhoc = (item as { adhoc_post?: unknown } | null)?.adhoc_post === true

  const latest = useMemo(() => [...versions].sort((a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0))[0] ?? null, [versions])
  const slides = useMemo(() => slidesOf(latest), [latest])
  const nameOf = (uid: string | null | undefined) => team.find(u => u.id === uid)?.name ?? null
  const roleOf = (uid: string | null | undefined) => team.find(u => u.id === uid)?.role ?? null
  /**
   * WHO READS WHAT. The client's words are the manager's to read (the owner,
   * 9 Sep 2026: "AM can see the comment and super admin too, both of them
   * only"). A scheduler or an editor sees the team's own notes and the
   * manager's change note — which names the file it is about, so they know
   * which one to change without reading the client.
   */
  const readsClient = canReadClientComments(me?.role ?? null)
  const said = useMemo(() => [...comments]
    .filter(c => readsClient || roleOf(c.author_id) !== 'client')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))), [comments, readsClient, team])
  const changeNote = (item as { change_note?: string | null } | null)?.change_note ?? null
  const changeAbout = changeNote ? splitSlideTag(changeNote) : null

  const viewer = me ? { id: me.id, role: me.role } : null
  const isManager = me?.role === 'account_manager' || me?.role === 'super_admin'
  const { busyId, act, dialogs } = useCardActs<BoardViewCard>(viewer ?? { id: '', role: 'scheduler' }, onClose)
  const card = item as unknown as BoardViewCard | null
  const actions = card && viewer ? cardActions(card, viewer) : { primary: null, more: [] }
  const busy = busyId === id

  /* ── the files: replace one, remove one, add more ──────────────────── */
  const [working, setWorking] = useState<string | null>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const addInput = useRef<HTMLInputElement>(null)
  const replacing = useRef<number | null>(null)

  const writeVersion = async (next: Slide[], what: string) => {
    if (!item) return
    setWorking(what)
    try {
      // an uploaded post's files are written the Schedule page's way; a piece
      // of production work gets an ordinary new version on its card
      const res = adhoc
        ? await fetch('/api/social/schedule/media', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, files: next }),
        })
        : await fetch(`/api/production/items/${item.id}/versions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: next, file_url: next[0]?.url ?? '' }),
        })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? json?.problems?.[0] ?? 'Could not save the files'))
      toast.success(`${what} — saved as version ${json?.version?.version_number ?? ''}`.trim())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the files')
    } finally {
      setWorking(null)
    }
  }
  const upload = async (files: File[]): Promise<Slide[]> => {
    const { done } = await Promise.resolve(uploadFiles(files, { purpose: 'social' }))
    const landed = await done
    return landed.map(({ file, url }) => ({
      url, name: file.name, bytes: file.size, source: 'upload' as const,
      type: file.type.startsWith('video/') ? 'video' as const : slideTypeFromUrl(url),
    }))
  }
  const onReplacePicked = async (files: File[]) => {
    const i = replacing.current
    replacing.current = null
    if (i === null || files.length === 0) return
    setWorking(`Replacing ${i + 1}`)
    try {
      const [fresh] = await upload([files[0]])
      const next = slides.map((s, k) => (k === i ? fresh : s))
      await writeVersion(next, `Replaced ${i + 1} of ${slides.length}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
      setWorking(null)
    }
  }
  const onAddPicked = async (files: File[]) => {
    if (files.length === 0) return
    setWorking('Adding')
    try {
      const fresh = await upload(files)
      await writeVersion([...slides, ...fresh], `Added ${fresh.length}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
      setWorking(null)
    }
  }
  const remove = (i: number) => {
    if (slides.length < 2) { toast.error('A post needs at least one file — replace it instead'); return }
    void writeVersion(slides.filter((_, k) => k !== i), `Removed ${i + 1}`)
  }

  /* ── a note from the team ──────────────────────────────────────────── */
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /** a manager's note is for the team, or a reply the client sees on their
   *  portal — one switch, no email either way unless somebody is @tagged */
  const [toClient, setToClient] = useState(false)
  const sendNote = async () => {
    const text = draft.trim()
    if (!text || !item) return
    setSending(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, visibility: isManager && toClient ? 'client' : 'internal' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not add the note')
      setDraft('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the note')
    } finally {
      setSending(false)
    }
  }

  /* ── "change this one": the manager's send-back, naming the file ───── */
  const [changeOn, setChangeOn] = useState<number | null>(null)
  const [changeText, setChangeText] = useState('')
  const sendBack = async () => {
    if (!item || changeOn === null || !changeText.trim()) return
    const s = slides[changeOn]
    setWorking('Sending back')
    try {
      const res = await fetch(`/api/production/items/${item.id}/send-back`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: tagComment(changeText, slideTag(changeOn, slides.length, s?.type)) }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not send it back')
      toast.success(`Sent back — the change is marked on ${s?.type === 'video' ? 'video' : 'photo'} ${changeOn + 1}`)
      setChangeOn(null); setChangeText('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send it back')
    } finally {
      setWorking(null)
    }
  }
  const mayAskChange = isManager && ['internal_review', 'client_review', 'client_changes_requested', 'approved_for_scheduling', 'revision_complete'].includes(String(item?.status ?? ''))

  /* ── delete, in two presses ────────────────────────────────────────── */
  const [confirmDelete, setConfirmDelete] = useState(false)
  const del = async () => {
    if (!item) return
    setWorking('Deleting')
    try {
      const res = await fetch(`/api/production/items/${item.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not delete it')
      toast.success('Deleted')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete it')
      setWorking(null)
    }
  }

  if (!item) return <div className="p-5 text-[14px] text-muted-foreground">Loading…</div>
  const status = String(item.status) as ItemStatus
  const primary = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90'
  const secondary = 'h-11 rounded-full px-4 text-[14px] font-semibold'

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* ── 1. what and where ── */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-5">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {client?.name ?? ''} · {adhoc ? 'Post' : (kind?.name ?? 'Work')}
          </p>
          <h2 className="text-section-title truncate">{item.title}</h2>
          {!adhoc && (
            <div className="mt-1.5 flex flex-col gap-1 text-[13px]">
              {(item as { brief?: string | null }).brief && (
                <p><span className="font-semibold">What needs doing: </span>{(item as { brief?: string | null }).brief}</p>
              )}
              <p className="text-muted-foreground">
                {item.due_date ? `Due ${new Date(item.due_date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'No due date'}
                {' · '}{item.owner_id ? `With ${nameOf(item.owner_id) ?? 'someone'}` : 'Not assigned yet'}
              </p>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip tone={status === 'approved_for_scheduling' || status === 'scheduled' ? 'green' : status === 'published' ? 'ink' : status === 'client_review' ? 'blue' : 'amber'}>
              {STATUS_LABELS[status] ?? status}
            </Chip>
            <span className="text-[13px] text-muted-foreground">{whatHappensNext(status)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* the manager sees what the client sees — the owner, 9 Sep 2026:
              "AM and super admin should see the client portal on the
              assigned task" (not the editor, not the scheduler) */}
          {isManager && client?.share_token && (
            <a href={`/portal/${client.share_token}`} target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-[13px] font-semibold hover:bg-muted">
              Client portal <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted">
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* ── 2. the decision ── */}
      {(actions.primary || actions.more.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          {actions.primary && (
            <Button className={primary} disabled={busy} onClick={() => card && act(card, actions.primary!)}>
              {actions.primary.label}
            </Button>
          )}
          {actions.more.map(a => (
            <Button key={a.label} variant="outline" className={secondary} disabled={busy} onClick={() => card && act(card, a)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}

      {/* ── 3. the files ── */}
      <div className="flex flex-col gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {slides.length} {slides.length === 1 ? 'file' : 'files'}{latest ? ` · version ${latest.version_number}` : ''}
          </p>
          <Button variant="outline" className={secondary} disabled={working !== null} onClick={() => addInput.current?.click()}>
            <Plus className="h-4 w-4" /> Add another
          </Button>
        </div>
        {working && <p className="text-[13px] text-muted-foreground">{working}…</p>}
        {slides.length === 0 && <p className="text-[14px] text-muted-foreground">No files yet.</p>}
        {slides.map((s, i) => {
          const about = said.filter(c => splitSlideTag(String(c.body ?? '')).index === i)
          return (
            <figure key={s.url} className="flex flex-col gap-2">
              <div className="overflow-hidden rounded-inner bg-foreground/[0.06]">
                {s.type === 'video'
                  ? <video src={s.url} controls playsInline preload="metadata" className="max-h-[480px] w-full object-contain" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={s.url} alt={s.name} className="max-h-[480px] w-full object-contain" />}
              </div>
              <figcaption className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold">{s.type === 'video' ? 'Video' : 'Photo'} {i + 1} of {slides.length}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{s.name}</span>
                <Button variant="outline" size="sm" className="h-9 rounded-full" disabled={working !== null}
                  onClick={() => { replacing.current = i; replaceInput.current?.click() }}>
                  <RefreshCw className="h-3.5 w-3.5" /> Replace
                </Button>
                {slides.length > 1 && (
                  <Button variant="ghost" size="sm" className="h-9 rounded-full" disabled={working !== null} onClick={() => remove(i)}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                )}
                {mayAskChange && changeOn !== i && (
                  <Button variant="ghost" size="sm" className="h-9 rounded-full" disabled={working !== null} onClick={() => { setChangeOn(i); setChangeText('') }}>
                    <MessageCircle className="h-3.5 w-3.5" /> Change this one
                  </Button>
                )}
              </figcaption>
              {/* the manager's change note, under the file it names — what a
                  scheduler or an editor works from */}
              {changeAbout && changeAbout.index === i && (
                <p className="rounded-inner bg-tint-red p-3 text-[13px]"><span className="font-semibold">Change asked for: </span>{changeAbout.rest}</p>
              )}
              {changeOn === i && (
                <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
                  <textarea rows={2} autoFocus value={changeText} onChange={e => setChangeText(e.target.value)}
                    placeholder={`What should change on ${s.type === 'video' ? 'video' : 'photo'} ${i + 1}?`}
                    className="min-h-11 resize-none rounded-inner border border-border bg-surface p-2.5 text-[14px]" />
                  <div className="flex items-center gap-2">
                    <Button className={primary} disabled={working !== null || !changeText.trim()} onClick={() => void sendBack()}>Send back</Button>
                    <Button variant="ghost" className={secondary} onClick={() => setChangeOn(null)}>Cancel</Button>
                  </div>
                </div>
              )}
              {about.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-inner bg-tint-amber p-3">
                  {about.map(c => (
                    <p key={c.id} className="text-[13px]">
                      <span className="font-semibold">{nameOf(c.author_id) ?? client?.name ?? 'Client'}: </span>
                      {splitSlideTag(String(c.body ?? '')).rest}
                    </p>
                  ))}
                </div>
              )}
            </figure>
          )
        })}
        <input ref={replaceInput} type="file" accept="image/*,video/*" className="hidden"
          onChange={e => { void onReplacePicked(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <input ref={addInput} type="file" multiple accept="image/*,video/*" className="hidden"
          onChange={e => { void onAddPicked(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>

      {/* ── 4. what was said ── */}
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">What was said</p>
        {changeAbout && changeAbout.index === null && (
          <p className="rounded-inner bg-tint-red p-3 text-[13px]"><span className="font-semibold">Change asked for: </span>{changeAbout.rest}</p>
        )}
        {!readsClient && (
          <p className="text-[12px] text-muted-foreground">The client’s own comments are read by the account manager; what they asked for is in the change note.</p>
        )}
        {said.length === 0 && !changeNote && (
          <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
        )}
        {said.map(c => {
          const { label, rest } = splitSlideTag(String(c.body ?? ''))
          return (
            <div key={c.id} className="rounded-inner bg-foreground/[0.04] p-3 text-[13px]">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground">
                <span className="font-semibold text-foreground">{nameOf(c.author_id) ?? 'Someone'}</span>
                <span>{new Date(String(c.created_at)).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                {label && <span className="italic">on {label.toLowerCase()}</span>}
                {(c as { visibility?: string }).visibility === 'client' && <Chip tone="blue" className="px-1.5 py-0.5 text-[10px]">Client sees this</Chip>}
                {roleOf(c.author_id) === 'client' && <Chip tone="amber" className="px-1.5 py-0.5 text-[10px]">Client</Chip>}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{rest}</p>
            </div>
          )
        })}
        {isManager && (
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1 w-fit text-[13px] font-semibold">
            <button type="button" onClick={() => setToClient(false)}
              className={cn('rounded-full px-3 py-1.5', !toClient ? 'bg-foreground text-background' : 'text-muted-foreground')}>Note for the team</button>
            <button type="button" onClick={() => setToClient(true)}
              className={cn('rounded-full px-3 py-1.5', toClient ? 'bg-foreground text-background' : 'text-muted-foreground')}>Reply to {client?.name ?? 'the client'}</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea rows={2} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={isManager && toClient ? `They see this on their portal — no email is sent` : 'A note for the team — @name to tag someone'}
            className="min-h-11 flex-1 resize-none rounded-inner border border-border bg-surface p-2.5 text-[14px]" />
          <Button className="h-11 w-11 rounded-full p-0" disabled={sending || !draft.trim()} onClick={() => void sendNote()} aria-label="Add note">
            <MessageCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isManager && (
        <div className={cn('mt-auto flex items-center justify-end gap-2 border-t border-border px-5 py-4')}>
          {confirmDelete ? (
            <>
              <span className="text-[13px] text-muted-foreground">Delete this post and its files?</span>
              <Button variant="outline" className={secondary} onClick={() => setConfirmDelete(false)}>Keep it</Button>
              <Button className="h-11 rounded-full bg-accent-red px-4 text-[14px] font-semibold text-cream" disabled={working !== null} onClick={() => void del()}>Delete</Button>
            </>
          ) : (
            <Button variant="ghost" className={secondary} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      )}
      {dialogs}
    </div>
  )
}
