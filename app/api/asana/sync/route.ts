import { NextResponse } from 'next/server'
import { guard } from '@/app/lib/authz'
import { reconcileAll } from '@/app/lib/asana-sync'

/**
 * Reconciliation, triggerable by an external scheduler.
 *
 * Same shape as /api/ingest/email: a bearer CRON_SECRET for machines, a role
 * check for humans. It lives outside the Clerk-protected matcher so a
 * scheduler can reach it, which is exactly why the auth is enforced in the
 * handler instead.
 *
 * This exists because Inngest is not configured on this deployment. The
 * Inngest function and this route call the same `reconcileAll`, so whichever
 * scheduler ends up driving it, the behaviour is identical — and running both
 * is harmless, since the dedup_key constraint makes overlapping passes collide
 * rather than double-count.
 */

export const maxDuration = 300

async function run(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const isCron = Boolean(cronSecret && bearer && bearer === cronSecret)

  if (!isCron) {
    const denied = await guard('account_manager')
    if (denied) return denied
  }

  const result = await reconcileAll()
  return NextResponse.json(result)
}

export const POST = run
/** Most schedulers send GET. */
export const GET = run
