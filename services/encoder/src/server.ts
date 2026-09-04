import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { runEncode, loggerFor, safeUrl, type EncodeRequest, type EncodeResult } from './encode.js'
import { targetProblem, type EncodeTarget } from './ladder.js'
import { JobQueue } from './queue.js'
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
 * Env, all read at start-up because a machine with no token must not boot
 * pretending to be safe:
 *   ENCODER_TOKEN            the bearer every /encode must carry
 *   ENCODER_CALLBACK_SECRET  what the callback is signed with
 *   PORT                     8080 on Fly
 */

const PORT = Number(process.env.PORT ?? 8080)
const TOKEN = process.env.ENCODER_TOKEN ?? ''
const CALLBACK_SECRET = process.env.ENCODER_CALLBACK_SECRET ?? ''

/** A body bigger than this is not a job description, it is an attack. */
const MAX_BODY_BYTES = 64 * 1024

const queue = new JobQueue()

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

/** Only https, and only somewhere that is not this machine's own network. */
function usableUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:') return null
  return url.toString()
}

type ParsedJob = { job: EncodeRequest } | { problem: string }

export function parseJob(raw: unknown): ParsedJob {
  const body = (raw ?? {}) as Record<string, unknown>
  const jobId = String(body.jobId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return { problem: 'jobId is missing or not a plain id' }

  const sourceUrl = usableUrl(body.sourceUrl)
  if (!sourceUrl) return { problem: 'sourceUrl must be an https URL' }
  const uploadUrl = usableUrl(body.uploadUrl)
  if (!uploadUrl) return { problem: 'uploadUrl must be an https URL' }
  const callbackUrl = usableUrl(body.callbackUrl)
  if (!callbackUrl) return { problem: 'callbackUrl must be an https URL' }

  const problem = targetProblem(body.target as Partial<EncodeTarget>)
  if (problem) return { problem }

  return { job: { jobId, sourceUrl, uploadUrl, callbackUrl, target: body.target as EncodeTarget } }
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
    // machine with auto-stop on does not idle for minutes waiting to retry
    if (attempt < 4) await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)))
  }
  log('gave up reporting; the app will ask again')
}

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? '/'

    if (req.method === 'GET' && (url === '/health' || url === '/health/')) {
      send(res, 200, { ok: true, jobs: queue.depth, configured: Boolean(TOKEN && CALLBACK_SECRET) })
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

    const parsed = parseJob(parsedBody)
    if ('problem' in parsed) {
      send(res, 400, { error: parsed.problem })
      return
    }
    const { job } = parsed

    // a retried POST for a job already in the line is the same job
    if (queue.has(job.jobId)) {
      send(res, 202, { accepted: true, jobId: job.jobId, note: 'already queued' })
      return
    }

    const accepted = queue.add(job.jobId, async () => {
      const result = await runEncode(job)
      await report(job, result)
    })
    if (!accepted) {
      send(res, 503, { error: 'busy', jobs: queue.depth })
      return
    }

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
  console.log(`[encoder] listening on ${PORT}; token ${TOKEN ? 'set' : 'MISSING'}, callback secret ${CALLBACK_SECRET ? 'set' : 'MISSING'}`)
})

/** Fly stops the machine with SIGTERM; finish the answer, then go. */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[encoder] ${signal}: closing`)
    server.close(() => process.exit(0))
    // a running encode is worth a minute of grace; past that the app retries
    setTimeout(() => process.exit(0), 60_000).unref()
  })
}
