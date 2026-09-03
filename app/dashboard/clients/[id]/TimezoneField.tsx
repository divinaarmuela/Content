'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  COMMON_ZONES, ZONE_GROUPS, isValidZone, zoneAbbrev, zoneLabel,
} from '@/app/lib/timezone-core'

const OTHER = '__other__'

/**
 * The client's posting zone.
 *
 * The label is the whole explanation, because the question people ask when
 * they see a time zone on a client record is "whose?" — the agency's, the
 * scheduler's, or the audience's. It is the audience's, and every posting time
 * in the app is shown in it.
 *
 * The list covers where this agency's clients and team actually are; "Other…"
 * takes any IANA identifier, checked against `Intl` before it can be saved, so
 * a typo can never reach the database and quietly become UTC on every screen.
 */
export default function TimezoneField({ value, onSave, disabled }: {
  value: string
  onSave: (tz: string) => void
  disabled?: boolean
}) {
  const listed = COMMON_ZONES.includes(value)
  const [custom, setCustom] = useState(listed ? '' : value)
  const [showCustom, setShowCustom] = useState(!listed)
  const [error, setError] = useState<string | null>(null)

  const commit = (tz: string) => {
    const z = tz.trim()
    if (!z) return
    if (!isValidZone(z)) {
      setError(`“${z}” isn’t a time zone this browser knows. Use an IANA name like Asia/Manila.`)
      return
    }
    setError(null)
    if (z !== value) onSave(z)
  }

  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <Label>
        Posting time zone{' '}
        <span className="text-secondary-13 font-normal text-muted-foreground">
          — where the audience is; every posting time is shown in this zone.
        </span>
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={showCustom ? OTHER : value}
          disabled={disabled}
          onValueChange={v => {
            if (v === OTHER) { setShowCustom(true); return }
            setShowCustom(false)
            setError(null)
            commit(v)
          }}
        >
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ZONE_GROUPS.map(g => (
              <SelectGroup key={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.zones.map(z => (
                  <SelectItem key={z} value={z}>
                    {zoneLabel(z)} — {zoneAbbrev(z)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            <SelectGroup>
              <SelectLabel>Anywhere else</SelectLabel>
              <SelectItem value={OTHER}>Other…</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        {showCustom && (
          <Input
            className="w-64 font-mono text-body-15"
            placeholder="Asia/Manila"
            value={custom}
            disabled={disabled}
            onChange={e => { setCustom(e.target.value); setError(null) }}
            onBlur={e => commit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
          />
        )}

        {!error && isValidZone(value) && (
          <span className="font-mono text-secondary-13 text-muted-foreground">
            {value} · {zoneAbbrev(value)} right now
          </span>
        )}
      </div>
      {error && <p className="text-secondary-13 text-accent-red">{error}</p>}
    </div>
  )
}
