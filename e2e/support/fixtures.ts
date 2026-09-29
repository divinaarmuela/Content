import { test as base, expect, type Browser, type Page } from '@playwright/test'
import { authFile, type Role } from './env'
import { purgeMade } from './cleanup'
import { act, getPost } from './posts'

/**
 * THE JOURNEYS' FIXTURES.
 *
 *   scheduler / reviewer / manager — a page signed in as that person
 *     (cookies saved by the global setup). Each is its own browser context,
 *     so two people can have the same post open at once.
 *   client — a page with NO sign-in: the client reaches the portal by its
 *     share link, exactly as they do in real life.
 *   made — the journey says what it made (`made.post(id, itemId)`), and after
 *     the journey, pass or fail, every one of them is taken off the board
 *     through the app (Delete draft / Cancel post, as the manager) and then
 *     its rows are removed (cleanup.ts). SPEC §8.4: every spec cleans up
 *     after itself.
 */

type Made = {
  post(postId: string, itemId?: string): void
  readonly postIds: readonly string[]
}

type Fixtures = {
  scheduler: Page
  reviewer: Page
  manager: Page
  client: Page
  made: Made
}

async function pageFor(browser: Browser, baseURL: string | undefined, role: Role | null): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    ...(role ? { storageState: authFile(role) } : {}),
  })
  return context.newPage()
}

const rolePage = (role: Role | null) =>
  async ({ browser, baseURL }: { browser: Browser; baseURL: string | undefined }, use: (p: Page) => Promise<void>) => {
    const page = await pageFor(browser, baseURL, role)
    await use(page)
    await page.context().close()
  }

export const test = base.extend<Fixtures>({
  scheduler: rolePage('scheduler'),
  reviewer: rolePage('reviewer'),
  manager: rolePage('manager'),
  client: rolePage(null),

  made: async ({ browser, baseURL }, use, testInfo) => {
    const posts: string[] = []
    const items: string[] = []
    await use({
      post(postId, itemId) {
        if (postId && !posts.includes(postId)) posts.push(postId)
        if (itemId && !items.includes(itemId)) items.push(itemId)
      },
      get postIds() { return posts },
    })

    // 1. through the app first, as the manager, so a half-done journey
    //    never leaves a post that could still be booked
    const page = await pageFor(browser, baseURL, 'manager')
    const notes: string[] = []
    try {
      for (const id of posts) {
        const post = await getPost(page.request, id).catch(() => null)
        if (!post) continue
        if (post.stage === 'draft') {
          const r = await act(page.request, id, { action: 'delete_draft', confirm: true })
          notes.push(`${id}: delete_draft → ${r.status}`)
        } else if (post.stage !== 'cancelled' && post.stage !== 'posted') {
          const r = await act(page.request, id, { action: 'cancel', confirm: true, reason: 'E2E clean-up' })
          notes.push(`${id}: cancel from ${post.stage} → ${r.status}`)
        }
      }
    } finally {
      await page.context().close()
    }
    // 2. then the rows themselves, ZZ client only
    const log = await purgeMade(posts, items)
    await testInfo.attach('cleanup', { body: [...notes, ...log].join('\n') || 'nothing to clean', contentType: 'text/plain' })
  },
})

export { expect }
