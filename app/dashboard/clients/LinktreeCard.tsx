'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, Link2, Plus, Trash2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useRole } from '../useRole'
import { mayManageLinktree, type LinktreeLink, type LinktreeNumbers, type LinktreeProfile } from '../../lib/linktree-core'

/**
 * A CLIENT'S LINKTREE, ON SOCIAL CHANNELS (the owner, 21 Sep 2026: "I want
 * the linktree — set it up on the social channels").
 *
 * Linktree offers no way to MAKE a profile from outside, so the card says so
 * in plain words: make it on linktr.ee, then connect it here. Once connected
 * a manager picks the profile, and the card shows its links in order with 28
 * days of views and clicks, and adds, renames, hides, moves and deletes
 * links. Everyone else on the team reads it. linktree-core.ts has what was
 * checked against Linktree's own servers.
 */

type State = {
  connected: boolean
  profile?: { username: string; url: string | null; name: string | null } | null
  profiles?: LinktreeProfile[]
  links?: LinktreeLink[]
  numbers?: LinktreeNumbers | null
  error?: string
}

export default function LinktreeCard({ clientId }: { clientId: string }) {
  const { me } = useRole()
  const manager = mayManageLinktree(me)
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  /** the link whose Delete was pressed once — the second press deletes */
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/production/linktree/${clientId}`)
      const json = await res.json().catch(() => ({})) as State
      setState(res.ok ? json : { connected: false, error: (json as { error?: string }).error })
    } catch { setState({ connected: false, error: 'Could not reach the server' }) }
  }, [clientId])
  useEffect(() => { void load() }, [load])

  const act = async (body: Record<string, unknown>, said: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/linktree/${clientId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Linktree did not take that')
      toast.success(said)
      await load()
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Linktree did not take that'); return false } finally { setBusy(false) }
  }

  const H = 'font-mono text-[12px] uppercase tracking-widest text-muted-foreground'

  if (state === null) return <Skeleton className="h-16 w-full rounded-inner" />

  if (!state.connected) {
    return (
      <div className="flex flex-col gap-2 rounded-inner border border-border p-3" data-linktree="off">
        <p className={H}>Linktree</p>
        <p className="text-[13px] text-muted-foreground">
          Linktree has no way to make a profile from here. Make the client’s profile on linktr.ee first, then connect it: the dashboard then shows its links and clicks, and edits the links.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {manager ? (
            <Button asChild className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
              <a href={`/api/production/linktree/connect?clientId=${encodeURIComponent(clientId)}`}><Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Connect Linktree</a>
            </Button>
          ) : <span className="text-[13px] text-muted-foreground">An account manager or a super admin connects it.</span>}
          <Button asChild variant="outline" className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <a href="https://linktr.ee/register" target="_blank" rel="noreferrer noopener"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Make a profile on linktr.ee</a>
          </Button>
        </div>
        {state.error && <p className="text-[12px] text-accent-red-deep">{state.error}</p>}
      </div>
    )
  }

  const links = state.links ?? []
  return (
    <div className="flex flex-col gap-3 rounded-inner border border-border p-3" data-linktree="on">
      <div className="flex flex-wrap items-center gap-2">
        <p className={H}>Linktree</p>
        {state.profile?.url && (
          <a href={state.profile.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold underline underline-offset-4">
            {state.profile.name ? `${state.profile.name} · ` : ''}linktr.ee/{state.profile.username} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
        {state.numbers && (
          <span className="text-[12px] text-muted-foreground">
            Last 28 days: {state.numbers.views ?? '—'} views · {state.numbers.clicks ?? '—'} clicks{state.numbers.ctr !== null ? ` · ${Math.round(state.numbers.ctr * (state.numbers.ctr <= 1 ? 100 : 1))}% click-through` : ''}
          </span>
        )}
        {manager && (
          <Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'disconnect' }, 'Linktree disconnected')}
            className="ml-auto h-9 rounded-full px-3 text-[12px] font-semibold text-muted-foreground"><Unplug className="mr-1 h-3.5 w-3.5" aria-hidden /> Disconnect</Button>
        )}
      </div>

      {state.error && <p className="rounded-inner bg-tint-red px-3 py-2 text-[13px]">{state.error}</p>}

      {!state.profile && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px]">Which profile is this client’s?</p>
          {(state.profiles ?? []).length === 0
            ? <p className="text-[13px] text-muted-foreground">That Linktree sign-in reaches no profile yet. Make one on linktr.ee, or sign in with the account that holds it.</p>
            : <div className="flex flex-wrap gap-2">{(state.profiles ?? []).map(p => (
                <Button key={p.username} variant="outline" disabled={busy || !manager} onClick={() => void act({ action: 'pick_profile', username: p.username }, `Profile set — ${p.username}`)}
                  className="h-11 rounded-full px-4 text-[13px] font-semibold">{p.displayName ? `${p.displayName} · ` : ''}{p.username}</Button>
              ))}</div>}
        </div>
      )}

      {state.profile && (
        <>
          {links.length === 0 && !state.error && <p className="text-[13px] text-muted-foreground">No links on this Linktree yet.</p>}
          <ul className="flex flex-col gap-1.5" aria-label="The Linktree’s links, in order">
            {links.map((l, i) => (
              <li key={l.id} className={`flex flex-wrap items-center gap-2 rounded-inner border border-border px-3 py-2 ${l.active ? '' : 'opacity-60'}`}>
                <span className="w-5 shrink-0 text-right font-mono text-[12px] text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{l.title || l.url}</span>
                  <a href={l.url} target="_blank" rel="noreferrer noopener" className="block truncate text-[12px] text-muted-foreground hover:underline">{l.url}</a>
                </span>
                {!l.active && <span className="text-[12px] text-muted-foreground">hidden</span>}
                {manager && (
                  <span className="flex items-center">
                    <Button variant="ghost" size="icon" disabled={busy || i === 0} aria-label={`Move ${l.title || 'link'} up`} className="h-11 w-11 rounded-full" onClick={() => void act({ action: 'move_link', id: l.id, direction: 'up' }, 'Moved up')}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                    <Button variant="ghost" size="icon" disabled={busy || i === links.length - 1} aria-label={`Move ${l.title || 'link'} down`} className="h-11 w-11 rounded-full" onClick={() => void act({ action: 'move_link', id: l.id, direction: 'down' }, 'Moved down')}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                    <Button variant="ghost" size="icon" disabled={busy} aria-label={l.active ? `Hide ${l.title || 'link'}` : `Show ${l.title || 'link'}`} className="h-11 w-11 rounded-full" onClick={() => void act({ action: 'update_link', id: l.id, active: !l.active }, l.active ? 'Hidden on the Linktree' : 'Showing on the Linktree')}>{l.active ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}</Button>
                    <Button variant="ghost" size="icon" disabled={busy} aria-label={`Delete ${l.title || 'link'}`} className={`h-11 rounded-full hover:text-accent-red-deep ${confirmId === l.id ? 'w-auto bg-tint-red px-3 text-[12px] font-semibold text-accent-red-deep' : 'w-11'}`}
                      onBlur={() => setConfirmId(null)}
                      onClick={() => { if (confirmId === l.id) { setConfirmId(null); void act({ action: 'delete_link', id: l.id }, 'Link deleted') } else setConfirmId(l.id) }}>
                      {confirmId === l.id ? 'Delete it?' : <Trash2 className="h-4 w-4" aria-hidden />}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {manager && (
            <form className="flex flex-wrap items-center gap-2" onSubmit={async e => { e.preventDefault(); if (await act({ action: 'add_link', title, url }, 'Link added to the Linktree')) { setTitle(''); setUrl('') } }}>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title — Book a call" aria-label="The new link’s title" className="h-11 min-w-0 flex-1 basis-40" />
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" aria-label="Where the new link goes" className="h-11 min-w-0 flex-1 basis-56" />
              <Button type="submit" disabled={busy || !url.trim()} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90"><Plus className="mr-1 h-4 w-4" aria-hidden /> Add link</Button>
            </form>
          )}
        </>
      )}
    </div>
  )
}
