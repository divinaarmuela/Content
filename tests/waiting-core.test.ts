import { describe, expect, it } from 'vitest'
import { sinceWords } from '../app/lib/waiting-core'

/**
 * How long something has waited, in words — what the Post approval board's
 * cards say beside who they are waiting on. The old list of edits waiting on
 * a decision went with the posting rebuild (29 Sep 2026): a post's wait is its
 * own stage (tests/post-waiting-core.test.ts).
 */

const TODAY = '2026-09-08' // a Tuesday

describe('how long it has been waiting, in words', () => {
  it('says today, yesterday, the weekday, then the date', () => {
    expect(sinceWords('2026-09-08T09:00:00.000Z', TODAY)).toBe('since today')
    expect(sinceWords('2026-09-07T09:00:00.000Z', TODAY)).toBe('since yesterday')
    // 2026-09-02 is a Wednesday, six days back — still inside the week
    expect(sinceWords('2026-09-02T09:00:00.000Z', TODAY)).toBe('since Wednesday')
    // past six days a weekday name stops naming one day
    expect(sinceWords('2026-08-30T09:00:00.000Z', TODAY)).toBe('since 30 Aug')
  })

  it('says nothing rather than something odd', () => {
    expect(sinceWords(null, TODAY)).toBeNull()
    expect(sinceWords(undefined, TODAY)).toBeNull()
    expect(sinceWords('not a date', TODAY)).toBeNull()
    expect(sinceWords('2026-09-20T09:00:00.000Z', TODAY)).toBeNull() // the future
  })
})
