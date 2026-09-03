'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Client, SocialAccount } from '@/lib/db-types'
import PlatformIcon from '../PlatformIcon'

/**
 * Who this week is for, and which of their channels is on screen.
 *
 * The avatars are the client's connected accounts: tapping one narrows the
 * calendar to that channel, tapping it again puts them all back. "+" goes to
 * the client's own Social page, which is where an account is actually
 * connected — this page never asks for a password.
 */

export const VIEWS = ['Stories', 'Preview', 'Week', 'Month', 'List'] as const
export type ScheduleViewName = (typeof VIEWS)[number]

/** Two letters for a client, when the whole name will not fit in 34px. */
export function initialsOf(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export default function ProfilesBar({
  clients, clientId, onClient, accounts, channel, onChannel, view, onView,
}: {
  clients: Client[]
  clientId: string | null
  onClient: (id: string) => void
  accounts: SocialAccount[]
  /** the account id the calendar is narrowed to, or null for all of them */
  channel: string | null
  onChannel: (id: string | null) => void
  view: ScheduleViewName
  onView: (v: ScheduleViewName) => void
}) {
  const client = clients.find(c => c.id === clientId) ?? null

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border py-3">
      <h1 className="text-page-title-sm sm:text-[26px] sm:leading-none">Schedule</h1>

      <Select value={clientId ?? ''} onValueChange={onClient}>
        <SelectTrigger className="h-11 w-[200px] rounded-full border-border bg-surface text-[13px] font-semibold">
          <SelectValue placeholder="Pick a client" />
        </SelectTrigger>
        <SelectContent>
          {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2.5">
        {accounts.map(a => {
          const on = channel === a.id
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              title={`${a.username ?? a.name ?? a.platform} — show only this channel`}
              onClick={() => onChannel(on ? null : a.id)}
              className={cn(
                'relative flex h-11 w-11 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                on ? 'bg-foreground text-background' : 'bg-paper text-foreground hover:bg-muted',
              )}
            >
              {initialsOf(a.name ?? a.username ?? client?.name ?? a.platform)}
              <span className="absolute bottom-0 right-0 rounded-full border-2 border-background">
                <PlatformIcon platform={a.platform} size={16} />
              </span>
            </button>
          )
        })}
        {clientId && (
          <Link
            href={`/dashboard/clients/${clientId}/social`}
            title="Add a social profile"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            <span className="sr-only">Add a social profile</span>
          </Link>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1 rounded-full border border-border bg-surface p-1">
        {VIEWS.map(v => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onView(v)}
            className={cn(
              'min-h-9 rounded-full px-3.5 text-[13px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-11',
              view === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}
