/**
 * DUPLICATING A SHOOT BRIEF (the owner, 20 Oct 2026: "a feature to duplicate brief so from existing brief then copy
 * everything to the new one … it should be on the main page … choose option either to duplicate details and the
 * board vice versa").
 *
 * A new shoot is made from an old one, carrying what the person ticks: the plan's DETAILS (objective, deliverables,
 * shot list, script, location, call time, talent, props, client availability, editor priorities, the parts marked
 * "Not needed"), its BOARD (every card, the boards inside it, its name and whether the client sees it), and — only
 * when asked — its PEOPLE (the editor and the crew on the day). Never copied: the shoot date and edit deadline, any
 * stamp of where it is (shared, read, confirmed, reviewed, client decisions), the footage and the Drive folder — the
 * copy is a new plan in Draft. Pure.
 */
import type { Batch } from '@/lib/db-types'
import { sanitisePlannedDeliverables, sanitiseReferenceMedia, sanitiseShotList } from './batch-brief-core'

export type CopyParts = { details: boolean; board: boolean; people: boolean }

/** what the dialog starts with: details and board ticked, people not */
export const DEFAULT_COPY: CopyParts = { details: true, board: true, people: false }

/** read the parts from a request body — anything but `true` is not copied; nothing ticked copies nothing */
export function copyPartsOf(raw: unknown): CopyParts {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return { details: r.details === true, board: r.board === true, people: r.people === true }
}

export function nothingToCopy(p: CopyParts): boolean {
  return !p.details && !p.board && !p.people
}

/** "Copy of October clinic day" — or the title the person typed */
export function copyTitle(source: string, typed?: string | null): string {
  const t = String(typed ?? '').trim()
  return (t || `Copy of ${source}`).slice(0, 120)
}

type Source = Pick<Batch,
  'objective' | 'description' | 'concept' | 'location' | 'shot_list' | 'planned_deliverables' | 'reference_media' |
  'scripts' | 'script' | 'call_time' | 'talent' | 'props_wardrobe' | 'client_availability' | 'editor_priorities' |
  'brief_skipped' | 'deliver_only' | 'canvas_cards' | 'board_name' | 'share_board' | 'editor_id' | 'crew_ids'>

/** The fields of the new shoot taken from the old one, by the parts ticked. */
export function briefCopyFields(src: Source, parts: CopyParts): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (parts.details) {
    Object.assign(out, {
      objective: src.objective ?? null,
      description: src.description ?? null,
      concept: src.concept ?? null,
      location: src.location ?? null,
      // the shot list starts unticked: nothing has been filmed for the new shoot
      shot_list: sanitiseShotList(src.shot_list).map(s => ({ ...s, done: false })),
      planned_deliverables: sanitisePlannedDeliverables(src.planned_deliverables),
      reference_media: sanitiseReferenceMedia(src.reference_media),
      scripts: src.scripts ?? null,
      script: src.script ?? null,
      call_time: src.call_time ?? null,
      talent: src.talent ?? null,
      props_wardrobe: src.props_wardrobe ?? null,
      client_availability: src.client_availability ?? null,
      editor_priorities: src.editor_priorities ?? null,
      brief_skipped: src.brief_skipped ?? null,
      deliver_only: src.deliver_only ?? null,
    })
  }
  if (parts.board) {
    Object.assign(out, {
      canvas_cards: Array.isArray(src.canvas_cards) ? src.canvas_cards : [],
      board_name: src.board_name ?? null,
      share_board: src.share_board ?? null,
    })
  }
  if (parts.people) {
    Object.assign(out, {
      editor_id: src.editor_id ?? null,
      crew_ids: Array.isArray(src.crew_ids) ? src.crew_ids : [],
    })
  }
  return out
}

/** "Copied the details and the board from October clinic day" */
export function copiedWords(parts: CopyParts, from: string): string {
  const what = [parts.details ? 'the details' : '', parts.board ? 'the board' : '', parts.people ? 'the people' : ''].filter(Boolean)
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0] ?? 'nothing'
  return `Copied ${list} from ${from}`
}
