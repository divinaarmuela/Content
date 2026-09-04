'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Download, ExternalLink, FolderInput, Link2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { friendlyError } from '@/app/lib/support-core'
import {
  formatBytes, formatModified, isFolder, kindOf, KIND_LABEL, type DriveEntry,
} from '@/app/lib/files-core'

/**
 * The right-hand panel: what this one file is, and the four things a person
 * does with it.
 *
 * Two halves, and the difference matters. Drive knows the name, the size, the
 * owner and when it changed. Only WE know it is version 2 of Pure Allure's
 * spring reel, and only for files this app put there — most of what is in the
 * owner's Drive was filed by a person long before any of this existed. So the
 * second half simply is not drawn when there is nothing to draw, rather than
 * showing "Client: unknown" and making a stranger's PDF look like a mistake.
 */

export type PanelInfo = {
  entry: DriveEntry & { parents: string[] }
  mirror: {
    client_id: string | null
    client_name: string | null
    item_id: string | null
    item_title: string | null
    version_number: number | null
    version_is_current: boolean
    uploaded_by: string | null
  } | null
  poster: string | null
}

export default function FilesPanel({
  selectedId, selectedCount, now, onRename, onMove, onShare,
}: {
  selectedId: string | null
  selectedCount: number
  now: Date
  onRename: (entry: DriveEntry) => void
  onMove: () => void
  onShare: (entry: DriveEntry) => void
}) {
  const [info, setInfo] = useState<PanelInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!selectedId) { setInfo(null); return }
    let alive = true
    void fetch(`/api/drive/info?id=${encodeURIComponent(selectedId)}`, { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null) as
          (PanelInfo & { error?: string }) | null
        if (!alive) return
        if (!res.ok || !json || json.error) {
          setInfo(null)
          setError(friendlyError(json?.error ?? '', 'Files'))
          return
        }
        setInfo(json)
      })
      .catch(() => { if (alive) setError(friendlyError('', 'Files')) })
    return () => { alive = false }
  }, [selectedId])

  if (selectedCount > 1) {
    return (
      <Shell>
        <p className="text-body-15 font-semibold">{selectedCount} things picked</p>
        <p className="text-secondary-13 text-muted-foreground">
          Drag them onto a folder, or use Move… — you will be asked to confirm before
          anything moves.
        </p>
        <div className="flex-1" />
        <button type="button" onClick={onMove} className={PRIMARY}>
          <FolderInput className="h-4 w-4" strokeWidth={2} />Move…
        </button>
      </Shell>
    )
  }

  if (!selectedId) {
    return (
      <Shell>
        <p className="text-body-15 font-semibold">Nothing picked</p>
        <p className="text-secondary-13 text-muted-foreground">
          Choose a file to see who it belongs to, what it weighs and where it came from.
        </p>
      </Shell>
    )
  }

  if (error) return <Shell><p className="text-secondary-13">{error}</p></Shell>
  if (!info) return <Shell><p className="text-secondary-13 text-muted-foreground">Looking…</p></Shell>

  const { entry, mirror } = info
  const kind = kindOf(entry.mimeType, entry.name)
  const folder = isFolder(entry)
  const openUrl = entry.webViewLink
    ?? (folder
      ? `https://drive.google.com/drive/folders/${entry.id}`
      : `https://drive.google.com/file/d/${entry.id}/view`)

  return (
    <Shell>
      <div className="h-[120px] overflow-hidden rounded-inner bg-paper">
        {info.poster || entry.hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- proxied
          <img
            src={info.poster ?? `/api/drive/thumbnail?id=${encodeURIComponent(entry.id)}&size=600`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>

      <p className="text-card-title">{entry.name}</p>

      <dl className="flex flex-col">
        {mirror?.client_name && (
          <Row label="Client">
            {mirror.client_id
              ? <Link className="underline" href={`/dashboard/clients/${mirror.client_id}`}>{mirror.client_name}</Link>
              : mirror.client_name}
          </Row>
        )}
        {mirror?.item_title && (
          <Row label="Piece">
            {mirror.item_id
              ? <Link className="underline" href={`/dashboard/production/${mirror.item_id}`}>{mirror.item_title}</Link>
              : mirror.item_title}
          </Row>
        )}
        {mirror?.version_number != null && (
          <Row label="Version">
            v{mirror.version_number}{mirror.version_is_current ? ' · the latest' : ''}
          </Row>
        )}
        <Row label="Type">{folder ? 'Folder' : KIND_LABEL[kind].replace(/s$/, '')}</Row>
        <Row label="Owner">{entry.ownerName ?? entry.ownerEmail ?? 'Not known'}</Row>
        {mirror?.uploaded_by && <Row label="Added by">{mirror.uploaded_by}</Row>}
        <Row label="Last changed">{formatModified(entry.modified, now)}</Row>
        {!folder && <Row label="Size">{formatBytes(entry.size)}</Row>}
      </dl>

      <div className="flex-1" />

      <div className="flex flex-wrap gap-2">
        <a href={openUrl} target="_blank" rel="noreferrer" className={PRIMARY}>
          <ExternalLink className="h-4 w-4" strokeWidth={2} />Open in Drive
        </a>
        {!folder && (
          <a href={`/api/drive/download?id=${encodeURIComponent(entry.id)}`} className={SECONDARY}>
            <Download className="h-4 w-4" strokeWidth={2} />Download
          </a>
        )}
        <button type="button" onClick={() => onRename(entry)} className={SECONDARY}>
          <Pencil className="h-4 w-4" strokeWidth={2} />Rename…
        </button>
        <button type="button" onClick={onMove} className={SECONDARY}>
          <FolderInput className="h-4 w-4" strokeWidth={2} />Move…
        </button>
        <button type="button" onClick={() => onShare(entry)} className={SECONDARY}>
          <Link2 className="h-4 w-4" strokeWidth={2} />Get a link…
        </button>
      </div>
    </Shell>
  )
}

const PRIMARY = cn(
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full',
  'bg-foreground px-4 text-secondary-13 font-semibold text-background',
)
const SECONDARY = cn(
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full',
  'border border-border px-4 text-secondary-13 font-semibold text-foreground hover:bg-foreground/[0.04]',
)

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <aside
      aria-label="About this file"
      className="flex w-full shrink-0 flex-col gap-2.5 rounded-card border border-border bg-surface p-4 lg:w-[260px]"
    >
      {children}
    </aside>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 text-secondary-13 first:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-semibold">{children}</dd>
    </div>
  )
}
