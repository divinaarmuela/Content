'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import type { ScopeViewer } from '../../lib/production-access-core'
import { laneFromAddress } from '../../lib/post-board-core'
import { postWaitingRows } from '../../lib/post-waiting-core'
import { useRole } from '../useRole'
import { AccountUnavailable } from '../production/shoot-ui'
import GettingStarted from '../GettingStarted'
import NoReviewerBanner from '../ui/NoReviewerBanner'
import { CardSheet, useCardSheet } from '../board/CardSheet'
import WaitingOnYou from './WaitingOnYou'
import { PostBoard } from './board/PostBoard'
import SourceTray from './board/SourceTray'
import { usePostActs } from './board/usePostActs'
import { usePostBoard } from './board/usePostBoard'

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
 *   1. Waiting on you — the posts somebody is held up by (`post-waiting-core`).
 *   2. Edits ready to become posts — a tray, not a lane (`SourceTray`).
 *   3. The board — Draft · Quality check · With client · Approved, and the
 *      cancelled posts folded under it (`PostBoard`).
 *
 * Every button on all three is from `boardActions` (post-board-core, which
 * narrows `postActions` to this page's moves) and is sent by `usePostActs` to
 * the one act route. A card opens the post window.
 *
 * Addresses: `?lane=` (or the old `?column=`) opens a lane on a phone;
 * `?post=<id>` outlines that post; `?item=<id>` / `?card=<id>` (the bell and
 * older emails) outline the posts made from that edit, or open the edit when
 * it has none yet.
 */
export default function PostApprovalPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<ScopeViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true } : null), [me])
  const data = usePostBoard(viewer)
  const acts = usePostActs({ choicesFor: data.choicesFor, assignees: data.assignees, nameOf: data.nameOf })
  const sheet = useCardSheet()

  /* ── narrowing to one client, for people who look across many ── */
  const [clientId, setClientId] = useState<string>('')
  const clientsOnBoard = useMemo(() => {
    const seen = new Map<string, string>()
    for (const bp of [...data.onLanes, ...data.cancelled]) seen.set(bp.post.client_id, bp.face.client)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data.onLanes, data.cancelled])
  const lanes = useMemo(
    () => (clientId ? data.onLanes.filter(bp => bp.post.client_id === clientId) : data.onLanes),
    [data.onLanes, clientId])
  const cancelled = useMemo(
    () => (clientId ? data.cancelled.filter(bp => bp.post.client_id === clientId) : data.cancelled),
    [data.cancelled, clientId])
  const sources = useMemo(
    () => (clientId ? data.sources.filter(i => i.client_id === clientId) : data.sources),
    [data.sources, clientId])

  const waiting = useMemo(() => {
    if (!viewer) return []
    const byId = new Map(lanes.map(bp => [bp.post.id, bp]))
    return postWaitingRows(lanes.map(bp => bp.post), viewer, data.clock.now,
      post => ({ face: byId.get(post.id)!.face, ctx: byId.get(post.id)!.ctx }))
  }, [lanes, viewer, data.clock.now])

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
      if (all.some(bp => bp.post.id === postId)) setFocus(new Set([postId]))
      else toast.error('That post is not on this board. It may have gone out more than two weeks ago, or been deleted.')
      return
    }
    if (itemId) {
      const made = all.filter(bp => bp.post.source_item_id === itemId).map(bp => bp.post.id)
      if (made.length > 0) setFocus(new Set(made))
      else sheet.open(itemId)
    }
  }, [ready, data.onLanes, data.cancelled, sheet])

  if (noAccount) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      {ready && <GettingStarted role={viewer.role} page="scheduler" />}
      {ready && <NoReviewerBanner me={me} />}

      {ready && (
        <WaitingOnYou rows={waiting} busyId={acts.busyId} errorFor={acts.errorFor} onPress={acts.press} />
      )}

      {ready && <SourceTray items={sources} onOpenEdit={sheet.open} nameOf={data.nameOf} />}

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
          {clientsOnBoard.length > 1 && (
            <label className="inline-flex h-11 w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] font-semibold text-muted-foreground">
              Client
              <select aria-label="Show one client" value={clientId} onChange={e => setClientId(e.target.value)}
                className="h-9 bg-transparent text-[13px] font-semibold text-foreground outline-none">
                <option value="">Every client</option>
                {clientsOnBoard.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <PostBoard
            posts={lanes}
            cancelled={cancelled}
            now={data.clock.now}
            busyId={acts.busyId}
            errorFor={acts.errorFor}
            onPress={acts.press}
            initialLane={initialLane}
            focus={focus}
          />
        </>
      )}

      {acts.dialogs}
      {/* an edit from the tray, opened beside the board — the edit's own card */}
      <CardSheet id={sheet.cardId} onClose={sheet.close} />
    </div>
  )
}
