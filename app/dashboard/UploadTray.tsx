'use client'

import { useSyncExternalStore } from 'react'
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react'
import { clearFinishedUploads, getUploads, subscribeUploads } from './uploadQueue'

/** Floating background-upload tray — visible on every dashboard page while
 *  transfers run, so "upload and keep working" is actually true. */
export default function UploadTray() {
  const uploads = useSyncExternalStore(subscribeUploads, getUploads, getUploads)
  if (uploads.length === 0) return null
  const active = uploads.filter(u => u.status === 'uploading').length
  const waiting = uploads.filter(u => u.status === 'queued').length

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <span className="text-xs font-semibold">
          {active > 0 ? `Uploading ${active} file${active > 1 ? 's' : ''}${waiting > 0 ? ` · ${waiting} waiting` : ''}…` : 'Uploads finished'}
        </span>
        {active === 0 && (
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
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto p-2">
        {uploads.map(u => (
          <div key={u.id} className="flex items-center gap-2 text-xs">
            {u.status === 'queued' && <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-zinc-400" aria-label="Waiting" />}
            {u.status === 'uploading' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />}
            {u.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
            {u.status === 'failed' && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
            <span className="min-w-0 truncate">{u.name}</span>
            {u.status === 'failed' && (
              <span className="ml-auto shrink-0 text-red-500" title={u.error}>failed</span>
            )}
          </div>
        ))}
      </div>
      {active > 0 && (
        <p className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          Keep this tab open — you can keep working anywhere in the dashboard.
        </p>
      )}
    </div>
  )
}
