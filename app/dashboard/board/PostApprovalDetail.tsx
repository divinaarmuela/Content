'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MessageCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRow, useTable } from '@/lib/db-client'
import type { AssetVersion, Client, ContentItem, ItemComment, TeamUser } from '@/lib/db-types'
import { Button } from '@/components/ui/button'
import Chip from '../ui/Chip'
import { useRole } from '../useRole'
import { useCardActs } from './useCardActs'
import { cardActions, type BoardViewCard } from '../../lib/board-view-core'
import { STATUS_LABELS, type ItemStatus } from '../../lib/workflow-core'
import { whatHappensNext } from '../../lib/email-voice-core'
import { slidesOf, slideTypeFromUrl, type Slide } from '../../lib/version-files-core'
import { splitSlideTag } from '../../lib/slide-comment-core'
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
 */
export default function PostApprovalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { me } = useRole()
  const { row: item } = useRow<ContentItem>('content_items', id)
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: versions } = useTable<AssetVersion>('asset_versions', { by: byItem })
  const { rows: comments } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)

  const latest = useMemo(() => [...versions].sort((a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0))[0] ?? null, [versions])
  const slides = useMemo(() => slidesOf(latest), [latest])
  const said = useMemo(() => [...comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))), [comments])
  const nameOf = (uid: string | null | undefined) => team.find(u => u.id === uid)?.name ?? null

  const viewer = me ? { id: me.id, role: me.role } : null
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
      const res = await fetch('/api/social/schedule/media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, files: next }),
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
  const sendNote = async () => {
    const text = draft.trim()
    if (!text || !item) return
    setSending(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not add the note')
      setDraft('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the note')
    } finally {
      setSending(false)
    }
  }

  /* ── delete, in two presses ────────────────────────────────────────── */
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isManager = me?.role === 'account_manager' || me?.role === 'super_admin'
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
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{client?.name ?? 'Post'} · Post</p>
          <h2 className="text-section-title truncate">{item.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip tone={status === 'approved_for_scheduling' || status === 'scheduled' ? 'green' : status === 'published' ? 'ink' : status === 'client_review' ? 'blue' : 'amber'}>
              {STATUS_LABELS[status] ?? status}
            </Chip>
            <span className="text-[13px] text-muted-foreground">{whatHappensNext(status)}</span>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
          <X className="h-[18px] w-[18px]" />
        </button>
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
              </figcaption>
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
        {(item as { change_note?: string | null }).change_note && (
          <p className="text-[13px]"><span className="font-semibold">Sent back: </span>{(item as { change_note?: string | null }).change_note}</p>
        )}
        {said.length === 0 && !(item as { change_note?: string | null }).change_note && (
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
              </p>
              <p className="mt-1 whitespace-pre-wrap">{rest}</p>
            </div>
          )
        })}
        <div className="flex items-end gap-2">
          <textarea rows={2} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a note for the team or the client"
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
