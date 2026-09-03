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

import { useCallback, useMemo } from 'react'
import { AlertTriangle, Check, Crop, FileCog, Gauge, HelpCircle, XCircle } from 'lucide-react'
import PlatformIcon from './PlatformIcon'
import type { Platform, PostKind } from '../../lib/publish-core'
import {
  assessAssets, assetOutcomes, channelSpecs, describeAspect, fitHeadline, unmeasured,
  verdictByPlatform, LEVEL_WORDS, PLATFORM_MEDIA,
  type AssetProbe, type FitLevel,
} from '../../lib/media-fit-core'

const TONE: Record<FitLevel, { chip: string; icon: typeof Check }> = {
  ok: {
    chip: 'border-accent-green/30 bg-tint-green text-foreground',
    icon: Check,
  },
  reframed: {
    chip: 'border-accent-blue/25 bg-tint-blue text-accent-blue-deep',
    icon: Crop,
  },
  degraded: {
    chip: 'border-accent-amber/35 bg-tint-amber text-foreground',
    icon: Gauge,
  },
  blocked: {
    chip: 'border-accent-red/30 bg-tint-red text-foreground',
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
  probes, platforms, kinds, overrides, compact = false,
}: {
  probes: AssetProbe[]
  platforms: Platform[]
  kinds?: Partial<Record<Platform, PostKind>>
  /** a channel given its own files is checked against THOSE, not the shared set */
  overrides?: Partial<Record<Platform, AssetProbe[]>>
  /** the Review step wants the verdict without the per-asset breakdown */
  compact?: boolean
}) {
  // each channel is judged on the files it will actually receive
  const probesOf = useCallback(
    (p: Platform) => overrides?.[p]?.length ? overrides[p]! : probes,
    [overrides, probes],
  )
  const findings = useMemo(
    () => platforms.flatMap(p => assessAssets({ probes: probesOf(p), platforms: [p], kinds })),
    [probesOf, platforms, kinds],
  )
  const verdicts = useMemo(
    () => verdictByPlatform(findings, platforms),
    [findings, platforms],
  )
  // a row for every asset on every channel — a channel that is fine has to say
  // so out loud, or it looks the same as a channel nobody checked
  const outcomes = useMemo(
    () => platforms.flatMap(p => assetOutcomes({ probes: probesOf(p), platforms: [p], kinds })),
    [probesOf, platforms, kinds],
  )
  const missing = useMemo(
    () => unmeasured([...probes, ...Object.values(overrides ?? {}).flat()]),
    [probes, overrides],
  )
  // the export brief, off the same rules the check is decided by — useful
  // BEFORE a file exists, which is the moment it can still be exported right
  const specs = useMemo(
    () => channelSpecs({ platforms, kinds, types: probes.map(p => p.type) }),
    [platforms, kinds, probes],
  )

  if (probes.length === 0 && platforms.length === 0) return null

  const rank: Record<FitLevel, number> = { ok: 0, reframed: 1, degraded: 2, blocked: 3 }
  const worst = verdicts.reduce<FitLevel>(
    (w, v) => (rank[v.level] > rank[w] ? v.level : w), 'ok')

  return (
    <div className="grid gap-3 rounded-inner border border-border p-3">
      <div className="flex items-start gap-2">
        {worst === 'ok'
          ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-green" />
          : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-amber" />}
        <div>
          <p className="text-secondary-13 font-medium">Before you schedule</p>
          <p className="text-secondary-13 text-muted-foreground">
            {platforms.length === 0
              ? 'Pick the channels first — what happens to a file depends entirely on where it goes.'
              : probes.length === 0
              ? 'Nothing attached yet. What each channel wants is below — export to it and nothing gets re-encoded.'
              : fitHeadline(findings, platforms)}
          </p>
        </div>
      </div>

      {/* the cross-platform answer: is this set acceptable on each channel */}
      {platforms.length > 0 && probes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {verdicts.map(v => {
            const tone = TONE[v.level]
            const Icon = tone.icon
            return (
              <span
                key={v.platform}
                title={LEVEL_WORDS[v.level].meaning}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-chip-12 ${tone.chip}`}
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
            className="rounded-inner border border-border"
          >
            {/* Safari draws its own disclosure triangle unless the webkit
                pseudo-element is hidden too — `list-none` alone leaves it */}
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 px-2 py-1.5 text-[12px] [&::-webkit-details-marker]:hidden">
              <PlatformIcon platform={v.platform} size={14} />
              <span className="font-medium">{PLATFORM_MEDIA[v.platform].label}</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${tone.chip}`}>
                <Icon className="h-3 w-3" />
                {LEVEL_WORDS[v.level].label}
              </span>
              {medium && (
                <span className="text-muted-foreground">sent as {medium}</span>
              )}
              <span className="ml-auto font-mono text-muted-foreground">
                {rows.length} file{rows.length === 1 ? '' : 's'}
              </span>
            </summary>

            <ul className="grid gap-1.5 px-2 pb-2">
              {rows.map(row => {
                const rowTone = TONE[row.level]
                const RowIcon = rowTone.icon
                const probe = probesOf(row.platform)[row.asset - 1]
                return (
                  <li
                    key={row.asset}
                    className={`rounded-tile border px-2 py-1.5 text-[12px] ${rowTone.chip}`}
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
        <p className="border-t border-border pt-2 text-[12px] text-muted-foreground">
          Nothing is checked yet — go back and choose the channels first.
        </p>
      )}

      {/* The export brief. Open by default when nothing is attached yet,
       *  because that is the moment it can still change what gets exported;
       *  closed once there are files, when the verdicts above answer the
       *  question it was asked to answer. */}
      {specs.length > 0 && (
        <details
          open={probes.length === 0}
          className="rounded-inner border border-border"
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium [&::-webkit-details-marker]:hidden">
            <FileCog className="h-3.5 w-3.5 text-muted-foreground" />
            What each channel wants
            <span className="ml-auto font-mono font-normal text-muted-foreground">
              {specs.length} channel{specs.length === 1 ? '' : 's'}
            </span>
          </summary>

          <div className="grid gap-2 px-2 pb-2">
            {specs.map(s => (
              <div key={s.platform} className="grid gap-1">
                <p className="flex items-center gap-1.5 text-[12px] font-medium">
                  <PlatformIcon platform={s.platform} size={12} />
                  {s.label}
                  <span className="font-normal text-muted-foreground">
                    — as {s.becomes}
                  </span>
                </p>
                {s.groups.map(g => (
                  <p key={g.type} className="pl-4 text-[12px] text-muted-foreground">
                    <span className="font-mono text-muted-foreground">{g.type}</span>
                    {' · '}
                    {g.lines.join(' · ')}
                  </p>
                ))}
              </div>
            ))}
            <p className="text-[12px] text-muted-foreground">
              These are the same numbers the checks above use, so hitting them
              means nothing is cropped, cut or re-encoded on the way out.
            </p>
          </div>
        </details>
      )}

      {missing.length > 0 && (
        <p className="flex items-start gap-1.5 border-t border-border pt-2 text-[12px] text-muted-foreground">
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
