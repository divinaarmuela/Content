import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { E2E } from './env'
import { testImages } from './images'

/**
 * WHAT A JOURNEY DOES TO A POST — through the same doors a person uses.
 *
 * The UI helpers press the post window's own buttons (`data-action`), answer
 * its question (`data-question` / `data-go`), and read its stage chip
 * (`data-stage-chip`). The API helpers call the one act route
 * (`POST /api/posts/<id>/act`) with the signed-in person's own cookies, for
 * the steps a journey is not testing the screen of.
 *
 * Words are the ones in app/lib/post-stage-core.ts (STAGE_WORDS, the
 * transition table's labels) — copied here as strings on purpose: if a label
 * changes, a journey should fail and a person should look.
 */

export const SCHEDULE = '/dashboard/social/schedule'
export const POST_APPROVAL = '/dashboard/scheduler'

export const STAGE_LABEL = {
  draft: 'Draft',
  quality_check: 'Quality check',
  with_client: 'With client',
  ready: 'Ready to post',
  booked: 'Booked in',
  posted: 'Posted',
  cancelled: 'Cancelled',
} as const
export type Stage = keyof typeof STAGE_LABEL

/** Post approval's columns: "Approved" holds ready, booked and posted (POST_APPROVAL_LANES). */
export const POST_APPROVAL_LANE: Partial<Record<Stage, string>> = {
  draft: 'Draft', quality_check: 'Quality check', with_client: 'With client',
  ready: 'Approved', booked: 'Approved', posted: 'Approved',
}

export type PostRow = {
  id: string
  stage: Stage
  rev: number
  caption: string
  slides: { url: string; type: string }[]
  channels: string[]
  per_channel: Record<string, unknown>
  scheduled_for: string | null
  sent_version: number | null
  client_send: { version: number } | null
  item_id: string
  [k: string]: unknown
}

/* ── reading and moving a post over HTTP ─────────────────────────────── */

export async function getPost(req: APIRequestContext, id: string): Promise<PostRow> {
  const res = await req.get(`/api/social/schedule/${encodeURIComponent(id)}`)
  expect(res.status(), `reading post ${id}`).toBe(200)
  const body = await res.json() as { post: PostRow }
  return body.post
}

export type ActResult = { status: number; body: { ok: boolean; stage?: Stage | 'deleted'; words?: string; reason?: string; code?: string; problems?: string[]; post?: PostRow | null; created_post_id?: string } }

/** One move through the act route, with the post's current `rev` read just before. */
export async function act(req: APIRequestContext, id: string, body: Record<string, unknown>): Promise<ActResult> {
  const { rev } = await getPost(req, id)
  const res = await req.post(`/api/posts/${encodeURIComponent(id)}/act`, { data: { expect_rev: rev, ...body } })
  return { status: res.status(), body: await res.json().catch(() => ({ ok: false })) as ActResult['body'] }
}

/** Like `act`, but the move must land in `stage`. */
export async function actTo(req: APIRequestContext, id: string, body: Record<string, unknown>, stage: Stage): Promise<PostRow> {
  const r = await act(req, id, body)
  expect(r.body.ok, `${String(body.action)} on ${id}: ${r.body.reason ?? ''}`).toBe(true)
  expect(r.body.stage).toBe(stage)
  return r.body.post as PostRow
}

/** Save the draft's working copy (PATCH, drafts only), keeping what is not named. */
export async function saveDraft(req: APIRequestContext, id: string, patch: Partial<Pick<PostRow, 'caption' | 'channels' | 'per_channel' | 'scheduled_for' | 'slides'>>): Promise<PostRow> {
  const post = await getPost(req, id)
  const res = await req.patch(`/api/social/schedule/${encodeURIComponent(id)}`, {
    data: {
      expect_rev: post.rev,
      slides: post.slides, caption: post.caption, channels: post.channels,
      per_channel: post.per_channel ?? {}, scheduled_for: post.scheduled_for,
      timezone: 'Australia/Melbourne',
      ...patch,
    },
  })
  const body = await res.json().catch(() => ({})) as { post?: PostRow; error?: string; problems?: string[] }
  expect(res.status(), `saving draft ${id}: ${body.error ?? body.problems?.join('; ') ?? ''}`).toBe(200)
  return body.post as PostRow
}

/** Minutes from now, as an ISO instant, rounded to the minute (the time picker's grain). */
export function minutesFromNow(min: number): string {
  const t = new Date(Date.now() + min * 60_000)
  t.setSeconds(0, 0)
  return t.toISOString()
}

/** "Copy the link instead" — the ZZ client has no email address, and no journey ever emails a client. */
export const BY_LINK = { via: 'link', send_to: [] as string[] }

/* ── making a post: the Schedule page's upload ────────────────────────── */

/**
 * Upload `count` fresh test images on Schedule → New post → Upload, and let
 * the page make the post. Returns the post and the piece made for it, read
 * off the page's own `from-upload` answer.
 */
export async function uploadDraft(page: Page, opts: { count?: number; tag: string }): Promise<{ postId: string; itemId: string }> {
  const count = opts.count ?? 1
  await page.goto(`${SCHEDULE}?client=${E2E.clientId}`)
  await page.getByRole('button', { name: 'New post', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await expect(dialog).toBeVisible()
  await dialog.locator('input[type="file"]').setInputFiles(testImages(count, opts.tag))
  const use = dialog.getByRole('button', { name: count > 1 ? `Use these ${count} files` : 'Use this file' })
  // the files go to storage first; the button waits for them
  await expect(use).toBeEnabled({ timeout: 120_000 })
  const [res] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/social/schedule/from-upload') && r.request().method() === 'POST', { timeout: 120_000 }),
    use.click(),
  ])
  const body = await res.json() as { post?: { id?: string }; item_id?: string; error?: string }
  expect(res.status(), `upload made no post: ${body.error ?? ''}`).toBe(200)
  const postId = String(body.post?.id ?? '')
  const itemId = String(body.item_id ?? '')
  expect(postId).not.toBe('')
  return { postId, itemId }
}

/* ── the post window ──────────────────────────────────────────────────── */

export function postWindow(page: Page): Locator {
  return page.locator('[data-post-window]')
}

/**
 * Open the one post window, straight from the address. Schedule opens a Ready, Booked or Posted post
 * itself, and hands a post still being approved to Post approval (`postWindowHref`, the owner's
 * decision 1) — the window there is the same one, so the journeys read it the same way.
 */
export async function openWindow(page: Page, postId: string): Promise<Locator> {
  await page.goto(`${SCHEDULE}?client=${E2E.clientId}&post=${encodeURIComponent(postId)}`)
  const win = postWindow(page)
  await expect(win).toBeVisible({ timeout: 30_000 })
  // "Checking who you are…" goes once the buttons are known
  await expect(win.getByText('Checking who you are…')).toHaveCount(0, { timeout: 30_000 })
  return win
}

export async function expectWindowStage(page: Page, stage: Stage): Promise<void> {
  await expect(postWindow(page).locator('[data-stage-chip]')).toHaveText(STAGE_LABEL[stage], { timeout: 30_000 })
}

export type Answers = {
  note?: string
  agreedVia?: string // the option's words, e.g. "On a call"
  byLink?: boolean
}

/**
 * Press one of the window's buttons. When the window asks a question next to
 * the button (a note, how the client agreed, who gets it, a confirm), answer
 * it and press its go button. Returns the act route's answer.
 */
export async function pressInWindow(page: Page, action: string, answers: Answers = {}): Promise<ActResult['body']> {
  const win = postWindow(page)
  const isAct = (r: { url(): string; request(): { method(): string } }) => /\/api\/posts\/[^/]+\/act$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'
  const waitAct = page.waitForResponse(isAct, { timeout: 120_000 })
  await win.locator(`[data-action="${action}"]`).click()

  const question = win.locator(`[data-question="${action}"]`)
  const asked = await question.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)
  if (asked) {
    if (answers.agreedVia) await question.getByLabel('How the client agreed').selectOption({ label: answers.agreedVia })
    if (answers.note !== undefined) await question.locator('textarea').fill(answers.note)
    if (answers.byLink) await question.getByLabel('Copy the link instead — I will send it myself').check()
    await question.locator(`[data-go="${action}"]`).click()
  }
  const res = await waitAct
  return await res.json() as ActResult['body']
}

/* ── the Post approval board ──────────────────────────────────────────── */

/** The board lane, by its column title (PostBoard's list label). */
export function boardLane(page: Page, laneTitle: string): Locator {
  return page.getByRole('list', { name: `${laneTitle} — drop a post here to move it` })
}

export function boardCard(page: Page, postId: string): Locator {
  return page.locator(`[role="listitem"][data-post-id="${postId}"]`)
}

/** Open Post approval on this post and check it sits in the lane its stage belongs to, wearing that stage's chip. */
export async function expectOnBoard(page: Page, postId: string, stage: Stage): Promise<Locator> {
  const lane = POST_APPROVAL_LANE[stage]
  if (!lane) throw new Error(`${stage} is not a Post approval column`)
  await page.goto(`${POST_APPROVAL}?post=${encodeURIComponent(postId)}`)
  const card = boardLane(page, lane).locator(`[data-post-id="${postId}"]`)
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByText(STAGE_LABEL[stage], { exact: true }).first()).toBeVisible()
  return card
}

/* ── the client's portal ──────────────────────────────────────────────── */

export function portalPostPath(postId: string): string {
  return `/portal/${encodeURIComponent(E2E.portalToken)}/post/${encodeURIComponent(postId)}`
}

/** The client's answer, as the portal page sends it. */
export async function portalAct(req: APIRequestContext, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req.post('/api/portal/act', { data: { token: E2E.portalToken, ...body } })
  return { status: res.status(), body: await res.json().catch(() => ({})) as Record<string, unknown> }
}
