'use client'

import Link from 'next/link'
import { Check, Plus } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Client, SocialAccount } from '@/lib/db-types'
import { PLATFORM_RULES } from '@/app/lib/publish-core'
import { initialsOf as accountInitials } from '@/app/lib/social-access-core'
import AccountAvatar from '../AccountAvatar'
import PlatformIcon, { brandFor } from '../PlatformIcon'

/**
 * Who this week is for, and which of their channels is on screen.
 *
 * ONE SLOT PER NETWORK WE CAN POST TO, always, in the same order — so the bar
 * is a map of where this client is and where they are not, rather than a list
 * that changes shape per client. A connected account shows its own profile
 * picture; a network with nobody on it shows its logo greyed with a "+" that
 * goes to Social, where an account is actually connected. Two accounts on one
 * network get two slots: which account a post goes to is a real question.
 *
 * Tapping a profile narrows the calendar to it; tapping it again puts them
 * all back.
 */

export const VIEWS = ['Stories', 'Preview', 'Week', 'Month', 'List'] as const
export type ScheduleViewName = (typeof VIEWS)[number]

/**
 * The networks, in the order they are drawn.
 *
 * Written out rather than taken from `Object.keys(PLATFORM_RULES)`: the order
 * is a decision (the ones this agency actually posts to first), and a test
 * pins that it still covers every platform the publisher supports, so adding
 * a network to `publish-core` cannot silently leave it off this bar.
 */
export const NETWORK_ORDER = [
  'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin',
  'threads', 'twitter', 'pinterest', 'bluesky', 'reddit',
] as const

export type ProfileSlot =
  | { kind: 'account'; platform: string; account: SocialAccount }
  | { kind: 'empty'; platform: string }

/** One slot per connected account, then one greyed slot for every network
 *  this client is not on yet. */
export function profileSlots(
  accounts: readonly SocialAccount[] | null | undefined,
  order: readonly string[] = NETWORK_ORDER,
): ProfileSlot[] {
  const live = (accounts ?? []).filter(a => a?.active !== false)
  const out: ProfileSlot[] = []
  for (const platform of order) {
    const mine = live.filter(a => a.platform === platform)
    if (mine.length === 0) out.push({ kind: 'empty', platform })
    else for (const account of mine) out.push({ kind: 'account', platform, account })
  }
  return out
}

/**
 * Two letters for an account, when there is no profile picture to show.
 *
 * The rule itself moved to `social-access-core` when the access page started
 * drawing the same faces — one initials rule, or the two of them disagree the
 * first time somebody decides a one-word name should be one letter. Kept
 * exported here because this is where the calendar's bar has always been
 * asked about it.
 */
export const initialsOf = accountInitials

/** The brand's own colour as a ring — Instagram's mark is a gradient, and a
 *  ring cannot be one, so it wears its pink. */
function ringColour(platform: string): string {
  const bg = brandFor(platform).background
  return bg.startsWith('#') ? bg : '#DD2A7B'
}

function AccountSlot({ slot, selected, onPick, fallbackName }: {
  slot: Extract<ProfileSlot, { kind: 'account' }>
  selected: boolean
  onPick: () => void
  fallbackName: string
}) {
  const { account, platform } = slot
  const name = account.username || account.name || fallbackName
  const ring = ringColour(platform)

  return (
    <button
      type="button"
      aria-pressed={selected}
      title={selected ? `Showing only ${name}` : `Show only ${name}`}
      onClick={onPick}
      className="flex w-[58px] shrink-0 flex-col items-center gap-1"
    >
      <span
        style={selected ? { boxShadow: `0 0 0 2px var(--dbx-surface, #fff), 0 0 0 4px ${ring}` } : undefined}
        className="relative flex h-11 w-11 items-center justify-center overflow-visible rounded-full"
      >
        {/* the real photo when the network gives us one, initials when it
            does not, and initials again when a signed URL has run out — see
            AccountAvatar. The network's own mark rides in the corner. */}
        <AccountAvatar account={account} size={44} fallbackName={fallbackName} />
        {selected && (
          <span
            style={{ background: ring }}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-white"
          >
            <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-[11px] font-medium text-muted-foreground">
        {name}
      </span>
    </button>
  )
}

function EmptySlot({ platform }: { platform: string }) {
  const label = brandFor(platform).label
  return (
    <Link
      href="/dashboard/social"
      title={`Connect a ${label} account`}
      className="flex w-[58px] shrink-0 flex-col items-center gap-1"
    >
      {/* A greyed-out logo on a near-black page is a dark smudge on a dark
          circle — at 25% opacity the unconnected networks were all but
          invisible in dark mode. The circle gets a lifted fill and a real
          border so it reads as an empty SLOT in both themes, and the logo
          sits on top of that instead of on the page. */}
      <span className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-paper">
        <PlatformIcon platform={platform} size={40} className="rounded-full opacity-45 grayscale dark:opacity-70" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background">
            <Plus className="h-3 w-3" strokeWidth={3} aria-hidden />
          </span>
        </span>
      </span>
      <span className="w-full truncate text-center text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
    </Link>
  )
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
  const slots = profileSlots(accounts)

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border py-2">
      <Select value={clientId ?? ''} onValueChange={onClient}>
        <SelectTrigger className="h-11 w-[200px] shrink-0 rounded-full border-border bg-surface text-[13px] font-semibold">
          <SelectValue placeholder="Pick a client" />
        </SelectTrigger>
        <SelectContent>
          {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* the networks scroll rather than wrap: ten slots and a calendar have
          to share one row on a laptop */}
      <div className="flex min-w-0 flex-1 items-start gap-1 overflow-x-auto pb-0.5">
        {slots.map(slot => (
          slot.kind === 'account' ? (
            <AccountSlot
              key={slot.account.id}
              slot={slot}
              selected={channel === slot.account.id}
              fallbackName={client?.name ?? slot.platform}
              onPick={() => onChannel(channel === slot.account.id ? null : slot.account.id)}
            />
          ) : (
            <EmptySlot key={`empty-${slot.platform}`} platform={slot.platform} />
          )
        ))}
      </div>

      <div
        role="tablist"
        aria-label="How to look at the week"
        className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface p-1"
      >
        {VIEWS.map(v => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`schedule-view-${v}`}
            aria-selected={view === v}
            tabIndex={view === v ? 0 : -1}
            onKeyDown={e => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              const i = VIEWS.indexOf(v)
              const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length]
              onView(next)
              document.getElementById(`schedule-view-${next}`)?.focus()
            }}
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

/** Exported for the test that pins the bar against the publisher's own list. */
export const PUBLISHABLE_NETWORKS = Object.keys(PLATFORM_RULES)
