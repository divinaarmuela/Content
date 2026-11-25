'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { ChevronDown, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { CanvasCard } from '../../../../lib/batch-brief-core'
import ShootPrintSheet, { PRINT_PAPERS, shootPrintCss, type PrintPaper, type PrintShoot } from './ShootPrintSheet'

/** how long the print window waits for the board's pictures before it opens anyway */
const PICTURES_WAIT_MS = 25_000

/**
 * PRINT THE PLAN — the button's word is the glossary's, "shoot plan" (Renee, 25 Nov 2026: "the shoot brief needs to be printable … im gonna try print this today").
 * One button: the sheet is drawn straight under <body> (hidden on the screen), its pictures are waited for, and the
 * browser's own print window opens on the sheet and nothing else — the same way the monthly report prints. "Save as
 * PDF" in that window makes the file.
 *
 * Nothing is fetched or saved: the sheet is drawn from the plan and the board already on the page.
 */
export default function PrintBrief({ shoot, cards, crew = [], className }: {
  shoot: PrintShoot
  cards: readonly CanvasCard[]
  crew?: readonly string[]
  className?: string
}) {
  /** the paper being printed on, while the sheet is up */
  const [printing, setPrinting] = useState<PrintPaper | null>(null)
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!printing) return
    const node = host.current
    if (!node) return
    let live = true
    const done = () => { if (live) setPrinting(null) }
    window.addEventListener('afterprint', done)
    const pictures = Array.from(node.querySelectorAll('img'))
    const note = pictures.length > 0 ? toast.loading(`Getting ${pictures.length === 1 ? 'the picture' : `${pictures.length} pictures`} ready to print…`) : undefined
    const loaded = Promise.all(pictures.map(img => (img.complete
      ? Promise.resolve()
      : new Promise<void>(res => { img.addEventListener('load', () => res(), { once: true }); img.addEventListener('error', () => res(), { once: true }) }))))
    const waited = new Promise<void>(res => { setTimeout(res, PICTURES_WAIT_MS) })
    void Promise.race([loaded, waited]).then(() => {
      if (note !== undefined) toast.dismiss(note)
      if (!live) return
      window.print()
      // a browser with no `afterprint` (or a print window closed at once) must not leave the sheet mounted
      setTimeout(done, 1000)
    })
    return () => { live = false; window.removeEventListener('afterprint', done) }
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
              {paper === 'A3' ? 'A3 — the big sheet, fewer pages' : 'A4 — a standard printer'}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {printing && typeof document !== 'undefined' && createPortal(
        <div id="shoot-print" ref={host}>
          <style>{shootPrintCss(printing)}</style>
          <ShootPrintSheet shoot={shoot} cards={cards} crew={crew} />
        </div>,
        document.body,
      )}
    </>
  )
}
