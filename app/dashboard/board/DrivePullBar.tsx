'use client'

import { useEffect, useState } from 'react'
import { Check, Download, FolderDown, Play, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useRow } from '@/lib/db-client'
import type { DrivePull } from '@/lib/db-types'
import { driveFolderIdFromUrl } from '../../lib/card-link-core'
import { canStartPull, filesOf, formatBytes, pullId, pullLooksStuck, pullProgress, type PullFile } from '../../lib/drive-pull-core'
import { kindOf } from '../../lib/files-core'
import { friendlyError } from '../../lib/support-core'

/**
 * THE BAR UNDER A DRIVE FOLDER (the owner, 16 Sep 2026: "a proper loading
 * feature for the shoot brief footage when it's added, so we know how long
 * it would take"). Watches the folder's pull row live: waiting, reading the
 * folder, copying with the bytes and the time left, done with every file
 * listed — a Download of our copy each, a Play for a video — or the plain
 * words when the folder is private. "Pull the files in" starts it, and
 * "Check the folder again" after a new cut was dropped into the same link.
 */
export default function DrivePullBar({ kind, scopeId, folderUrl, which = 'folder', mayStart, onPulled }: {
  kind: 'batch' | 'item'
  scopeId: string
  folderUrl: string | null | undefined
  /** on a card: the source working folder, or the finished edit */
  which?: 'folder' | 'finished'
  mayStart: boolean
  /** told once the pull reports done, so the page can show the copies elsewhere */
  onPulled?: (files: PullFile[]) => void
}) {
  const folderId = driveFolderIdFromUrl(folderUrl)
  const { row } = useRow<DrivePull>('drive_pulls', folderId ? pullId(folderId) : null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [showing, setShowing] = useState<PullFile | null>(null)
  useEffect(() => {
    if (!row || !['queued', 'listing', 'copying'].includes(row.status)) return
    const t = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(t)
  }, [row])
  const progress = pullProgress(row as never, now)
  const files = filesOf(row)
  useEffect(() => { if (row?.status === 'done') onPulled?.(files) }, [row?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/drive/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id: scopeId, which }),
      })
      const json = await res.json().catch(() => ({})) as { started?: boolean; reason?: string; error?: string }
      if (!res.ok) throw new Error(friendlyError(json.error ?? json.reason ?? 'Could not start', 'this page'))
      toast.success(json.started ? 'Pulling the files in — you can close this page, it carries on' : json.reason ?? 'Already on it')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start')
    } finally { setBusy(false) }
  }

  if (!folderId) return null
  const inFlight = !!row && ['queued', 'listing', 'copying'].includes(row.status)
  const startable = mayStart && (canStartPull(row as never) || pullLooksStuck(row as never, now) || row?.status === 'done')

  return (
    <div className="flex flex-col gap-2 rounded-inner border border-border p-3" data-drive-pull>
      <div className="flex flex-wrap items-center gap-2">
        <FolderDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px]">
          {!row ? 'The files are not copied in yet.' : progress?.words}
        </p>
        {startable && (
          <Button variant="outline" className="h-9 rounded-full px-3 text-[13px] font-semibold" disabled={busy || inFlight} onClick={() => void start()}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {!row || row.status === 'unreadable' || row.status === 'failed' ? 'Pull the files in' : 'Check the folder again'}
          </Button>
        )}
      </div>
      {progress && (inFlight || progress.status === 'done') && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct} aria-label="Files copied in">
          <div className={`h-full rounded-full transition-[width] duration-700 ${progress.status === 'done' ? 'bg-accent-green' : 'bg-foreground'}`} style={{ width: `${progress.pct}%` }} />
        </div>
      )}
      {files.length > 0 && (
        <ul className="flex flex-col divide-y divide-border" aria-label="The files">
          {files.map(f => {
            const k = kindOf(f.mime, f.name)
            const done = f.status === 'done' && !!f.url
            const open = showing?.id === f.id
            return (
              <li key={f.id} className="flex flex-col gap-1 py-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  {done ? <Check className="h-3.5 w-3.5 text-accent-green" strokeWidth={3} aria-hidden /> : <span className="inline-block h-3.5 w-3.5 rounded-full border border-border" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {f.status === 'copying' && f.size ? `${formatBytes(f.done)} of ${formatBytes(f.size)}` : f.size ? formatBytes(f.size) : ''}
                    {f.status === 'failed' ? ' · failed' : ''}
                  </span>
                  {done && k === 'video' && (
                    <button type="button" onClick={() => setShowing(open ? null : f)} aria-pressed={open}
                      className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted">
                      <Play className="h-3 w-3" aria-hidden /> {open ? 'Close' : 'Play'}
                    </button>
                  )}
                  {done && (
                    <a href={f.url!} download className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted">
                      <Download className="h-3 w-3" aria-hidden /> Download
                    </a>
                  )}
                </div>
                {open && done && (
                  <video src={f.url!} controls playsInline preload="metadata" className="max-h-[420px] w-full rounded-tile bg-black" />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
