'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTable } from '@/lib/db-client'
import type { ClientContact, SocialPost } from '@/lib/db-types'
import { personLabel } from '../../../lib/identity-core'
import {
  hatsFor, readPostState,
  type AccountRef, type PostHat, type PostState, type TransitionContext,
} from '../../../lib/post-stage-core'
import {
  onBoard, postCardFace, postVisibleTo, readyToBecomePosts, sourcesWithLivePost,
  type PostCardFace,
} from '../../../lib/post-board-core'
import { clientRecipients, type ClientRecipient } from '../../../lib/client-recipients-core'
import type { ScopeViewer } from '../../../lib/production-access-core'
import { todayKey } from '../../ui/tone'
import { useWorkRows, type LiveItem } from '../../useLiveWork'
import type { Assignee } from './usePostActs'

/** The clock the page reads: once a minute, so "missed" and "since" move while it is open (audit S12). */
export function useMinuteClock(): { now: string; today: string } {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return useMemo(() => ({ now: now.toISOString(), today: todayKey(now) }), [now])
}

/** Roles in the posting flow — the people a change can be given to (decision 7: not editors or designers). */
const POSTING_ROLES = ['super_admin', 'account_manager', 'scheduler', 'general', 'quality_checker']

/** How long a cancelled post stays in the folded Cancelled list, in days. */
const CANCELLED_DAYS = 30

export type BoardPost = {
  post: PostState
  face: PostCardFace
  hats: PostHat[]
  ctx: Omit<TransitionContext, 'now'>
}

/**
 * EVERYTHING THE POST APPROVAL PAGE READS, live and read-only.
 *
 * The posts are `social_posts` rows read through `readPostState` — a row the
 * migration has not given a stage yet reads as null and is left off, and the
 * page says how many there are rather than showing them in a made-up place.
 * The edits (for the "ready to become posts" tray), the clients, the team and
 * who looks after whom come from the same live rows every board uses.
 */
export function usePostBoard(person: ScopeViewer | null) {
  const clock = useMinuteClock()
  const live = useWorkRows(person, { schedulerPostFilter: false })
  const { rows: postRows, loading: postsLoading } = useTable<SocialPost>('social_posts', { enabled: person !== null })
  const { rows: contacts } = useTable<ClientContact>('client_contacts', { enabled: person !== null })

  /** the client's connected channels, for the logos and the send check */
  const [accounts, setAccounts] = useState<AccountRef[] | null>(null)
  useEffect(() => {
    if (!person) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/social/accounts', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as { accounts?: { id: string; platform: string; active: boolean; name?: string | null }[] }
        if (!cancelled) setAccounts((json.accounts ?? []).map(a => ({ id: a.id, platform: a.platform, live: a.active, name: a.name ?? null })))
      } catch { /* the board still draws; the rules that need channels say they were not loaded */ }
    })()
    return () => { cancelled = true }
  }, [person])

  const team = live.tables.team.rows
  const names = useMemo(() => new Map(team.map(u => [u.id, personLabel(u.name, u.email)])), [team])
  const nameOf = useCallback((id: string | null | undefined) => (id ? names.get(id) ?? null : null), [names])
  const assignees: Assignee[] = useMemo(
    () => team
      .filter(u => POSTING_ROLES.includes(String(u.role)) && u.active_status !== false)
      .map(u => ({ id: u.id, name: personLabel(u.name, u.email) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [team])

  const clients = live.tables.clients.rows
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])
  const platformOf = useMemo(() => {
    const m = new Map((accounts ?? []).map(a => [a.id, a.platform]))
    return (id: string) => m.get(id) ?? null
  }, [accounts])
  const itemTitle = useMemo(() => new Map(live.tables.items.rows.map(i => [i.id, i.title])), [live.tables.items.rows])

  /** the client's own approval setting, for the steps a post starts from */
  const clientOf = useCallback((post: Pick<PostState, 'client_id'>) => {
    const c = clientById.get(post.client_id)
    return c ? { client_approval_required: c.client_approval_required } : null
  }, [clientById])

  const choicesFor = useCallback((post: Pick<PostState, 'client_id'>): ClientRecipient[] => {
    const c = clientById.get(post.client_id)
    return clientRecipients(c ?? null, contacts.filter(x => x.client_id === post.client_id))
  }, [clientById, contacts])

  /** every post with a stage, as the rules read it */
  const states = useMemo(() => {
    const out: PostState[] = []
    let unstaged = 0
    for (const r of postRows) {
      const s = readPostState(r as unknown as Record<string, unknown>)
      if (s) out.push(s)
      else unstaged++
    }
    return { posts: out, unstaged }
  }, [postRows])

  const visible = useMemo(
    () => (person ? states.posts.filter(p => postVisibleTo(p, person, live.tables.assignments.rows)) : []),
    [states.posts, person, live.tables.assignments.rows])

  const decorate = useCallback((post: PostState): BoardPost => {
    const client = clientById.get(post.client_id) ?? null
    const ctx: Omit<TransitionContext, 'now'> = {
      accounts,
      clientHasContact: choicesFor(post).length > 0,
      client: client ? { client_approval_required: client.client_approval_required } : null,
    }
    return {
      post,
      hats: hatsFor(person, post),
      ctx,
      face: postCardFace(post, {
        now: clock.now,
        today: clock.today,
        clientName: client?.name ?? null,
        client: ctx.client,
        sourceTitle: post.source_item_id ? itemTitle.get(post.source_item_id) ?? null : null,
        nameOf,
        platformOf: accounts ? platformOf : undefined,
        zone: client?.timezone ?? null,
      }),
    }
  }, [clientById, accounts, choicesFor, person, clock, itemTitle, nameOf, platformOf])

  const onLanes = useMemo(
    () => visible.filter(p => onBoard(p, clock.now)).map(decorate),
    [visible, clock.now, decorate])
  const cancelled = useMemo(() => {
    const cutoff = Date.parse(clock.now) - CANCELLED_DAYS * 24 * 60 * 60_000
    return visible
      .filter(p => p.stage === 'cancelled' && !(Date.parse(p.stage_at ?? '') < cutoff))
      .sort((a, b) => String(b.stage_at ?? '').localeCompare(String(a.stage_at ?? '')))
      .map(decorate)
  }, [visible, clock.now, decorate])

  /**
   * EDITS READY TO BECOME POSTS (SPEC §4.2 source tray): an edit approved for
   * posting that has no live post yet. Not a lane — an edit card is a source
   * of files, never a post (audit B3, L5). An upload made on Schedule is its
   * own post from the start, and an edit the client posts themselves is not
   * ours to post, so neither is here.
   */
  const sources = useMemo(
    () => readyToBecomePosts(live.items as LiveItem[], sourcesWithLivePost(postRows as unknown as Record<string, unknown>[])),
    [live.items, postRows])

  return {
    clock,
    loading: live.loading || postsLoading,
    onLanes,
    cancelled,
    sources,
    unstaged: states.unstaged,
    clients,
    nameOf,
    assignees,
    choicesFor,
    clientOf,
    accountsLoaded: accounts !== null,
  }
}
