'use client'

import { useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { clearFinishedUploads, dismissUpload, getUploads, subscribeUploads } from './uploadQueue'
import { UploadOverall, UploadRows } from './UploadRows'
import { isSettled, overallProgress } from '../lib/upload-progress-core'

/**
 * Floating background-upload tray — visible on every dashboard page while
 * transfers run, so "upload and keep working" is actually true.
 *
 * It used to say "Uploading 3 files…" and list their names beside a spinner,
 * which told a person nothing they could not already see. It now shows the
 * same thing every other upload surface shows: bytes, a bar, a speed, a time
 * left, and a way to stop.
 */
export default function UploadTray() {
  const uploads = useSyncExternalStore(subscribeUploads, getUploads, getUploads)
  if (uploads.length === 0) return null

  const active = uploads.filter(u => !isSettled(u.status))
  const overall = overallProgress(uploads)
  const waiting = uploads.filter(u => u.status === 'queued').length

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <span className="text-xs font-semibold">
          {active.length > 0
            ? `${overall.label}${waiting > 0 ? ` · ${waiting} waiting` : ''}`
            : 'Uploads finished'}
        </span>
        {active.length === 0 && (
          <button
            type="button"
            onClick={clearFinishedUploads}
            aria-label="Dismiss uploads"
            className="ml-auto text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {uploads.length > 1 && (
        <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <UploadOverall uploads={uploads} />
        </div>
      )}

      <div className="max-h-60 overflow-y-auto p-2">
        <UploadRows uploads={uploads} onDismiss={dismissUpload} compact />
      </div>

      {active.length > 0 && (
        <p className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          Keep this tab open — you can keep working anywhere in the dashboard.
        </p>
      )}
    </div>
  )
}
