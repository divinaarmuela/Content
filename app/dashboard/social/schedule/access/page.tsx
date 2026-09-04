'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Check, ChevronDown, Loader2, Plus, RefreshCw, Trash2, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import {
  accountHealthWords, lastCheckedWords, profileMappingWords,
  type PersonWithAccess, type ProfileChoice,
} from '@/app/lib/social-access-core'
import type { TokenStatus } from '@/app/lib/token-health-core'
import PlatformIcon, { brandFor } from '../../PlatformIcon'
import PageTitle from '../../../ui/PageTitle'

/**
 * ACCOUNTS AND ACCESS — one client's social set, and who may touch it.
 *
 * Later calls this "Social Sets & Access Groups". MD Media has no groups of
 * groups: a CLIENT is the group, and this page says so in the client's own
 * name. Two questions and no more:
 *
 *  1. WHICH ACCOUNTS post for this client, and is any of them about to stop
 *     working. Connecting, refreshing and removing all run the connect flow
 *     that already exists — this page is a better place to stand, not a
 *     second implementation.
 *  2. WHO on the team is on this client, and what they may do. Straight from
 *     `team_user_clients` and their role, written out in words. "Change" goes
 *     to the assignment screen that already owns that decision; nothing here
 *     invents a permission.
 *
 * The third thing, which nobody asked for and everybody needs: which GROUP at
 * the posting service the client's accounts sit in. A post is created against
 * a group, so accounts scattered across groups is how a post goes out from
 * the wrong Instagram. It is one line, near the accounts it is about.
 */

const CLIENT_KEY = 'md-schedule-client'

/** The platforms this agency actually publishes to, in the order it uses
 *  them. The provider supports more; offering all of them is a longer menu
 *  and no more useful. */
const OFFERED = [
  'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'threads', 'pinterest',
] as const

type ClientRow = { id: string; name: string; status: string }

type AccountRow = {
  id: string
  platform: string
  provider_account_id: string
  name: string | null
  username: string | null
  avatar_url: string | null
  connected_at: string | null
}

type AccessData = {
  client: { id: string; name: string; timezone: string | null }
  accounts: AccountRow[]
  health: Record<string, TokenStatus>
  checkedAt: string
  people: PersonWithAccess[]
  profiles: ProfileChoice[]
  profileId: string | null
  stray: string[]
  provider: { configured: boolean }
  can: { profile: boolean; access: boolean }
}

export default function AccessPage() {
  const [clients, setClients] = useState<ClientRow[] | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [data, setData] = useState<AccessData | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<AccountRow | null>(null)
  const [now, setNow] = useState(() => Date.now())

  /* which client. The one the calendar was last on, so arriving here from the
     week does not ask a question that was already answered. */
  useEffect(() => {
    let live = true
    fetch('/api/website/clients')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: ClientRow[]) => {
        if (!live) return
        const usable = (rows ?? []).filter(c => c.status !== 'archived')
        setClients(usable)
        let saved: string | null = null
        try {
          saved = new URL(window.location.href).searchParams.get('clientId')
            ?? localStorage.getItem(CLIENT_KEY)
        } catch { /* private mode */ }
        const known = saved && usable.some(c => c.id === saved) ? saved : usable[0]?.id ?? null
        setClientId(known)
        if (!known) setLoading(false)
      })
      .catch(() => { if (live) { setClients([]); setLoading(false) } })
    return () => { live = false }
  }, [])

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setProblem(null)
    try {
      const res = await fetch(`/api/social/schedule/access?clientId=${encodeURIComponent(id)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProblem(friendlyError(String(json?.error ?? ''), 'Schedule'))
        setData(null)
        return
      }
      setData(json as AccessData)
      setNow(Date.now())
    } catch {
      setProblem(loadFailedMessage('this client’s accounts'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (clientId) void load(clientId) }, [clientId, load])

  const pickClient = (id: string) => {
    setClientId(id)
    try { localStorage.setItem(CLIENT_KEY, id) } catch { /* private mode */ }
  }

  /* ── the connect flow, exactly the one that already exists ───────────── */

  const connect = async (platform: string) => {
    if (!clientId) return
    setBusy(`connect:${platform}`)
    setProblem(null)
    try {
      const res = await fetch('/api/social/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, platform }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? ''))
      // a full navigation, not a popup: the platforms' consent screens refuse
      // to be framed and popups get blocked
      window.location.href = json.authUrl
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
      setBusy(null)
    }
  }

  const refresh = async () => {
    if (!clientId) return
    setBusy('refresh')
    setNote(null)
    try {
      const res = await fetch('/api/social/connect', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? ''))
      await load(clientId)
      const count = Number(json?.synced ?? 0)
      setNote(count > 0
        ? `${count} account${count === 1 ? '' : 's'} checked and up to date.`
        : 'Checked. Nothing has changed.')
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (account: AccountRow) => {
    setBusy(`remove:${account.id}`)
    setProblem(null)
    try {
      const res = await fetch('/api/social/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? ''))
      setNote('Account removed. Nothing that has already been posted is affected.')
      if (clientId) await load(clientId)
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  /* ── the group at the posting service ────────────────────────────────── */

  const setProfile = async (input: { profileId?: string; name?: string }) => {
    if (!clientId) return
    setBusy('profile')
    setProblem(null)
    setNote(null)
    try {
      const res = await fetch('/api/social/schedule/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ...input }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? ''))
      setNote(String(json?.message ?? 'Saved.'))
      await load(clientId)
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
    } finally {
      setBusy(null)
    }
  }

  const mapped = useMemo(
    () => data?.profiles.find(p => p.id === data.profileId) ?? null,
    [data])

  const clientName = data?.client.name
    ?? clients?.find(c => c.id === clientId)?.name
    ?? 'this client'

  const mapping = profileMappingWords({
    clientName,
    profile: mapped ?? (data?.profileId ? { id: data.profileId, name: 'A group', accountCount: null } : null),
    strayCount: data?.stray.length ?? 0,
  })

  const connected = new Set((data?.accounts ?? []).map(a => a.platform))

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Accounts and access"
        summary={`Which accounts post for ${clientName}, and who on the team can plan, approve and post.`}
        actions={
          <Link
            href="/dashboard/social/schedule"
            className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            Back to the week
          </Link>
        }
      />

      {/* which client */}
      {clients && clients.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {clients.map(c => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === clientId}
              onClick={() => pickClient(c.id)}
              className={cn(
                'min-h-11 rounded-full border border-border px-4 text-[13px] font-semibold',
                c.id === clientId ? 'bg-foreground text-background' : 'bg-surface hover:bg-muted',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {problem && (
        <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px] font-medium">
          {problem}
        </p>
      )}
      {note && (
        <p className="rounded-inner border border-border bg-paper px-3 py-2 text-[13px]">{note}</p>
      )}

      {data && !data.provider.configured && (
        <p className="rounded-inner border border-accent-amber/35 bg-tint-amber px-3 py-2 text-[13px]">
          Posting isn’t switched on yet — nobody can connect an account or send a
          post from here until someone on our side turns it on.
        </p>
      )}

      {/* ── the social set ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-section-title">Accounts we post to</h2>
          <span className="text-[13px] text-muted-foreground">
            {loading
              ? 'Loading…'
              : `${data?.accounts.length ?? 0} connected`}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy === 'refresh' || !clientId}
              className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              {busy === 'refresh'
                ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
                : <RefreshCw className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
              Check them
            </button>
            <AddAccount
              connected={connected}
              busy={busy}
              disabled={!clientId || !(data?.provider.configured ?? false)}
              onPick={p => void connect(p)}
            />
          </div>
        </div>

        {loading ? (
          <p className="py-4 text-[13px] text-muted-foreground">Loading…</p>
        ) : (data?.accounts.length ?? 0) === 0 ? (
          <div className="flex flex-col gap-2 rounded-inner border border-dashed border-border p-4">
            <div className="flex gap-1.5">
              {OFFERED.slice(0, 5).map(p => (
                <PlatformIcon key={p} platform={p} size={20} className="opacity-25 grayscale" />
              ))}
            </div>
            <p className="text-[13px] text-muted-foreground">
              No accounts yet. “Add an account” opens the platform’s own login —
              the client’s password is never typed in here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {(data?.accounts ?? []).map(a => {
              const words = accountHealthWords(data?.health[a.id], now)
              const brand = brandFor(a.platform)
              const isStray = data?.stray.includes(a.id) ?? false
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-inner border border-border bg-paper px-3 py-2.5"
                >
                  <PlatformIcon platform={a.platform} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{brand.label}</span>
                      <span className="truncate font-mono text-[13px] text-muted-foreground">
                        {a.username ? `@${a.username}` : a.name ?? '—'}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          words.state === 'connected' && 'bg-tint-green text-foreground',
                          words.state === 'reconnect' && 'bg-tint-amber text-foreground',
                          words.state === 'expired' && 'bg-tint-red text-foreground',
                        )}
                      >
                        {words.label}
                      </span>
                      {isStray && (
                        <span className="rounded-full bg-tint-amber px-2.5 py-1 text-[11px] font-semibold">
                          In another group
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {words.detail} {lastCheckedWords(data?.checkedAt, now)}.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/dashboard/social/${a.id}`}
                      className="flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
                    >
                      Open
                    </Link>
                    {words.needsReconnect && (
                      <button
                        type="button"
                        onClick={() => void connect(a.platform)}
                        disabled={busy === `connect:${a.platform}`}
                        className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-50"
                      >
                        Reconnect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirm(a)}
                      aria-label={`Remove ${brand.label}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* which group at the posting service */}
        {data && (
          <div className="flex flex-col gap-2 rounded-inner border border-border bg-paper px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold">Group: {mapping.title}</span>
              {data.can.profile && (
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <label className="sr-only" htmlFor="profile-pick">Group of accounts</label>
                  <select
                    id="profile-pick"
                    value={data.profileId ?? ''}
                    disabled={busy === 'profile'}
                    onChange={e => {
                      if (e.target.value) void setProfile({ profileId: e.target.value })
                    }}
                    className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold"
                  >
                    <option value="">Choose a group…</option>
                    {data.profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy === 'profile'}
                    onClick={() => void setProfile({ name: clientName })}
                    className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    {busy === 'profile'
                      ? 'Working…'
                      : `Make one called “${clientName}”`}
                  </button>
                </div>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground">{mapping.detail}</p>
          </div>
        )}
      </section>

      {/* ── people ────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} aria-hidden />
          <h2 className="text-section-title">People on this client</h2>
          {clientId && (
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="ml-auto flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
            >
              Change
            </Link>
          )}
        </div>

        {loading ? (
          <p className="py-4 text-[13px] text-muted-foreground">Loading…</p>
        ) : (data?.people.length ?? 0) === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nobody is on this client yet. “Change” is where people are put on one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(data?.people ?? []).map(p => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-inner border border-border bg-paper px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold">{p.name}</span>
                    <span className="text-[12px] text-muted-foreground">{p.roleLabel}</span>
                    {p.rights.map(r => (
                      <span
                        key={r}
                        className="rounded-full bg-foreground/[0.06] px-2.5 py-1 text-[11px] font-semibold"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                  <p className="text-[12px] text-muted-foreground">{p.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[12px] text-muted-foreground">
          These are the rights everyone already has — this page only writes them
          out. Changing them means changing who is on the client, or their role
          on the Team page.
        </p>
      </section>

      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Remove this account"
          onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null) }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
        >
          <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-card bg-surface p-4 shadow-xl">
            <h2 className="text-section-title">
              {`Remove ${brandFor(confirm.platform).label}${confirm.username ? ` @${confirm.username}` : ''}?`}
            </h2>
            <p className="text-[13px] text-muted-foreground">
              This signs us out at the platform as well as here. Anything already
              posted stays up. Posts planned for this account will not go out
              until it is connected again.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold"
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={busy === `remove:${confirm.id}`}
                onClick={() => void remove(confirm)}
                className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60"
              >
                {busy === `remove:${confirm.id}` ? 'Removing…' : 'Remove it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The menu of platforms, with the ones already on marked rather than hidden —
 *  "where has Instagram gone" is the question hiding them creates. */
function AddAccount({ connected, busy, disabled, onPick }: {
  connected: Set<string>
  busy: string | null
  disabled: boolean
  onPick: (platform: string) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className="flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-50"
      >
        <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
        Add an account
        <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          className="absolute right-0 z-30 mt-1 flex w-56 flex-col rounded-card border border-border bg-popover p-1 shadow-xl"
        >
          {OFFERED.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => { setOpen(false); onPick(p) }}
              disabled={busy === `connect:${p}`}
              className="flex min-h-11 items-center gap-2 rounded-inner px-2 text-left text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              <PlatformIcon platform={p} size={20} />
              <span className="flex-1">{brandFor(p).label}</span>
              {busy === `connect:${p}`
                ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
                : connected.has(p) && <Check className="h-4 w-4 text-accent-green" strokeWidth={2} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
