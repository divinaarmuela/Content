'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { ChevronDown, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { CanvasCard } from '../../../../lib/batch-brief-core'
import { boardBounds, fitBoardToPage, picturesReadyLine, type PrintBox } from '../../../../lib/shoot-print-core'
import ShootPrintSheet, { BOARD_PAGE, PRINT_PAPERS, boardPrintCss, shootPrintCss, type PrintPaper, type PrintShoot } from './ShootPrintSheet'

/** how often the pictures are counted while the sheet waits for them */
const PICTURES_CHECK_MS = 300

/** what is printed: the plan read into a document on one of the papers, or the board as it looks on the screen */
type PrintJob = PrintPaper | 'board'

/**
 * A COPY OF THE BOARD ON THE PAGE, shrunk on to one sheet (Renee, 25 Nov 2026: "similar to the one on screen too").
 * The board already drawn on the page is copied as it stands — nothing fetched, nothing changed on the board itself.
 * False when there is no board on the page, or nothing on it.
 */
function copyBoardInto(host: HTMLElement): boolean {
  const world = document.querySelector<HTMLElement>('[data-board-world]')
  if (!world) return false
  const at = world.getBoundingClientRect()
  const zoom = new DOMMatrixReadOnly(getComputedStyle(world).transform).a || 1
  const boxes: PrintBox[] = Array.from(world.querySelectorAll<HTMLElement>('[data-card]')).map(el => {
    const r = el.getBoundingClientRect()
    return { x: (r.left - at.left) / zoom, y: (r.top - at.top) / zoom, w: r.width / zoom, h: r.height / zoom }
  }).filter(b => b.w > 0 && b.h > 0)
  const board = boardBounds(boxes)
  if (!board) return false
  const fit = fitBoardToPage(board, BOARD_PAGE)
  const copy = world.cloneNode(true) as HTMLElement
  copy.removeAttribute('data-board-world')
  // the buttons that float over a picked card are for the screen
  copy.querySelectorAll('[data-card-toolbar]').forEach(el => el.remove())
  // a picture still waiting to scroll into view on the screen is wanted on the paper now
  copy.querySelectorAll('img').forEach(img => { img.loading = 'eager' })
  copy.style.transform = `translate(${fit.left}px, ${fit.top}px) scale(${fit.scale}) translate(${-board.x}px, ${-board.y}px)`
  host.replaceChildren(copy)
  return true
}

/**
 * PRINT THE PLAN — the button's word is the glossary's, "shoot plan" (Renee, 25 Nov 2026: "the shoot brief needs to be printable … im gonna try print this today").
 * One button: the sheet is drawn straight under <body> (hidden on the screen), its pictures are waited for, and the
 * browser's own print window opens on the sheet and nothing else — the same way the monthly report prints. "Save as
 * PDF" in that window makes the file.
 *
 * Nothing is saved: the sheet is drawn from the plan and the board already on the page, its pictures from their
 * small copies (shoot-print-core's `printPicture`).
 */
export default function PrintBrief({ shoot, cards, crew = [], className }: {
  shoot: PrintShoot
  cards: readonly CanvasCard[]
  crew?: readonly string[]
  className?: string
}) {
  /** the paper being printed on, while the sheet is up */
  const [printing, setPrinting] = useState<PrintJob | null>(null)
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!printing) return
    const node = host.current
    if (!node) return
    let live = true
    const done = () => { if (live) setPrinting(null) }
    if (printing === 'board') {
      const page = node.querySelector<HTMLElement>('.sp-board')
      if (!page || !copyBoardInto(page)) {
        toast.error('There is nothing on the board to print yet')
        setPrinting(null)
        return
      }
    }
    window.addEventListener('afterprint', done)
    // THE SHEET WAITS FOR EVERY PICTURE, AND SAYS HOW FAR IT HAS GOT (Renee, 26 Nov 2026: "it doesnt save the pics
    // when print" — the Alia brief's 94 pictures were 194 MB at full size, and the print window opened after a flat
    // 25 seconds with whatever had arrived: the words and one picture). There is no clock now: the count is shown as
    // it climbs, and "Print now" is the person's own way to stop waiting. A picture that fails counts as done.
    const pictures = Array.from(node.querySelectorAll('img'))
    let note: string | number | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let opened = false
    const open = () => {
      if (opened) return
      opened = true
      if (timer !== undefined) clearInterval(timer)
      if (note !== undefined) toast.dismiss(note)
      if (!live) return
      window.print()
      // a browser with no `afterprint` (or a print window closed at once) must not leave the sheet mounted
      setTimeout(done, 1000)
    }
    const check = () => {
      const ready = pictures.filter(img => img.complete).length
      if (ready >= pictures.length) { open(); return }
      note = toast.loading(picturesReadyLine(ready, pictures.length), { id: note, action: { label: 'Print now', onClick: open } })
    }
    check()
    if (!opened) timer = setInterval(check, PICTURES_CHECK_MS)
    return () => {
      live = false
      if (timer !== undefined) clearInterval(timer)
      if (note !== undefined) toast.dismiss(note)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  return (
    <>
      {/* THE PAPER IS CHOSEN HERE (the owner, 25 Nov 2026: "print can u make it a3"): a page size written into the
          sheet is what the print window opens on, so nobody has to find the setting in the browser's own dialog */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className={className ?? 'h-11 rounded-full px-4 text-[14px] font-semibold'} disabled={!!printing} data-print-brief>
            <Printer className="h-4 w-4" aria-hidden /> {printing ? 'Getting it ready…' : 'Print the plan'}
            {!printing && <ChevronDown className="h-4 w-4" aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover">
          {PRINT_PAPERS.map(paper => (
            <DropdownMenuItem key={paper} className="min-h-11 text-[14px]" onSelect={() => setPrinting(paper)} data-print-paper={paper}>
              {paper === 'A3' ? 'A3 landscape — the plan and the board, to read' : 'A4 — the plan and the board, to read'}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem className="min-h-11 text-[14px]" onSelect={() => setPrinting('board')} data-print-paper="board">
            A3 landscape — the board as it looks on screen, one sheet
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {printing && typeof document !== 'undefined' && createPortal(
        <div id="shoot-print" ref={host}>
          {printing === 'board'
            ? <><style>{boardPrintCss()}</style><div className="dbx"><div className="sp-board" /></div></>
            : <><style>{shootPrintCss(printing)}</style><ShootPrintSheet shoot={shoot} cards={cards} crew={crew} /></>}
        </div>,
        document.body,
      )}
    </>
  )
}
