'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { friendlyError } from '@/app/lib/support-core'
import { DAILY_TOP_MAX, DAILY_TOP_MIN, type FullCadence } from '@/app/lib/followers-core'

/**
 * WHO FOLLOWS — this client's three choices.
 *
 * Off the portal by default: a client's follower list is theirs to be shown,
 * and an account manager decides when. The other two are how much the
 * morning look reads and how often the whole list is read; the defaults
 * (the newest 100 every morning, the whole list once a month) suit almost
 * everybody, so they sit under the switch in smaller type.
 *
 * Nothing here names where the list comes from or what it costs.
 */
type Settings = { enabled: boolean; on_portal: boolean; daily_top: number; full_cadence: FullCadence }

const CADENCE: [FullCadence, string][] = [
  ['monthly', 'Once a month'],
  ['weekly', 'Once a week'],
  ['off', 'Never'],
]
const TOPS = [25, 50, 100, 200, 500].filter(n => n >= DAILY_TOP_MIN && n <= DAILY_TOP_MAX)

export default function FollowerSettings({ clientId, mayEdit }: { clientId: string; mayEdit: boolean }) {
  const [s, setS] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const url = `/api/clients/${clientId}/followers`

  const load = useCallback(async () => {
    try {
      const res = await fetch(url)
      const json = await res.json()
      setS(res.ok ? json : { enabled: false, on_portal: false, daily_top: 100, full_cadence: 'monthly' })
    } catch {
      setS({ enabled: false, on_portal: false, daily_top: 100, full_cadence: 'monthly' })
    }
  }, [url])

  useEffect(() => { void load() }, [load])

  const save = async (patch: Partial<Pick<Settings, 'on_portal' | 'daily_top' | 'full_cadence'>>, said: string) => {
    const before = s
    if (s) setS({ ...s, ...patch })
    setSaving(true)
    try {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setS(json)
      toast.success(said)
    } catch (e) {
      setS(before)
      toast.error(friendlyError(e instanceof Error ? e.message : '', 'this client'))
    } finally {
      setSaving(false)
    }
  }

  const selectClass = 'min-h-11 rounded-inner border border-border bg-background px-3 text-body-15 disabled:opacity-60'

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-center gap-2">
          <Users className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
          <h2 className="text-card-title">Followers</h2>
        </div>

        {s === null ? (
          <Skeleton className="h-14 w-full" />
        ) : !s.enabled ? (
          <p className="text-secondary-13 text-muted-foreground">Not switched on.</p>
        ) : (
          <>
            <label className="flex min-h-11 items-start gap-3">
              <Switch
                checked={s.on_portal}
                disabled={!mayEdit || saving}
                onCheckedChange={v => void save({ on_portal: v }, v ? 'Saved. The client now sees their followers on the portal.' : 'Saved. Followers are off the portal.')}
                aria-label="Show followers to the client"
              />
              <span className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">Show followers to the client</span>
                <span className="max-w-prose text-secondary-13 text-muted-foreground">
                  {s.on_portal
                    ? 'The portal has a Followers section: the count, who joined this week and who left.'
                    : 'The follower list stays on this dashboard. Turn this on and the portal shows the client their count, who joined this week and who left.'}
                </span>
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-secondary-13 text-muted-foreground">Every morning, check the newest</span>
                <select
                  className={selectClass}
                  value={s.daily_top}
                  disabled={!mayEdit || saving}
                  onChange={e => void save({ daily_top: Number(e.target.value) }, 'Saved.')}
                >
                  {TOPS.map(n => <option key={n} value={n}>{n} followers</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-secondary-13 text-muted-foreground">Read the whole list (to see who left)</span>
                <select
                  className={selectClass}
                  value={s.full_cadence}
                  disabled={!mayEdit || saving}
                  onChange={e => void save({ full_cadence: e.target.value as FullCadence }, 'Saved.')}
                >
                  {CADENCE.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
            </div>
            {!mayEdit && (
              <span className="text-secondary-13 text-muted-foreground">Only an account manager on this client can change these.</span>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
