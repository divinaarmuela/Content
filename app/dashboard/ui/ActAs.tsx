'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserRoundCog } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { roleLabel } from '@/app/lib/identity-core'

/**
 * "Act as this person" — the whole control, in one place.
 *
 * It asks the server whether it should exist at all: GET /api/act-as answers
 * 403 for every account but tech@, and this shows nothing on anything but a
 * clean 200. That is a courtesy, not the lock — the server refuses the POST
 * regardless, and `resolveTeamUser` re-checks the real email on every single
 * request, so the cookie on its own is worth nothing.
 *
 * Starting and stopping both do a FULL PAGE LOAD rather than a router
 * refresh. Every hook in the dashboard reads who you are once, on mount — the
 * role, the page grants, the client scoping, the live subscriptions — so a
 * soft refresh would leave half the screen belonging to one person and half
 * to another. A reload is the honest way to become somebody else.
 */

export type ActAsPerson = { id: string; name: string; email: string; role: string }

/** The state the shell needs: may I, who am I right now, and who could I be. */
export function useActAs() {
  const [allowed, setAllowed] = useState(false)
  const [acting, setActing] = useState<ActAsPerson | null>(null)
  const [realName, setRealName] = useState('')
  const [people, setPeople] = useState<ActAsPerson[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/act-as')
      .then(r => (r.ok ? r.json() : null))
      .then((j: { real?: { name?: string }; acting: ActAsPerson | null; people: ActAsPerson[] } | null) => {
        if (!live || !j) return
        setAllowed(true)
        setRealName(j.real?.name ?? '')
        setActing(j.acting ?? null)
        setPeople(Array.isArray(j.people) ? j.people : [])
      })
      .catch(() => { /* not allowed, or offline — the control simply is not there */ })
    return () => { live = false }
  }, [])

  const start = useCallback(async (id: string) => {
    setBusy(true)
    const res = await fetch('/api/act-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_user_id: id }),
    }).catch(() => null)
    if (!res || !res.ok) { setBusy(false); return }
    window.location.assign('/dashboard')
  }, [])

  const stop = useCallback(async () => {
    setBusy(true)
    const res = await fetch('/api/act-as', { method: 'DELETE' }).catch(() => null)
    if (!res || !res.ok) { setBusy(false); return }
    window.location.assign('/dashboard')
  }, [])

  return { allowed, acting, people, realName, busy, start, stop }
}

/** The top-bar control and its picker. Rendered for the one address only. */
export function ActAsButton({
  people, busy, onPick,
}: {
  people: ActAsPerson[]
  busy: boolean
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // grouped by role, in the order the ladder reads, so a long team is
  // something you scan rather than something you have to search
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = q ? people.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(q)) : people
    const order = ['super_admin', 'account_manager', 'general', 'editor', 'scheduler']
    const rank = (role: string) => {
      const i = order.indexOf(role)
      return i < 0 ? order.length : i
    }
    const by = new Map<string, ActAsPerson[]>()
    for (const p of hits) by.set(p.role, [...(by.get(p.role) ?? []), p])
    return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [people, query])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Act as another person"
        title="Act as another person"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-muted"
      >
        <UserRoundCog className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>

      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery('') }}>
        <DialogContent className="max-w-md bg-popover">
          <DialogHeader>
            <DialogTitle>Act as someone</DialogTitle>
            <DialogDescription>
              You will see what they see, and everything you do is done as them. It is
              logged as you acting as them, and it stops on its own after 12 hours.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search people"
          />

          <div className="max-h-[50vh] overflow-y-auto">
            {groups.length === 0 && (
              <p className="py-6 text-center text-[13px] text-muted-foreground">Nobody matches that.</p>
            )}
            {groups.map(([role, list]) => (
              <div key={role} className="mb-3">
                <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {roleLabel(role)}
                </p>
                {list.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => { setOpen(false); onPick(p.id) }}
                    className="flex min-h-11 w-full flex-col items-start rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <span className="text-[14px] font-medium text-foreground">{p.name}</span>
                    <span className="text-[12px] text-muted-foreground">{p.email}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The bar nobody can miss while they are somebody else.
 *
 * It says who you are right now, what that means, and how to stop, in that
 * order — the three things a person needs when they have forgotten they are
 * wearing somebody else's account, which is the only way this can do harm.
 */
export function ActingBar({
  acting, realName, busy, onStop,
}: {
  acting: ActAsPerson
  realName: string
  busy: boolean
  onStop: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-accent-amber px-4 py-2 text-center text-[13px] font-semibold text-ink">
      <span>
        You are {acting.name} right now ({roleLabel(acting.role).toLowerCase()}). Everything you
        do is done as them and logged as {realName} acting as them.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onStop}
        className="min-h-8 rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-cream transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        Stop acting as them
      </button>
    </div>
  )
}
