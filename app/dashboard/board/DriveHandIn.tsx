'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRow } from '@/lib/db-client'
import type { DrivePull } from '@/lib/db-types'
import { driveLinkTarget, handInWords, latestHandIn, pendingHandIn } from '../../lib/drive-handin-core'
import { roundLabel as plainRoundLabel } from '../../lib/edit-round-core'
import { watchDriveCopy } from '../driveCopyWatch'

/**
 * HAND IN FROM GOOGLE DRIVE (the owner, 30 Sep 2026) — drive-handin-core.ts has the rules.
 *
 * "They just need to know they need to submit the Drive link again and all will become Version 2." Paste the link
 * to the finished folder (or one file) and hand it in: everything in it is the version. No picking, no matching —
 * the app matches each file to the card's pieces itself (the same Drive file, then the same name), keeps what did
 * not change, makes a new cut of what did, adds what is new and drops from this version what is no longer there
 * (earlier versions keep it). The copy runs in the background; the card and the progress tray say how far it is.
 */
const primaryBtn = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50'
const outlineBtn = 'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50'
const field = 'min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px] font-normal'

export function DriveHandInDialog({ open, onOpenChange, item, round, label }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: { id: string; final_files?: unknown; change_assets?: unknown; status?: unknown }
  round: number
  /** the version as everybody reads it (edit-round-core.versionLabel) */
  label?: string
}) {
  const roundLabel = (r: number) => (r === round && label ? label : plainRoundLabel(r))
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!open) { setUrl(''); setError(null) } }, [open])
  const check = url.trim() ? driveLinkTarget(url) : null

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/production/items/${item.id}/drive-handin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; round?: number; hand_in?: { id: string; pull_id: string; drive_ids?: string[] } }
      if (!res.ok) throw new Error(json.error ?? 'Could not hand the files in')
      // the progress tray watches the copy, on every page, until it is dismissed
      if (json.hand_in) watchDriveCopy({ pullId: json.hand_in.pull_id, handInId: json.hand_in.id, itemId: item.id, title: String((item as { title?: unknown }).title ?? 'A card') })
      const n = json.hand_in?.drive_ids?.length ?? 0
      toast.success(`Copying ${n || 'the'} ${n === 1 ? 'file' : 'files'} from Google Drive as ${roundLabel(json.round ?? round)} — you can close this page, it carries on`)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hand the files in')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand in from Google Drive — {roundLabel(round)}</DialogTitle>
          <DialogDescription>
            Paste the link to the folder with the finished files (or to one file). Everything in it becomes {roundLabel(round)} — what changed is the new cut, what did not is kept, and anything no longer in the folder is left out of this version. The files are copied onto the card; nothing in Drive is changed.
          </DialogDescription>
        </DialogHeader>
        <input value={url} onChange={e => { setUrl(e.target.value); setError(null) }} placeholder="https://drive.google.com/…" aria-label="Google Drive link to the finished folder or file" className={field} />
        {check && !check.ok && <p role="alert" className="text-[13px] font-medium text-accent-red-deep">{check.error}</p>}
        {error && <p role="alert" className="text-[13px] font-medium text-accent-red-deep">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)} className={outlineBtn}>Cancel</Button>
          <Button disabled={busy || !check || !check.ok} className={primaryBtn} onClick={() => void submit()}>
            {busy ? 'Handing in…' : 'Hand in'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** THE LINE ON THE CARD for the newest Drive hand-in: copying (live, from the pull row), done, or what stopped it */
export function DriveHandInStatus({ item }: { item: { drive_handins?: unknown } }) {
  const latest = latestHandIn(item)
  const pending = pendingHandIn(item)
  const { row } = useRow<DrivePull>('drive_pulls', pending ? pending.pull_id : null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(t)
  }, [pending])
  const said = handInWords(row as never, latest, now)
  if (!said) return null
  const tone = said.tone === 'failed' ? 'bg-tint-red' : said.tone === 'done' ? 'bg-tint-green' : 'bg-tint-amber'
  return <p role="status" data-drive-handin-status className={`rounded-inner ${tone} p-2.5 text-[13px] font-semibold`}>{said.words}</p>
}
