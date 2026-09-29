import { test, expect } from '../support/fixtures'
import { expectOnBoard, expectWindowStage, getPost, openWindow, portalPostPath, postWindow, pressInWindow } from '../support/posts'
import { makeDraft, runTag, toClient } from '../support/start'

/**
 * J3 — the manager approves for the client (the owner's decision 5). It is
 * recorded as the manager's yes, with how the client agreed, and never shown
 * as "Client approved": the card reads "Approved by <manager> for the client —
 * on a call", the portal reads "Approved by <manager> for you".
 */
test('J3: with client → Approve for the client, with how they agreed → the card and the portal name the manager', async ({ scheduler, reviewer, manager, client, made }) => {
  const tag = runTag('j3')
  const post = await makeDraft(scheduler, made, { tag })
  await toClient(scheduler, reviewer, post.id)

  const me = await (await manager.request.get('/api/team/me')).json() as { name: string }
  const first = me.name.trim().split(/\s+/)[0]

  // a scheduler is not offered it
  await openWindow(scheduler, post.id)
  await expect(postWindow(scheduler).locator('[data-action="approve_for_client"]')).toHaveCount(0)

  await openWindow(manager, post.id)
  const done = await pressInWindow(manager, 'approve_for_client', { agreedVia: 'On a call', note: 'Said yes on the phone (E2E)' })
  expect(done.ok, done.reason).toBe(true)
  expect(done.stage).toBe('ready')
  await expectWindowStage(manager, 'ready')

  const row = await getPost(manager.request, post.id)
  expect(row.stage).toBe('ready')

  const card = await expectOnBoard(manager, post.id, 'ready')
  await expect(card).toContainText(`for the client — on a call`)
  await expect(card).toContainText(first)
  await expect(card).not.toContainText('Approved by the client')

  await client.goto(portalPostPath(post.id))
  await expect(client.getByText(`Approved by ${first} for you`)).toBeVisible()
  await expect(client.getByText('You approved this')).toHaveCount(0)
})
