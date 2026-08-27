'use client'

import { isProbableMp4, probeFile } from '../../lib/video-probe'
import { uploadWarning } from '../../lib/video-probe-core'

/**
 * "This will upload fine, and nobody will be able to watch it here."
 *
 * Said at the moment of choosing the file, on the editor's own machine,
 * before a byte moves — because the alternative is a super admin finding out
 * at 5pm that the review cut cannot be played, and nobody knowing why.
 *
 * It is a warning and never a gate. The file uploads, mirrors to Drive and
 * posts to the platform exactly as it always did; only the in-browser preview
 * is affected, and a preview is not worth refusing someone's work over.
 */

export type ExportWarning = { name: string; line: string }

/** Probe every video in a selection; return a line for each one that will
 *  not preview. Docs, decks and images are skipped without a read. */
export async function exportWarningsFor(files: readonly File[]): Promise<ExportWarning[]> {
  const out: ExportWarning[] = []
  for (const file of files) {
    if (!isProbableMp4(file)) continue
    const check = await probeFile(file)
    const line = uploadWarning(check.probe, check.bytes)
    if (line) out.push({ name: file.name, line })
  }
  return out
}

export default function ExportWarnings({ items, onDismiss }: {
  items: readonly ExportWarning[]
  onDismiss?: () => void
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      {items.map(w => (
        <p key={w.name} className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
          <span className="font-medium">{w.name}</span> — {w.line}
        </p>
      ))}
      {onDismiss && (
        <button type="button" onClick={onDismiss}
          className="w-fit text-[11px] text-amber-700 underline hover:no-underline dark:text-amber-400">
          Dismiss
        </button>
      )}
    </div>
  )
}
