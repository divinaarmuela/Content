'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { CheckCircle2, Film, FolderOpen, Hourglass, Palette } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import type { Client, ContentItem, DriveSeen, DriveSource, TeamUser, WorkKind } from '@/lib/db-types'
import { PREVIEW_LANES, cardFace, initialsOfName, isEditorCard, laneOf } from '../../../lib/editor-preview-core'
import { needsColourGrade } from '../../../lib/colour-grade-core'
import PreviewFrame, { AiScanning, usePreviewAccess } from './PreviewFrame'

/**
 * THE NEW EDITOR — BOARD (preview). Five lanes, the road a video takes: Editing → Quality check → Colour grade →
 * With client → Approved. Each card says its videos, how far along they are, and what the AI is doing with its Drive
 * links. Reads the real cards live; changes nothing.
 */
const TONE: Record<string, string> = {
  surface: 'bg-surface border border-border', amber: 'bg-tint-amber', blue: 'bg-tint-blue', green: 'bg-tint-green',
}

export default function EditorPreviewBoard() {
  const { allowed } = usePreviewAccess()
  const items = useTable<ContentItem>('content_items', { enabled: allowed })
  const clients = useTable<Client>('clients', { enabled: allowed })
  const kinds = useTable<WorkKind>('work_kinds', { enabled: allowed })
  const team = useTable<TeamUser>('team_users', { enabled: allowed })
  const nameOf = useMemo(() => new Map(team.rows.map(u => [u.id, u.name || u.email])), [team.rows])
  const seen = useTable<DriveSeen>('drive_seen', { enabled: allowed })
  const sources = useTable<DriveSource>('drive_sources', { enabled: allowed })

  const clientName = useMemo(() => new Map(clients.rows.map(c => [c.id, c.name])), [clients.rows])
  const kindOf = useMemo(() => new Map(kinds.rows.map(k => [k.id, k])), [kinds.rows])
  const cards = useMemo(() => items.rows
    .filter(i => isEditorCard(i as never, kindOf.get(String(i.work_kind_id ?? ''))?.slug))
    .filter(i => laneOf(i.status))
    .map(i => ({ item: i, face: cardFace(i, seen.rows, sources.rows), grade: needsColourGrade(kindOf.get(String(i.work_kind_id ?? ''))?.slug) }))
    .sort((a, b) => String(b.item.updated_at ?? '').localeCompare(String(a.item.updated_at ?? ''))),
  [items.rows, kindOf, seen.rows, sources.rows])

  const scanningAll = cards.reduce((n, c) => n + c.face.scanning, 0)

  return (
    <PreviewFrame>
      {scanningAll > 0 && <div className="mb-4"><AiScanning n={scanningAll} /></div>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {PREVIEW_LANES.map(lane => {
          const mine = cards.filter(c => lane.statuses.includes(String(c.item.status)))
          return (
            <section key={lane.key} aria-label={lane.label} className={`flex min-h-[200px] flex-col gap-3 rounded-card p-3 ${TONE[lane.tone]}`}>
              <header className="flex items-center justify-between px-1 pt-1">
                <h2 className="text-[15px] font-semibold">{lane.label}</h2>
                <span className="rounded-full bg-background/70 px-2 text-[12px] font-semibold tabular-nums">{mine.length}</span>
              </header>
              {mine.length === 0 && <p className="px-1 text-[13px] text-muted-foreground">Nothing here.</p>}
              {mine.map(({ item, face, grade }) => (
                <Link key={item.id} href={`/dashboard/editor/preview/${item.id}`}
                  className="group flex flex-col gap-2 rounded-inner border border-border bg-background p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-muted-foreground">{clientName.get(String(item.client_id)) ?? 'No client'}</span>
                    {/* who holds it, as the live Editor's cards show (the owner, 22 Oct 2026) */}
                    {item.owner_id
                      ? <span title={nameOf.get(String(item.owner_id)) ?? 'Assigned'} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">{initialsOfName(nameOf.get(String(item.owner_id)))}</span>
                      : <span className="shrink-0 rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground">Unassigned</span>}
                  </span>
                  <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{item.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"><Film className="h-3 w-3" aria-hidden />{face.videos} {face.videos === 1 ? 'video' : 'videos'}</span>
                    {face.approved > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-tint-green px-2 py-0.5"><CheckCircle2 className="h-3 w-3" aria-hidden />{face.approved} approved</span>}
                    {grade && face.graded && <span className="inline-flex items-center gap-1 rounded-full bg-tint-blue px-2 py-0.5"><Palette className="h-3 w-3" aria-hidden />Graded</span>}
                    {face.sources > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"><FolderOpen className="h-3 w-3" aria-hidden />{face.sources} {face.sources === 1 ? 'link' : 'links'}</span>}
                  </span>
                  <AiScanning n={face.scanning} className="self-start" />
                  {face.toConfirm > 0 && <span className="self-start rounded-full bg-tint-amber px-2.5 py-1 text-[12px] font-semibold">{face.toConfirm} new from Drive to confirm</span>}
                  {face.waiting > 0 && <span className="inline-flex items-center gap-1 self-start text-[12px] text-muted-foreground"><Hourglass className="h-3 w-3" aria-hidden />{face.waiting} waiting for the next hand-in</span>}
                </Link>
              ))}
            </section>
          )
        })}
      </div>
    </PreviewFrame>
  )
}
