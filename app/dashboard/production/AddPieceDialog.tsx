'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { addTypeLabel } from '../../lib/deliverable-group-core'
import { slidesSatisfyType, type Slide } from '../../lib/version-files-core'
import { batchBusy, clearGroup, completedIn, uploadFiles } from '../uploadQueue'
import { UploadOverall, UploadRows, useUploadGroup } from '../UploadRows'
import ExportWarnings, { exportWarningsFor, type ExportWarning } from '../../components/media/ExportWarnings'

/** Everything the dialog needs to create one real piece inside a group. */
export type AddPieceTarget = {
  group_id: string
  client_id: string
  batch_id: string | null
  /** the format being added — reel / carousel / video / … */
  content_type: string
  work_kind_id?: string | null
  /** the piece's title, already numbered by the caller (nextPieceTitle) */
  title: string
}

/**
 * Add ONE piece to a quota/group card — but only once it has content.
 *
 * "Add the next piece" used to create an empty item on the click, so anyone
 * could pad "1 of 6, 2 of 6…" with shells that held nothing and the count
 * became a lie. Now the piece is created only when a file is uploaded or a
 * link is pasted: the item and its first version are saved together, so it
 * lands in Drafting with its work already on it, ready to Submit for review.
 * Cancel creates nothing.
 */
export default function AddPieceDialog({ open, onOpenChange, target, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  target: AddPieceTarget | null
  /** the created item (as the items API returned it), for the board's
   *  optimistic count bump */
  onCreated: (item: Record<string, unknown> & { id: string }) => void
}) {
  const [groupKey, setGroupKey] = useState('')
  const uploads = useUploadGroup(groupKey)
  const [driveUrl, setDriveUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [warnings, setWarnings] = useState<ExportWarning[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // a fresh upload group every time the dialog opens, and a clean slate — so
  // one add can never carry another's files or link
  useEffect(() => {
    if (!open) return
    setGroupKey(`add:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`)
    setDriveUrl('')
    setWarnings([])
  }, [open])

  const landed = groupKey ? completedIn(groupKey) : []
  const uploading = groupKey ? batchBusy(groupKey) : false
  const link = driveUrl.trim()
  const slides: Slide[] = landed.map(l => ({
    url: l.url, name: l.name, type: 'image' as const, ...(l.bytes > 0 ? { bytes: l.bytes } : {}),
  }))
  // the same shape rule the server enforces, run here so a carousel with one
  // file is caught before anything is created — not by deleting a shell after
  const shapeProblem = target ? slidesSatisfyType(target.content_type, slides) : null
  const hasContent = landed.length > 0 || link.length > 0

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !groupKey) return
    const chosen = Array.from(files)
    void exportWarningsFor(chosen).then(setWarnings)
    const { done } = uploadFiles(chosen, { group: groupKey })
    try {
      await done
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** What still stops the confirm button, in one line — the NewItemDialog pattern. */
  const missing: string | null = !hasContent
    ? 'Drop a file or paste a link first.'
    : uploading ? 'Waiting for the file to finish…'
    : shapeProblem ? shapeProblem
    : null

  const confirm = async () => {
    if (!target || missing || busy) return
    setBusy(true)
    let createdId: string | null = null
    try {
      // 1) the piece itself
      const itemRes = await fetch('/api/production/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{
          client_id: target.client_id,
          batch_id: target.batch_id ?? null,
          group_id: target.group_id,
          title: target.title,
          content_type: target.content_type,
          ...(target.work_kind_id ? { work_kind_id: target.work_kind_id } : {}),
        }] }),
      })
      const itemJson = await itemRes.json().catch(() => null)
      if (!itemRes.ok) throw new Error((itemJson as { error?: string } | null)?.error ?? 'Could not add the piece')
      const item = (Array.isArray(itemJson) ? itemJson[0] : null) as (Record<string, unknown> & { id?: string }) | null
      if (!item?.id) throw new Error('Could not add the piece')
      createdId = item.id
      // 2) its first version — the CONTENT that makes the count honest. Without
      //    this the piece would be the empty shell this whole change exists to
      //    prevent, so a failure here rolls the piece back.
      const verRes = await fetch(`/api/production/items/${item.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: landed.map(l => ({ url: l.url, name: l.name, bytes: l.bytes })),
          drive_url: link || undefined,
        }),
      })
      const verJson = await verRes.json().catch(() => null)
      if (!verRes.ok) throw new Error((verJson as { error?: string } | null)?.error ?? 'Could not attach the file or link')
      clearGroup(groupKey)
      onCreated(item as Record<string, unknown> & { id: string })
      onOpenChange(false)
      toast.success(`${String(item.title ?? 'Piece')} added`)
    } catch (e) {
      // never leave an empty shell behind: if the version failed after the item
      // was made, remove the item so "1 of 6" always means one real piece
      if (createdId) {
        void fetch(`/api/production/items/${createdId}`, { method: 'DELETE' }).catch(() => {})
      }
      toast.error(e instanceof Error ? e.message : 'Could not add the piece')
    } finally {
      setBusy(false)
    }
  }

  const heading = target ? addTypeLabel(target.content_type) : 'Add a piece'

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="capitalize">{heading}</DialogTitle>
          <DialogDescription className="text-xs">
            Drop the file or paste a link. It&rsquo;s only added once it has something in it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); void onFiles(e.dataTransfer.files) }}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragging ? 'border-blue-400 bg-blue-50/60 dark:border-blue-600 dark:bg-blue-950/30'
                : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
            }`}>
            <p className="text-sm font-medium">{uploading ? 'Uploading…' : 'Choose a file, or drag it here'}</p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Any size — it goes straight to our storage.{' '}
              {target && /carousel/i.test(target.content_type) ? 'A carousel takes several — drop them all.' : ''}
            </p>
          </div>
          {landed.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {landed.map(a => (
                <Badge key={a.url} variant="secondary" className="max-w-full gap-1 font-normal">
                  <span className="max-w-40 truncate">{a.name}</span>
                </Badge>
              ))}
            </div>
          )}
          {uploads.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              <UploadOverall uploads={uploads} />
              <UploadRows uploads={uploads} />
            </div>
          )}
          <ExportWarnings items={warnings} onDismiss={() => setWarnings([])} />
          <input ref={fileRef} type="file" multiple className="sr-only"
            onChange={e => void onFiles(e.target.files)} />

          <div className="grid gap-1.5">
            <Label className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
              …or paste a link instead <span className="text-zinc-400">(Drive, YouTube, Dropbox — anywhere it can be watched)</span>
            </Label>
            <Input value={driveUrl} placeholder="https://drive.google.com/…"
              onChange={e => setDriveUrl(e.target.value)} className="font-mono text-xs" />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="min-h-11" disabled={busy || missing !== null} onClick={() => void confirm()}>
            {busy ? 'Adding…' : heading}
          </Button>
        </DialogFooter>
        {missing && (
          <p className="-mt-2 text-right text-xs text-amber-600 dark:text-amber-400">{missing}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
