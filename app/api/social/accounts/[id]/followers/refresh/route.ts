import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../../lib/authz'
import { assertClientAccess } from '../../../../../../lib/social-schedule'
import { inngest } from '../../../../../../inngest/client'
import { followersEnabled, latestSnapshot } from '../../../../../../lib/followers'
import { refreshAllowed, snapshotBucket, snapshotId } from '../../../../../../lib/followers-core'

/**
 * "Refresh now" — look at this account's newest followers again, today.
 *
 * An account manager or a super admin, on a client they are on. Once an
 * hour per account: the verdict here is the polite refusal with a time, and
 * the snapshot row's hour bucket (claimed by the job) is the guard that
 * holds when two people press it at once. `{ full: true }` asks for the
 * whole list instead — the same read the monthly look does.
 *
 * The event is the same one the morning cron sends, so there is one code
 * path with two triggers.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { full?: unknown }

      const account = await table<SocialAccount>('social_accounts').get(id)
      if (!account || !account.client_id) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      await assertClientAccess(user, account.client_id)
      if (account.platform !== 'instagram') {
        return NextResponse.json({ error: 'Only Instagram accounts have a follower list here' }, { status: 400 })
      }
      if (!followersEnabled()) return NextResponse.json({ error: 'Not switched on.' }, { status: 400 })

      const now = new Date()
      const verdict = refreshAllowed(await latestSnapshot(account.id), now)
      if (!verdict.ok) {
        return NextResponse.json({
          error: verdict.reason === 'running'
            ? 'A look is already under way. Give it a few minutes.'
            : 'Looked at less than an hour ago. Try again a little later.',
          retryAt: verdict.retryAt,
        }, { status: 429 })
      }

      const mode = body.full === true ? 'full' as const : 'top' as const
      const dedupe = snapshotId(account.id, mode, snapshotBucket('manual', now))
      await inngest.send({
        name: 'app/followers.snapshot.requested',
        data: { accountId: account.id, mode, trigger: 'manual' as const, dedupe },
      })
      return NextResponse.json({ ok: true, mode })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
