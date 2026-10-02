'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PostPreviewFrame } from '../social/PostPreview'
import type { NetworkProfile, PostedTile, ScheduledTile, SchedulingNetwork } from '../../lib/one-portal-schedule'
import { REVIEW_WORDS } from '../../lib/one-portal-core'

/**
 * THE SCHEDULING TAB (docs/ONE_PORTAL_SPEC.md R10, R11) — each network as its own profile: Instagram a 3-column
 * grid, LinkedIn a scrolling feed, TikTok a 9:16 grid. Booked posts lead, marked with their date and where the
 * client's word stands; what is already posted follows. Tap a booked post → it as the network will show it, and
 * Approve / Not approved. Tap a posted one → its numbers.
 */

const NETWORK_WORD: Record<SchedulingNetwork, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok' }
const NAME_KEY = 'mdm-portal-name'

const STATE_TONE: Record<ScheduledTile['state'], string> = {
  approved: 'bg-emerald-500',
  asked_again: 'bg-amber-400',
  not_reviewed: 'bg-amber-400',
  not_approved: 'bg-red-500',
}

function Cover({ tile, className }: { tile: { cover?: ScheduledTile['cover']; thumbnail?: string | null; mediaType?: string | null }; className?: string }) {
  const url = 'cover' in tile && tile.cover ? tile.cover.url : (tile as PostedTile).thumbnail ?? null
  const video = 'cover' in tile && tile.cover ? tile.cover.type === 'video' : false
  if (!url) return <div className={`bg-muted ${className ?? ''}`} />
  return video
    ? <video src={url} muted playsInline preload="metadata" className={`object-cover ${className ?? ''}`} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={url} alt="" loading="lazy" className={`object-cover ${className ?? ''}`} />
}

function StateMark({ t }: { t: ScheduledTile }) {
  return (
    <span className="absolute left-1.5 top-1.5 inline-flex max-w-[calc(100%-12px)] items-center gap-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_TONE[t.state]}`} aria-hidden />
      <span className="truncate">{t.when ?? 'Booked'}</span>
    </span>
  )
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString('en-AU'))

export default function OnePortalScheduling({ token, profiles, openPostId }: {
  token: string
  profiles: NetworkProfile[]
  openPostId?: string | null
}) {
  const [net, setNet] = useState<SchedulingNetwork | null>(() =>
    (openPostId ? profiles.find(p => [...p.booked, ...p.off].some(t => t.post_id === openPostId))?.network : null) ?? profiles[0]?.network ?? null)
  const [open, setOpen] = useState<{ booked: ScheduledTile } | { posted: PostedTile } | null>(() => {
    if (!openPostId) return null
    for (const p of profiles) { const t = [...p.booked, ...p.off].find(x => x.post_id === openPostId); if (t) return { booked: t } }
    return null
  })
  const profile = profiles.find(p => p.network === net) ?? null

  if (profiles.length === 0) {
    return <p className="rounded-inner border border-dashed border-border px-4 py-10 text-center text-[14px] text-muted-foreground">No social accounts are connected yet. Once they are, your scheduled and posted posts show here.</p>
  }

  return (
    <div className="flex flex-col gap-5" data-one-portal-scheduling>
      {profiles.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Network">
          {profiles.map(p => (
            <button key={p.network} type="button" role="tab" aria-selected={p.network === net} onClick={() => setNet(p.network)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold ${p.network === net ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
              {NETWORK_WORD[p.network]}
              {p.booked.length > 0 && <span className="text-[11px] opacity-70">{p.booked.length} booked</span>}
            </button>
          ))}
        </div>
      )}

      {profile && (
        <section className="mx-auto flex w-full max-w-[640px] flex-col gap-4" data-network={profile.network}>
          {/* the profile header, as the network draws it */}
          <div className="flex items-center gap-4">
            <Avatar url={profile.avatar_url} letter={(profile.name ?? profile.handle ?? '?').replace(/^@/, '').slice(0, 1).toUpperCase()} />
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold">{profile.handle ? `@${profile.handle.replace(/^@/, '')}` : profile.name}</p>
              <p className="text-[13px] text-muted-foreground">{profile.booked.length} booked · {profile.posted.length} posted · {NETWORK_WORD[profile.network]}</p>
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground">
            Tap a booked post to approve it, or tell us what to change. Posts go out at their time unless you say otherwise.
          </p>

          {profile.network === 'linkedin'
            ? <LinkedInFeed profile={profile} onOpen={setOpen} />
            : <Grid profile={profile} tall={profile.network === 'tiktok'} onOpen={setOpen} />}

          {profile.feed_problem && <p className="text-[13px] text-muted-foreground" role="status">{profile.feed_problem}</p>}

          {profile.off.length > 0 && (
            <div className="flex flex-col gap-2" data-one-portal-off>
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Off the schedule</p>
              {profile.off.map(t => (
                <button key={t.post_id} type="button" onClick={() => setOpen({ booked: t })}
                  className="flex items-center gap-3 rounded-inner border border-border p-2 text-left hover:bg-muted">
                  <Cover tile={t} className="h-14 w-14 shrink-0 rounded" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{t.title}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {t.state === 'not_approved' ? `Not approved — the team is changing it${t.note ? `: “${t.note}”` : ''}` : 'Waiting for your approval — it goes out once you approve'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {open && 'booked' in open && <BookedSheet token={token} tile={open.booked} onClose={() => setOpen(null)} network={net} />}
      {open && 'posted' in open && <PostedSheet tile={open.posted} network={net} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** The profile picture, or the first letter when there is none or it will not load (TikTok's links expire). */
function Avatar({ url, letter }: { url: string | null; letter: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [url])
  return url && !broken
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-16 w-16 rounded-full object-cover" />
    : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-[20px] font-semibold" aria-hidden>{letter}</div>
}

function Grid({ profile, tall, onOpen }: { profile: NetworkProfile; tall: boolean; onOpen: (o: { booked: ScheduledTile } | { posted: PostedTile }) => void }) {
  const aspect = tall ? 'aspect-[9/16]' : 'aspect-[4/5]'
  if (profile.booked.length === 0 && profile.posted.length === 0) {
    return <p className="rounded-inner border border-dashed border-border px-4 py-10 text-center text-[14px] text-muted-foreground">Nothing booked or posted here yet.</p>
  }
  return (
    <div className="grid grid-cols-3 gap-0.5" data-grid>
      {profile.booked.map(t => (
        <button key={t.post_id} type="button" onClick={() => onOpen({ booked: t })} className={`relative ${aspect} overflow-hidden bg-muted`}
          aria-label={`${t.title}, ${t.when ?? 'booked'} — ${REVIEW_WORDS[t.state]}`} data-booked={t.post_id}>
          <Cover tile={t} className="h-full w-full" />
          <StateMark t={t} />
        </button>
      ))}
      {profile.posted.map(t => (
        <button key={t.id} type="button" onClick={() => onOpen({ posted: t })} className={`relative ${aspect} overflow-hidden bg-muted`}
          aria-label="A posted post — see how it did" data-posted={t.id}>
          <Cover tile={t} className="h-full w-full" />
        </button>
      ))}
    </div>
  )
}

function LinkedInFeed({ profile, onOpen }: { profile: NetworkProfile; onOpen: (o: { booked: ScheduledTile } | { posted: PostedTile }) => void }) {
  if (profile.booked.length === 0 && profile.posted.length === 0) {
    return <p className="rounded-inner border border-dashed border-border px-4 py-10 text-center text-[14px] text-muted-foreground">Nothing booked or posted here yet.</p>
  }
  return (
    <div className="flex flex-col gap-3" data-feed>
      {profile.booked.map(t => {
        const frame = t.preview.find(p => p.platform === 'linkedin')
        return (
          <button key={t.post_id} type="button" onClick={() => onOpen({ booked: t })} className="relative rounded-card border border-border bg-card p-3 text-left hover:border-foreground/40" data-booked={t.post_id}>
            <span className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold">
              <span className={`h-2 w-2 rounded-full ${STATE_TONE[t.state]}`} aria-hidden />{t.when ?? 'Booked'} · {REVIEW_WORDS[t.state]}
            </span>
            {frame ? <div className="pointer-events-none"><PostPreviewFrame preview={frame as never} /></div> : <Cover tile={t} className="aspect-[1.91/1] w-full rounded" />}
          </button>
        )
      })}
      {profile.posted.map(t => (
        <button key={t.id} type="button" onClick={() => onOpen({ posted: t })} className="rounded-card border border-border bg-card p-3 text-left hover:border-foreground/40" data-posted={t.id}>
          {t.caption && <p className="mb-2 line-clamp-3 whitespace-pre-wrap text-[14px]">{t.caption}</p>}
          <Cover tile={t} className="aspect-[1.91/1] w-full rounded" />
          <p className="mt-2 text-[12px] text-muted-foreground">{fmt(t.likes)} reactions · {fmt(t.comments)} comments</p>
        </button>
      ))}
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl border border-border bg-popover p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-3">
          <p className="min-w-0 flex-1 text-[17px] font-semibold leading-snug">{title}</p>
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-full border border-border px-3 text-[13px]">Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function BookedSheet({ token, tile, network, onClose }: { token: string; tile: ScheduledTile; network: SchedulingNetwork | null; onClose: () => void }) {
  const router = useRouter()
  const frame = tile.preview.find(p => p.platform === network) ?? tile.preview[0] ?? null
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [saying, setSaying] = useState<'no' | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? '') } catch { /* private window */ } }, [])

  const answer = async (action: 'client_ok' | 'client_not_approved') => {
    if (!name.trim()) { toast.error('Add your name so the team knows who answered.'); return }
    if (action === 'client_not_approved' && !note.trim()) { toast.error('Say what should change, so the team can fix it.'); return }
    setBusy(true)
    try { localStorage.setItem(NAME_KEY, name.trim()) } catch { /* private window */ }
    try {
      const res = await fetch('/api/portal/act', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, post_id: tile.post_id, version: tile.version, action, note: note.trim() || null, author_name: name.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'That did not go through — reload the page and try again.')
      toast.success(action === 'client_ok' ? 'Approved — thank you.' : 'Thanks — it is off the schedule and the team has your note.')
      onClose()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={tile.title} onClose={onClose}>
      <p className="mb-3 text-[13px] text-muted-foreground">
        {tile.when ? `Goes out ${tile.when}` : 'Booked'} · <span className="font-semibold text-foreground">{REVIEW_WORDS[tile.state]}</span>
      </p>
      {frame ? <PostPreviewFrame preview={frame as never} /> : <Cover tile={tile} className="aspect-square w-full rounded" />}

      {tile.state === 'not_approved' ? (
        <p className="mt-4 rounded-inner bg-muted p-3 text-[14px]">You asked for a change{tile.note ? `: “${tile.note}”` : ''}. The team is on it — the new version will show here.</p>
      ) : tile.answerable ? (
        <div className="mt-4 flex flex-col gap-3" data-answer={tile.post_id}>
          {tile.last_slot && <p className="text-[13px] text-muted-foreground">This goes out in under 15 minutes, so your answer moves it to the next free time first.</p>}
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name"
            className="h-11 rounded-full border border-border bg-background px-4 text-[14px]" />
          {saying === 'no' && (
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus
              placeholder="What should change?" aria-label="What should change"
              className="rounded-inner border border-border bg-background p-3 text-[14px]" />
          )}
          <div className="flex flex-wrap gap-2">
            {saying === 'no' ? (
              <>
                <button type="button" disabled={busy} onClick={() => void answer('client_not_approved')}
                  className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-50">Send — take it off the schedule</button>
                <button type="button" disabled={busy} onClick={() => setSaying(null)}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-[14px]">Back</button>
              </>
            ) : (
              <>
                {tile.state !== 'approved' && (
                  <button type="button" disabled={busy} onClick={() => void answer('client_ok')}
                    className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background disabled:opacity-50">Approve</button>
                )}
                <button type="button" disabled={busy} onClick={() => setSaying('no')}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-[14px] font-semibold">Not approved</button>
              </>
            )}
          </div>
          {tile.waiting_for_them && tile.state !== 'approved' && (
            <p className="text-[12px] text-muted-foreground">This post waits for your approval — it does not go out until you approve it.</p>
          )}
        </div>
      ) : null}
    </Sheet>
  )
}

function PostedSheet({ tile, network, onClose }: { tile: PostedTile; network: SchedulingNetwork | null; onClose: () => void }) {
  const s = tile.stats
  const cells: [string, number | null | undefined][] = s
    ? [['Views', s.views], ['Reach', s.reach], ['Likes', s.likes], ['Comments', s.comments], ['Shares', s.shares], ['Saves', s.saves]]
    : [['Likes', tile.likes], ['Comments', tile.comments]]
  return (
    <Sheet title="How it did" onClose={onClose}>
      <Cover tile={tile} className="aspect-square w-full rounded" />
      <div className="mt-4 grid grid-cols-3 gap-2" data-stats>
        {cells.filter(([, v]) => v != null).map(([k, v]) => (
          <div key={k} className="rounded-inner border border-border p-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{k}</p>
            <p className="text-[18px] font-semibold tabular-nums">{fmt(v)}</p>
          </div>
        ))}
      </div>
      {!s && <p className="mt-2 text-[12px] text-muted-foreground">More numbers arrive within the hour of posting.</p>}
      {tile.caption && <p className="mt-4 whitespace-pre-wrap text-[14px]">{tile.caption}</p>}
      {tile.permalink && (
        <a href={tile.permalink} target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-border px-5 text-[14px] font-semibold">
          Open on {network ? NETWORK_WORD[network] : 'the network'}
        </a>
      )}
    </Sheet>
  )
}
