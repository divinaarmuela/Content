import { test, expect } from '../support/fixtures'
import { E2E } from '../support/env'
import { readRow } from '../support/cleanup'
import { expectWindowStage, getPost, openWindow, postWindow, pressInWindow } from '../support/posts'
import { makeDraft, runTag } from '../support/start'

/**
 * J7 — Instagram takes ten (the owner's decision 10). Eleven images: LinkedIn
 * alone takes all eleven. Adding Instagram is refused by the server (even for
 * a draft — the count is checked per network), and in the window it shows
 * "Instagram 11 of 10" with the three ways out. "Give Instagram its own 10"
 * leaves LinkedIn with all eleven, and then the post sends.
 */
test('J7: 11 images — Instagram is refused with a counter; Instagram\'s own 10 while LinkedIn keeps 11 is allowed', async ({ scheduler, made }) => {
  test.setTimeout(6 * 60_000)
  const tag = runTag('j7')
  // LinkedIn only: eleven is fine
  const post = await makeDraft(scheduler, made, { tag, count: 11, channels: ['linkedin'] })
  expect(post.slides).toHaveLength(11)

  // the server refuses eleven for Instagram, whatever a page shows
  const res = await scheduler.request.patch(`/api/social/schedule/${post.id}`, {
    data: { expect_rev: post.rev, slides: post.slides, caption: post.caption, channels: [E2E.channels.linkedin, E2E.channels.instagram], per_channel: {} },
  })
  expect(res.status()).toBeGreaterThanOrEqual(400)
  expect(JSON.stringify(await res.json())).toMatch(/Instagram/)
  expect((await getPost(scheduler.request, post.id)).channels).toEqual([E2E.channels.linkedin])

  // in the window: turn Instagram on, see the counter and the three ways out
  const ig = await readRow('social_accounts', E2E.channels.instagram)
  const igName = String(ig?.username || ig?.name || '')
  expect(igName, 'the Instagram test channel has no name to pick it by').not.toBe('')
  await openWindow(scheduler, post.id)
  const win = postWindow(scheduler)
  await win.locator('[data-tour="post-channels"] button').first().click()
  await scheduler.getByRole('button', { name: igName }).click()
  await scheduler.keyboard.press('Escape')

  await expect(win.locator('[data-instagram-counter]')).toHaveText('Instagram 11 of 10')
  const choices = win.getByRole('group', { name: 'Instagram takes ten' })
  await expect(choices.getByRole('button', { name: 'Keep 10 — take 1 out' })).toBeVisible()
  await expect(choices.getByRole('button', { name: 'Split it into two posts' })).toBeVisible()
  await choices.getByRole('button', { name: 'Give Instagram its own 10 — the other networks keep all 11' }).click()
  await expect(win.locator('[data-instagram-counter]')).toHaveText('Instagram 10 of 10')

  // now it sends: LinkedIn keeps 11, Instagram has its own 10
  const sent = await pressInWindow(scheduler, 'send_to_qc')
  expect(sent.ok, sent.reason).toBe(true)
  expect(sent.stage).toBe('quality_check')
  await expectWindowStage(scheduler, 'quality_check')
  const after = await getPost(scheduler.request, post.id)
  expect(after.slides).toHaveLength(11)
  expect([...after.channels].sort()).toEqual([E2E.channels.instagram, E2E.channels.linkedin].sort())
  const own = (after.per_channel?.[E2E.channels.instagram] as { slides?: unknown[] } | undefined)?.slides
  expect(own).toHaveLength(10)
})
