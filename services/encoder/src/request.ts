import { targetProblem, type EncodeTarget } from './ladder.js'
import type { EncodeRequest } from './encode.js'

/**
 * Reading one job description, and refusing every shape of it that is not one.
 *
 * Pure, and separate from `server.ts` so it can be tested without a socket:
 * importing the server starts one. Everything here is a refusal rule, and a
 * refusal rule that has never been run is a hope.
 */

/**
 * An address this machine must never be talked into fetching.
 *
 * Loopback, link-local and the three private ranges — the shapes a server-side
 * request forgery takes, including Fly's own internal network and a cloud
 * metadata endpoint. Hostnames are not resolved here (that would be a race
 * against DNS); the real guard is the host allow-list below, and this is what
 * is left when nobody has configured one.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true
  if (h === '::1' || h.startsWith('fd') || h.startsWith('fe80:')) return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 127 || a === 0 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true          // link-local, and AWS metadata
  return false
}

/** Only https, and only somewhere a source of ours could actually live. */
export function sourceUrlProblem(value: unknown, hosts: string[] = []): string | null {
  if (typeof value !== 'string' || !value) return 'sourceUrl must be an https URL'
  let url: URL
  try { url = new URL(value) } catch { return 'sourceUrl must be an https URL' }
  if (url.protocol !== 'https:') return 'sourceUrl must be an https URL'
  const host = url.hostname.toLowerCase()
  if (hosts.length > 0) {
    if (!hosts.includes(host)) return 'sourceUrl is not on this workspace’s file storage'
  } else if (isPrivateHost(host)) {
    return 'sourceUrl is not a public address'
  }
  return null
}

/** Only https, for the two URLs the app itself mints. */
function usableUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:') return null
  return url.toString()
}

type ParsedJob = { job: EncodeRequest } | { problem: string }

export function parseJob(raw: unknown, hosts: string[] = []): ParsedJob {
  const body = (raw ?? {}) as Record<string, unknown>
  const jobId = String(body.jobId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return { problem: 'jobId is missing or not a plain id' }

  const sourceProblem = sourceUrlProblem(body.sourceUrl, hosts)
  if (sourceProblem) return { problem: sourceProblem }
  const sourceUrl = String(body.sourceUrl)

  const uploadUrl = usableUrl(body.uploadUrl)
  if (!uploadUrl) return { problem: 'uploadUrl must be an https URL' }
  const callbackUrl = usableUrl(body.callbackUrl)
  if (!callbackUrl) return { problem: 'callbackUrl must be an https URL' }

  const problem = targetProblem(body.target as Partial<EncodeTarget>)
  if (problem) return { problem }

  return { job: { jobId, sourceUrl, uploadUrl, callbackUrl, target: body.target as EncodeTarget } }
}
