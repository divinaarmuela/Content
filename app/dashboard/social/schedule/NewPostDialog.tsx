'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  ChevronDown, Clock, Plus, Trash2, X, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SocialAccount } from '@/lib/db-types'
import {
  APPROVAL_LINE, clockPillLabel, composerReducer, footerActions, initialComposer,
  moreOptionsFor, type ComposerState, type FooterActionKey,
} from '@/app/lib/schedule-compose-core'
import {
  tileTone, validateComposition, type SocialPostStatus, type SuggestedTime,
} from '@/app/lib/social-schedule-core'
import { autoKindFor, availableKinds, isPlatform, type PostKind } from '@/app/lib/publish-core'
import { mayPublish as roleMayPublish, type Role } from '@/app/lib/identity-core'
import { friendlyError } from '@/app/lib/support-core'
import { formatInZone } from '@/app/lib/timezone-core'
import type { Slide } from '@/app/lib/version-files-core'
import PlatformIcon from '../PlatformIcon'
import MediaPicker from './MediaPicker'
import TimePicker from './TimePicker'
import { DOT_CLASS, STATUS_WORDS, Thumb } from './tiles'
import type { SchedulePostRow } from './useSchedulePosts'

/**
 * NEW POST — the one window where a plan becomes something a client's
 * followers will see.
 *
 * Four things it will not do:
 *
 *  1. IT NEVER PRETENDS TO POST. The footer says exactly where the post
 *     stands (that pill is the ITEM's approval, live), and the button offers
 *     only what this person may actually do — `footerActions`, which is where
 *     "Schedule without approval" is withheld from anyone who could not have
 *     approved it. The server refuses too; this only stops the button lying.
 *  2. IT NEVER OFFERS A SETTING THE PROVIDER DOES NOT HAVE. "More options" is
 *     `moreOptionsFor`, read off what `publish-core` actually sends.
 *  3. IT NEVER SHOWS MEDIA THE CLIENT HAS NOT SEEN AS APPROVED. The badge is
 *     drawn from the approved version's own files, and anything else routes
 *     through the picker's new-version path.
 *  4. EVERY TIME IN IT IS THE CLIENT'S. The pill, the chips and the "goes out
 *     at" line all run through the client's zone.
 *
 * It is live: the post row it is given comes from the page's listeners, so an
 * approval landing on the item page in another tab changes the pill and the
 * button here without a refresh.
 */

export type ComposerTarget = {
  itemId: string
  title: string
  contentType: string
  /** the approved version's files — the default media and the only media that
   *  needs no fresh approval */
  approved: Slide[]
  versionNumber: number | null
  /** an existing post to edit, or null for a new one */
  post: SchedulePostRow | null
  /** the time a click on the calendar meant, for a new post */
  at: string | null
}

export default function NewPostDialog({
  target, tz, accounts, suggested, role, onClose, onOpenPost,
}: {
  target: ComposerTarget
  tz: string
  accounts: SocialAccount[]
  suggested: SuggestedTime[]
  role: Role | null
  onClose: () => void
  /** the draft became real — the page keeps its id so the live row can be
   *  handed back in */
  onOpenPost: (postId: string) => void
}) {
  const post = target.post
  const [state, dispatch] = useReducer(
    composerReducer,
    {
      itemId: target.itemId,
      slides: post?.slides ?? target.approved,
      scheduledFor: post?.scheduled_for ?? target.at,
      channels: post?.channels ?? (accounts[0] ? [accounts[0].id] : []),
    },
    initialComposer,
  )
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [kindOpen, setKindOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const menu = useRef<HTMLDivElement>(null)

  // the post row is LIVE: an approval elsewhere lands here. Only the fields
  // this window does not own are taken back — retyping somebody's caption
  // under their cursor because a listener fired is worse than being stale.
  useEffect(() => {
    if (post?.id) dispatch({ type: 'saved', postId: post.id })
  }, [post?.id])

  useEffect(() => {
    if (!menuOpen && !channelsOpen && !kindOpen) return
    const away = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) {
        setMenuOpen(false); setChannelsOpen(false); setKindOpen(false)
      }
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); setChannelsOpen(false); setKindOpen(false) }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [menuOpen, channelsOpen, kindOpen])

  const chosen = useMemo(
    () => accounts.filter(a => state.channels.includes(a.id)), [accounts, state.channels])
  const platforms = useMemo(
    () => [...new Set(chosen.map(a => String(a.platform)))], [chosen])

  const status: SocialPostStatus = post?.live_status ?? 'draft'
  const mayApprove = role === 'account_manager' || role === 'super_admin'
  const canPublish = role ? roleMayPublish(role) : false
  const { primary, menu: menuItems } = footerActions({ status, mayApprove, mayPublish: canPublish })

  const check = useMemo(() => validateComposition({
    item: { status: 'approved_for_scheduling', content_type: target.contentType },
    version: null,
    slides: state.slides,
    caption: state.caption,
    channels: chosen.map(a => ({ id: a.id, platform: String(a.platform) })),
    scheduledFor: state.scheduledFor,
    now: Date.now(),
  }), [state.slides, state.caption, state.scheduledFor, chosen, target.contentType])

  const approvedUrls = useMemo(
    () => new Set(target.approved.map(s => s.url)), [target.approved])
  const allApproved = state.slides.every(s => approvedUrls.has(s.url))

  /* ── talking to the server ────────────────────────────────────────────── */

  const body = (s: ComposerState) => ({
    item_id: target.itemId,
    slides: s.slides,
    caption: s.caption,
    channels: s.channels,
    per_channel: s.perChannel,
    scheduled_for: s.scheduledFor,
    timezone: tz,
  })

  /** Write the draft if it does not exist yet, and hand back its id. */
  const ensurePost = async (s: ComposerState): Promise<string> => {
    if (s.postId) {
      const res = await fetch(`/api/social/schedule/${s.postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(s)),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new ComposeProblem(json)
      return s.postId
    }
    const res = await fetch('/api/social/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(s)),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new ComposeProblem(json)
    const id = String(json?.post?.id ?? '')
    dispatch({ type: 'saved', postId: id })
    onOpenPost(id)
    return id
  }

  const run = async (what: FooterActionKey) => {
    if (what === 'none') return
    setBusy(true); setProblems([]); setNote(null)
    try {
      const id = await ensurePost(state)
      if (what === 'draft') { setNote('Saved as a draft.'); return }
      if (what === 'send' || what === 'direct') {
        const res = await fetch(`/api/social/schedule/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: what === 'direct' ? 'direct' : 'approval' }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new ComposeProblem(json)
        setNote(what === 'direct'
          ? 'Approved by you and booked in with the channel.'
          : 'Sent. The people who approve posts have been told.')
        return
      }
      if (what === 'now') {
        const res = await fetch(`/api/social/schedule/${id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ at: new Date(Date.now() + 60_000).toISOString() }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new ComposeProblem(json)
      }
      const res = await fetch(`/api/social/schedule/${id}/schedule`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new ComposeProblem(json)
      setNote('Booked in with the channel.')
    } catch (e) {
      setProblems(problemsOf(e))
    } finally {
      setBusy(false)
      setMenuOpen(false)
    }
  }

  const saveMedia = async (next: Slide[]) => {
    setBusy(true); setProblems([]); setNote(null)
    try {
      const fresh = next.filter(s => !approvedUrls.has(s.url))
      if (fresh.length === 0) {
        dispatch({ type: 'slides', slides: next })
        setPicking(false)
        return
      }
      // media the client has not seen: the whole arrangement becomes a new
      // version and the piece goes back to them. The post has to exist first
      // — once the item is with the client it can no longer start one.
      const id = await ensurePost({ ...state, slides: state.slides })
      const res = await fetch('/api/social/schedule/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: target.itemId, post_id: id, files: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new ComposeProblem(json)
      dispatch({ type: 'slides', slides: next })
      dispatch({ type: 'saved' })
      setNote(String(json?.message ?? 'Saved.'))
      setPicking(false)
    } catch (e) {
      setProblems(problemsOf(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!state.postId) { onClose(); return }
    setBusy(true)
    try {
      await fetch(`/api/social/schedule/${state.postId}`, { method: 'DELETE' })
      onClose()
    } catch {
      setProblems(['Could not take that post off the calendar. Try again in a moment.'])
    } finally {
      setBusy(false)
    }
  }

  /* ── the header's post type ───────────────────────────────────────────── */

  const lead = platforms[0]
  const kinds: PostKind[] = lead && isPlatform(lead)
    ? availableKinds(lead, state.slides.map(s => ({ url: s.url, type: s.type })))
    : []
  const currentKind = (state.perChannel[chosen[0]?.id ?? '']?.kind ?? '') as PostKind | ''
  const autoKind = lead && isPlatform(lead)
    ? autoKindFor(lead, state.slides.map(s => ({ url: s.url, type: s.type })))
    : null
  const KIND_WORD: Record<PostKind, string> = {
    feed: 'Feed post', reel: 'Reel', story: 'Story', carousel: 'Carousel',
  }

  const options = moreOptionsFor(platforms)
  const strip = state.slides.slice(0, 3)
  const extra = Math.max(0, state.slides.length - strip.length)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
    >
      <div
        ref={menu}
        className="flex w-full max-w-[720px] flex-col rounded-card bg-surface shadow-xl"
      >
        {/* ── header ── */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border p-3.5">
          {/* who it goes to */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setChannelsOpen(o => !o); setKindOpen(false); setMenuOpen(false) }}
              className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-paper px-3 text-[13px] font-semibold hover:bg-muted"
            >
              {chosen[0]
                ? <PlatformIcon platform={String(chosen[0].platform)} size={26} className="rounded-full" />
                : <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-foreground/10"><Plus className="h-3 w-3" aria-hidden /></span>}
              <span className="flex flex-col items-start leading-[1.1]">
                <span>{chosen[0] ? (chosen[0].username || chosen[0].name || 'Channel') : 'Choose a channel'}</span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {chosen.length > 1 ? `and ${chosen.length - 1} more` : (chosen[0]?.platform ?? 'none yet')}
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
            {channelsOpen && (
              <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[260px] rounded-inner border border-border bg-popover p-1.5 shadow-lg">
                {accounts.length === 0 && (
                  <p className="p-2 text-[13px] text-muted-foreground">
                    This client has no channels connected yet.
                  </p>
                )}
                {accounts.map(a => {
                  const on = state.channels.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => dispatch({ type: 'channel', id: a.id, on: !on })}
                      className="flex min-h-11 w-full items-center gap-2 rounded-tile px-2 text-left text-[13px] hover:bg-muted"
                    >
                      <PlatformIcon platform={String(a.platform)} size={22} className="rounded-full" />
                      <span className="min-w-0 flex-1 truncate">{a.username || a.name}</span>
                      <span className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border',
                        on ? 'border-foreground bg-foreground text-background' : 'border-border',
                      )}
                      >
                        {on ? '✓' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* what kind of post */}
          {kinds.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => { setKindOpen(o => !o); setChannelsOpen(false); setMenuOpen(false) }}
                className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-paper px-3 text-[13px] font-semibold hover:bg-muted"
              >
                <Zap className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                {currentKind ? KIND_WORD[currentKind] : 'Auto publish'}
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </button>
              {kindOpen && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[220px] rounded-inner border border-border bg-popover p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      for (const a of chosen) dispatch({ type: 'extra', channel: a.id, patch: { kind: undefined } })
                      setKindOpen(false)
                    }}
                    className="flex min-h-11 w-full items-center rounded-tile px-2 text-left text-[13px] hover:bg-muted"
                  >
                    Auto publish{autoKind ? ` — ${KIND_WORD[autoKind].toLowerCase()}` : ''}
                  </button>
                  {kinds.map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        for (const a of chosen) dispatch({ type: 'extra', channel: a.id, patch: { kind: k } })
                        setKindOpen(false)
                      }}
                      className="flex min-h-11 w-full items-center rounded-tile px-2 text-left text-[13px] hover:bg-muted"
                    >
                      {KIND_WORD[k]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <span className="text-[13px] text-muted-foreground">on</span>
          <TimePicker
            value={state.scheduledFor}
            tz={tz}
            onChange={iso => dispatch({ type: 'time', iso })}
          />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* ── best times ── */}
        {suggested.length > 0 && (
          <div className="mx-3.5 mt-3.5 flex flex-wrap items-center gap-2.5 rounded-inner border border-border bg-paper px-3.5 py-2.5">
            <Clock className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            <span className="flex flex-col leading-[1.15]">
              <span className="text-[13px] font-semibold">Best times to post</span>
              <span className="text-[11px] text-muted-foreground">
                When more of this client&rsquo;s followers are online
              </span>
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              {suggested.slice(0, 3).map(s => {
                const on = state.scheduledFor === s.iso
                return (
                  <button
                    key={s.iso}
                    type="button"
                    title={s.why}
                    onClick={() => dispatch({ type: 'time', iso: s.iso })}
                    className={cn(
                      'min-h-11 rounded-full px-3 text-[12px] font-semibold',
                      on
                        ? 'bg-foreground text-background'
                        : 'border border-border bg-surface hover:bg-muted',
                    )}
                  >
                    {formatInZone(s.iso, tz, 'full') ?? clockPillLabel(s.iso, tz)}
                  </button>
                )
              })}
            </span>
          </div>
        )}

        {/* ── body ── */}
        <div className="flex flex-col gap-5 p-3.5 sm:flex-row sm:gap-5">
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-[240px]">
            <div className="relative aspect-square w-full overflow-hidden rounded-inner border border-border bg-foreground/[0.06]">
              <Thumb slide={state.slides[0] ?? null} label={target.title} className="h-full w-full" />
              {state.slides.length > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-ink/60 px-2 py-0.5 text-[11px] font-bold text-cream">
                  1/{state.slides.length}
                </span>
              )}
              <span className={cn(
                'absolute bottom-2 left-2 rounded-full px-2 py-1 text-[11px] font-bold',
                allApproved ? 'bg-tint-green' : 'bg-tint-amber',
              )}
              >
                {allApproved ? 'Client approved' : 'Waiting for approval'}
              </span>
            </div>

            {state.slides.length > 1 && (
              <div className="flex gap-1.5">
                {strip.map((s, i) => (
                  <div
                    key={`${s.url}-${i}`}
                    className={cn(
                      'h-[70px] w-[56px] shrink-0 overflow-hidden rounded-tile bg-foreground/[0.06]',
                      i === 0 && 'outline outline-2 outline-offset-2 outline-accent-blue',
                    )}
                  >
                    <Thumb slide={s} label={s.name} className="h-full w-full" />
                  </div>
                ))}
                {extra > 0 && (
                  <div className="flex h-[70px] w-[56px] shrink-0 items-center justify-center rounded-tile bg-foreground/[0.06] text-[12px] font-bold text-muted-foreground">
                    +{extra}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-border text-[13px] font-semibold hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              Change media
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 rounded-inner border border-border p-3">
              <span className="text-[12px] font-semibold text-muted-foreground">Caption</span>
              <textarea
                value={state.caption}
                onChange={e => dispatch({ type: 'caption', caption: e.target.value })}
                rows={4}
                placeholder="What goes with the picture?"
                className="w-full resize-y bg-transparent text-[14px] leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            {options.length > 0 && (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  More options
                </span>
                <div className="flex flex-col gap-2.5">
                  {options.map(o => (
                    <ExtraRow
                      key={o.key}
                      option={o.key}
                      label={o.label}
                      channels={chosen.filter(a => o.platforms.includes(String(a.platform)))}
                      state={state}
                      dispatch={dispatch}
                    />
                  ))}
                </div>
              </>
            )}

            {/* the other channels this client has — Later's "Also post to" */}
            {accounts.some(a => !state.channels.includes(a.id)) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-muted-foreground">Also post to</span>
                {accounts.filter(a => !state.channels.includes(a.id)).map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => dispatch({ type: 'channel', id: a.id, on: true })}
                    className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted"
                  >
                    <PlatformIcon platform={String(a.platform)} size={16} className="rounded-full" />
                    {a.username || a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── what is wrong, and what just happened ── */}
        {(problems.length > 0 || check.problems.length > 0 || note) && (
          <div className="flex flex-col gap-1.5 px-3.5">
            {[...problems, ...(problems.length === 0 ? check.problems : [])].map(p => (
              <p key={p} className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
                {p}
              </p>
            ))}
            {note && (
              <p className="rounded-inner border border-accent-green/40 bg-tint-green px-3 py-2 text-[12px] font-medium">
                {note}
              </p>
            )}
          </div>
        )}

        {/* ── footer ── */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border p-3.5">
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label={state.postId ? 'Take this post off the calendar' : 'Close without saving'}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </button>

          <span
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full px-3 text-[13px] font-semibold',
              status === 'approved' ? 'bg-tint-green'
                : status === 'changes' || status === 'failed' ? 'bg-tint-red'
                  : status === 'scheduled' || status === 'published' ? 'bg-tint-blue'
                    : 'bg-tint-amber',
            )}
            title={STATUS_WORDS[status]}
          >
            <span className={cn('inline-block h-2 w-2 rounded-full', DOT_CLASS[tileTone(status)])} />
            {APPROVAL_LINE[status]}
          </span>

          <div className="ml-auto flex items-center">
            {primary.key === 'none' ? (
              <span className="text-[13px] font-semibold text-muted-foreground">{primary.label}</span>
            ) : (
              <div className="relative flex">
                <button
                  type="button"
                  disabled={busy || !check.ok}
                  onClick={() => void run(primary.key)}
                  className="flex min-h-11 items-center rounded-l-full bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-60"
                >
                  {busy ? 'Working…' : primary.label}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label="More ways to save this post"
                  onClick={() => { setMenuOpen(o => !o); setChannelsOpen(false); setKindOpen(false) }}
                  className="flex min-h-11 w-10 items-center justify-center rounded-r-full border-l border-background/20 bg-foreground text-background disabled:opacity-60"
                >
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                </button>
                {menuOpen && (
                  <div className="absolute bottom-[calc(100%+6px)] right-0 z-50 w-[260px] rounded-inner border border-border bg-popover p-1.5 shadow-lg">
                    {menuItems.map(m => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => void run(m.key)}
                        className="flex min-h-11 w-full items-center rounded-tile px-2 text-left text-[13px] hover:bg-muted"
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {state.scheduledFor && status === 'approved' && (
            <p className="w-full text-[12px] text-muted-foreground">
              Once it is booked in, this post goes out on its own at{' '}
              {formatInZone(state.scheduledFor, tz, 'full') ?? clockPillLabel(state.scheduledFor, tz)}.
            </p>
          )}
        </div>
      </div>

      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        itemId={target.itemId}
        approved={target.approved}
        versionLabel={`${target.title} · version ${target.versionNumber ?? 1}`}
        slides={state.slides}
        platforms={platforms}
        onSave={saveMedia}
        saving={busy}
      />
    </div>
  )
}

/** A server refusal that carried a whole list of things to fix. */
class ComposeProblem extends Error {
  problems: string[]
  constructor(json: unknown) {
    const j = (json ?? {}) as { error?: string; problems?: string[] }
    super(j.error ?? 'That did not work')
    this.problems = Array.isArray(j.problems) && j.problems.length > 0
      ? j.problems
      : [friendlyError(j.error ?? '', 'this post')]
  }
}

function problemsOf(e: unknown): string[] {
  if (e instanceof ComposeProblem) return e.problems
  return [friendlyError(e instanceof Error ? e.message : '', 'this post')]
}

/** One row of "More options", for the channels it actually applies to. */
function ExtraRow({ option, label, channels, state, dispatch }: {
  option: 'firstComment' | 'collaborators' | 'shareToFeed'
  label: string
  channels: SocialAccount[]
  state: ComposerState
  dispatch: (a: { type: 'extra'; channel: string; patch: Record<string, unknown> }) => void
}) {
  const [open, setOpen] = useState(false)
  if (channels.length === 0) return null
  const first = channels[0]
  const value = state.perChannel[first.id] ?? {}

  if (option === 'shareToFeed') {
    return (
      <label className="flex min-h-11 items-center gap-2.5 text-[14px] font-medium">
        <input
          type="checkbox"
          checked={Boolean(value.shareToFeed)}
          onChange={e => {
            for (const c of channels) {
              dispatch({ type: 'extra', channel: c.id, patch: { shareToFeed: e.target.checked } })
            }
          }}
          className="h-4 w-4"
        />
        {label}
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex min-h-11 items-center gap-2.5 text-left text-[14px] font-medium"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
        {label}
      </button>
      {open && (
        <input
          value={option === 'firstComment'
            ? String(value.firstComment ?? '')
            : (value.collaborators ?? []).join(', ')}
          onChange={e => {
            const patch = option === 'firstComment'
              ? { firstComment: e.target.value }
              : {
                collaborators: e.target.value.split(',').map(s => s.trim().replace(/^@/, ''))
                  .filter(Boolean).slice(0, 3),
              }
            for (const c of channels) dispatch({ type: 'extra', channel: c.id, patch })
          }}
          placeholder={option === 'firstComment'
            ? 'Posted as the first comment — the usual place for hashtags'
            : 'Up to three usernames, separated by commas'}
          className="min-h-11 w-full rounded-full border border-border bg-surface px-3 text-[13px]"
        />
      )}
    </div>
  )
}
