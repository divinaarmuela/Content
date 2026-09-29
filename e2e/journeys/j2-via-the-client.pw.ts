import { test, expect } from '../support/fixtures'
import {
  actTo, expectOnBoard, expectWindowStage, getPost, openWindow, portalPostPath, pressInWindow, saveDraft,
} from '../support/posts'
import { makeDraft, runTag } from '../support/start'

/**
 * J2 — via the client, adjusted to the owner's decision 3: there is no
 * "send it unchecked". Draft → Quality check → the reviewer presses
 * "Passed — send to client" → the portal shows v1 → the team edits → the
 * portal never shows the unsent v2, only "being updated" → v2 goes through
 * the check again and is sent → the client approves → Ready to post, and the
 * card says "Approved by the client".
 *
 * The send is "Copy the link instead": the ZZ client has no email address,
 * and no journey ever emails anybody.
 */
test('J2: draft → quality check → pass and send to client → edit keeps v1 on the portal → resend v2 → client approves', async ({ scheduler, reviewer, client, made }) => {
  test.setTimeout(6 * 60_000)
  const tag = runTag('j2')
  const v1 = `E2E ${tag} first caption`
  const v2 = `E2E ${tag} second caption`
  const post = await makeDraft(scheduler, made, { tag, caption: v1 })

  // Draft → Quality check
  await openWindow(scheduler, post.id)
  expect((await pressInWindow(scheduler, 'send_to_qc')).stage).toBe('quality_check')

  // the reviewer: Passed — send to client, by link
  await openWindow(reviewer, post.id)
  const sent = await pressInWindow(reviewer, 'pass_send_client', { byLink: true })
  expect(sent.ok, sent.reason).toBe(true)
  expect(sent.stage).toBe('with_client')
  await expectWindowStage(reviewer, 'with_client')
  await expectOnBoard(reviewer, post.id, 'with_client')

  // the client sees v1, and may answer it
  await client.goto(portalPostPath(post.id))
  await expect(client.getByText('Ready for you — approve it, or ask for a change.')).toBeVisible()
  await expect(client.getByText(v1)).toBeVisible()
  await expect(client.locator('[data-post-answer]')).toBeVisible()

  // the team edits it: a new draft version, and the client's approval closes
  await openWindow(scheduler, post.id)
  const edited = await pressInWindow(scheduler, 'edit')
  expect(edited.stage).toBe('draft')
  await saveDraft(scheduler.request, post.id, { caption: v2 })

  // the portal never shows the unsent v2 — it says the team is updating it
  await client.reload()
  await expect(client.getByText('The team is updating this post')).toBeVisible()
  await expect(client.getByText(v2)).toHaveCount(0)
  await expect(client.locator('[data-post-answer]')).toHaveCount(0)

  // v2 goes through the check again and is sent
  await actTo(scheduler.request, post.id, { action: 'send_to_qc' }, 'quality_check')
  await openWindow(reviewer, post.id)
  const resent = await pressInWindow(reviewer, 'pass_send_client', { byLink: true })
  expect(resent.stage).toBe('with_client')
  const now = await getPost(reviewer.request, post.id)
  expect(now.client_send?.version).toBe(2)

  // the client sees v2 and approves it on the page
  await client.reload()
  await expect(client.getByText(v2)).toBeVisible()
  await client.locator('[data-post-answer]').getByRole('button', { name: 'Approve' }).click()
  await expect(client.getByText('You approved this')).toBeVisible()

  expect((await getPost(scheduler.request, post.id)).stage).toBe('ready')
  const card = await expectOnBoard(scheduler, post.id, 'ready')
  await expect(card).toContainText('Approved by the client')
})
