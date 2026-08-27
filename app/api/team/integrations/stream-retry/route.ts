import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse, AuthzError } from '@/app/lib/authz'
import { retryFailedPreviews, streamConfigured } from '@/app/lib/stream'

export const dynamic = 'force-dynamic'

/**
 * "Retry failed" — ask Cloudflare again for the previews that did not encode.
 *
 * Encodes fail for reasons that pass: a transient fetch of the R2 object, a
 * file that was still uploading when Stream reached for it. Without this the
 * only cure is a fresh upload of the same file, because the claim row records
 * that we already tried.
 *
 * Super-admin only, and enforced here rather than by hiding the button: this
 * deletes video at Cloudflare and pays to make it again.
 */
export async function POST() {
  try {
    await requireRole('super_admin')
    if (!streamConfigured()) {
      throw new AuthzError(
        'Cloudflare Stream is not configured — set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_TOKEN first',
        400,
      )
    }
    const { retried } = await retryFailedPreviews()
    return NextResponse.json({
      ok: true,
      retried,
      message: retried > 0
        ? `Re-queued ${retried} video${retried === 1 ? '' : 's'} — each takes a few minutes`
        : 'Nothing to retry — no preview has failed in the last seven days',
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
