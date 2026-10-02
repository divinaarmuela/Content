'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useRow } from '@/lib/db-client'
import type { ContentItem, DrivePull } from '@/lib/db-types'
import { driveHandInsOf, handInWords } from '../lib/drive-handin-core'
import { dismissDriveCopy, type DriveCopyWatch } from './driveCopyWatch'

/** how long a finished copy's "7 files handed in" stays in the tray */
export const DONE_SHOWN_MS = 8000

/** THE DRIVE COPIES IN THE PROGRESS TRAY (30 Sep 2026): one line each, read live from the card and its pull row */
export function DriveCopyRows({ watches }: { watches: readonly DriveCopyWatch[] }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Copying from Google Drive" data-drive-copies>
      {watches.map(w => <DriveCopyRow key={w.handInId} watch={w} />)}
    </ul>
  )
}

function DriveCopyRow({ watch }: { watch: DriveCopyWatch }) {
  const { row: card } = useRow<ContentItem>('content_items', watch.itemId)
  const handIn = driveHandInsOf(card as never).find(h => h.id === watch.handInId) ?? null
  const { row: pull } = useRow<DrivePull>('drive_pulls', handIn?.status === 'copying' ? watch.pullId : null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (handIn?.status !== 'copying') return
    const t = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(t)
  }, [handIn?.status])
  // A FINISHED COPY LEAVES THE TRAY on its own once it has been read (30 Sep 2026: finished rows sat over the card's
  // files); one that stopped stays until it is closed — that one needs doing something about
  // A STOP THAT A LATER HAND-IN PUT RIGHT leaves too (2 Oct 2026, Divina on Justin's September Videos: the 6:36 pm
  // copy failed, her 6:49 pm retry handed in all 8 files, and the tray still read "Nothing was handed in")
  const all = driveHandInsOf(card as never)
  const at = all.findIndex(h => h.id === watch.handInId)
  const putRight = handIn?.status === 'failed' && at >= 0 && all.slice(at + 1).some(h => h.status === 'done')
  const done = handIn?.status === 'done' || putRight
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => dismissDriveCopy(watch.handInId), DONE_SHOWN_MS)
    return () => clearTimeout(t)
  }, [done, watch.handInId])
  const said = putRight ? { words: 'Handed in on the next try — nothing to do', tone: 'done' as const } : handInWords(pull as never, handIn, now)
  const tone = !said ? 'text-muted-foreground' : said.tone === 'failed' ? 'text-accent-red-deep' : said.tone === 'done' ? 'text-foreground' : 'text-muted-foreground'
  return (
    <li className="flex items-start gap-2 rounded-inner px-1 py-1 text-[12px]">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold" title={watch.title}>{watch.title}</span>
        <span className={`block ${tone}`} role="status">{said?.words ?? (card ? 'Waiting to start copying from Google Drive…' : 'Reading the card…')}</span>
      </span>
      {(!handIn || handIn.status !== 'copying') && (
        <button type="button" onClick={() => dismissDriveCopy(watch.handInId)} aria-label={`Dismiss ${watch.title}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </li>
  )
}
