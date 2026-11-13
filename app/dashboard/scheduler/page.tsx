'use client'

import { mayReadClientComments } from '../../lib/client-comments-core'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { matchesSearch } from '../../lib/pager-core'
import type { ScopeViewer } from '../../lib/production-access-core'
import { addressWithClient, clientDropdownChoices, clientFromAddress, laneFromAddress } from '../../lib/post-board-core'
import { useRole } from '../useRole'
import { AccountUnavailable } from '../production/shoot-ui'
import GettingStarted from '../GettingStarted'
import NoReviewerBanner from '../ui/NoReviewerBanner'
import PostWindowFromAddress from './PostWindowFromAddress'
import ClientRound from './board/ClientRound'
import { PostBoard } from './board/PostBoard'
import { usePostActs } from './board/usePostActs'
import { usePostBoard } from './board/usePostBoard'

/** the dropdown's "no one client" choice (the menu cannot hold an empty value) */
const EVERY_CLIENT = 'every'

/**
 * POST APPROVAL (/dashboard/scheduler) — getting a post approved.
 *
 * The owner's decision 1 (29 Sep 2026): two pages, two jobs. This page takes
 * a post from Draft through the quality check and, when it goes to them, the
 * client, to Approved. The Schedule page books approved posts in. Both read
 * the one field, `social_posts.stage`; nothing here reads the edit card's
 * status to decide where a post is (docs/posting-rebuild/SPEC.md §4.2).
 *
 * Top to bottom:
 *   The board — Draft · Quality check · With client · Approved (`PostBoard`). The "waiting on you" block above
 *   it and the Cancelled list under it were taken off the page on 13 Nov 2026 (the owner: "remove this block on
 *   post approval … and remove cancel block"). A cancelled post still says where it went and offers Re-book in
 *   the notice that follows the cancel.
 *
 * Every button on all three is from `boardActions` (post-board-core, which
 * narrows `postActions` to this page's moves) and is sent by `usePostActs` to
 * the one act route. A card opens the post window.
 *
 * Addresses: `?lane=` (or the old `?column=`) opens a lane on a phone;
 * `?post=<id>` opens that post's window HERE (every card, list row and
 * Waiting row links to it — the quality checker has no Schedule page) and
 * outlines its card; `?item=<id>` / `?card=<id>` (the bell and older emails)
 * outline the posts made from that edit.
 *
 * NO EDIT CARDS HERE (the owner, 30 Sep 2026: "what does Team AA Edits doing
 * here"). The rebuild kept a tray of approved edits above the board whose
 * names opened the editor's card — its assignee, edit due date and Drive
 * link — on a page that is about posts. Edits waiting to become posts are on
 * the Schedule page's media rail, where the post is made from them.
 */
export default function PostApprovalPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<ScopeViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true, colourist: me.colourist === true } : null), [me])
  const data = usePostBoard(viewer)
  const acts = usePostActs({ choicesFor: data.choicesFor, assignees: data.assignees, nameOf: data.nameOf, clientOf: data.clientOf })

  /* ── narrowing to one client, for people who look across many ──
   * `?client=<id>` chooses it (live test, 29 Sep 2026: the parameter was ignored), read ONCE as the
   * first state, as Schedule does; the dropdown writes it back into the address, so the link can be
   * shared. Every other part of the address (`?post=`, `?lane=`) is kept. */
  const [clientId, setClientId] = useState<string>(
    () => (typeof window === 'undefined' ? '' : clientFromAddress(window.location.search)))
  useEffect(() => {
    const next = addressWithClient(window.location.search, clientId)
    if (next !== window.location.search) window.history.replaceState(null, '', `${window.location.pathname}${next}`)
  }, [clientId])
  const clientsOnBoard = useMemo(() => {
    const seen = new Map<string, string>()
    // clients with a post in a lane — not those whose only posts are cancelled, which listed names
    // like Bond Street with nothing to show under them (the owner's check of 30 Sep 2026)
    for (const bp of data.onLanes) seen.set(bp.post.client_id, bp.face.client)
    const names = new Map(data.clients.map(c => [c.id, String(c.name ?? '')]))
    return clientDropdownChoices([...seen].map(([id, name]) => ({ id, name })), clientId, id => names.get(id))
  }, [data.onLanes, data.clients, clientId])
  const lanes = useMemo(
    () => (clientId ? data.onLanes.filter(bp => bp.post.client_id === clientId) : data.onLanes),
    [data.onLanes, clientId])
  /* ── the search box: a post's title, its client, its caption ── */
  const [q, setQ] = useState('')
  const found = useMemo(
    () => (q.trim() ? lanes.filter(bp => matchesSearch([bp.face.title, bp.face.client, bp.post.caption], q)) : lanes),
    [lanes, q])

  /* ── what the address names ── */
  const [initialLane, setInitialLane] = useState<string | null>(null)
  const [focus, setFocus] = useState<ReadonlySet<string>>(() => new Set())
  const ready = viewer !== null && !data.loading
  const handledAddress = useRef(false)
  useEffect(() => {
    if (!ready || handledAddress.current) return
    handledAddress.current = true
    let p: URLSearchParams
    try { p = new URLSearchParams(window.location.search) } catch { return }
    setInitialLane(laneFromAddress(p.get('lane') ?? p.get('column')))
    const postId = p.get('post')
    const itemId = p.get('item') ?? p.get('card')
    const all = [...data.onLanes, ...data.cancelled]
    if (postId) {
      // the window opens from the address (PostWindowFromAddress); the card is outlined when it is here
      if (all.some(bp => bp.post.id === postId)) setFocus(new Set([postId]))
      return
    }
    if (itemId) {
      const made = all.filter(bp => bp.post.source_item_id === itemId).map(bp => bp.post.id)
      if (made.length > 0) setFocus(new Set(made))
    }
  }, [ready, data.onLanes, data.cancelled])

  if (noAccount) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      {ready && <GettingStarted role={viewer.role} page="scheduler" />}
      {ready && <NoReviewerBanner me={me} />}

      {ready && data.unstaged > 0 && (
        <p className="rounded-inner border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">
          {data.unstaged === 1 ? '1 older post has' : `${data.unstaged} older posts have`} not been moved to the new stages yet. {data.unstaged === 1 ? 'It shows' : 'They show'} here once the move has run.
        </p>
      )}

      {!ready ? (
        <div role="status" aria-label="Loading the board" aria-busy="true" className="grid gap-3.5 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-card" />)}
        </div>
      ) : (
        <>
          <PostBoard
            toolbar={<>
              {(clientsOnBoard.length > 1 || clientId !== '') && (
                <Select value={clientId || EVERY_CLIENT} onValueChange={v => setClientId(v === EVERY_CLIENT ? '' : v)}>
                  <SelectTrigger aria-label="Show one client" className="h-11 w-[210px] rounded-full bg-surface px-4 text-[13px] font-semibold">
                    <SelectValue placeholder="Every client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EVERY_CLIENT}>Every client</SelectItem>
                    {clientsOnBoard.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <label className="inline-flex h-11 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-4 sm:w-[260px]">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <input type="search" aria-label="Search posts" placeholder="Search posts" value={q} onChange={e => setQ(e.target.value)}
                  className="h-9 w-full min-w-0 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground" />
              </label>
              <ClientRound posts={lanes} now={data.clock.now} choicesFor={data.choicesFor} />
            </>}
            posts={found}
            clientId={clientId}
            mayComments={mayReadClientComments(viewer)}
            now={data.clock.now}
            busyId={acts.busyId}
            errorFor={acts.errorFor}
            onPress={acts.press}
            initialLane={initialLane}
            focus={focus}
            channelsOf={data.channelsOf}
            zoneOf={data.zoneOf}
          />
        </>
      )}

      {acts.dialogs}
      <Suspense fallback={null}><PostWindowFromAddress clientId={clientId} /></Suspense>
    </div>
  )
}
