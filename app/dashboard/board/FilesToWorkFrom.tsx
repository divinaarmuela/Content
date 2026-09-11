'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, Film, FolderOpen, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uploadFiles } from '../uploadQueue'
import { linkKindOf } from '../../lib/card-link-core'
import {
  FILES_TO_WORK_FROM, filesToWorkFromWords, mergeRawAssets, rawAssetKind, readRawAssets, withoutRawAsset,
  type RawAsset,
} from '../../lib/raw-assets-core'

/**
 * FILES TO WORK FROM — what a manager hands the editor.
 *
 * The owner, 11 Sep 2026: "Abby (super admin) will assign an editor to edit
 * and she will show the files there". Footage, stills and references, or a
 * Drive/Dropbox folder link, kept on the card ABOVE the editor's own
 * versions and separate from them. A manager adds and removes; the editor
 * sees, opens and downloads. Stored as the card's raw assets, so the job
 * pack email and the Drive mirror already know the shape.
 */
export default function FilesToWorkFrom({ item, isManager, frozen }: {
  item: { id: string; raw_assets?: unknown; raw_assets_url?: string | null }
  isManager: boolean
  /** booked in or posted: the work is done, nothing more is added */
  frozen: boolean
}) {
  const files = readRawAssets(item.raw_assets)
  const folder = item.raw_assets_url ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState(folder ?? '')
  useEffect(() => { setLink(folder ?? '') }, [folder])
  const input = useRef<HTMLInputElement | null>(null)
  const linkCheck = linkKindOf(link)
  const mayEdit = isManager && !frozen

  const save = async (patch: Record<string, unknown>, said: string) => {
    const res = await fetch(`/api/production/items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
    toast.success(said)
  }
  const add = async (picked: File[]) => {
    if (picked.length === 0) return
    setBusy(`Uploading ${picked.length} ${picked.length === 1 ? 'file' : 'files'}`)
    try {
      const { done } = uploadFiles(picked, { purpose: 'social' })
      const landed = await done
      const added: RawAsset[] = landed.map(({ file, url }) => ({ url, name: file.name }))
      await save({ raw_assets: mergeRawAssets(files, added) }, `${added.length} ${added.length === 1 ? 'file' : 'files'} added — the editor has been told`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(null)
      if (input.current) input.current.value = ''
    }
  }
  const remove = async (url: string) => {
    setBusy('Removing')
    try {
      await save({ raw_assets: withoutRawAsset(files, url) }, 'Removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove it')
    } finally { setBusy(null) }
  }
  const saveLink = async () => {
    const url = link.trim()
    if (url && !linkCheck.ok) { toast.error(linkCheck.reason); return }
    setBusy('Saving the link')
    try {
      await save({ raw_assets_url: url || null }, url ? 'Folder link saved — the editor has been told' : 'Folder link removed')
      setLinkOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the link')
    } finally { setBusy(null) }
  }

  const button = 'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50'

  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{FILES_TO_WORK_FROM}</p>
        {mayEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className={button} disabled={busy !== null} onClick={() => input.current?.click()}>
              <Plus className="h-4 w-4" aria-hidden /> Add files
            </Button>
            <Button variant="outline" className={button} disabled={busy !== null} onClick={() => setLinkOpen(o => !o)}>
              <FolderOpen className="h-4 w-4" aria-hidden /> {folder ? 'Change the folder link' : 'Add a folder link'}
            </Button>
            <input ref={input} type="file" multiple accept="image/*,video/*" className="hidden"
              aria-label="Files for the editor to work from"
              onChange={e => { void add(Array.from(e.target.files ?? [])); }} />
          </div>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{filesToWorkFromWords(files.length, !!folder)}</p>
      {busy && <p role="status" className="text-[13px] text-muted-foreground">{busy}…</p>}

      {linkOpen && mayEdit && (
        <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
          <label htmlFor="work-folder" className="text-[12px] font-semibold">Where the files live — a Google Drive or Dropbox folder</label>
          <input id="work-folder" value={link} onChange={e => setLink(e.target.value)} placeholder="https://drive.google.com/…"
            className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]" />
          {link.trim() !== '' && (
            <p className="text-[12px] text-muted-foreground">{linkCheck.ok ? `This is a ${linkCheck.label} link.` : linkCheck.reason}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
              disabled={busy !== null} onClick={() => void saveLink()}>Save the link</Button>
            <Button variant="ghost" className="h-11 rounded-full px-4 text-[14px] font-semibold" onClick={() => setLinkOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {folder && !linkOpen && (
        <a href={folder} target="_blank" rel="noreferrer noopener"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted">
          <FolderOpen className="h-4 w-4" aria-hidden /> Open the folder
          <span className="sr-only">, opens in a new tab</span>
        </a>
      )}

      {files.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map(f => {
            const kind = rawAssetKind(f)
            return (
              <li key={f.url} className="flex flex-col gap-1 rounded-inner border border-border p-2">
                {kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt="" className="aspect-square w-full rounded-tile object-cover bg-foreground/[0.06]" />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center rounded-tile bg-foreground/[0.06] text-muted-foreground">
                    <Film className="h-6 w-6" strokeWidth={1.6} aria-hidden />
                  </span>
                )}
                <span className="truncate text-[12px] font-semibold" title={f.name}>{f.name}</span>
                <div className="flex items-center gap-1">
                  <a href={f.url} target="_blank" rel="noreferrer noopener" download
                    className="inline-flex min-h-11 flex-1 items-center gap-1 text-[12px] underline-offset-4 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open
                    <span className="sr-only">{f.name}, opens in a new tab</span>
                  </a>
                  {mayEdit && (
                    <button type="button" disabled={busy !== null} onClick={() => void remove(f.url)}
                      aria-label={`Remove ${f.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50">
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
