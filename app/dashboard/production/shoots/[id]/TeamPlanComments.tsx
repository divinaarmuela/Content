'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PlanCommentsProvider, type PlanCommentRow } from '../../../../components/PlanComments'
import { useProductionLive, type ProductionChange } from '../../useProductionLive'

/**
 * THE TEAM'S SIDE OF COMMENTS ON THE PLAN'S WORDS (29 Oct 2026). The shoot page's boxes hand over the words picked in them
 * (PlanComments.usePickFromBox); this loads the shoot's comments — the client's from the portal and the team's own — keeps
 * them live as the team thread does, and posts, replies and resolves through the team's thread route.
 */
type Row = PlanCommentRow & { team_users?: { name?: string | null; role?: string | null } | null }

export default function TeamPlanComments({ batchId, children }: { batchId: string; children: React.ReactNode }) {
  const [rows, setRows] = useState<PlanCommentRow[]>([])
  const load = useCallback(async () => {
    const res = await fetch(`/api/production/batches/${batchId}/comments`).catch(() => null)
    if (!res?.ok) return
    const json = await res.json().catch(() => ({}))
    setRows(((json.comments ?? []) as Row[]).map(c => ({
      ...c,
      author_name: c.team_users?.name ?? null,
      from_team: (c.team_users?.role ?? 'client') !== 'client',
    })))
  }, [batchId])
  useEffect(() => { void load() }, [load])
  const onLive = useCallback((change?: ProductionChange) => {
    if (!change || change.item_id === `batch:${batchId}`) void load()
  }, [batchId, load])
  useProductionLive(onLive)

  const post = useCallback(async (input: { body: string; part?: string; quote?: string; parent_id?: string }) => {
    const res = await fetch(`/api/production/batches/${batchId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: input.body, anchor_part: input.part, anchor_quote: input.quote, parent_id: input.parent_id }),
    }).catch(() => null)
    const j = await res?.json().catch(() => ({}))
    if (!res?.ok) { toast.error(j?.error ?? 'That comment did not go through — try again.'); return false }
    void load()
    return true
  }, [batchId, load])
  const resolve = useCallback(async (commentId: string, on: boolean) => {
    const res = await fetch(`/api/production/batches/${batchId}/comments`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment_id: commentId, resolved: on }),
    }).catch(() => null)
    if (!res?.ok) { toast.error('That did not go through — try again.'); return false }
    void load()
    return true
  }, [batchId, load])

  return <PlanCommentsProvider comments={rows} canComment post={post} resolve={resolve}>{children}</PlanCommentsProvider>
}
