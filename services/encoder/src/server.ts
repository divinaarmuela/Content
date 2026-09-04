import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { ENCODE_TIMEOUT_MS, runEncode, loggerFor, safeUrl, type EncodeRequest, type EncodeResult } from './encode.js'
import { JobQueue } from './queue.js'
import { parseJob as parseJobWith } from './request.js'
import { SIGNATURE_HEADER, signCallback } from './sign.js'

/**
 * The whole service: two routes and a queue.
 *
 *   GET  /health   is Fly's check, and says nothing secret
 *   POST /encode   takes one job, answers 202 at once, and reports later
 *
 * `/encode` answers before the work starts because the work is minutes long
 * and the caller is an Inngest step with a request timeout. The answer to
 * "did it work" comes back as a signed POST to `callbackUrl`, which is the
 * only thing the app acts on.
 *
 * ── Why this machine stops ITSELF ──
 *
 * Fly Proxy decides a machine is idle from IN-FLIGHT REQUESTS, and this
 * design deliberately has none: the POST returns in milliseconds and then
 * ffmpeg runs for two to forty-five minutes with no open connection. With
 * `auto_stop_machines` on, Fly's idle sweep would stop the machine in the
 * middle of an encode — no callback, no error, and a client's post waiting
 * forever. So auto-stop is OFF in fly.toml and the machine decides for
 * itself: it exits cleanly once the queue has been empty for five minutes,
 * and never while a job is running. Scale-to-zero, but on the one clock that
 * knows what this box is doing.
 *
 * Env, all read at start-up because a machine with no token must not boot
 * pretending to be safe:
 *   ENCODER_TOKEN            the bearer every /encode must carry
 *   ENCODER_CALLBACK_SECRET  what the callback is signed with
 *   ENCODER_SOURCE_HOSTS     comma-separated hosts a source may come from
 *                            (the R2 public base); unset falls back to
 *                            refusing private and loopback addresses
 *   PORT                     8080 on Fly
 */

const PORT = Number(process.env.PORT ?? 8080)
const TOKEN = process.env.ENCODER_TOKEN ?? ''
const CALLBACK_SECRET = process.env.ENCODER_CALLBACK_SECRET ?? ''
const SOURCE_HOSTS = (process.env.ENCODER_SOURCE_HOSTS ?? '')
  .split(',').map(h => h.trim().toLowerCase()).filter(Boolean)

/** A body bigger than this is not a job description, it is an attack. */
const MAX_BODY_BYTES = 64 * 1024

/** How long the queue may stay empty before the machine stops itself. */
export const IDLE_EXIT_MS = 5 * 60 * 1000
/** How often that is checked. */
const IDLE_TICK_MS = 30 * 1000

const queue = new JobQueue()
/** The job being encoded, so a crash can still report a failure for it. */
let currentJob: EncodeRequest | null = null
/** The last moment this machine had anything to do. */
let lastBusyAt = Date.now()
/** Set once we are on the way out; no new work is taken after this. */
let stopping = false

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('the request body is too big'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Constant-time bearer check, so the token cannot be guessed a byte at a time. */
function authorised(req: IncomingMessage): boolean {
  if (!TOKEN) return false
  const header = String(req.headers.authorization ?? '')
  const given = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (given.length !== TOKEN.length) return false
  let diff = 0
  for (let i = 0; i < TOKEN.length; i++) diff |= given.charCodeAt(i) ^ TOKEN.charCodeAt(i)
  return diff === 0
}

/** Tell the app what happened, with a few tries — this is the only report. */
async function report(job: EncodeRequest, result: EncodeResult): Promise<void> {
  const log = loggerFor(job.jobId)
  const payload = JSON.stringify(result)
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(job.callbackUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signCallback(payload, CALLBACK_SECRET),
        },
        body: payload,
      })
      if (res.ok) { log('reported', { ok: result.ok }); return }
      log('callback refused', { status: res.status, attempt })
    } catch (e) {
      log('callback failed', { attempt, error: e instanceof Error ? e.message : String(e) })
    }
    // 2s, 4s, 8s — long enough to ride out a deploy, short enough that a
    // machine on an idle clock does not sit for minutes waiting to retry
    if (attempt < 4) await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)))
  }
  log('gave up reporting; the sweep will settle this row')
}

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? '/'

    if (req.method === 'GET' && (url === '/health' || url === '/health/')) {
      send(res, 200, {
        ok: true,
        jobs: queue.depth,
        configured: Boolean(TOKEN && CALLBACK_SECRET),
        sourceHostsPinned: SOURCE_HOSTS.length > 0,
      })
      return
    }

    if (req.method !== 'POST' || !url.startsWith('/encode')) {
      send(res, 404, { error: 'not found' })
      return
    }

    if (!authorised(req)) {
      send(res, 401, { error: 'not allowed' })
      return
    }
    if (!CALLBACK_SECRET) {
      send(res, 500, { error: 'this machine has no callback secret; nothing could be reported back' })
      return
    }
    if (stopping) {
      // on the way out: the app must ask a machine that will still be here
      send(res, 503, { error: 'busy', jobs: queue.depth })
      return
    }

    let raw: string
    try { raw = await readBody(req) } catch (e) {
      send(res, 413, { error: e instanceof Error ? e.message : 'the request body could not be read' })
      return
    }
    let parsedBody: unknown
    try { parsedBody = JSON.parse(raw || '{}') } catch {
      send(res, 400, { error: 'the request body is not JSON' })
      return
    }

    const parsed = parseJobWith(parsedBody, SOURCE_HOSTS)
    if ('problem' in parsed) {
      send(res, 400, { error: parsed.problem })
      return
    }
    const { job } = parsed

    // a retried POST for a job already here — running OR waiting — is the
    // same job, and encoding it twice is twenty minutes of wasted CPU and two
    // PUTs to one presigned URL
    if (queue.has(job.jobId)) {
      send(res, 202, { accepted: true, jobId: job.jobId, note: 'already queued' })
      return
    }

    const accepted = queue.add(job.jobId, async () => {
      currentJob = job
      try {
        const result = await runEncode(job)
        await report(job, result)
      } finally {
        currentJob = null
      }
    })
    if (!accepted) {
      send(res, 503, { error: 'busy', jobs: queue.depth })
      return
    }

    lastBusyAt = Date.now()
    loggerFor(job.jobId)('accepted', { platform: job.target.platform, source: safeUrl(job.sourceUrl), queued: queue.depth })
    send(res, 202, { accepted: true, jobId: job.jobId, jobs: queue.depth })
  })().catch(e => {
    console.error('request failed:', e instanceof Error ? e.message : e)
    if (!res.headersSent) send(res, 500, { error: 'something went wrong' })
  })
})

// a 2 GB upload over a slow line must not be cut off by the default 5-minute
// header timeout, and a job POST is tiny either way
server.requestTimeout = 0
server.headersTimeout = 60_000

server.listen(PORT, () => {
  console.log(
    `[encoder] listening on ${PORT}; token ${TOKEN ? 'set' : 'MISSING'},`
    + ` callback secret ${CALLBACK_SECRET ? 'set' : 'MISSING'},`
    + ` source hosts ${SOURCE_HOSTS.length ? SOURCE_HOSTS.join(' ') : 'NOT PINNED'}`,
  )
})

/**
 * Stop the machine once it has had nothing to do for five minutes.
 *
 * This is what replaces Fly's auto-stop, which cannot see an encode that has
 * no open connection. Never fires while anything is queued or running.
 */
const idleTimer = setInterval(() => {
  if (queue.depth > 0) { lastBusyAt = Date.now(); return }
  if (Date.now() - lastBusyAt < IDLE_EXIT_MS) return
  console.log('[encoder] idle; stopping. Fly will start a machine when the next job arrives.')
  stopping = true
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5_000).unref()
}, IDLE_TICK_MS)
idleTimer.unref()

/**
 * A stop from outside — a deploy, a host event — waits for the encode.
 *
 * Killing a running job means no callback, and no callback means a client's
 * post waits until the app's sweep gives up on it an hour and a half later.
 * The wait is bounded by the encode timeout, because past that the job was
 * going to fail anyway.
 */
async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  console.log(`[encoder] ${signal}: finishing ${queue.depth} job(s) before closing`)
  server.close()
  const deadline = Date.now() + ENCODE_TIMEOUT_MS
  while (queue.depth > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2_000))
  }
  if (queue.depth > 0) console.error('[encoder] gave up waiting; a job is still running')
  process.exit(0)
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { void shutdown(signal) })
}

/**
 * The crash nobody predicted still has to tell the app.
 *
 * `runEncode` never throws and the queue catches, so nothing here is expected
 * — but on a 2 GB box the one crash worth surviving is the unexpected one,
 * and a crash that says nothing leaves a row `running` and a post waiting.
 */
function crashed(what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[encoder] ${what}:`, message)
  const job = currentJob
  if (!job || !CALLBACK_SECRET) { process.exit(1); return }
  currentJob = null
  void report(job, {
    jobId: job.jobId, ok: false, bytes: null, durationSec: null,
    width: null, height: null, videoKbps: null,
    error: `the encoder stopped unexpectedly: ${message}`,
  }).finally(() => process.exit(1))
  // never hang on the way out
  setTimeout(() => process.exit(1), 20_000).unref()
}
process.on('uncaughtException', e => crashed('uncaught exception', e))
process.on('unhandledRejection', e => crashed('unhandled rejection', e))
