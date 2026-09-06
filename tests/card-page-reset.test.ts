import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BOOKED_LABEL, POSTED_LABEL, READY_FOR_CHECK_LABEL, SEND_BACK_LABEL,
} from '@/app/lib/board-view-core'

/**
 * THE CARD PAGE IS THE BOARD'S CARD, OPENED.
 *
 * A card is one deliverable with ONE link and what needs doing. The page
 * shows the same `link_url` the board shows, offers the one move the board
 * would in the board's words, and does no posting at all — that is the
 * Schedule page's job, one tap away. This reads the source, the way
 * `drive-page-writes.test.ts` does, so a caption box or a "Who posts this?"
 * picker that comes back fails here rather than in front of the team.
 */

const root = join(__dirname, '..')
const PAGE = 'app/dashboard/production/[id]/page.tsx'
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** the code, without the prose about the code */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !/^\s*\/\//.test(l))
  .join('\n')

describe('the card page shows the one link', () => {
  const src = code(read(PAGE))

  it('renders link_url and its label — the same fields the board draws', () => {
    expect(src).toContain('detail.link_url')
    expect(src).toContain('linkLabel(detail.link_kind)')
    expect(src).toMatch(/href=\{detail\.link_url\}/)
  })

  it('says which version this is, in words, and replaces the link through the board\'s own dialog', () => {
    expect(src).toContain('versionWord(detail.current_version_number)')
    expect(src).toMatch(/import \{ LinkDialog, SendBackDialog \} from '[^']*board\/BoardDialogs'/)
    expect(src).toContain('Replace the link')
    expect(src).toContain('Earlier versions')
  })

  it('shows what needs doing, from `brief`', () => {
    expect(src).toContain('What needs doing')
    expect(src).toContain("saveField({ brief: v || null }")
  })

  it('has no drop zone and no "Save v2" — existing files are listed read only', () => {
    expect(src).not.toMatch(/onDrop=/)
    expect(src).not.toMatch(/Save v\$/)
    expect(src).not.toContain('Add the first version')
    expect(src).not.toContain('posting order')
    expect(src).toContain('title="Files"')
  })
})

describe('the card page uses the board\'s words', () => {
  const src = code(read(PAGE))

  it('routes every move through actionFor', () => {
    expect(src).toMatch(/import \{ actionFor,[^}]*\} from '[^']*board-view-core'/)
    expect(src).toContain('actionFor(t.to, t.label, hats)')
  })

  it('never appends "(manual)" to a move', () => {
    expect(src).not.toContain('(manual)')
  })

  it('the board\'s labels are the ones the page would show', () => {
    expect(READY_FOR_CHECK_LABEL).toBe('Ready for checking')
    expect(BOOKED_LABEL).toBe('Booked in')
    expect(POSTED_LABEL).toBe('Posted')
    expect(SEND_BACK_LABEL).toBe('Send back for changes')
    // the machine's words are not typed into the page by hand
    expect(src).not.toContain("'Submit for review'")
    expect(src).not.toContain("'Mark scheduled'")
    expect(src).not.toContain("'Mark published'")
  })

  it('calls the card a card', () => {
    expect(src).not.toContain('Delete this item')
    expect(src).not.toContain("'Item deleted'")
    expect(src).not.toContain("'Item not found'")
    expect(src).toContain('Delete this card')
    expect(src).toContain("'Card deleted'")
    expect(src).toContain("'Card not found'")
  })
})

describe('the card page does no posting', () => {
  const src = code(read(PAGE))

  it('PostingCard is gone — the file and every import of it', () => {
    expect(existsSync(join(root, 'app/dashboard/production/[id]/PostingCard.tsx'))).toBe(false)
    expect(src).not.toContain('PostingCard')
    expect(src).not.toContain('posting-card-core')
    expect(src).not.toContain('posting-approval-core')
  })

  it('has no caption box, no "Who posts this?", no reviewer picker, no final-post approval', () => {
    expect(src).not.toContain('Caption')
    expect(src).not.toContain('Who posts this')
    expect(src).not.toContain('Who should review this')
    expect(src).not.toContain('posting-approval')
    expect(src).not.toContain('/publish')
    expect(src).not.toContain('/schedule`')
    expect(src).not.toContain('/handoff')
  })

  it('a move is one tap — no notify_ids or scheduler_ids ride the transition', () => {
    expect(src).not.toContain('notify_ids')
    expect(src).not.toContain('scheduler_ids: schedulerIds')
    expect(src).not.toContain('{ scheduler_ids:')
  })

  it('keeps one plain "Open in Schedule" link for the people who post', () => {
    expect(src).toContain('Open in Schedule')
    expect(src).toContain('href="/dashboard/social/schedule"')
  })

  it('keeps the approve/move call exactly where it was', () => {
    expect(src).toContain('/api/production/items/${id}/transition')
    expect(src).toContain("body: JSON.stringify({ to })")
  })

  it('keeps the board inside the card', () => {
    expect(src).toMatch(/<ItemBoard itemId=\{id\}/)
  })
})
