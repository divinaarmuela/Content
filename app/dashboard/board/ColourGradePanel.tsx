'use client'

import { useState } from 'react'
import { Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DriveHandInDialog, DriveHandInStatus } from './DriveHandIn'
import { gradedRoundOf, PUT_ON_PORTAL } from '../../lib/colour-grade-core'
import { pendingHandIn } from '../../lib/drive-handin-core'
import { roundOf, roundLabel } from '../../lib/edit-round-core'
import { versionSnapshot } from '../../lib/final-files-core'

/**
 * THE COLOURIST'S PANEL (docs/COLOUR_GRADE_SPLIT_SPEC.md C4, C5). On a card at Colour grade, for the colourist and a
 * manager: hand in the graded videos from Google Drive — the same hand-in the editor uses, matched to the editor's
 * videos by name, so the graded cut replaces each one and the client sees graded videos only — then the card's own
 * "Put it on the client's portal" button. Nothing here moves the card; the button does, and the server checks the
 * graded cut landed first.
 */
export function ColourGradePanel({ item, mayGrade }: {
  item: { id: string; status?: unknown; final_files?: unknown; drive_handins?: unknown; graded_round?: unknown; edit_round?: unknown; change_assets?: unknown; change_note_at?: unknown }
  /** the colourist, or a manager */
  mayGrade: boolean
}) {
  const [open, setOpen] = useState(false)
  if (String(item.status) !== 'colour_grade') return null
  const round = roundOf(item as never)
  const graded = gradedRoundOf(item) === round
  const copying = !!pendingHandIn(item as never)
  const count = versionSnapshot(item as never, round).length
  return (
    <section className="flex flex-col gap-2 border-b border-border p-4" aria-labelledby="colour-grade-h" data-colour-grade>
      <p id="colour-grade-h" className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Palette className="h-4 w-4" aria-hidden /> Colour grade
      </p>
      <p className="text-[14px]">
        {graded
          ? `Graded videos are in — ${count} ${count === 1 ? 'video' : 'videos'} for ${roundLabel(round)}. Press "${PUT_ON_PORTAL}" when it is ready for the client.`
          : 'Passed the quality check. Hand in the graded videos from Google Drive — they replace the editor’s, video by video, and the client sees the graded ones only.'}
      </p>
      <DriveHandInStatus item={item} />
      {mayGrade && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-11 rounded-full px-4 text-[14px] font-semibold" disabled={copying} onClick={() => setOpen(true)} data-grade-handin>
            {graded ? 'Hand in a new graded link' : 'Hand in the graded Drive link'}
          </Button>
          {copying && <p className="text-[12px] text-muted-foreground" role="status">Copying in — the client button waits for it.</p>}
        </div>
      )}
      {mayGrade && <DriveHandInDialog open={open} onOpenChange={setOpen} item={item as never} round={round} label={roundLabel(round)} />}
    </section>
  )
}
