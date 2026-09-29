import { test, expect } from '../support/fixtures'
import { openWindow, postWindow, uploadDraft } from '../support/posts'
import { runTag } from '../support/start'

/**
 * J6 — the caption keeps the cursor (audit W1: the window's focus effect
 * re-ran on every keystroke and threw the cursor out of the box). Forty
 * characters typed with one click at the start must all land, in order.
 */
test('J6: typing 40 characters into the caption without clicking again keeps every one', async ({ scheduler, made }) => {
  const tag = runTag('j6')
  const { postId, itemId } = await uploadDraft(scheduler, { tag })
  made.post(postId, itemId)

  await openWindow(scheduler, postId)
  const caption = postWindow(scheduler).locator('[data-caption]')
  await caption.click()
  await caption.fill('')
  const typed = 'Forty characters, typed one at a time!!'.padEnd(40, '.')
  expect(typed).toHaveLength(40)
  await scheduler.keyboard.type(typed, { delay: 40 })
  await expect(caption).toHaveValue(typed)
  await expect(caption).toBeFocused()
})
