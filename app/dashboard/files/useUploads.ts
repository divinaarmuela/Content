'use client'

import { useCallback, useRef, useState } from 'react'
import { friendlyError } from '@/app/lib/support-core'
import {
  applyChunk, nextChunk, startUpload, type UploadState,
} from '@/app/lib/files-core'

/**
 * Files dropped on a folder, going up one slice at a time.
 *
 * The loop is deliberately dull: ask the server to open a resumable session,
 * then POST slices until it says the file is finished, believing its `received`
 * over our own arithmetic every time. All of that decision-making is
 * `nextChunk` / `applyChunk` in `files-core.ts`, which are pure and tested;
 * what is left here is the fetch and the progress bar.
 *
 * Slices rather than one big POST for two reasons. A serverless request body
 * is capped at a few megabytes, so a 900 MB clip has no other way through; and
 * a person watching a bar move is a person who knows the app is working,
 * which a thirty-minute spinner is not.
 *
 * Uploading only ever ADDS a file. Nothing in this file renames, moves or
 * replaces anything, and a failure stops — it never retries under a different
 * name.
 */

export type Upload = UploadState & { id: string; folderId: string }

let counter = 0

export function useUploads(onDone: (folderId: string) => void) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const running = useRef(0)

  const patch = useCallback((id: string, next: Partial<Upload>) => {
    setUploads(list => list.map(u => (u.id === id ? { ...u, ...next } : u)))
  }, [])

  const send = useCallback(async (file: File, folderId: string, id: string) => {
    let state: UploadState = startUpload(file.name, file.size)
    patch(id, { ...state, status: 'sending' })
    state = { ...state, status: 'sending' }

    const started = await fetch('/api/drive/upload/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent: folderId, name: file.name, size: file.size, mime_type: file.type,
      }),
    })
    const begun = await started.json().catch(() => null) as
      { upload?: string; error?: string } | null
    if (!started.ok || !begun?.upload) {
      patch(id, applyChunk(state, { error: friendlyError(begun?.error ?? '', 'Files') }))
      return
    }

    for (;;) {
      const slice = nextChunk(state)
      if (!slice) break
      const res = await fetch(
        `/api/drive/upload/chunk?upload=${encodeURIComponent(begun.upload)}&offset=${state.sent}`,
        { method: 'POST', body: file.slice(slice.start, slice.end) },
      )
      const json = await res.json().catch(() => null) as
        { done?: boolean; received?: number; error?: string } | null
      if (!res.ok || !json || json.error) {
        state = applyChunk(state, { error: friendlyError(json?.error ?? '', 'Files') })
        patch(id, state)
        return
      }
      state = applyChunk(state, json)
      patch(id, state)
      if (state.status === 'done') break
    }
    onDone(folderId)
  }, [patch, onDone])

  /** Take what was dropped and start it. Folders dragged from the desktop are
   *  refused in words rather than half-uploaded — the browser hands us a
   *  directory entry with no bytes behind it. */
  const add = useCallback((files: FileList | File[], folderId: string) => {
    const list = [...files].filter(f => f.size > 0 || f.type !== '')
    if (!list.length) return
    const started = list.map(file => ({
      ...startUpload(file.name, file.size),
      id: `up-${++counter}`,
      folderId,
    }))
    setUploads(prev => [...prev, ...started])
    running.current += list.length
    for (const [index, file] of list.entries()) {
      void send(file, folderId, started[index].id).finally(() => { running.current -= 1 })
    }
  }, [send])

  const clearFinished = useCallback(() => {
    setUploads(list => list.filter(u => u.status !== 'done'))
  }, [])

  return { uploads, add, clearFinished }
}
