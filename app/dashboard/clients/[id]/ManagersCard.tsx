'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Check, Loader2, UserRoundPlus, X } from 'lucide-react'
import { roleLabel } from '@/app/lib/identity-core'

/**
 * Who runs this client, and the moment to decide it.
 *
 * Quiet chip row once managers are assigned. The interesting state is the
 * gap this card exists for: the intake form has been submitted and nobody
 * owns the client yet — then it becomes an invitation, with each eligible
 * account manager as a pickable tile showing how many clients they already
 * carry, so the assignment can balance rather than pile up.
 */

type Manager = { team_user_id: string; name: string; email: string; role: string }
type Eligible = { id: string; name: string; email: string; role: string; client_count: number }

const initials = (name: string, email: string) =>
  (name || email).split(/[\s@.]+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')

export default function ManagersCard({ clientId, intakeComplete = false, hideWhenIdle = false }: {
  clientId: string
  /** a submitted intake form exists — the trigger for the assign invitation */
  intakeComplete?: boolean
  /** for secondary placements: render nothing unless inviting or assigned */
  hideWhenIdle?: boolean
}) {
  const [managers, setManagers] = useState<Manager[] | null>(null)
  const [eligible, setEligible] = useState<Eligible[]>([])
  const [canManage, setCanManage] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = (json: { managers?: Manager[]; eligible?: Eligible[]; can_manage?: boolean }) => {
    setManagers(json.managers ?? [])
    setEligible(json.eligible ?? [])
    if (json.can_manage !== undefined) setCanManage(json.can_manage)
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/managers`)
    if (res.ok) apply(await res.json())
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const assign = async (teamUserId: string) => {
    setBusy(true)
    const res = await fetch(`/api/clients/${clientId}/managers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_user_id: teamUserId }),
    })
    setBusy(false)
    if (!res.ok) { toast.error((await res.json()).error ?? 'Could not assign'); return }
    apply(await res.json())
    setPicked(null); setAdding(false)
    toast.success('Account manager assigned')
  }

  const remove = async (m: Manager) => {
    const res = await fetch(
      `/api/clients/${clientId}/managers?team_user_id=${m.team_user_id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not remove'); return }
    apply(await res.json())
    toast.success(`${m.name || m.email} removed`)
  }

  if (managers === null) return <Skeleton className="h-16 w-full" />

  const unassigned = eligible.filter(e => !managers.some(m => m.team_user_id === e.id))
  const inviting = intakeComplete && managers.length === 0 && canManage
  const showPicker = (inviting || adding) && unassigned.length > 0

  // secondary placements stay quiet unless there is something to say;
  // the primary placement always offers the assignment
  if (hideWhenIdle && managers.length === 0 && !inviting) return null

  return (
    <div className={
      'rounded-lg border p-5 transition-colors ' +
      (inviting
        ? 'border-primary/40 bg-primary/[0.04]'
        : 'border-border bg-card')
    }>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {inviting ? 'Intake complete. Who will run this client?' : 'Account managers'}
          </h3>
          {inviting ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              The brief is in. Assign an account manager so it has an owner from day one.
            </p>
          ) : managers.length === 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {canManage
                ? 'Nobody runs this client yet. Assign any time, before or after the intake.'
                : 'Nobody has been assigned yet.'}
            </p>
          ) : null}
        </div>
        {!inviting && !showPicker && canManage && unassigned.length > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAdding(true)}>
            <UserRoundPlus className="mr-1.5 h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>

      {managers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {managers.map(m => (
            <span key={m.team_user_id}
              className="group flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {initials(m.name, m.email)}
              </span>
              {m.name || m.email}
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {roleLabel(m.role)}
              </span>
              {canManage && (
                <button onClick={() => void remove(m)} aria-label={`Remove ${m.name || m.email}`}
                  className="-mr-1 rounded-full p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {showPicker && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {unassigned.map(e => (
              <button key={e.id} type="button" onClick={() => setPicked(picked === e.id ? null : e.id)}
                className={
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition ' +
                  (picked === e.id
                    ? 'border-primary bg-primary/[0.06]'
                    : 'border-border bg-background hover:border-foreground/40')
                }>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initials(e.name, e.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.name || e.email}</span>
                  <span className="block text-xs text-muted-foreground">
                    {roleLabel(e.role)} · {e.client_count === 0
                      ? 'no clients yet'
                      : `${e.client_count} client${e.client_count === 1 ? '' : 's'}`}
                  </span>
                </span>
                {picked === e.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!picked || busy} onClick={() => picked && void assign(picked)}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Assign
            </Button>
            {adding && (
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setPicked(null) }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {inviting && unassigned.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nobody with an account manager role is available to assign. Add one on the Team page first.
        </p>
      )}
    </div>
  )
}
