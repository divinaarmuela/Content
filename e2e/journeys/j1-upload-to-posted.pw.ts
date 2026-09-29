import { test, expect } from '../support/fixtures'
import { E2E, postingBlocked } from '../support/env'
import {
  expectOnBoard, expectWindowStage, getPost, openWindow, postWindow, pressInWindow, saveDraft, uploadDraft,
} from '../support/posts'
import { runTag, toReady } from '../support/start'

/**
 * J1 — an upload on Schedule, all the way to Posted (SPEC §8.4, with the
 * owner's decision 3: the quality check is required).
 *
 * At every step the three places that show a post must agree: the window's
 * stage chip, the Post approval lane, and the post's own stage.
 */

test('J1a: upload → Draft → Send for quality check → the reviewer passes → Ready to post', async ({ scheduler, reviewer, made }) => {
  const tag = runTag('j1a')
  const { postId, itemId } = await uploadDraft(scheduler, { tag })
  made.post(postId, itemId)
  await saveDraft(scheduler.request, postId, { caption: `E2E ${tag}`, channels: [E2E.channels.instagram, E2E.channels.linkedin] })

  // Draft
  await openWindow(scheduler, postId)
  await expectWindowStage(scheduler, 'draft')
  expect((await getPost(scheduler.request, postId)).stage).toBe('draft')
  await expectOnBoard(scheduler, postId, 'draft')

  // the scheduler sends it for the quality check
  await openWindow(scheduler, postId)
  const sent = await pressInWindow(scheduler, 'send_to_qc')
  expect(sent.ok, sent.reason).toBe(true)
  expect(sent.stage).toBe('quality_check')
  await expectWindowStage(scheduler, 'quality_check')
  await expectOnBoard(scheduler, postId, 'quality_check')

  // the scheduler cannot pass it — only the reviewer can (decision 3)
  await openWindow(scheduler, postId)
  await expect(postWindow(scheduler).locator('[data-action="pass"]')).toHaveCount(0)

  // the reviewer passes it
  await openWindow(reviewer, postId)
  const passed = await pressInWindow(reviewer, 'pass')
  expect(passed.ok, passed.reason).toBe(true)
  expect(passed.stage).toBe('ready')
  await expectWindowStage(reviewer, 'ready')
  const card = await expectOnBoard(reviewer, postId, 'ready')
  await expect(card).toContainText('Passed quality check')
  expect((await getPost(reviewer.request, postId)).stage).toBe('ready')
})

test('J1b: Ready to post → Post now → Posted, with every network\'s link', async ({ scheduler, reviewer, made }) => {
  const blocked = postingBlocked()
  test.skip(blocked !== null, blocked ?? '')
  test.setTimeout(8 * 60_000)

  const tag = runTag('j1b')
  const { postId, itemId } = await uploadDraft(scheduler, { tag })
  made.post(postId, itemId)
  await saveDraft(scheduler.request, postId, { caption: `E2E ${tag}`, channels: [E2E.channels.instagram, E2E.channels.linkedin] })
  await toReady(scheduler, reviewer, postId)

  await openWindow(scheduler, postId)
  await expectWindowStage(scheduler, 'ready')
  const now = await pressInWindow(scheduler, 'post_now')
  expect(now.ok, now.reason).toBe(true)
  // the window draws the stage the server returned — never an assumed "Booked in" (audit W4)
  await expectWindowStage(scheduler, now.stage === 'booked' ? 'booked' : 'ready')
  expect(now.stage).toBe('booked')

  // the dry-run provider answers at once; the publish job reports back through Inngest
  await expect.poll(async () => (await getPost(scheduler.request, postId)).stage, { timeout: 5 * 60_000, intervals: [5_000] }).toBe('posted')
  await openWindow(scheduler, postId)
  await expectWindowStage(scheduler, 'posted')
  const links = postWindow(scheduler).getByRole('list', { name: 'Where it went out' }).locator('a[href^="https://"]')
  await expect(links).toHaveCount(2)
  await expectOnBoard(scheduler, postId, 'posted')
})
