'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, MessageCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRow, useTable } from '@/lib/db-client'
import type { AssetVersion, Client, ContentItem, ItemComment, PublishJob, SocialPost, TeamUser, WorkKind } from '@/lib/db-types'
import { Button } from '@/components/ui/button'
import Chip from '../ui/Chip'
import { useRole } from '../useRole'
import { useCardActs } from './useCardActs'
import { HandToDialog } from './BoardDialogs'
import { cardActions, type BoardViewCard } from '../../lib/board-view-core'
import { STATUS_LABELS, type ItemStatus } from '../../lib/workflow-core'
import { whatHappensNext } from '../../lib/email-voice-core'
import { slidesOf, slideTypeFromUrl, type Slide } from '../../lib/version-files-core'
import { slideTag, splitSlideTag, tagComment } from '../../lib/slide-comment-core'
import { canReadClientComments } from '../../lib/comment-access-core'
import { handRecord, readPostedSlides } from '../../lib/posted-slides-core'
import { fileBooking, outcomeWords, type OutcomeJob } from '../../lib/post-outcome-core'
import { networkName } from '../../lib/publish-core'
import { uploadFiles } from '../uploadQueue'
import BrandCard from '../production/BrandCard'
import CollapsibleCard from '../CollapsibleCard'

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
/** "Booked · Fri 11 Sep, 9:00 am" or "Went out on Instagram · …" under one
 *  file, from the post that carries it (post-outcome-core.fileBooking) */
function FileBookingChip({ url, posts, jobsById, alreadyPosted }: {
  url: string; posts: SocialPost[]; jobsById: ReadonlyMap<string, OutcomeJob>; alreadyPosted: boolean
}) {
  const booking = fileBooking(url, posts, jobsById)
  if (!booking) return null
  const when = booking.at
    ? new Date(booking.at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null
  const live = booking.outcomes.filter(o => o.status === 'published').map(o => networkName(o.platform))
  const refused = booking.outcomes.filter(o => o.status === 'failed')
  if (booking.status === 'published') {
    return (
      <>
        {!alreadyPosted && <Chip tone="green">Went out{live.length ? ` on ${live.join(', ')}` : ''}{when ? ` · ${when}` : ''}</Chip>}
        {refused.map(o => <span key={o.platform} title={o.reason ?? undefined}><Chip tone="red">{networkName(o.platform)}: {outcomeWords(o).label.toLowerCase()}</Chip></span>)}
      </>
    )
  }
  return (
    <>
      <Chip tone="amber">Booked{when ? ` · ${when}` : ''}</Chip>
      {refused.map(o => <span key={o.platform} title={o.reason ?? undefined}><Chip tone="red">{networkName(o.platform)}: {outcomeWords(o).label.toLowerCase()}</Chip></span>)}
    </>
  )
}

export default function PostApprovalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { me } = useRole()
  const { row: item } = useRow<ContentItem>('content_items', id)
  const byItem = useMemo(() => ({ item_id: id }), [id])
  const { rows: versions } = useTable<AssetVersion>('asset_versions', { by: byItem })
  const { rows: comments } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  // THE POSTS THAT CARRY EACH FILE, so the file can say "Booked · Fri 9:00"
  // or "Went out on Instagram" — the owner, 9 Sep 2026: "in schedule to
  // show that it's scheduled and in post approval page"
  const { rows: filePosts } = useTable<SocialPost>('social_posts', { by: byItem })
  const byContentItem = useMemo(() => ({ content_item_id: id }), [id])
  const { rows: fileJobs } = useTable<PublishJob>('publish_jobs', { by: byContentItem })
  const jobsById = useMemo(() => new Map<string, OutcomeJob>(fileJobs.map(j => [j.id, j as unknown as OutcomeJob])), [fileJobs])
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
  /** "Hand to…" — the same dialog the board card's menu opens (the owner, 9
   *  Sep 2026: a manager who does not want to schedule it hands it to a
   *  scheduler or a general user, who then sees it on their Schedule page) */
  const [handing, setHanding] = useState(false)
  const handedTo = (Array.isArray((item as { scheduler_ids?: unknown } | null)?.scheduler_ids)
    ? ((item as { scheduler_ids: unknown[] }).scheduler_ids as unknown[]).map(String) : [])
    .map(uid => nameOf(uid)).filter((n): n is string => !!n)

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
  /** the asset a reply is about — the reply carries its tag, so it lands
   *  under that photo on the portal too (the owner, 9 Sep 2026: "if a client
   *  comments on an asset why can't I reply back … so it appears on his
   *  portal") */
  const [replyOn, setReplyOn] = useState<number | null>(null)
  const noteBox = useRef<HTMLTextAreaElement>(null)
  const replyAbout = (i: number) => {
    setReplyOn(i); setToClient(true); setDraft('')
    setTimeout(() => noteBox.current?.focus(), 0)
  }
  const sendNote = async () => {
    const raw = draft.trim()
    if (!raw || !item) return
    const text = replyOn !== null && slides[replyOn]
      ? tagComment(raw, slideTag(replyOn, slides.length, slides[replyOn].type))
      : raw
    setSending(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, visibility: isManager && toClient ? 'client' : 'internal' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not add the note')
      setDraft(''); setReplyOn(null)
      toast.success(isManager && toClient ? `Replied — ${client?.name ?? 'the client'} sees it on their portal` : 'Note added')
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
  /* ── posted by hand, one file at a time ────────────────────────────── */
  const postedSlides = readPostedSlides((item as { posted_slides?: unknown } | null)?.posted_slides)
  const postedUrls = new Set(postedSlides?.urls ?? [])
  const [handOn, setHandOn] = useState<number | null>(null)
  const [handLink, setHandLink] = useState('')
  /** when it went out — a `datetime-local` value, defaulting to now */
  const [handAt, setHandAt] = useState('')
  const localNow = () => {
    const d = new Date(); d.setSeconds(0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const mayMarkPosted = ['approved_for_scheduling', 'scheduled'].includes(String(item?.status ?? ''))
  const markPosted = async () => {
    if (!item || handOn === null) return
    const s = slides[handOn]
    setWorking('Marking posted')
    try {
      const res = await fetch(`/api/production/items/${item.id}/posted-slide`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: s.url, live_url: handLink.trim() || null, posted_at: handAt ? new Date(handAt).toISOString() : null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not mark it posted'))
      const p = json?.posted as { posted?: number; total?: number } | undefined
      toast.success(p && p.posted !== undefined && p.total !== undefined && p.posted < p.total
        ? `Marked posted — ${p.posted} of ${p.total} now out`
        : 'Marked posted — every file is out, the card is in Posted')
      setHandOn(null); setHandLink(''); setHandAt('')
      if (p && p.posted !== undefined && p.total !== undefined && p.posted >= p.total) onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark it posted')
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
          {isManager && (
            <Button variant="outline" className={secondary} disabled={busy} onClick={() => setHanding(true)}>
              {handedTo.length > 0 ? `With ${handedTo.join(', ')} · change` : 'Hand to…'}
            </Button>
          )}
        </div>
      )}
      {isManager && viewer && (
        <HandToDialog card={handing ? card : null} viewer={viewer} viewerName={me?.name ?? null}
          onClose={() => setHanding(false)} />
      )}

      {/* ── 3. the files ── */}
      <div className="flex flex-col gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {slides.length} {slides.length === 1 ? 'file' : 'files'}{latest ? ` · version ${latest.version_number}` : ''}
            {postedSlides && postedSlides.posted > 0 ? ` · ${postedSlides.posted} of ${postedSlides.total} posted` : ''}
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
                {postedUrls.has(s.url) && (
                  <Chip tone="green">
                    {handRecord(postedSlides, s.url)
                      ? `Posted by hand · ${new Date(handRecord(postedSlides, s.url)!.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
                      : 'Posted'}
                  </Chip>
                )}
                <FileBookingChip url={s.url} posts={filePosts} jobsById={jobsById} alreadyPosted={postedUrls.has(s.url)} />
                {handRecord(postedSlides, s.url)?.link && (
                  <a href={handRecord(postedSlides, s.url)!.link!} target="_blank" rel="noreferrer" className="text-[12px] underline underline-offset-4">Live post</a>
                )}
                {mayMarkPosted && !postedUrls.has(s.url) && handOn !== i && (
                  <Button variant="ghost" size="sm" className="h-9 rounded-full" disabled={working !== null} onClick={() => { setHandOn(i); setHandLink(''); setHandAt(localNow()) }}>
                    Posted by hand
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
              {handOn === i && (
                <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
                  <p className="text-[13px]">This file went out by hand or through another tool. Say when, and paste the link if there is one.</p>
                  <label className="flex flex-col gap-1 text-[12px] font-semibold">
                    When did it go out?
                    <input type="datetime-local" value={handAt} max={localNow()} onChange={e => setHandAt(e.target.value)}
                      className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px] font-normal" />
                  </label>
                  <input value={handLink} onChange={e => setHandLink(e.target.value)} placeholder="https://www.instagram.com/p/… (optional)"
                    className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]" />
                  <div className="flex items-center gap-2">
                    <Button className={primary} disabled={working !== null} onClick={() => void markPosted()}>It’s posted</Button>
                    <Button variant="ghost" className={secondary} onClick={() => setHandOn(null)}>Cancel</Button>
                  </div>
                </div>
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
                  {isManager && (
                    <button type="button" onClick={() => replyAbout(i)} className="w-fit text-[12px] font-semibold underline-offset-4 hover:underline">
                      Reply to {client?.name ?? 'the client'} about this one
                    </button>
                  )}
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

      {/* ── the brand: colours, fonts, voice, logo files — for the editor and
          the scheduler as much as the manager (the owner, 9 Sep 2026: "make
          sure brand assets are shown … editor or scheduler can see it in the
          card, the brand guidelines, and account manager") ── */}
      {item.client_id && (
        <div className="border-b border-border px-5 py-4">
          <CollapsibleCard title="Brand" summary={`${client?.name ?? 'the client'}’s colours, fonts, voice and logo files`}>
            <BrandCard clientId={item.client_id} />
          </CollapsibleCard>
        </div>
      )}

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
        {replyOn !== null && slides[replyOn] && (
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            About {slides[replyOn].type === 'video' ? 'video' : 'photo'} {replyOn + 1} of {slides.length}
            <button type="button" onClick={() => setReplyOn(null)} className="underline underline-offset-4">the whole post instead</button>
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea ref={noteBox} rows={2} value={draft} onChange={e => setDraft(e.target.value)}
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
