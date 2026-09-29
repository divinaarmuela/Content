import { test, expect } from '../support/fixtures'
import { BY_LINK, actTo, expectOnBoard, getPost, minutesFromNow, portalAct, portalPostPath } from '../support/posts'
import { makeDraft, runTag, toClient } from '../support/start'

/**
 * J4 — a missed time (the owner's decision 11). The post is set 18 minutes
 * out, so its "approve by" is 15 minutes before that: about three minutes
 * after the send. The SERVER decides a time has passed, so the journey waits
 * for the real clock rather than faking the browser's (page.clock would only
 * move the page, not the portal's server render or the act route).
 *
 * Then: the portal's buttons are gone and the client's answer is refused, the
 * board says "Missed — needs a new time", nothing moved by itself, and "New
 * time and resend" opens it to the client again.
 */
test('J4: the approve-by time passes → the portal closes, the board says missed → New time and resend → the client can approve', async ({ scheduler, reviewer, manager, client, made }) => {
  test.setTimeout(10 * 60_000)
  const tag = runTag('j4')
  const post = await makeDraft(scheduler, made, { tag, scheduledFor: minutesFromNow(18) })
  await toClient(scheduler, reviewer, post.id)
  const sent = await getPost(manager.request, post.id)
  const version = sent.client_send?.version ?? 1

  // before the time: the client can answer
  await client.goto(portalPostPath(post.id))
  await expect(client.locator('[data-post-answer]')).toBeVisible()

  // wait for the approve-by time to pass, on the server's clock
  await expect.poll(async () => {
    await client.reload()
    return client.getByText('The time for this post has passed — the team will send you a new time.').count()
  }, { timeout: 6 * 60_000, intervals: [15_000] }).toBeGreaterThan(0)
  await expect(client.locator('[data-post-answer]')).toHaveCount(0)

  // a late answer is refused, and nothing moved by itself
  const late = await portalAct(client.request, { post_id: post.id, action: 'client_approve', version })
  expect(late.status).toBe(409)
  expect((await getPost(manager.request, post.id)).stage).toBe('with_client')

  const card = await expectOnBoard(manager, post.id, 'with_client')
  await expect(card).toContainText('Missed — needs a new time')

  // the manager picks a new time and resends
  const again = await actTo(manager.request, post.id, { action: 'resend_new_time', scheduled_for: minutesFromNow(3 * 24 * 60), ...BY_LINK }, 'with_client')
  expect(again.stage).toBe('with_client')

  await client.reload()
  await expect(client.locator('[data-post-answer]')).toBeVisible()
  await client.locator('[data-post-answer]').getByRole('button', { name: 'Approve' }).click()
  await expect(client.getByText('You approved this')).toBeVisible()
  expect((await getPost(manager.request, post.id)).stage).toBe('ready')
})
