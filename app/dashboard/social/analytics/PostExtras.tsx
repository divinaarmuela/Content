'use client'

import { AUDIENCE_WORDS, SOURCE_WORDS, durationWords, pct, type PostDeep, type Slice } from '@/app/lib/channel-insights-core'

/**
 * WHAT ONLY SOME NETWORKS GIVE ABOUT ONE POST (the owner, 2 Nov 2026: "no misses"), in its panel under the general
 * numbers: who watched and for how long (TikTok Business connections, Facebook Reels), an Instagram post's
 * collaborators, and LinkedIn's own per-post numbers. Nothing is drawn for what the network did not fill in.
 */
export type PostExtrasData = {
  deep: PostDeep | null
  collaborators: { username: string | null; status: string }[] | null
  collaboratorsProblem: string | null
  linkedin: Record<string, number> | null
}

const n = (v: number) => v.toLocaleString('en-AU')

let regions: Intl.DisplayNames | null = null
function countryName(code: string): string {
  if (code === 'other') return 'Other'
  if (!/^[A-Z]{2}$/.test(code)) return code
  try { regions ??= new Intl.DisplayNames(['en-AU'], { type: 'region' }); return regions.of(code) ?? code } catch { return code }
}

export function PostExtras({ data, platform }: { data: PostExtrasData; platform: string | null }) {
  const d = data.deep
  const watch = d && (d.avgWatchMs > 0 || d.completionRate > 0 || d.totalWatchMs > 0)
  const people = d && (d.profileViews > 0 || d.follows > 0 || d.websiteClicks > 0 || d.replays > 0)
  // TikTok's two pairs read apart: who they are to the account, and whether they had seen it before
  const followerPair = d?.audienceTypes.filter(s => s.label === 'follower' || s.label === 'nonFollower') ?? []
  const newPair = d?.audienceTypes.filter(s => s.label === 'newViewer' || s.label === 'returnViewer') ?? []

  return (
    <div className="flex flex-col gap-4">
      {(watch || people) && d && (
        <Block title="Watching and what people did">
          <div className="grid grid-cols-3 gap-2">
            {d.avgWatchMs > 0 && <Tile label="Average watch" value={durationWords(d.avgWatchMs)} />}
            {d.totalWatchMs > 0 && <Tile label="Total watch time" value={durationWords(d.totalWatchMs)} />}
            {d.completionRate > 0 && <Tile label="Watched to the end" value={pct(d.completionRate)} />}
            {d.durationSec ? <Tile label="Video length" value={durationWords(d.durationSec * 1000)} /> : null}
            {d.replays > 0 && <Tile label="Replays" value={n(d.replays)} />}
            {d.profileViews > 0 && <Tile label="Profile visits" value={n(d.profileViews)} />}
            {d.follows > 0 && <Tile label="New followers" value={n(d.follows)} />}
            {d.websiteClicks > 0 && <Tile label="Website clicks" value={n(d.websiteClicks)} />}
          </div>
        </Block>
      )}

      {d && d.retention.length > 1 && (
        <Block title="How long people kept watching">
          <Retention points={d.retention} />
          <p className="mt-1 text-[12px] text-muted-foreground">
            Share of viewers still watching at each second{platform === 'facebook' ? ' — Facebook gives the first 40 seconds, from a sample of plays, and counts loops as watching' : ''}.
          </p>
        </Block>
      )}

      {d && followerPair.length > 0 && (
        <Block title="Who watched">
          <SliceBars slices={followerPair.map(s => ({ ...s, label: AUDIENCE_WORDS[s.label] ?? s.label }))} />
          {newPair.length > 0 && <div className="mt-2"><SliceBars slices={newPair.map(s => ({ ...s, label: AUDIENCE_WORDS[s.label] ?? s.label }))} /></div>}
        </Block>
      )}

      {d && d.sources.length > 0 && (
        <Block title="Where the views came from">
          <SliceBars slices={d.sources.map(s => ({ ...s, label: SOURCE_WORDS[s.label] ?? s.label }))} />
        </Block>
      )}

      {d && d.countries.length > 0 && (
        <Block title="Where viewers are">
          <SliceBars slices={d.countries.map(s => ({ ...s, label: countryName(s.label) }))} limit={8} />
        </Block>
      )}

      {platform === 'instagram' && (data.collaborators || data.collaboratorsProblem) && (
        <Block title="Collab partners">
          {data.collaboratorsProblem ? <p className="text-secondary-13 text-muted-foreground">{data.collaboratorsProblem}</p>
            : data.collaborators && data.collaborators.length > 0 ? (
              <ul className="flex flex-col gap-1 text-secondary-13">
                {data.collaborators.map((c, i) => (
                  <li key={i}>{c.username ? `@${c.username}` : 'An account'} — {c.status === 'accepted' ? 'accepted' : c.status === 'pending' ? 'invited, not accepted yet' : c.status || 'invited'}</li>
                ))}
              </ul>
            ) : <p className="text-secondary-13 text-muted-foreground">No collab partners on this post.</p>}
        </Block>
      )}

      {platform === 'linkedin' && data.linkedin && (
        <Block title="LinkedIn’s own numbers">
          <div className="grid grid-cols-3 gap-2">
            {typeof data.linkedin.reach === 'number' && <Tile label="Unique people" value={n(data.linkedin.reach)} />}
            {typeof data.linkedin.clicks === 'number' && <Tile label="Clicks" value={n(data.linkedin.clicks)} />}
            {typeof data.linkedin.saves === 'number' && data.linkedin.saves > 0 && <Tile label="Saves" value={n(data.linkedin.saves)} />}
            {typeof data.linkedin.sends === 'number' && data.linkedin.sends > 0 && <Tile label="Sent in messages" value={n(data.linkedin.sends)} />}
            {typeof data.linkedin.engagementRate === 'number' && <Tile label="Engagement with clicks" value={`${data.linkedin.engagementRate}%`} />}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">LinkedIn counts clicks as engagement here, so this rate is higher than the one above.</p>
        </Block>
      )}
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-card-title">{title}</h3>{children}</section>
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-inner border border-border p-2.5">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="font-mono text-lg tabular-nums">{value}</p>
    </div>
  )
}

/** Horizontal bars, biggest first; `counts` shows numbers, otherwise each slice is a 0–1 share. */
export function SliceBars({ slices, counts, limit = 10 }: { slices: readonly Slice[]; counts?: boolean; limit?: number }) {
  const top = slices.slice(0, limit)
  const max = Math.max(...top.map(s => s.value), counts ? 1 : 0.0001)
  return (
    <ul className="flex flex-col gap-1.5">
      {top.map(s => (
        <li key={`${s.label}-${s.id ?? ''}`} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-secondary-13">
          <span className="truncate">{s.label}</span>
          <span className="h-2 rounded-full bg-foreground/[0.08]"><span className="block h-2 rounded-full bg-foreground/40" style={{ width: `${(s.value / max) * 100}%` }} /></span>
          <span className="w-16 text-right font-mono tabular-nums">{counts ? n(s.value) : pct(s.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Share still watching, second by second, as a row of bars. */
function Retention({ points }: { points: readonly { sec: number; share: number }[] }) {
  return (
    <div className="flex items-end gap-px overflow-x-auto" style={{ height: 90 }}>
      {points.map(p => (
        <div key={p.sec} className="flex min-w-[6px] flex-1 flex-col items-center justify-end" title={`${p.sec}s · ${pct(p.share)} still watching`}>
          <div className="w-full rounded-t bg-foreground/30" style={{ height: Math.max(2, p.share * 80) }} />
        </div>
      ))}
    </div>
  )
}
