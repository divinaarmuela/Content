'use client'

import Link from 'next/link'
import { AlertTriangle, Check, Mail, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { needsReconnect, readStoredHealth } from '@/app/lib/account-health-core'
import { toast } from 'sonner'
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
  // revoked accounts stay in the bar, red, so they can be reconnected
  const live = (accounts ?? []).filter(a => !!a)
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

function AccountSlot({ slot, selected, onPick, onReconnect, onAskClient, fallbackName }: {
  slot: Extract<ProfileSlot, { kind: 'account' }>
  selected: boolean
  onPick: () => void
  /** start the network's sign-in again for this account's platform */
  onReconnect?: (account: SocialAccount) => void
  /** email the client their own connect link, with Reconnect on it */
  onAskClient?: (account: SocialAccount) => void
  fallbackName: string
}) {
  const { account, platform } = slot
  const name = account.username || account.name || fallbackName
  const ring = ringColour(platform)
  /* IS IT STILL CONNECTED? The morning check writes its verdict on the
   * account's row; the icon wears it — red for "reconnect now", amber for
   * "soon" — and a press on EITHER opens the reason and offers Reconnect,
   * the same sign-in the Social channels page starts (the owner, 9 Sep
   * 2026). The amber one used to filter the calendar like an ordinary press
   * and keep its reason in the hover title, which a phone never shows: "the
   * top icons show yellow caution but does nothing". */
  const health = readStoredHealth((account as { health?: unknown }).health)
  // a channel the network revoked (`active: false`) is exactly the one that
  // needs the Reconnect press — it was filtered out of the bar while the
  // tile named it as the block (the audit of 9 Sep 2026)
  const broken = needsReconnect(health) || account.active === false
  const [checking, setChecking] = useState(false)
  const soon = health?.level === 'watch'
  const warned = broken || soon
  const [asking, setAsking] = useState(false)

  return (
    <div className="relative flex w-[58px] shrink-0 flex-col items-center gap-1">
    <button
      type="button"
      aria-pressed={selected}
      // pressing a warned channel opens the panel below it rather than
      // filtering the week — the button has to announce which it does
      aria-haspopup={warned && onReconnect ? 'dialog' : undefined}
      aria-expanded={warned && onReconnect ? asking : undefined}
      title={broken ? `${name} — ${health?.reason ?? 'needs reconnecting'}` : soon ? `${name} — ${health?.reason}` : selected ? `Showing only ${name}` : `Show only ${name}`}
      onClick={() => { if (warned && onReconnect) setAsking(v => !v); else onPick() }}
      className="flex w-full flex-col items-center gap-1"
    >
      <span
        style={selected ? { boxShadow: `0 0 0 2px var(--dbx-surface, #fff), 0 0 0 4px ${ring}` } : undefined}
        className="relative flex h-11 w-11 items-center justify-center overflow-visible rounded-full"
      >
        {/* the real photo when the network gives us one, initials when it
            does not, and initials again when a signed URL has run out — see
            AccountAvatar. The network's own mark rides in the corner. */}
        <AccountAvatar account={account} size={44} fallbackName={fallbackName} />
        {selected && !broken && (
          <span
            style={{ background: ring }}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-white"
          >
            <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />
          </span>
        )}
        {(broken || soon) && (
          <span
            role="img"
            aria-label={broken ? 'Needs reconnecting' : 'Connection runs out soon'}
            className={cn('absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-white', broken ? 'bg-accent-red' : 'bg-accent-amber')}
          >
            <AlertTriangle className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
          </span>
        )}
      </span>
      <span className={cn('w-full truncate text-center text-[11px] font-medium', broken ? 'text-accent-red-deep' : 'text-muted-foreground')}>
        {broken ? 'Reconnect' : name}
      </span>
    </button>
    {asking && warned && onReconnect && (
      <div role="dialog" aria-label={`${name}: connection`}
        className="absolute left-1/2 top-full z-30 mt-1 w-[220px] -translate-x-1/2 rounded-inner border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg">
        <p className="text-[13px] font-semibold">
          {broken ? `${name} needs reconnecting` : `${name} — connection runs out soon`}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {health?.reason}
          {soon && ' Reconnecting now keeps every post on this account going out.'}
        </p>
        {/* the sign-in that opens is THE NETWORK's, in this browser: whoever
            signs in is who gets connected. Signing in as yourself puts your
            own account in the client's slot — and on Instagram replaces
            theirs (the owner, 9 Sep 2026: "what if team click reconnect"). */}
        <p className="mt-1.5 rounded-inner bg-tint-amber px-2 py-1.5 text-[12px] leading-[1.4]">
          Sign in as <strong>{name}</strong>, or as an admin on their page. Signing in as
          yourself connects <em>your</em> account instead.
        </p>
        <button type="button" onClick={() => { setAsking(false); onReconnect(account) }}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-foreground text-[13px] font-semibold text-background">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reconnect {brandFor(platform).label}
        </button>
        {/* no login for it? one press emails the client their own connect
            link, with Reconnect waiting on it — the way out of the popover
            that does not involve typing an email */}
        {onAskClient && (
          <button type="button" onClick={() => { setAsking(false); onAskClient(account) }}
            className="mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-border text-[13px] font-semibold">
            <Mail className="h-3.5 w-3.5" aria-hidden /> Email the client to reconnect
          </button>
        )}
        {soon && (
          <button type="button" onClick={() => { setAsking(false); onPick() }}
            className="mt-1 flex min-h-11 w-full items-center justify-center rounded-full border border-border text-[13px] font-semibold">
            {selected ? 'Show every channel' : `Show only ${name}`}
          </button>
        )}
        {/* already reconnected, or the provider has renewed it itself (TikTok
            rotates its token daily)? Ask the provider now instead of waiting
            for tomorrow's 7 am check — the row updates live */}
        <button type="button" disabled={checking}
          onClick={async () => {
            setChecking(true)
            try {
              const res = await fetch('/api/social/accounts/health', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: account.client_id }),
              })
              if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not check')
              setAsking(false)
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not check')
            } finally { setChecking(false) }
          }}
          className="mt-1 flex min-h-11 w-full items-center justify-center rounded-full border border-border text-[13px] font-semibold disabled:opacity-60">
          {checking ? 'Checking…' : 'Already reconnected — check again'}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="mt-1 flex min-h-11 w-full items-center justify-center text-[12px] text-muted-foreground underline-offset-4 hover:underline">Not now</button>
      </div>
    )}
    </div>
  )
}

function EmptySlot({ platform, onConnect }: { platform: string; onConnect?: (platform: string) => void }) {
  const label = brandFor(platform).label
  const [busy, setBusy] = useState(false)
  // CONNECT IT HERE (the owner, 9 Sep 2026): the "+" used to link to the
  // Social channels page, which a scheduler cannot even open. It now starts
  // the network's sign-in from this bar and comes back to this bar; the link
  // is only the fallback for a bar drawn with no way to connect.
  const face = (
    <>
      {/* A greyed-out logo on a near-black page is a dark smudge on a dark
          circle — at 25% opacity the unconnected networks were all but
          invisible in dark mode. The circle gets a lifted fill and a real
          border so it reads as an empty SLOT in both themes, and the logo
          sits on top of that instead of on the page. */}
      <span className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-paper">
        <PlatformIcon platform={platform} size={40} className="rounded-full opacity-45 grayscale dark:opacity-70" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background">
            {busy ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden /> : <Plus className="h-3 w-3" strokeWidth={3} aria-hidden />}
          </span>
        </span>
      </span>
      <span className="w-full truncate text-center text-[11px] font-medium text-muted-foreground">
        {busy ? 'Connecting…' : label}
      </span>
    </>
  )
  if (onConnect) {
    return (
      <button
        type="button"
        title={`Connect a ${label} account`}
        disabled={busy}
        onClick={() => { setBusy(true); onConnect(platform) }}
        className="flex w-[66px] shrink-0 flex-col items-center gap-1"
      >
        {face}
      </button>
    )
  }
  return (
    <Link
      href="/dashboard/social"
      title={`Connect a ${label} account`}
      className="flex w-[66px] shrink-0 flex-col items-center gap-1"
    >
      {face}
    </Link>
  )
}

export default function ProfilesBar({
  clients, clientId, onClient, accounts, channel, onChannel, view, onView, onReconnect, onConnect, onAskClient,
}: {
  /** start the network's sign-in again for this account (the Schedule
   *  page's own connect flow — see page.tsx) */
  onReconnect?: (account: SocialAccount) => void
  /** connect a network this client has no account on yet — the same sign-in,
   *  from the empty slot, coming back HERE (the owner, 9 Sep 2026) */
  onConnect?: (platform: string) => void
  /** email the client their own connect link, with Reconnect waiting on it */
  onAskClient?: (account: SocialAccount) => void
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
    <div data-tour="profiles-bar" className="flex flex-wrap items-center gap-3 border-b border-border py-2">
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
      <div className="flex min-w-0 flex-1 items-start gap-2 overflow-x-auto pb-0.5">
        {slots.map(slot => (
          slot.kind === 'account' ? (
            <AccountSlot
              key={slot.account.id}
              slot={slot}
              selected={channel === slot.account.id}
              fallbackName={client?.name ?? slot.platform}
              onPick={() => onChannel(channel === slot.account.id ? null : slot.account.id)}
              onReconnect={onReconnect}
              onAskClient={onAskClient}
            />
          ) : (
            <EmptySlot key={`empty-${slot.platform}`} platform={slot.platform} onConnect={onConnect} />
          )
        ))}
      </div>

      <div
        data-tour="views"
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
