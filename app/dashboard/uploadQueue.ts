'use client'

import { uploadMedia } from './uploadMedia'

/**
 * Background uploads that outlive the page that started them.
 *
 * The queue lives at module scope, not component scope, so navigating
 * anywhere inside the dashboard leaves the transfers running; the tray in
 * the layout shows progress and the finished file PATCHes itself onto the
 * item's job pack. The browser tab is the real boundary — closing it kills
 * any web upload, which no site can escape.
 */

export type QueuedUpload = {
  id: string
  name: string
  itemId: string
  status: 'uploading' | 'done' | 'failed'
  error?: string
}

let queue: QueuedUpload[] = []
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

export function subscribeUploads(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function getUploads(): QueuedUpload[] {
  return queue
}
export function clearFinishedUploads(): void {
  queue = queue.filter(u => u.status === 'uploading')
  emit()
}

const patch = (id: string, p: Partial<QueuedUpload>) => {
  queue = queue.map(u => (u.id === id ? { ...u, ...p } : u))
  emit()
}

// two files finishing together must not lose each other's PATCH — serialise
// the read-modify-write per item
const chains = new Map<string, Promise<void>>()
function serialise(itemId: string, work: () => Promise<void>): Promise<void> {
  const next = (chains.get(itemId) ?? Promise.resolve()).then(work, work)
  chains.set(itemId, next)
  return next
}

async function attachToItem(itemId: string, file: { url: string; name: string }): Promise<void> {
  const res = await fetch(`/api/production/items/${itemId}`)
  if (!res.ok) throw new Error('Could not load the item to attach the file')
  const detail = await res.json() as { raw_assets?: { url: string; name: string }[] }
  const save = await fetch(`/api/production/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_assets: [...(detail.raw_assets ?? []), file] }),
  })
  if (!save.ok) throw new Error((await save.json()).error ?? 'Could not attach the file')
}

/** Start background uploads of source files for one item's job pack. */
export function enqueueJobAssets(itemId: string, files: File[]): void {
  for (const file of files) {
    const id = `${itemId}:${file.name}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
    queue = [...queue, { id, name: file.name, itemId, status: 'uploading' }]
    emit()
    void (async () => {
      try {
        const { url } = await uploadMedia(file, { purpose: 'production' })
        await serialise(itemId, () => attachToItem(itemId, { url, name: file.name }))
        patch(id, { status: 'done' })
      } catch (e) {
        patch(id, { status: 'failed', error: e instanceof Error ? e.message : 'Upload failed' })
      }
    })()
  }
}
