'use client'

import { useEffect, useState } from 'react'
import type { PreviewRow } from '../../lib/stream-core'

/**
 * THE PREVIEW ROWS FOR OUR COPIES (16 Sep 2026): asked through the public
 * lookup every player uses, with `claim=1` so a copy that has none gets one
 * started, and asked again every ten seconds while any is still encoding —
 * Cloudflare takes a minute or two — then left alone. The page draws the
 * still and the hover frames from a ready row, and the copy itself before.
 */
const POLL_MS = 10_000
const GIVE_UP_AFTER = 30 // polls

export function usePreviewRows(urls: readonly string[]): Map<string, PreviewRow> {
  const key = urls.join('\n')
  const [rows, setRows] = useState<Map<string, PreviewRow>>(() => new Map())
  useEffect(() => {
    let live = true
    let polls = 0
    let timer: number | null = null
    const ask = async () => {
      const list = key ? key.split('\n') : []
      const next = new Map<string, PreviewRow>()
      await Promise.all(list.map(async url => {
        try {
          const res = await fetch(`/api/stream/preview?url=${encodeURIComponent(url)}&claim=1`)
          const json = await res.json().catch(() => null) as { row?: PreviewRow | null } | null
          if (json?.row) next.set(url, json.row)
        } catch { /* no opinion: the copy itself plays */ }
      }))
      if (!live) return
      setRows(next)
      const pending = list.some(u => { const r = next.get(u); return !r || (r.state !== 'ready' && r.state !== 'error') })
      if (pending && ++polls < GIVE_UP_AFTER) timer = window.setTimeout(() => { void ask() }, POLL_MS)
    }
    if (key) void ask()
    else setRows(new Map())
    return () => { live = false; if (timer !== null) clearTimeout(timer) }
  }, [key])
  return rows
}
