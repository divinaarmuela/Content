'use client'

/**
 * What the platforms will do to these files — shown the moment they are chosen.
 *
 * The composer already refuses a post that breaks a count or a caption limit.
 * This is the other half, and the half that used to be invisible: a file that
 * publishes successfully and still arrives wrong. A 400 MB master goes up to
 * Instagram, gets re-encoded on the way, and the post looks soft — no error,
 * nothing in the job log, nothing to notice until a client mentions it. The
 * only place that can be caught is here, while the file is still replaceable.
 */

import { useMemo } from 'react'
import { AlertTriangle, Check, Crop, Gauge, HelpCircle, XCircle } from 'lucide-react'
import PlatformIcon from './PlatformIcon'
import type { Platform, PostKind } from '../../lib/publish-core'
import {
  assessAssets, assetOutcomes, describeAspect, fitHeadline, unmeasured, verdictByPlatform,
  LEVEL_WORDS, PLATFORM_MEDIA,
  type AssetProbe, type FitLevel,
} from '../../lib/media-fit-core'

const TONE: Record<FitLevel, { chip: string; icon: typeof Check }> = {
  ok: {
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
    icon: Check,
  },
  reframed: {
    chip: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
    icon: Crop,
  },
  degraded: {
    chip: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    icon: Gauge,
  },
  blocked: {
    chip: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    icon: XCircle,
  },
}

const MB = 1024 * 1024

function sizeWords(bytes: number): string {
  const value = bytes / MB
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`
  return value >= 10 ? `${Math.round(value)} MB` : `${value.toFixed(1)} MB`
}

function durationWords(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m}m ${s}s` : `${m} min`
}

/** The one line above each asset's findings: what this file actually is. */
function assetLine(probe: AssetProbe): string {
  const parts: string[] = [probe.type]
  if (probe.bytes !== undefined) parts.push(sizeWords(probe.bytes))
  if (probe.width && probe.height) {
    parts.push(`${probe.width} x ${probe.height}`, describeAspect(probe.width, probe.height))
  }
  if (probe.seconds !== undefined) parts.push(durationWords(probe.seconds))
  return parts.join(' · ')
}

export default function AssetCheck({
  probes, platforms, kinds, compact = false,
}: {
  probes: AssetProbe[]
  platforms: Platform[]
  kinds?: Partial<Record<Platform, PostKind>>
  /** the Review step wants the verdict without the per-asset breakdown */
  compact?: boolean
}) {
  const findings = useMemo(
    () => assessAssets({ probes, platforms, kinds }),
    [probes, platforms, kinds],
  )
  const verdicts = useMemo(
    () => verdictByPlatform(findings, platforms),
    [findings, platforms],
  )
  // a row for every asset on every channel — a channel that is fine has to say
  // so out loud, or it looks the same as a channel nobody checked
  const outcomes = useMemo(
    () => assetOutcomes({ probes, platforms, kinds }),
    [probes, platforms, kinds],
  )
  const missing = useMemo(() => unmeasured(probes), [probes])

  if (probes.length === 0) return null

  const rank: Record<FitLevel, number> = { ok: 0, reframed: 1, degraded: 2, blocked: 3 }
  const worst = verdicts.reduce<FitLevel>(
    (w, v) => (rank[v.level] > rank[w] ? v.level : w), 'ok')

  return (
    <div className="grid gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-start gap-2">
        {worst === 'ok'
          ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
        <div>
          <p className="text-xs font-medium">Before you schedule</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            {platforms.length === 0
              ? 'Pick the channels first — what happens to a file depends entirely on where it goes.'
              : fitHeadline(findings, platforms)}
          </p>
        </div>
      </div>

      {/* the cross-platform answer: is this set acceptable on each channel */}
      {platforms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {verdicts.map(v => {
            const tone = TONE[v.level]
            const Icon = tone.icon
            return (
              <span
                key={v.platform}
                title={LEVEL_WORDS[v.level].meaning}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${tone.chip}`}
              >
                <PlatformIcon platform={v.platform} size={13} />
                <span>{PLATFORM_MEDIA[v.platform].label}</span>
                <Icon className="h-3 w-3" />
                <span>{LEVEL_WORDS[v.level].label}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* One section per channel, each holding a row per file.
       *
       *  Grouped this way round because a post usually goes to several
       *  channels at once, and "what happens on Instagram" is one decision:
       *  every file, one medium, one verdict. Flattening asset-by-asset made
       *  a three-file, four-channel post twelve unsorted lines. A channel
       *  that changes nothing collapses; one that does not opens itself. */}
      {!compact && verdicts.map(v => {
        const rows = outcomes.filter(o => o.platform === v.platform)
        const tone = TONE[v.level]
        const Icon = tone.icon
        const medium = rows[0]?.becomes
        return (
          <details
            key={v.platform}
            open={v.level !== 'ok'}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800"
          >
            {/* Safari draws its own disclosure triangle unless the webkit
                pseudo-element is hidden too — `list-none` alone leaves it */}
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 px-2 py-1.5 text-[11px] [&::-webkit-details-marker]:hidden">
              <PlatformIcon platform={v.platform} size={14} />
              <span className="font-medium">{PLATFORM_MEDIA[v.platform].label}</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${tone.chip}`}>
                <Icon className="h-3 w-3" />
                {LEVEL_WORDS[v.level].label}
              </span>
              {medium && (
                <span className="text-zinc-500 dark:text-zinc-400">sent as {medium}</span>
              )}
              <span className="ml-auto font-mono text-zinc-400 dark:text-zinc-500">
                {rows.length} file{rows.length === 1 ? '' : 's'}
              </span>
            </summary>

            <ul className="grid gap-1.5 px-2 pb-2">
              {rows.map(row => {
                const rowTone = TONE[row.level]
                const RowIcon = rowTone.icon
                const probe = probes[row.asset - 1]
                return (
                  <li
                    key={row.asset}
                    className={`rounded-md border px-2 py-1.5 text-[11px] ${rowTone.chip}`}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <RowIcon className="h-3 w-3" />
                      File {row.asset}
                      <span className="font-mono font-normal opacity-80">
                        {probe ? assetLine(probe) : ''}
                      </span>
                    </span>

                    {row.summary ? (
                      <span className="mt-0.5 block opacity-90">{row.summary}</span>
                    ) : (
                      row.findings.map((f, n) => (
                        <span key={n} className="mt-1 block">
                          <span className="block font-medium opacity-95">{f.headline}</span>
                          <span className="block opacity-90">{f.detail}.</span>
                          <span className="block opacity-80">{f.consequence}</span>
                        </span>
                      ))
                    )}
                  </li>
                )
              })}
            </ul>
          </details>
        )
      })}

      {!compact && platforms.length === 0 && (
        <p className="border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Nothing is checked yet — go back and choose the channels first.
        </p>
      )}

      {missing.length > 0 && (
        <p className="flex items-start gap-1.5 border-t border-zinc-100 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {missing.length === 1 ? `File ${missing[0]} could not be` : `Files ${missing.join(', ')} could not be`}
            {' '}read in the browser, so nothing above was checked for
            {missing.length === 1 ? ' it' : ' them'}. Check the size and length by hand before scheduling.
          </span>
        </p>
      )}
    </div>
  )
}
