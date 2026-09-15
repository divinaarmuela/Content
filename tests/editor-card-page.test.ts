import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A CARD'S OWN PAGE ON THE EDITOR SIDE (the owner, 15 Sep 2026: "make the
 * editor card, when clicked, open a new page displaying the videos'
 * thumbnails so I can view from there" — "not a slider anymore").
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('the Editor page opens a card as a page', () => {
  const board = src('app/dashboard/editor/page.tsx')
  it('a press goes to /dashboard/editor/<id>; no slide-in is drawn', () => {
    expect(board).toContain('onOpen={c => router.push(`/dashboard/editor/${c.id}`)}')
    expect(board).not.toContain('<CardSheet')
    expect(board).not.toContain('useCardSheet')
  })
  it('an email or bell link (?card=) still lands on the board and goes on to the page', () => {
    expect(board).toContain('const id = readCardParam(window.location.search)')
    expect(board).toContain('if (id) router.replace(`/dashboard/editor/${id}`)')
  })
})

describe('the card’s page', () => {
  const page = src('app/dashboard/editor/[id]/page.tsx')
  it('draws the folder’s files wide, and the card beside them', () => {
    // one block, said once (15 Sep 2026): the files box carries the heading, the folder and the wide tiles
    expect(page).toContain('fallbackFolder={from.footage} wideFiles')
    // a press on a clip opens its review page (15 Sep 2026)
    expect(page).toContain('reviewHref={t => reviewPath(id, t.id, t.name)} />')
    expect(page).not.toContain('Footage folder: ')
    expect(page).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(360px,560px)]')
    expect(page).toContain('<PageTitle')
    expect(page).toContain('href="/dashboard/editor"')
  })
  it('chooses the same three cards the drawer did: the post’s, the maker’s, the manager’s', () => {
    expect(page).toContain('const maker = usesMakerDrawer(me, item)')
    expect(page).toContain('? <PostApprovalDetail key={id} id={id} onClose={back} />')
    // one card for everyone on the team (15 Sep 2026): the brief, with a
    // manager's or checker's own buttons above it — never the lined table
    expect(page).toContain('<EditorCardDrawer key={id} id={id} onClose={back} hideFolderFiles />')
    expect(page).not.toContain('<CardDetail')
    expect(page).toContain("{!maker && me && me.role !== 'client' && (")
    expect(page).toContain('const { primary, more } = cardActions(card, viewer)')
  })
  it('the maker’s drawer leaves the folder’s files to the page, so they are not drawn twice', () => {
    const drawer = src('app/dashboard/board/EditorCardDrawer.tsx')
    expect(drawer).toContain('{!hideFolderFiles && <DriveFolderFiles url={from.footage} />}')
    const tiles = src('app/dashboard/board/DriveFolderFiles.tsx')
    expect(tiles).toContain("wide ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'")
  })
})
