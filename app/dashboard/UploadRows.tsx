'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { CheckCircle2, RotateCw, X, XCircle } from 'lucide-react'
import { getUploads, subscribeUploads, type QueuedUpload } from './uploadQueue'
import {
  formatSize, overallProgress, percent, progressLine, statusWords,
} from '../lib/upload-progress-core'

/**
 * What an upload looks like while it is happening.
 *
 * One component for all three surfaces — the floating tray, the new-item
 * dialog's Files box, and the item page's Files and NEW VERSION zones —
 * because they were three different renderings of the same word,
 * "Uploading…", and three chances to disagree about it.
 *
 * Each row answers the four questions a person waiting actually has: which
 * file, how far, how fast, how long. The bar is the answer they read; the
 * numbers are the answer they check it against. `✕` cancels — the missing
 * action that made a mis-dropped 2 GB file something you had to sit through —
 * and a failure keeps its reason and offers the file back rather than making
 * anyone find it on disk again.
 */

/**
 * The rows one surface owns, live.
 *
 * The store hands back the same array reference until something actually
 * changes, so `useSyncExternalStore` is safe here and the filter is memoised
 * on that reference rather than re-running on every render.
 */
export function useUploadGroup(group: string | null): QueuedUpload[] {
  const all = useSyncExternalStore(subscribeUploads, getUploads, getUploads)
  return useMemo(() => (group ? all.filter(u => u.group === group) : []), [all, group])
}

export function UploadRows({ uploads, onDismiss, compact }: {
  uploads: readonly QueuedUpload[]
  onDismiss?: (id: string) => void
  /** the tray is narrow; the zones have the width for a size and a speed */
  compact?: boolean
}) {
  if (uploads.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {uploads.map(u => <UploadRow key={u.id} u={u} onDismiss={onDismiss} compact={compact} />)}
    </div>
  )
}

function UploadRow({ u, onDismiss, compact }: {
  u: QueuedUpload
  onDismiss?: (id: string) => void
  compact?: boolean
}) {
  const pct = u.status === 'done' ? 100 : percent(u.loaded, u.total)
  const line = progressLine(u)
  const size = formatSize(u.total)
  const words = statusWords(u.status, u.preview)
  const failed = u.status === 'failed'
  // a preview still being made is progress, not a problem — it must not read
  // as a warning, and it must not stop anyone using the file
  const settled = u.status === 'done' || failed

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-center gap-2">
        {u.status === 'done' && u.preview !== 'pending' && (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
        )}
        {failed && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />}
        <span className="min-w-0 flex-1 truncate" title={u.name}>{u.name}</span>
        {!compact && size && (
          <span className="shrink-0 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{size}</span>
        )}
        <span className={`shrink-0 font-mono text-[11px] tabular-nums ${
          failed ? 'text-red-500' : 'text-zinc-500 dark:text-zinc-400'
        }`}>
          {failed ? 'failed' : u.status === 'uploading' ? `${pct}%` : words}
        </span>
        {u.abort && (
          <button
            type="button"
            onClick={u.abort}
            aria-label={`Cancel upload of ${u.name}`}
            className="shrink-0 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {u.retry && (
          <button
            type="button"
            onClick={u.retry}
            aria-label={`Retry upload of ${u.name}`}
            className="flex shrink-0 items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
          >
            <RotateCw className="h-3 w-3" /> Retry
          </button>
        )}
        {settled && onDismiss && !u.retry && (
          <button
            type="button"
            onClick={() => onDismiss(u.id)}
            aria-label={`Dismiss ${u.name}`}
            className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* the bar is the thing that proves it is moving. It stays visible while
          saving, because that stage has no percentage of its own and a bar
          that vanishes reads as a transfer that stopped. */}
      {!failed && (
        <Bar
          pct={pct}
          // indeterminate-looking states get a settled colour rather than an
          // animation: another spinner is exactly what this replaced
          tone={u.status === 'done' ? 'done' : u.status === 'processing' ? 'saving' : 'moving'}
        />
      )}

      {(line || failed || (u.status === 'done' && u.preview === 'pending')) && (
        <p className={`truncate text-[11px] ${failed ? 'text-red-500' : 'text-zinc-400 dark:text-zinc-500'}`}>
          {failed ? u.error ?? 'Upload failed' : u.preview === 'pending' ? words : line}
        </p>
      )}
    </div>
  )
}

function Bar({ pct, tone }: { pct: number; tone: 'moving' | 'saving' | 'done' }) {
  const colour = tone === 'done'
    ? 'bg-emerald-500'
    : tone === 'saving' ? 'bg-amber-500' : 'bg-blue-500'
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none ${colour}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * "3 of 6 files · 62%" over one bar.
 *
 * Weighted by bytes rather than by file count — see `overallProgress`. Six
 * clips where one is a gigabyte would otherwise sit at 83% with five sixths
 * of the wait still ahead, which is the specific kind of wrong that teaches
 * people not to trust the bar at all.
 */
export function UploadOverall({ uploads, className }: {
  uploads: readonly QueuedUpload[]
  className?: string
}) {
  if (uploads.length < 2) return null
  const overall = overallProgress(uploads)
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <div className="flex items-center justify-between text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
        <span>{overall.label}</span>
      </div>
      <Bar pct={overall.percent} tone={overall.active ? 'moving' : 'done'} />
    </div>
  )
}
