import { test, expect } from '../support/fixtures'
import { actTo, getPost, portalAct, portalPostPath } from '../support/posts'
import { makeDraft, runTag } from '../support/start'

/**
 * J8 — the portal cannot reach a post the client was never sent (audit V5,
 * P4). A post in the quality check is not theirs: approving it by its id is
 * refused, the old `approve_post` door is shut, and `?preview=1` shows
 * nothing extra.
 *
 * SPEC §8.4 expected a 409 for `approve_post`. The rebuilt route answers a
 * post's id with 400 "Unknown action" for it (app/api/portal/act/route.ts,
 * actOnClientPost) — also a refusal. The test pins "refused, and the post did
 * not move", and records the code it saw.
 */
test('J8: the client cannot approve a post in the quality check, and ?preview=1 shows nothing extra', async ({ scheduler, client, made }) => {
  const tag = runTag('j8')
  const caption = `E2E ${tag} not for the client yet`
  const post = await makeDraft(scheduler, made, { tag, caption })
  await actTo(scheduler.request, post.id, { action: 'send_to_qc' }, 'quality_check')

  const approve = await portalAct(client.request, { post_id: post.id, action: 'client_approve', version: 1 })
  expect(approve.status).toBe(409)

  const oldDoor = await portalAct(client.request, { post_id: post.id, action: 'approve_post', version: 1 })
  test.info().annotations.push({ type: 'approve_post status', description: String(oldDoor.status) })
  expect(oldDoor.status).toBeGreaterThanOrEqual(400)
  expect(oldDoor.status).toBeLessThan(500)

  expect((await getPost(scheduler.request, post.id)).stage).toBe('quality_check')

  for (const path of [portalPostPath(post.id), `${portalPostPath(post.id)}?preview=1`]) {
    const res = await client.goto(path)
    expect(res?.status(), path).toBe(404)
    await expect(client.getByText(caption)).toHaveCount(0)
  }
})
