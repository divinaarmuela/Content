import { test, expect } from '../support/fixtures'
import { POST_APPROVAL, boardLane, getPost } from '../support/posts'
import { makeDraft, runTag, toClient } from '../support/start'

/**
 * J9 — a drag the rules do not allow snaps back and says why (audit B1, B9).
 * A scheduler drags a post that is with the client onto Approved: only the
 * client, or a manager for them, may approve it, so the move is refused with
 * a toast, the card stays in With client, and the post did not move.
 */
test('J9: dragging a with-client card onto Approved is refused with a reason, and the card does not move', async ({ scheduler, reviewer, made }) => {
  const tag = runTag('j9')
  const post = await makeDraft(scheduler, made, { tag })
  await toClient(scheduler, reviewer, post.id)

  await scheduler.goto(`${POST_APPROVAL}?post=${post.id}`)
  const withClient = boardLane(scheduler, 'With client')
  const card = withClient.locator(`[data-post-id="${post.id}"]`)
  await expect(card).toBeVisible({ timeout: 30_000 })

  await card.dragTo(boardLane(scheduler, 'Approved'))

  const toast = scheduler.locator('[data-sonner-toast]').first()
  await expect(toast).toBeVisible()
  await expect(toast).not.toHaveText('')
  await expect(withClient.locator(`[data-post-id="${post.id}"]`)).toBeVisible()
  await expect(boardLane(scheduler, 'Approved').locator(`[data-post-id="${post.id}"]`)).toHaveCount(0)
  expect((await getPost(scheduler.request, post.id)).stage).toBe('with_client')
})
