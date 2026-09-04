import { NextResponse } from 'next/server'
import { parseReport, verifyCallback, CALLBACK_SIGNATURE_HEADER } from '../../../../lib/encoder'
import { settleEncodeJob } from '../../../../lib/encode-jobs'

/**
 * The encoder telling us how a copy went.
 *
 * PUBLIC by necessity — the encoder is a machine on Fly with no session — and
 * therefore verified before a word of it is believed. What this endpoint
 * writes ends up as the file sent to a client's real Instagram, so an
 * unsigned "job's done, here's the video" POST would be somebody else's
 * footage on somebody else's account. The signature is an HMAC of
 * `${timestamp}.${body}` under ENCODER_CALLBACK_SECRET, and the timestamp is
 * inside the signed string so an old delivery cannot be replayed.
 *
 * The row is moved with a claim, never a check-then-write (CLAUDE.md trap
 * 11). The encoder retries its report up to four times, so a duplicate
 * delivery is normal: it lands on a row that is already settled, changes
 * nothing, and is answered 200 — because 4xx would make the encoder retry a
 * message that arrived perfectly well.
 */

export const runtime = 'nodejs'
// the body must be read as raw text for the signature; nothing here is cached
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const raw = await req.text()

  const verified = verifyCallback(raw, req.headers.get(CALLBACK_SIGNATURE_HEADER))
  if (!verified.ok) {
    console.warn('[encode callback] refused:', verified.why)
    return NextResponse.json({ error: verified.why }, { status: 401 })
  }

  let body: unknown
  try { body = JSON.parse(raw) } catch { body = null }
  const report = parseReport(body)
  if (!report) return NextResponse.json({ error: 'no job in that report' }, { status: 400 })

  const settled = await settleEncodeJob({
    id: report.jobId,
    ok: report.ok,
    bytes: report.bytes,
    width: report.width,
    height: report.height,
    durationSec: report.durationSec,
    videoKbps: report.videoKbps,
    error: report.error ?? null,
  })

  // A report about a job that was already settled — or one we have no row for
  // — is not an error to the encoder. It did its part; there is simply
  // nothing left to change.
  if (!settled.settled) {
    return NextResponse.json({ ok: true, changed: false })
  }

  /**
   * Now wake anything that was waiting on this copy.
   *
   * Sent AFTER the row is written, so the function it triggers reads a
   * settled row rather than racing the write that settles it. Best effort:
   * the copy is recorded either way, and the publish dispatcher's ten-minute
   * sweep is the backstop if the event never lands.
   *
   * (CLAUDE.md trap 5b — `media/encode.finished` does nothing until the app
   * is re-synced with Inngest after deploying.)
   */
  try {
    const { inngest } = await import('../../../../inngest/client')
    await inngest.send({
      name: 'media/encode.finished',
      data: {
        jobId: report.jobId,
        sourceUrl: settled.row?.source_url ?? null,
        platform: settled.row?.platform ?? null,
        ok: report.ok,
      },
    })
  } catch (e) {
    console.error('[encode callback] could not announce the finished copy:', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ ok: true, changed: true })
}
