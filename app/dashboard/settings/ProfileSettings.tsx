'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { COMMON_ZONES, zoneOption } from '@/app/lib/timezone-core'

type Me = {
  id: string
  email: string
  name: string
  role: string
  employment_type: string
  timezone: string
  workday_start: string
  workday_end: string
  notification_prefs: Record<string, boolean>
}

/**
 * One list, shared with Team. This page's own copy of it left out
 * `Asia/Manila` — so half the team could not set the timezone that decides
 * what counts as overdue for them, and Team's picker (super-admin only) was
 * the only place it existed. Two lists WILL drift; there is now one.
 */
const ZONES = COMMON_ZONES

/** "09:00:00" from Postgres, "09:00" from an <input type=time>. */
const toTimeInput = (v: string) => (v || '').slice(0, 5)

export default function ProfileSettings() {
  const [me, setMe] = useState<Me | null>(null)
  const [draft, setDraft] = useState<Partial<Me>>({})
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/team/me')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load your profile')
      setMe(json)
      setDraft(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load your profile')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // the clock below is the point of the timezone field, so it has to tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/team/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          timezone: draft.timezone,
          workday_start: draft.workday_start,
          workday_end: draft.workday_end,
          notification_prefs: draft.notification_prefs,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setMe(json)
      setDraft(json)
      toast.success('Profile saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) return <Skeleton className="h-96 w-full" />

  const zone = draft.timezone || me.timezone
  let localTime = ''
  try {
    localTime = new Intl.DateTimeFormat('en-AU', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).format(now)
  } catch { localTime = '' }

  const dirty = JSON.stringify(draft) !== JSON.stringify(me)
  const prefs = draft.notification_prefs ?? {}

  return (
    <Card className="border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>
          Your details. Timezone and working hours are what the Team Activity page uses to
          decide what counts as overdue for you.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              value={draft.name ?? ''}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-email">Email</Label>
            {/* Read-only: identity comes from Clerk, and editing it here would
                only desynchronise the two. */}
            <Input id="profile-email" value={me.email} readOnly className="text-zinc-500" />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Managed by your sign-in account.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-timezone">Timezone</Label>
            <Select
              value={zone}
              onValueChange={v => setDraft(d => ({ ...d, timezone: v }))}
            >
              <SelectTrigger id="profile-timezone"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ZONES.map(z => <SelectItem key={z} value={z}>{zoneOption(z)}</SelectItem>)}
              </SelectContent>
            </Select>
            {localTime && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                It is <span className="font-mono text-zinc-700 dark:text-zinc-300">{localTime}</span> for you.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Working hours</Label>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={toTimeInput(draft.workday_start ?? '')}
                onChange={e => setDraft(d => ({ ...d, workday_start: e.target.value }))}
                className="font-mono"
              />
              <span className="text-sm text-zinc-400">to</span>
              <Input
                type="time"
                value={toTimeInput(draft.workday_end ?? '')}
                onChange={e => setDraft(d => ({ ...d, workday_end: e.target.value }))}
                className="font-mono"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">
            Your access
          </span>
          <Badge variant="outline" className="font-normal capitalize">
            {me.role.replace('_', ' ')}
          </Badge>
          <Badge variant="outline" className="font-normal capitalize">
            {me.employment_type}
          </Badge>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            — changed by a super admin in Team, not here.
          </span>
        </div>

        <Separator className="bg-zinc-200 dark:bg-zinc-800" />

        <div className="flex flex-col gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">
            Email notifications
          </span>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Workflow email
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Approvals, review requests and handoffs that name you.
              </p>
            </div>
            <Switch
              checked={prefs.email !== false}
              onCheckedChange={v =>
                setDraft(d => ({ ...d, notification_prefs: { ...(d.notification_prefs ?? {}), email: v } }))
              }
            />
          </div>
        </div>
      </CardContent>

      <CardFooter className="justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(me)} disabled={saving}>
            Discard
          </Button>
        )}
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </CardFooter>
    </Card>
  )
}
