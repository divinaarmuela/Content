import { test, expect } from '../support/fixtures'
import { bookingBlocked } from '../support/env'
import {
  POST_APPROVAL, expectWindowStage, getPost, minutesFromNow, openWindow, pressInWindow,
} from '../support/posts'
import { makeDraft, runTag, toReady } from '../support/start'

/**
 * J5 — Book → Cancel → Re-book (SPEC T11, T20, T22). Booking writes a
 * publish job, so this runs only on a separate database (see env.ts
 * `bookingBlocked`): on the live one, the live site's dispatcher would post
 * the job with the real publisher.
 */
test('J5: book → cancel → it leaves the schedule and shows under Cancelled → Re-book gives a draft with the same media and caption and no time', async ({ scheduler, reviewer, made }) => {
  const blocked = bookingBlocked()
  test.skip(blocked !== null, blocked ?? '')

  const tag = runTag('j5')
  const caption = `E2E ${tag} caption`
  const post = await makeDraft(scheduler, made, { tag, caption, scheduledFor: minutesFromNow(3 * 24 * 60) })
  await toReady(scheduler, reviewer, post.id)
  const before = await getPost(scheduler.request, post.id)

  await openWindow(scheduler, post.id)
  const booked = await pressInWindow(scheduler, 'book')
  expect(booked.ok, booked.reason).toBe(true)
  expect(booked.stage).toBe('booked')
  await expectWindowStage(scheduler, 'booked')

  const cancelled = await pressInWindow(scheduler, 'cancel')
  expect(cancelled.ok, cancelled.reason).toBe(true)
  expect(cancelled.stage).toBe('cancelled')
  await expectWindowStage(scheduler, 'cancelled')

  // off the lanes, and listed under Cancelled
  await scheduler.goto(POST_APPROVAL)
  await expect(scheduler.locator(`[role="listitem"][data-post-id="${post.id}"]`)).toHaveCount(0)
  const cancelledList = scheduler.locator('details', { hasText: 'Cancelled ·' })
  await cancelledList.locator('summary').click()
  await expect(cancelledList.locator(`a[href*="post=${post.id}"]`).first()).toBeVisible()

  // Re-book: a draft again, same files and caption, no time
  await openWindow(scheduler, post.id)
  const again = await pressInWindow(scheduler, 'rebook')
  expect(again.ok, again.reason).toBe(true)
  expect(again.stage).toBe('draft')
  const after = await getPost(scheduler.request, post.id)
  expect(after.stage).toBe('draft')
  expect(after.caption).toBe(caption)
  expect(after.slides.map(s => s.url)).toEqual(before.slides.map(s => s.url))
  expect(after.scheduled_for).toBeNull()
})
