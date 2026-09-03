'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowRight, MessageSquare, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import MentionBox from '../../dashboard/MentionBox'
import { useRow, useTable } from '@/lib/db-client'
import type {
  Client, ContentItem, ItemComment, TeamUser, TeamUserClient,
} from '@/lib/db-types'
import { useRole } from '../../dashboard/useRole'
import { itemIsVisible } from '../../lib/scope-client'
import { useItemScopeContext } from '../../dashboard/useLiveWork'
import { shapeItemDetail } from '../../lib/production-access-core'
import { extractMentions } from '../../lib/mention-core'
import { commentBadge, commentsParamOf, withCommentsParam } from '../../lib/comment-drawer-core'
import type { Role } from '../../lib/identity-core'
import CommentThread, { type ThreadComment } from './CommentThread'

/** What the drawer is pointed at: an item, and its title if the card knows it. */
export type CommentsTarget = { id: string; title?: string }

/**
 * One drawer per board page: which item it shows, opened either by a card's
 * comment button or by a `?comments=<itemId>` deep link (so a notification
 * can land someone straight in the conversation). Opening writes the
 * parameter into the URL and closing removes it — additive both ways, the
 * page and its other parameters stay put.
 */
export function useCommentsDrawer() {
  const [target, setTarget] = useState<CommentsTarget | null>(null)

  // a deep link opens the drawer on load; the title comes with the fetch
  useEffect(() => {
    const id = commentsParamOf(window.location.search)
    if (id) setTarget({ id })
  }, [])

  const open = useCallback((id: string, title?: string) => {
    setTarget({ id, title })
    syncUrl(id)
  }, [])
  const close = useCallback(() => {
    setTarget(null)
    syncUrl(null)
  }, [])
  return { target, open, close }
}

/** Keep the address bar honest without navigating anywhere. */
function syncUrl(id: string | null) {
  try {
    window.history.replaceState(null, '',
      withCommentsParam(window.location.pathname, window.location.search, id))
  } catch { /* the drawer still works without the URL keeping up */ }
}

/**
 * The comment button on a board card — the drawer's visible entry point.
 *
 * A 44px target on a phone, and it sits ABOVE the card's stretched link
 * (`relative z-10`) so the click opens the conversation, not the item page.
 * The amber dot repeats the card's "Waiting on you — tagged" signal: it
 * means somebody tagged YOU here and it is not marked done yet.
 */
export function CommentsButton({ onOpen, tagged, title, className = '' }: {
  onOpen: () => void
  /** the items API's `my_open_task` — a tag with the viewer's name on it */
  tagged?: boolean
  /** the item's title, for the accessible name */
  title: string
  className?: string
}) {
  const badge = commentBadge(tagged)
  return (
    <button type="button"
      onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen() }}
      aria-label={`${badge.label} — ${title}`} title={badge.label}
      className={`relative z-10 -my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 md:-my-1 md:h-8 md:w-8 ${className}`}>
      <MessageSquare className="h-4 w-4" />
      {badge.dot && (
        <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-500 md:right-1 md:top-1" />
      )}
    </button>
  )
}

type DrawerDetail = {
  id: string
  title: string
  client_name?: string | null
  viewer_id?: string
  viewer_role: Role
  /** the hats this viewer wears ON THIS ITEM — the server's own reading */
  acting_roles?: Role[]
  comments: ThreadComment[]
}

/**
 * The item's comments in a side drawer, so nobody has to leave the board to
 * read or answer one. Same conversation, same rules as the item page: the
 * server filters what this viewer may read, "@Name" tags a teammate,
 * managers choose client visibility, and marking one done clears the tagged
 * person's list. "Open full item →" is there for everything else.
 */
export default function CommentsDrawer({ target, onClose }: {
  target: CommentsTarget | null
  onClose: () => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={o => { if (!o) onClose() }}>
      {target && <DrawerBody key={target.id} itemId={target.id} fallbackTitle={target.title} />}
    </Sheet>
  )
}

/** Mounted only while the drawer is open, so it listens to nothing until asked. */
function DrawerBody({ itemId, fallbackTitle }: { itemId: string; fallbackTitle?: string }) {
  const [draft, setDraft] = useState('')
  const [visibility, setVisibility] = useState<'internal' | 'client'>('internal')
  const [busy, setBusy] = useState(false)
  /** the comment being posted, shown at once — the listener has the last word */
  const [pending, setPending] = useState<ThreadComment | null>(null)

  // the reader's zone, resolved after mount — a timestamp on something a
  // person did belongs to their own clock (same rule as the item page)
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  useEffect(() => {
    try { setViewerTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null) } catch { /* no hint */ }
  }, [])

  /**
   * THE CONVERSATION, LIVE.
   *
   * The drawer used to fetch the whole item detail — the item page's payload
   * — and refetch it every time anybody anywhere changed anything. It now
   * listens to this item's comments: somebody else's reply appears in the
   * thread as they post it, with no refetch and no reload.
   *
   * What the viewer may READ is unchanged, because it is decided by the same
   * function the API used: `shapeItemDetail` (now in `production-access-core`,
   * imported by both). A manager reads the whole record; everyone else reads
   * the conversations they are actually in.
   */
  // not gated on `/api/team/me`: an `enabled` that flips false→true leaves one
  // render with loading already false and no snapshot yet, and the drawer
  // would read that as "Item not found" (see useLiveWork.ts)
  const { me } = useRole()
  const { row: item, loading: itemLoading, error: itemError } = useRow<ContentItem>('content_items', itemId)
  const byItem = useMemo(() => ({ item_id: itemId }), [itemId])
  const { rows: commentRows } = useTable<ItemComment>('item_comments', { by: byItem })
  const { rows: team } = useTable<TeamUser>('team_users')
  // a client viewer is scoped by their own client_id, which /api/team/me does
  // not carry and the people table does
  const viewer = useMemo(
    () => (me ? { id: me.id, role: me.role, client_id: team.find(u => u.id === me.id)?.client_id ?? null } : null),
    [me, team],
  )
  const { rows: assignments, loading: assignmentsLoading } = useTable<TeamUserClient>('team_user_clients')
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)
  /** the shoot, its other items and the comment tags — the grants a single
   *  row cannot carry. Without them a tagged editor off the client team was
   *  told "Item not found" on the notification link that sent them here. */
  const { ctx: scopeCtx, loading: scopeLoading } =
    useItemScopeContext(viewer, item, commentRows)

  /** the item, shaped for this viewer — or the reason the drawer is empty */
  const { detail, failed } = useMemo((): { detail: DrawerDetail | null; failed: string | null } => {
    // the live listener itself failed — that is not a missing item, and
    // saying "Item not found" would send somebody looking for a deletion
    // that never happened
    if (itemError) return { detail: null, failed: 'We could not load this conversation. Check your connection.' }
    if (!viewer || itemLoading || assignmentsLoading || scopeLoading) return { detail: null, failed: null }
    if (!item) return { detail: null, failed: 'Item not found' }
    if (!itemIsVisible(viewer, item, assignments, scopeCtx)) {
      // the same words the API answered with — never "you are not allowed",
      // which tells somebody a thing exists that they cannot see
      return { detail: null, failed: 'Item not found' }
    }
    const personName = new Map(team.map(a => [a.id, a.name || a.email]))
    const named = [...commentRows]
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      .map(c => ({ ...c, author_name: c.author_id ? personName.get(c.author_id) ?? null : null }))
    const shaped = shapeItemDetail(viewer, item as unknown as Record<string, unknown>, [], named as never)
    return {
      detail: {
        id: item.id,
        title: item.title,
        client_name: client?.name ?? null,
        viewer_id: viewer.id,
        viewer_role: viewer.role,
        acting_roles: (shaped as { acting_roles?: Role[] }).acting_roles,
        comments: (shaped as { comments: ThreadComment[] }).comments,
      },
      failed: null,
    }
  }, [viewer, item, itemLoading, itemError, assignmentsLoading, scopeLoading, assignments, scopeCtx, team, commentRows, client])

  /** the people "@" can reach: everyone active on the team but you */
  const mentionable = useMemo(
    () => team
      .filter(t => t.active_status !== false && t.role !== 'client' && t.id !== viewer?.id)
      .map(t => ({ id: t.id, name: t.name || t.email })),
    [team, viewer?.id],
  )

  const nameOf = (uid: string) => {
    const m = team.find(t => t.id === uid)
    return m ? (m.name || m.email) : null
  }

  // what this viewer may do here follows the ASSIGNMENT, exactly as on the
  // item page — the hats come from `actingRoles` inside `shapeItemDetail`,
  // the same function the API shapes its payload with
  const role = detail?.viewer_role
  const isTeam = !!role && role !== 'client'
  const hats = detail?.acting_roles ?? []
  const isSuper = role === 'super_admin'
  const canComment = isTeam
    && (isSuper || hats.includes('editor') || hats.includes('account_manager') || hats.includes('scheduler'))
  const canManage = isSuper || hats.includes('account_manager')

  const comments: ThreadComment[] = [
    ...(detail?.comments ?? []),
    ...(pending && !(detail?.comments ?? []).some(c => c.id === pending.id) ? [pending] : []),
  ]

  // new comments should be seen: keep the thread scrolled to its newest line
  const scrollRef = useRef<HTMLDivElement>(null)
  const count = comments.length
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])

  const postComment = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    // shown immediately; the listener's own row replaces it a moment later
    const temp: ThreadComment = {
      id: `pending-${Date.now()}`,
      created_at: new Date().toISOString(),
      author_id: detail?.viewer_id ?? null,
      author_name: (detail?.viewer_id ? nameOf(detail.viewer_id) : null) ?? 'You',
      visibility,
      body: text,
      resolved: false,
      assigned_to: null,
    }
    setPending(temp)
    setDraft('')
    try {
      // the words are the truth: whoever is "@"-named in the text is tagged.
      // The server reads the same text with the same parser; the ids ride
      // along so a name the server cannot resolve still reaches the person.
      const tagged = visibility === 'internal' ? extractMentions(text, mentionable) : []
      const res = await fetch(`/api/production/items/${itemId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: text,
          visibility,
          ...(tagged.length ? { assigned_to: tagged[0].id, mention_ids: tagged.map(t => t.id) } : {}),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Comment failed')
      await res.json().catch(() => null)
      // the listener has already put the real row in the thread
      setPending(null)
      if (tagged.length > 0) {
        const names = tagged.map(t => t.name).join(', ')
        toast.success(`Posted — ${names} ${tagged.length === 1 ? 'has' : 'have'} been emailed and will see "Waiting on you"`)
      } else if (visibility === 'client') {
        toast.success(`Posted — ${detail?.client_name ?? 'the client'} can read it on their portal`)
      } else {
        toast.success('Posted — managers can see it. Tag someone with @ to reach them.')
      }
    } catch (e) {
      // give the words back — a failed post must never eat what was typed
      setPending(null)
      setDraft(text)
      toast.error(e instanceof Error ? e.message : 'Comment failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleResolved = async (c: ThreadComment) => {
    const res = await fetch(`/api/production/items/${itemId}/comments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: c.id, resolved: !c.resolved }),
    })
    if (!res.ok) return toast.error('Update failed')
    toast.success(c.resolved ? 'Reopened — it is back on their list' : 'Marked done — it is off their list')
  }

  const title = detail?.title ?? fallbackTitle

  return (
    <SheetContent side="right"
      className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
      <SheetHeader className="shrink-0 space-y-1 border-b border-zinc-200 px-4 py-3 pr-12 text-left dark:border-zinc-800">
        <SheetTitle className="truncate text-sm font-semibold">
          Comments{title ? ` · ${title}` : ''}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Read and add comments on this item without leaving the board.
        </SheetDescription>
        <Link href={`/dashboard/production/${itemId}`}
          className="flex min-h-11 w-fit items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100 md:min-h-0">
          Open full item <ArrowRight className="h-3 w-3" />
        </Link>
      </SheetHeader>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        {failed ? (
          // no "Try again": the thread is a live subscription, so this is the
          // database's current answer and pressing a button cannot change it.
          // (A dropped connection reconnects and repaints on its own.)
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{failed}</p>
        ) : detail === null ? (
          <>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-3/4" />
          </>
        ) : (
          <CommentThread
            comments={comments}
            viewerId={detail.viewer_id}
            viewerTz={viewerTz}
            isTeam={isTeam}
            nameOf={nameOf}
            onToggleResolved={c => void toggleResolved(c)}
          />
        )}
      </div>

      {detail !== null && !failed && (
        canComment ? (
          <div className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-col gap-2">
              <MentionBox
                value={draft}
                onChange={setDraft}
                members={visibility === 'internal' ? mentionable : []}
                placeholder={visibility === 'client' ? 'Write to the client…' : 'Add a comment — type @ to tag someone…'}
                onSubmit={() => void postComment()}
                disabled={busy}
              />
              <div className="flex flex-wrap items-center gap-3">
                {canManage && (
                  <label className="flex min-h-11 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 md:min-h-0">
                    <Switch
                      checked={visibility === 'client'}
                      onCheckedChange={v => setVisibility(v ? 'client' : 'internal')}
                    />
                    Visible to client
                  </label>
                )}
                <Button size="sm" className="ml-auto min-h-11 md:min-h-8"
                  disabled={busy || !draft.trim()} onClick={() => void postComment()}>
                  <Send className="h-3.5 w-3.5" /> {busy ? 'Posting…' : 'Post'}
                </Button>
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {visibility === 'client'
                  ? `${detail.client_name ?? 'The client'} reads this on their portal.`
                  : 'Managers see every comment. To reach anyone else, tag them with @ — they are emailed and it waits on them until it is marked done.'}
              </p>
            </div>
          </div>
        ) : isTeam ? (
          <p className="shrink-0 border-t border-zinc-200 p-3 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
            Only the people working on this item can comment here — open the full item to see where it is up to.
          </p>
        ) : null
      )}
    </SheetContent>
  )
}
