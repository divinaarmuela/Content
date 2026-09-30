'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, FolderDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRow } from '@/lib/db-client'
import type { DrivePull } from '@/lib/db-types'
import { assetIdOf, currentFiles } from '../../lib/final-files-core'
import { handInWords, latestHandIn, pendingHandIn } from '../../lib/drive-handin-core'
import { formatBytes } from '../../lib/drive-pull-core'
import { kindOf } from '../../lib/files-core'
import { roundLabel as plainRoundLabel } from '../../lib/edit-round-core'
import { watchDriveCopy } from '../driveCopyWatch'

/**
 * HAND IN FROM GOOGLE DRIVE (the owner, 30 Sep 2026) — drive-handin-core.ts has the rules.
 *
 * Paste the Drive link to the finished file or folder; the files it holds are listed (read from Drive, never
 * written); tick the ones that are this version, put them in order, and say which piece each replaces (a sensible
 * guess is made: the same Drive file, then the same name, then the pieces the send-back named). Hand in → the
 * copy runs in the background and the card says "Copying 3 of 8 from Drive…" until the files are on it.
 */
const primaryBtn = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50'
const outlineBtn = 'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50'
const field = 'min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px] font-normal'

type Listed = { id: string; name: string; mime: string; size: number | null }

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
  const [files, setFiles] = useState<Listed[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [map, setMap] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!open) { setUrl(''); setFiles(null); setPicked([]); setMap({}); setError(null) } }, [open])
  const pieces = currentFiles(item).filter(f => !f.retired_round)

  const list = async () => {
    setBusy('Reading Drive'); setError(null)
    try {
      const res = await fetch(`/api/production/items/${item.id}/drive-handin?url=${encodeURIComponent(url.trim())}`)
      const json = await res.json().catch(() => ({})) as { files?: Listed[]; map?: Record<string, string>; error?: string }
      if (!res.ok || !json.files) throw new Error(json.error ?? 'Could not read that Drive link')
      setFiles(json.files)
      // the pictures and clips are ticked; anything else is there to tick by hand
      setPicked(json.files.filter(f => ['video', 'image'].includes(kindOf(f.mime, f.name))).map(f => f.id))
      setMap(json.map ?? {})
    } catch (e) {
      setFiles(null)
      setError(e instanceof Error ? e.message : 'Could not read that Drive link')
    } finally { setBusy(null) }
  }
  const move = (id: string, by: -1 | 1) => setPicked(p => {
    const i = p.indexOf(id), j = i + by
    if (i < 0 || j < 0 || j >= p.length) return p
    const out = [...p]; [out[i], out[j]] = [out[j], out[i]]
    return out
  })
  const submit = async () => {
    setBusy('Handing in'); setError(null)
    try {
      const res = await fetch(`/api/production/items/${item.id}/drive-handin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), ids: picked, map: Object.fromEntries(picked.map(id => [id, map[id] ?? 'new'])) }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; round?: number; hand_in?: { id: string; pull_id: string } }
      if (!res.ok) throw new Error(json.error ?? 'Could not hand the files in')
      // the progress tray watches the copy, on every page, until it is dismissed
      if (json.hand_in) watchDriveCopy({ pullId: json.hand_in.pull_id, handInId: json.hand_in.id, itemId: item.id, title: String((item as { title?: unknown }).title ?? 'A card') })
      toast.success(`Copying ${picked.length} ${picked.length === 1 ? 'file' : 'files'} from Drive as ${roundLabel(json.round ?? round)} — you can close this page, it carries on`)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hand the files in')
    } finally { setBusy(null) }
  }
  const byId = new Map((files ?? []).map(f => [f.id, f]))

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="bg-popover sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Hand in from Google Drive — {roundLabel(round)}</DialogTitle>
          <DialogDescription>
            Paste the Drive link to the finished file or folder. The files are copied onto the card — the card keeps its own copy, and nothing in Drive is changed. Each file is its own piece: if one needs changing later, only that one is replaced.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <input value={url} onChange={e => { setUrl(e.target.value); setFiles(null) }} placeholder="https://drive.google.com/…" aria-label="Google Drive link to the finished file or folder" className={`${field} min-w-0 flex-1`} />
          <Button variant="outline" className={outlineBtn} disabled={!!busy || !url.trim()} onClick={() => void list()}>
            <FolderDown className="h-4 w-4" aria-hidden /> {busy === 'Reading Drive' ? 'Reading…' : 'Show the files'}
          </Button>
        </div>
        {error && <p role="alert" className="text-[13px] font-medium text-accent-red-deep">{error}</p>}
        {files && (
          <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto text-[13px]" aria-label="The files in that Drive link" data-drive-handin-files>
            {[...picked.map(id => byId.get(id)).filter((f): f is Listed => !!f), ...files.filter(f => !picked.includes(f.id))].map(f => {
              const on = picked.includes(f.id)
              return (
                <li key={f.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1">
                  <input type="checkbox" checked={on} aria-label={`Hand in ${f.name}`} className="h-5 w-5"
                    onChange={() => setPicked(p => (on ? p.filter(x => x !== f.id) : [...p, f.id]))} />
                  <span className="min-w-0 flex-1 truncate" title={f.name}>{on ? `${picked.indexOf(f.id) + 1}. ` : ''}{f.name}</span>
                  {f.size !== null && <span className="shrink-0 text-[12px] text-muted-foreground">{formatBytes(f.size)}</span>}
                  {on && (
                    <>
                      <select value={map[f.id] ?? 'new'} onChange={e => setMap(m => ({ ...m, [f.id]: e.target.value }))} aria-label={`Does ${f.name} replace a file on the card, or add a new one`} className={`${field} max-w-[14rem]`}>
                        {/* plain words (the owner, 30 Sep 2026): "Replaces clip 2" / "Adds a new clip" */}
                        <option value="new">Adds a new {kindOf(f.mime, f.name) === 'video' ? 'clip' : kindOf(f.mime, f.name) === 'image' ? 'picture' : 'file'}</option>
                        {pieces.map(p => <option key={assetIdOf(p)} value={assetIdOf(p)}>Replaces {p.name}</option>)}
                      </select>
                      <button type="button" onClick={() => move(f.id, -1)} aria-label={`Move ${f.name} up`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                      <button type="button" onClick={() => move(f.id, 1)} aria-label={`Move ${f.name} down`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><ArrowDown className="h-4 w-4" aria-hidden /></button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={() => onOpenChange(false)} className={outlineBtn}>Cancel</Button>
          <Button disabled={!files || picked.length === 0 || !!busy} className={primaryBtn} onClick={() => void submit()}>
            {busy === 'Handing in' ? 'Handing in…' : `Hand in ${picked.length || ''} ${picked.length === 1 ? 'file' : 'files'} as ${roundLabel(round)}`.replace('  ', ' ')}
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
