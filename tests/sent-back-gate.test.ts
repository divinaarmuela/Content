import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { newVersionPending, newVersionWords } from '../app/lib/version-approval-core'

describe('a sent-back card waits for the next version before submit; the Send back window counts (18 Sep 2026)', () => {
  it('pending until the round’s files are in, or the link is saved again after the send-back', () => {
    // not sent back: nothing pending
    expect(newVersionPending({ status: 'client_review', link_url: 'https://drive.google.com/x' })).toBe(false)
    // a files card sent back: pending until round 2 has files
    const v1 = { id: 'a', name: 'a', url: 'https://m/f.png', mime: 'image/png', size: 1, version: 1, uploaded_at: 'x' }
    const v2 = { id: 'b', name: 'b', url: 'https://m/f.png', mime: 'image/png', size: 1, version: 2, uploaded_at: 'x' }
    expect(newVersionPending({ status: 'revision_required', edit_round: 1, final_files: [v1] })).toBe(true)
    expect(newVersionPending({ status: 'revision_required', edit_round: 1, final_files: [v1, v2] })).toBe(false)
    expect(newVersionWords({ status: 'revision_required', edit_round: 1, work_kinds: { slug: 'graphics' } })).toBe('Upload Version 2 first')
    // a link card sent back: pending until the link is saved again after the send-back
    const link = { status: 'revision_required', edit_round: 1, link_url: 'https://drive.google.com/x' }
    expect(newVersionPending({ ...link, change_note_at: '2026-09-18T02:00:00Z', link_saved_at: '2026-09-18T01:00:00Z' })).toBe(true)
    expect(newVersionPending({ ...link, change_note_at: '2026-09-18T02:00:00Z', link_saved_at: '2026-09-18T03:00:00Z' })).toBe(false)
    expect(newVersionPending(link)).toBe(true)
    expect(newVersionWords(link)).toBe('Save the Version 2 link first — the same link is fine')
  })
  it('the board, the drawer, the link route and the Send back window carry it', () => {
    expect(readFileSync('app/lib/board-view-core.ts', 'utf8')).toContain('if (newVersionPending(card)) return true')
    const card = readFileSync('app/dashboard/board/BoardCard.tsx', 'utf8')
    expect(card).toContain("{busy ? 'Saving…' : blocked ? workFirstWords(card) : primary.label}")
    const drawer = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(drawer).toContain('|| newVersionPending({ ...item, work_kinds: kind } as never)}')
    const link = readFileSync('app/api/production/items/[id]/link/route.ts', 'utf8')
    expect(link).toContain('...(final ? { link_saved_at: new Date().toISOString() } : {}),')
    expect(link).toContain('if (final) await items.update(id, { link_saved_at: new Date().toISOString() } as never)')
    const dialogs = readFileSync('app/dashboard/board/BoardDialogs.tsx', 'utf8')
    expect(dialogs).toContain('data-send-back-counts')
    expect(dialogs).toContain("counts.back > 0 ? `Send back ${counts.back} ${counts.back === 1 ? 'clip' : 'clips'}` : 'Send back'")
  })
})
