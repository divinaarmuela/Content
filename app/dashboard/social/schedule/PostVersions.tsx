'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import PlatformIcon from '../PlatformIcon'

/**
 * EVERY VERSION OF THE POST, IN THE WINDOW (the owner, 2 Nov 2026: "save everything from past versions within that
 * modal … allow them to make edits and schedule a new one which goes to draft … they would want to look back at it").
 * Newest first; open one to see it exactly as it was — its media, its time, every channel's caption (with Copy) and
 * what has changed since — then bring it back into the post as the working draft, or start a new post from it.
 * Read from /api/posts/<id>/versions when the tab is opened.
 */

export type SavedVersion = {
  n: number
  frozen_for: string
  frozen_at: string
  frozen_by: string | null
  slides: { url: string; name?: string; type: string; thumbnail?: string }[]
  caption: string | null
  channels: string[]
  per_channel: Record<string, { caption?: string } & Record<string, unknown>>
  scheduled_for: string | null
  timezone: string
  automation: unknown
}
export type WasBooked = { n: number; at: string | null; offBy: string | null; offAt: string } | null

const FOR_WORDS: Record<string, string> = {
  quality_check: 'sent for the quality check', client: 'sent to the client', schedule: 'booked', retime: 'booked',
}
export const melb = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : 'no time')

/** the words a channel posts: its own caption, else the shared one */
const captionOn = (v: Pick<SavedVersion, 'caption' | 'per_channel'>, ch: string) => (v.per_channel?.[ch]?.caption ?? '').trim() || (v.caption ?? '').trim()

/** what changed between a version and what the post holds now, in a few words */
export function changesSince(v: SavedVersion, now: Pick<SavedVersion, 'slides' | 'caption' | 'channels' | 'per_channel' | 'scheduled_for'>, nameOf: (ch: string) => string): string[] {
  const out: string[] = []
  const urls = (s: SavedVersion['slides']) => s.map(x => x.url).join('|')
  if (urls(v.slides) !== urls(now.slides)) out.push('media changed')
  const chans = new Set([...v.channels, ...now.channels])
  const lost = v.channels.filter(c => !now.channels.includes(c)).map(nameOf)
  const added = now.channels.filter(c => !v.channels.includes(c)).map(nameOf)
  if (lost.length) out.push(`${lost.join(', ')} taken off`)
  if (added.length) out.push(`${added.join(', ')} added`)
  const reworded = [...chans].filter(c => v.channels.includes(c) && now.channels.includes(c) && captionOn(v, c) !== captionOn(now as SavedVersion, c)).map(nameOf)
  if (reworded.length) out.push(`caption changed on ${reworded.join(', ')}`)
  if ((v.scheduled_for ?? '') !== (now.scheduled_for ?? '')) out.push(`time was ${melb(v.scheduled_for)}`)
  return out
}

/** what a slide looks like, small or large: a still from a video (its first frame), or the picture itself */
function Preview({ s, className, play = false }: { s: SavedVersion['slides'][number]; className: string; play?: boolean }) {
  if (s.type === 'video') {
    // #t=0.1 asks the browser for a frame just in, so a video shows a picture instead of a black box
    return <video src={s.thumbnail ? undefined : `${s.url}#t=0.1`} poster={s.thumbnail} className={className} muted playsInline preload="metadata" controls={play} aria-label={s.name ?? 'Video'} />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={s.thumbnail ?? s.url} alt={s.name ?? 'Picture'} title={s.name} className={className} />
}

export default function PostVersions({ postId, accounts, now, busy, onBringBack, onNewPost }: {
  postId: string
  accounts: readonly { id: string; platform: string; name: string | null }[]
  /** what the post holds now, to say what changed */
  now: Pick<SavedVersion, 'slides' | 'caption' | 'channels' | 'per_channel' | 'scheduled_for'>
  busy: boolean
  onBringBack: (v: SavedVersion, book: boolean) => void
  onNewPost: (v: SavedVersion) => void
}) {
  const [data, setData] = useState<{ versions: SavedVersion[]; current: number | null; wasBooked: WasBooked } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    fetch(`/api/posts/${encodeURIComponent(postId)}/versions`, { cache: 'no-store' })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) setError(j.error ?? 'The versions could not be read'); else setData(j) })
      .catch(() => { if (live) setError('The versions could not be read') })
    return () => { live = false }
  }, [postId])
  const nameOf = useMemo(() => (ch: string) => {
    const a = accounts.find(x => x.id === ch)
    return a ? `${a.platform[0].toUpperCase()}${a.platform.slice(1)}${a.name ? ` @${a.name}` : ''}` : 'a channel no longer connected'
  }, [accounts])

  if (error) return <p className="text-[13px] text-muted-foreground">{error}</p>
  if (!data) return <p className="text-[13px] text-muted-foreground">Reading the versions…</p>
  if (!data.versions.length) return <p className="text-[13px] text-muted-foreground">No version has been saved yet. Version 1 is saved when the post is first sent for the quality check, to the client, or booked.</p>

  return (
    <ol className="flex flex-col gap-2" data-post-versions>
      {data.versions.map(v => {
        const isOpen = open === v.n
        const changes = changesSince(v, now, nameOf)
        return (
          <li key={v.n} className="rounded-inner border border-border bg-surface">
            <button type="button" onClick={() => setOpen(isOpen ? null : v.n)} aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-3 py-2 text-left">
              {v.slides[0] && <Preview s={v.slides[0]} className="h-16 w-12 shrink-0 rounded object-cover bg-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">
                  Version {v.n}{v.n === data.current ? ' · the one sent' : ''}
                </span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {FOR_WORDS[v.frozen_for] ? `${FOR_WORDS[v.frozen_for][0].toUpperCase()}${FOR_WORDS[v.frozen_for].slice(1)}` : 'Saved'}{v.frozen_by ? ` by ${v.frozen_by}` : ''} · {melb(v.frozen_at)}
                  {changes.length ? ` · since then: ${changes.join(', ')}` : ' · same as now'}
                </span>
                {(() => { const first = v.channels.map(c => captionOn(v, c)).find(Boolean); return first ? <span className="mt-0.5 block truncate text-[12px]">“{first.split(/\n/)[0]}”</span> : null })()}
              </span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                <p className="text-[12px] text-muted-foreground">Goes out: <strong className="text-foreground">{melb(v.scheduled_for)}</strong> · {v.slides.length} {v.slides.length === 1 ? 'file' : 'files'}</p>
                <div className="flex gap-1.5 overflow-x-auto">
                  {v.slides.map((s, i) => <Preview key={i} s={s} play className="h-56 w-auto max-w-[180px] shrink-0 rounded-inner bg-black object-contain" />)}
                </div>
                <ul className="flex flex-col gap-2">
                  {v.channels.map(ch => {
                    const words = captionOn(v, ch)
                    const acc = accounts.find(a => a.id === ch)
                    return (
                      <li key={ch} className="rounded-inner bg-muted/40 px-3 py-2">
                        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
                          {acc && <PlatformIcon platform={acc.platform} size={14} className="rounded-full" />}
                          {nameOf(ch)}
                          {words && (
                            <button type="button" onClick={() => { void navigator.clipboard.writeText(words); toast.success('Caption copied') }}
                              className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[12px] font-semibold text-accent-blue-deep hover:bg-muted">
                              <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
                            </button>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-[13px]">{words || <span className="text-muted-foreground">No caption</span>}</p>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => onBringBack(v, false)}
                    className="min-h-10 rounded-full bg-foreground px-4 text-[12px] font-semibold text-background disabled:opacity-60">
                    Bring this version back
                  </button>
                  <button type="button" disabled={busy} onClick={() => onNewPost(v)}
                    className="min-h-10 rounded-full border border-border px-4 text-[12px] font-semibold hover:bg-muted disabled:opacity-60">
                    Make a new post from this
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground">Bringing it back makes it the post's working draft — edit it, then send it for the check or schedule it as usual. The version you have now stays in this list.</p>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
