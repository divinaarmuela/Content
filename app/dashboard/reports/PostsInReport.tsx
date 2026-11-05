'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink } from 'lucide-react'
import { includedIds, type CandidatePost, type MonthKey } from '../../lib/client-report-core'

/**
 * THE POSTS IN THIS REPORT (the owner, 5 Nov 2026: "showcase when create a report … these posts are included, add any
 * more, and then it will do it"). Every post of the month, newest first. The ones MD Media published through the app
 * start ticked; the team ticks any other post to add it, or unticks one to leave it out. Build report then explains
 * and writes about the ticked posts only. Each tick saves at once.
 */
export default function PostsInReport({ candidates, saved, clientId, month, onChange }: {
  candidates: CandidatePost[]
  /** the report's `included_post_ids` as saved (unset = the default) */
  saved: unknown
  clientId: string
  month: MonthKey
  onChange: (report: unknown) => void
}) {
  const picked = useMemo(() => includedIds(saved, candidates), [saved, candidates])
  const [busy, setBusy] = useState(false)

  const save = async (next: Set<string>) => {
    setBusy(true)
    try {
      const r = await fetch('/api/reports/monthly', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, month, included_post_ids: [...next] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Could not save')
      onChange(j.report)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id); else next.add(id)
    void save(next)
  }

  const mine = candidates.filter(c => c.byMdm)
  const rest = candidates.filter(c => !c.byMdm)

  const card = (c: CandidatePost) => {
    const on = picked.has(c.id)
    return (
      <li key={c.id}>
        <button type="button" onClick={() => toggle(c.id)} disabled={busy} aria-pressed={on}
          className={`group relative flex w-full flex-col overflow-hidden rounded-inner border text-left transition ${on ? 'border-foreground ring-2 ring-foreground/20' : 'border-border opacity-70 hover:opacity-100'}`}>
          <div className="relative aspect-[4/5] w-full bg-muted">
            {/* an expired story's picture is refused by Facebook and Instagram (403, checked 5 Nov 2026): said, not a grey box */}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center text-[12px] text-muted-foreground">
              {c.format === 'story' ? <><strong className="text-foreground">Story</strong>Expired: {platformName(c.platform)} no longer shows its picture</> : 'No picture'}
            </span>
            {c.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="relative h-full w-full object-cover"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            )}
            <span className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 ${on ? 'border-foreground bg-foreground text-background' : 'border-white bg-black/30'}`}>
              {on && <Check className="h-3.5 w-3.5" aria-hidden />}
            </span>
            {c.byMdm && <span className="absolute right-2 top-2 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">MD Media</span>}
          </div>
          <div className="flex flex-col gap-1 p-2">
            {/* WHERE AND WHAT (5 Nov 2026: "show the platform and the medium, story etc") */}
            <span className="flex flex-wrap gap-1">
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold">{platformName(c.platform)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.format === 'story' ? 'bg-tint-amber' : 'bg-muted'}`}>{mediumName(c.format)}</span>
            </span>
            <span className="text-[12px] text-muted-foreground">
              {c.publishedAt ? new Date(c.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}
              {c.format === 'story' && !c.views ? ' · numbers gone after 24 h' : ` · ${c.views.toLocaleString('en-AU')} views`}
            </span>
            <span className="line-clamp-2 text-[12px]">{c.caption || 'No caption'}</span>
          </div>
        </button>
        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
            Open <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </li>
    )
  }
  const grid = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px]"><strong>{picked.size}</strong> <span className="text-muted-foreground">of {candidates.length} posts included</span></p>
      {mine.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">Posted by MD Media ({mine.length})</h3>
          <ul className={grid}>{mine.map(card)}</ul>
        </div>
      )}
      {rest.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">{mine.length ? `Other posts this month (${rest.length}) — click to add` : `This month's posts (${rest.length})`}</h3>
          <ul className={grid}>{rest.map(card)}</ul>
        </div>
      )}
    </div>
  )
}

const platformName = (p: string) => (p === 'instagram' ? 'Instagram' : p === 'facebook' ? 'Facebook' : p ? p[0].toUpperCase() + p.slice(1) : 'Post')

/** the medium in the team's words: Reel, Carousel, Image, Story */
function mediumName(f: string | null): string {
  switch ((f ?? '').toLowerCase()) {
    case 'story': return 'Story'
    case 'video': case 'reel': case 'reels': return 'Reel'
    case 'carousel': case 'carousel_album': case 'album': return 'Carousel'
    case 'image': case 'photo': return 'Image'
    case 'text': case 'status': return 'Text post'
    default: return f ? f[0].toUpperCase() + f.slice(1) : 'Post'
  }
}
