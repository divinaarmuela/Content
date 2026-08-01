import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { scanInbox } from '../../../lib/email-lead'
import { runLeadsReportTick } from '../../../lib/report-send'

export const maxDuration = 300 // scanning + classification can take a while

/** Trigger an inbox scan. Two callers:
 *  - Vercel Cron / external scheduler: Authorization: Bearer <CRON_SECRET>
 *  - Dashboard "Scan inbox" button: signed-in Clerk session
 *  (This route is intentionally NOT in the Clerk-protected matcher, so the
 *  cron can reach it — auth is enforced here instead.) */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const isCron = Boolean(cronSecret && bearer && bearer === cronSecret)

  if (!isCron) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not set — add it to .env.local to enable inbox classification' },
      { status: 503 }
    )
  }

  // The dashboard asks for a stream so it can show progress as it happens.
  // Cron and any other caller get the single JSON object they expect.
  if (req.headers.get('accept')?.includes('application/x-ndjson')) {
    return streamScan()
  }

  try {
    const result = await scanInbox()
    // piggyback the monthly report tick on the same schedule — one cron
    // covers both; the tick no-ops except on the configured send day
    const report = await runLeadsReportTick().catch(() => ({ skipped: 'tick error' }))
    return NextResponse.json({ ...result, report })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Scan failed'
    if (/relation .*email_ingest_log/i.test(msg)) {
      return NextResponse.json(
        { error: 'Run supabase/email_ingest.sql in the Supabase SQL editor first' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** Newline-delimited JSON: one event per line, flushed as the scan progresses.
 *  Each line is a ScanEvent; the final line is either `done` or `fatal`. */
function streamScan(): Response {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        } catch {
          // client navigated away mid-scan; the scan itself continues and its
          // results are already durable in email_ingest_log
        }
      }

      try {
        await scanInbox(write)
        const report = await runLeadsReportTick().catch(() => ({ skipped: 'tick error' }))
        write({ type: 'report', report })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Scan failed'
        write({
          type: 'fatal',
          message: /relation .*email_ingest_log/i.test(msg)
            ? 'Run supabase/email_ingest.sql in the Supabase SQL editor first'
            : msg,
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // stop proxies buffering the stream into one lump at the end
      'X-Accel-Buffering': 'no',
    },
  })
}

/** Vercel Cron sends GET — same auth, same scan. */
export async function GET(req: Request) {
  return POST(req)
}
