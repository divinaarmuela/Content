import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOT_CLIENT_APPROVED, WITH_THE_CLIENT_NOW } from '@/app/lib/social-schedule-core'

/**
 * WHAT THE SCREENS PROMISE ABOUT A CLIENT'S SIGN-OFF.
 *
 * On 5 Sep 2026 an account manager gained the right to post without an
 * approval step. Two sentences on the item page did not move with it: a
 * switch reading "The client signs this off before it goes out" and a header
 * line reading "then <Client> signs off". Both were, from that day, untrue of
 * every piece in the database — the server no longer required either — and a
 * manager who read them and told a client so was passing the promise on.
 *
 * A promise the server does not keep is worth a test, and the only honest way
 * to test copy is to read the source it is written in. The same shape as
 * `drive-page-writes.test.ts`: a sentence that comes back fails here rather
 * than in front of a client.
 */

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

// the card's body — the page route is a thin wrapper around CardDetail
const ITEM_PAGE = 'app/dashboard/production/[id]/CardDetail.tsx'
const COMPOSER = 'app/dashboard/social/schedule/NewPostDialog.tsx'
const RAIL = 'app/dashboard/social/schedule/MediaRail.tsx'
const PICKER = 'app/dashboard/social/schedule/NewPostSources.tsx'
const CLIENT_SOCIAL = 'app/dashboard/clients/[id]/social/page.tsx'
const SWITCH = 'app/dashboard/clients/ClientApproval.tsx'

describe('the item page no longer promises a sign-off the server does not require', () => {
  const source = read(ITEM_PAGE)

  it('does not say the client signs a piece off before it goes out', () => {
    expect(source).not.toContain('The client signs this off before it goes out')
    expect(source).not.toContain('signs off</span>')
  })

  it('says what the switch actually does instead — where the work goes next', () => {
    expect(source).toContain('Send this to the client for their answer')
    expect(source).toContain('for their answer</span>')
  })

  it('points at the setting that IS enforced, on the client’s own page', () => {
    expect(source).toContain('set on their own page')
  })
})

describe('the client-level switch exists in the product, not only in the database', () => {
  it('is on the client’s Social page', () => {
    const page = read(CLIENT_SOCIAL)
    expect(page).toContain('ClientApproval')
    expect(page).toContain("mayEdit={can('account_manager')}")
  })

  it('writes the column both server gates read', () => {
    const route = read('app/api/clients/[id]/approval/route.ts')
    expect(route).toContain('client_approval_required')
    // an account manager decides it; a scheduler may only read it
    expect(route).toContain("requireRole('account_manager')")
    expect(route).toContain("requireRole('scheduler')")
    // never check-then-write (CLAUDE.md trap 11)
    expect(route).toContain('.claim(')
  })

  it('says the same sentence the Schedule page says', () => {
    expect(read(SWITCH)).toContain('This client signs off every post')
  })
})

describe('the two markers stay two different sentences', () => {
  it('mean opposite things and never collapse into one', () => {
    expect(WITH_THE_CLIENT_NOW).not.toBe(NOT_CLIENT_APPROVED)
  })

  /**
   * I5. The post window hardcoded `status: 'approved_for_scheduling'` into its
   * own composition check, so the ONE screen where the irreversible press
   * happens was the one screen with no marker on it. A card dragged from the
   * rail onto a time showed the words for the half second it was under the
   * cursor and never again.
   */
  it('the post window shows the marker too, and judges the REAL status', () => {
    const source = read(COMPOSER)
    expect(source).toContain('NOT_CLIENT_APPROVED')
    expect(source).toContain('item: { status: target.itemStatus')
    expect(source).not.toContain("item: { status: 'approved_for_scheduling'")
  })

  /**
   * M4. The "Approve without client" branch is NOT dead code: dropping
   * `client_review` from the one-press set is exactly what brings it back to
   * life, and it is now the only way past a review that is happening.
   */
  it('the deliberate "Approve without client" button is still drawn', () => {
    for (const file of [RAIL, PICKER]) {
      expect(read(file), file).toContain('Approve without client')
      expect(read(file), file).toContain('mayApproveWithoutClient')
    }
  })
})
