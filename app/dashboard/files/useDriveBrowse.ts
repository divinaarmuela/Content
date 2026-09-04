'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import type { Crumb, DriveEntry, Filters, ListRequest, Sort } from '@/app/lib/files-core'

/**
 * Reading Drive, from the browser.
 *
 * Drive is not ours, so it is not live. `drive_files` is ours and IS live —
 * the page subscribes to it with `useTable` — but a folder listing has to be
 * fetched, and Drive's per-minute quota is real: clicking a folder, clicking
 * back, and clicking it again would otherwise be three round trips for an
 * answer that cannot have changed.
 *
 * Hence a 30-second soft cache, keyed on the exact request, and a Refresh
 * button that ignores it. Thirty seconds is short enough that "somebody just
 * dropped a file in" resolves itself by the time you have walked back to the
 * folder, and long enough that ordinary browsing costs one request per folder.
 * Every write this page makes clears the folder it wrote into, so a new folder
 * or an upload appears at once rather than waiting the cache out.
 */

const SOFT_CACHE_MS = 30_000

export type Listing = { entries: DriveEntry[]; nextPage: string | null }

type CacheEntry = { at: number; value: Listing }
const cache = new Map<string, CacheEntry>()

/** Drop everything remembered about one folder — after an upload, a new
 *  folder, a rename or a move, whichever end of the move it was. */
export function forgetFolder(parentId: string | null): void {
  for (const key of [...cache.keys()]) {
    if (!parentId || key.includes(`parent=${parentId}`)) cache.delete(key)
  }
}

export function buildQuery(
  req: Partial<ListRequest> & { parentId: string | null }, page?: string | null,
): string {
  const params = new URLSearchParams()
  if (req.parentId) params.set('parent', req.parentId)
  if (req.text) params.set('q', req.text)
  if (req.type && req.type !== 'all') params.set('type', req.type)
  if (req.modified && req.modified !== 'any') params.set('modified', req.modified)
  if (req.ownerEmail) params.set('owner', req.ownerEmail)
  if (req.foldersOnly) params.set('folders', '1')
  if (req.sort) { params.set('sort', req.sort.by); params.set('dir', req.sort.dir) }
  if (page) params.set('page', page)
  return params.toString()
}

async function readListing(query: string, fresh: boolean): Promise<Listing> {
  const hit = fresh ? null : cache.get(query)
  if (hit && Date.now() - hit.at < SOFT_CACHE_MS) return hit.value
  const res = await fetch(`/api/drive/list?${query}`, { cache: 'no-store' })
  const json = await res.json().catch(() => null) as
    { entries?: DriveEntry[]; next_page?: string | null; error?: string } | null
  if (!res.ok || !json || json.error) {
    throw new Error(friendlyError(json?.error ?? '', 'Files'))
  }
  const value: Listing = { entries: json.entries ?? [], nextPage: json.next_page ?? null }
  cache.set(query, { at: Date.now(), value })
  return value
}

export type BrowseState = {
  entries: DriveEntry[]
  loading: boolean
  error: string | null
  nextPage: string | null
  loadingMore: boolean
}

/**
 * One folder's worth of Drive, or one search's worth.
 *
 * The request is described by everything the caller passes; changing any of it
 * starts a new read and throws away the old one's answer if it lands late
 * (`seq`), because a slow listing for the folder you have already left must
 * never paint over the one you are looking at.
 */
export function useDriveBrowse(args: {
  parentId: string | null
  text: string | null
  filters: Filters
  sort: Sort
  ready: boolean
}): BrowseState & { refresh: () => void; loadMore: () => void } {
  const { parentId, text, filters, sort, ready } = args
  const [state, setState] = useState<BrowseState>({
    entries: [], loading: true, error: null, nextPage: null, loadingMore: false,
  })
  const seq = useRef(0)
  const [nonce, setNonce] = useState(0)

  const query = buildQuery({
    parentId,
    text,
    type: filters.type,
    modified: filters.modified,
    ownerEmail: filters.person,
    sort,
  })

  useEffect(() => {
    if (!ready) return
    const mine = ++seq.current
    setState(s => ({ ...s, loading: true, error: null }))
    readListing(query, nonce > 0)
      .then(value => {
        if (seq.current !== mine) return
        setState({ ...value, loading: false, error: null, loadingMore: false })
      })
      .catch((e: unknown) => {
        if (seq.current !== mine) return
        setState({
          entries: [], loading: false, nextPage: null, loadingMore: false,
          error: e instanceof Error ? e.message : loadFailedMessage('Files'),
        })
      })
  }, [query, ready, nonce])

  const refresh = useCallback(() => {
    forgetFolder(parentId)
    setNonce(n => n + 1)
  }, [parentId])

  const loadMore = useCallback(() => {
    const page = state.nextPage
    if (!page || state.loadingMore) return
    const mine = seq.current
    setState(s => ({ ...s, loadingMore: true }))
    readListing(buildQuery({
      parentId, text, type: filters.type, modified: filters.modified,
      ownerEmail: filters.person, sort,
    }, page), false)
      .then(value => {
        if (seq.current !== mine) return
        setState(s => ({
          ...s,
          entries: [...s.entries, ...value.entries],
          nextPage: value.nextPage,
          loadingMore: false,
        }))
      })
      .catch(() => {
        if (seq.current !== mine) return
        setState(s => ({ ...s, loadingMore: false }))
      })
  }, [state.nextPage, state.loadingMore, parentId, text, filters, sort])

  return { ...state, refresh, loadMore }
}

/* ── the left tree ─────────────────────────────────────────────────────── */

export type TreeNode = { id: string; name: string }

/**
 * Folders under one folder, fetched once and kept.
 *
 * The tree is lazy on purpose: the owner's HQ has a dozen folders at the top
 * and thousands below, and asking for the whole shape up front would be a
 * minute of waiting for a rail nobody has clicked yet. A branch is read the
 * first time it is opened and then remembered for as long as the page is.
 */
export function useFolderChildren(openIds: readonly string[], ready: boolean) {
  const [branches, setBranches] = useState<Record<string, TreeNode[]>>({})
  const asked = useRef(new Set<string>())

  useEffect(() => {
    if (!ready) return
    for (const id of openIds) {
      if (asked.current.has(id)) continue
      asked.current.add(id)
      void readListing(buildQuery({ parentId: id, foldersOnly: true }), false)
        .then(value => {
          setBranches(prev => ({
            ...prev,
            [id]: value.entries.map(e => ({ id: e.id, name: e.name })),
          }))
        })
        .catch(() => {
          // a branch that cannot be read shows as empty rather than as an
          // error: the rail is navigation, and the page's own message
          // already says what is going on
          setBranches(prev => ({ ...prev, [id]: [] }))
        })
    }
  }, [openIds, ready])

  const forget = useCallback((id: string) => {
    asked.current.delete(id)
    setBranches(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  return { branches, forget }
}

/** The trail down to a folder somebody arrived at sideways. */
export async function readTrail(id: string): Promise<Crumb[]> {
  const res = await fetch(`/api/drive/trail?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
  const json = await res.json().catch(() => null) as { trail?: Crumb[]; error?: string } | null
  if (!res.ok || !json?.trail) throw new Error(friendlyError(json?.error ?? '', 'Files'))
  return json.trail
}
