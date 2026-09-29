import type { Page } from '@playwright/test'
import { E2E } from './env'
import { BY_LINK, actTo, saveDraft, uploadDraft, type PostRow } from './posts'

type Made = { post(postId: string, itemId?: string): void }

/** A short tag that makes this run's captions and file names unique and findable. */
export function runTag(journey: string): string {
  return `${journey}-${Date.now().toString(36)}`
}

/**
 * A draft with real content: the scheduler uploads `count` test images on
 * Schedule, then its caption, channels and time are saved. Recorded with
 * `made` the moment it exists, so a failure after this line still cleans up.
 */
export async function makeDraft(scheduler: Page, made: Made, opts: {
  tag: string
  count?: number
  caption?: string
  channels?: ('instagram' | 'linkedin')[]
  scheduledFor?: string | null
}): Promise<PostRow> {
  const { postId, itemId } = await uploadDraft(scheduler, { count: opts.count, tag: opts.tag })
  made.post(postId, itemId)
  const channels = (opts.channels ?? ['instagram', 'linkedin']).map(n => E2E.channels[n])
  return saveDraft(scheduler.request, postId, {
    caption: opts.caption ?? `E2E ${opts.tag}`,
    channels,
    ...(opts.scheduledFor !== undefined ? { scheduled_for: opts.scheduledFor } : {}),
  })
}

/** Draft → Quality check (scheduler) → Passed — send to client, by link (reviewer). */
export async function toClient(scheduler: Page, reviewer: Page, postId: string): Promise<PostRow> {
  await actTo(scheduler.request, postId, { action: 'send_to_qc' }, 'quality_check')
  const post = await actTo(reviewer.request, postId, { action: 'pass_send_client', version: await frozenVersion(reviewer, postId), ...BY_LINK }, 'with_client')
  return post
}

/** Draft → Quality check → Passed (Ready to post). */
export async function toReady(scheduler: Page, reviewer: Page, postId: string): Promise<PostRow> {
  await actTo(scheduler.request, postId, { action: 'send_to_qc' }, 'quality_check')
  return actTo(reviewer.request, postId, { action: 'pass', version: await frozenVersion(reviewer, postId) }, 'ready')
}

/** The version frozen at the last send — what a reviewer or manager "looked at". */
export async function frozenVersion(page: Page, postId: string): Promise<number> {
  const res = await page.request.get(`/api/social/schedule/${encodeURIComponent(postId)}`)
  const { post } = await res.json() as { post: PostRow & { version?: number } }
  const v = Number(post.sent_version ?? post.version ?? 1)
  return Number.isInteger(v) && v > 0 ? v : 1
}
