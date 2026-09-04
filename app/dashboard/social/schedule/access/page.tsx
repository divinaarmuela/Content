'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Check, ChevronDown, Loader2, Pencil, Plus, RefreshCw, Trash2, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTable } from '@/lib/db-client'
import type { Client, SocialAccount, TeamUser, TeamUserClient } from '@/lib/db-types'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import { accessibleClientIdsOf, type ScopeViewer } from '@/app/lib/scope-client'
import { isValidZone, zoneLabel } from '@/app/lib/timezone-core'
import {
  accountHealthWords, lastCheckedWords, peopleWithAccess, profileMappingWords,
  type AccountHealth, type ProfileChoice,
} from '@/app/lib/social-access-core'
import { useRole } from '../../../useRole'
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
 *
 * LIVE, and SCOPED, exactly like the calendar it hangs off. The rows come from
 * listeners, so a colleague reconnecting TikTok in the next tab changes this
 * page without anybody pressing anything; and the client picker offers the
 * clients this person is actually on, so nobody is invited to click a name
 * that will answer them with a refusal.
 */

const CLIENT_KEY = 'md-schedule-client'

/** The platforms this agency actually publishes to, in the order it uses
 *  them. The provider supports more; offering all of them is a longer menu
 *  and no more useful. */
const OFFERED = [
  'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'threads', 'pinterest',
] as const

/** What only the server can answer: the provider's side of the story. */
type ProviderView = {
  health: Record<string, AccountHealth>
  checkedAt: string
  profiles: ProfileChoice[]
  profileId: string | null
  stray: string[]
  provider: { configured: boolean }
  can: { profile: boolean; access: boolean }
}

export default function AccessPage() {
  const { me, noAccount } = useRole()
  const viewer: ScopeViewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])

  const [clientId, setClientId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<SocialAccount | null>(null)
  const [editing, setEditing] = useState<SocialAccount | null>(null)

  /* ── the live rows ───────────────────────────────────────────────────── */

  const byClient = useMemo(() => ({ client_id: clientId ?? '' }), [clientId])
  const on = Boolean(clientId)
  const clients = useTable<Client>('clients')
  const assignments = useTable<TeamUserClient>('team_user_clients')
  const team = useTable<TeamUser>('team_users')
  const accountRows = useTable<SocialAccount>('social_accounts', { by: byClient, enabled: on })

  /** the clients this person may pick between — the same answer the calendar's
   *  picker gives, from the same helper, so the two cannot disagree */
  const pickable = useMemo(() => {
    if (!viewer) return []
    const base = accessibleClientIdsOf(viewer, assignments.rows)
    const rows = base === null
      ? clients.rows
      : clients.rows.filter(c => base.includes(c.id))
    return rows
      .filter(c => c.status !== 'archived')
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [viewer, clients.rows, assignments.rows])

  const client = useMemo(
    () => clients.rows.find(c => c.id === clientId) ?? null, [clients.rows, clientId])

  /** this client's channels, active only. Filtered in memory as well: a
   *  listener re-keys one render AFTER the client changes, and a frame of the
   *  previous client's accounts under this client's name is a lie. */
  const accounts = useMemo(
    () => accountRows.rows
      .filter(a => a.client_id === clientId && a.active !== false)
      .sort((a, b) => a.platform.localeCompare(b.platform)),
    [accountRows.rows, clientId])

  const people = useMemo(
    () => peopleWithAccess(
      assignments.rows.filter(l => l.client_id === clientId),
      team.rows,
    ),
    [assignments.rows, team.rows, clientId])

  /* ── which client ────────────────────────────────────────────────────── */

  useEffect(() => {
    if (clientId || pickable.length === 0) return
    let saved: string | null = null
    try {
      saved = new URL(window.location.href).searchParams.get('clientId')
        ?? localStorage.getItem(CLIENT_KEY)
    } catch { /* private mode */ }
    const known = saved && pickable.some(c => c.id === saved) ? saved : pickable[0].id
    setClientId(known)
  }, [clientId, pickable])

  const pickClient = (id: string) => {
    setClientId(id)
    setProblem(null)
    setNote(null)
    try { localStorage.setItem(CLIENT_KEY, id) } catch { /* private mode */ }
  }

  /* ── the provider's half ─────────────────────────────────────────────── */

  const [view, setView] = useState<ProviderView | null>(null)
  const [checking, setChecking] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  /**
   * ASK THE PROVIDER — never blocking the page, never answering for the
   * client somebody has since moved off.
   *
   * The rows on screen come from the listeners and are drawn immediately; the
   * badges say "Not checked" until this lands, which is honest and is what
   * they say for a failed check anyway. Two rules make that safe:
   *
   *  • the request for the client we have LEFT is aborted, so switching
   *    quickly does not stack requests against a slow provider;
   *  • a reply is dropped unless it is still about the client on screen — the
   *    same stale-frame discipline the accounts list uses, because an old
   *    reply landing late would badge this client's channels with another
   *    client's answers.
   */
  const asking = useRef<AbortController | null>(null)

  const askProvider = useCallback(async (id: string) => {
    asking.current?.abort()
    const mine = new AbortController()
    asking.current = mine
    setChecking(true)
    try {
      const res = await fetch(
        `/api/social/schedule/access?clientId=${encodeURIComponent(id)}`,
        { signal: mine.signal },
      )
      const json = await res.json().catch(() => ({}))
      if (mine.signal.aborted) return
      if (!res.ok) {
        setProblem(friendlyError(String(json?.error ?? ''), 'Schedule'))
        setView(null)
        return
      }
      setView(json as ProviderView)
      setNow(Date.now())
    } catch (e) {
      // an abort is this page moving on, not a failure to report
      if ((e as { name?: string })?.name === 'AbortError') return
      setProblem(loadFailedMessage('the state of these accounts'))
      setView(null)
    } finally {
      if (asking.current === mine) setChecking(false)
    }
  }, [])

  useEffect(() => {
    setView(null)
    if (clientId) void askProvider(clientId)
    return () => { asking.current?.abort() }
  }, [clientId, askProvider])

  // the badges age honestly while the page is left open
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

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

  /** ask the provider again — the accounts themselves arrive on the listener,
   *  so this is only about the part a listener cannot know */
  const recheck = async () => {
    if (!clientId) return
    setBusy('refresh')
    setNote(null)
    setProblem(null)
    try {
      const res = await fetch('/api/social/connect', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? ''))
      await askProvider(clientId)
      setNote('Checked with the posting service.')
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (account: SocialAccount) => {
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
      // the row leaves on the listener — nothing here refetches
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
      await askProvider(clientId)
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Schedule'))
    } finally {
      setBusy(null)
    }
  }

  const clientName = client?.name ?? 'this client'
  const mappedId = client?.social_profile_id ?? view?.profileId ?? null
  const mapped = useMemo(
    () => view?.profiles.find(p => p.id === mappedId) ?? null,
    [view, mappedId])

  const mapping = profileMappingWords({
    clientName,
    profile: mapped ?? (mappedId ? { id: mappedId, name: 'A group', accountCount: null } : null),
    strayCount: view?.stray.length ?? 0,
  })

  const connected = new Set(accounts.map(a => a.platform))
  const loading = clients.loading || (on && accountRows.loading)

  if (noAccount) {
    return <p className="py-10 text-[15px] text-muted-foreground">{loadFailedMessage('this page')}</p>
  }

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

      {pickable.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {pickable.map(c => (
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

      {view && !view.provider.configured && (
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
            {loading ? 'Loading…' : `${accounts.length} connected`}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void recheck()}
              disabled={busy === 'refresh' || !clientId}
              className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              {busy === 'refresh' || checking
                ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
                : <RefreshCw className="h-4 w-4" strokeWidth={1.8} aria-hidden />}
              Check them
            </button>
            <AddAccount
              connected={connected}
              busy={busy}
              disabled={!clientId || !(view?.provider.configured ?? false)}
              onPick={p => void connect(p)}
            />
          </div>
        </div>

        {loading ? (
          <p className="py-4 text-[13px] text-muted-foreground">Loading…</p>
        ) : accounts.length === 0 ? (
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
            {accounts.map(a => {
              const words = accountHealthWords(view?.health[a.id], now)
              const brand = brandFor(a.platform)
              const isStray = view?.stray.includes(a.id) ?? false
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-inner border border-border bg-paper px-3 py-2.5"
                >
                  <PlatformIcon platform={a.platform} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{a.name || brand.label}</span>
                      <span className="truncate font-mono text-[13px] text-muted-foreground">
                        {a.username ? `@${a.username}` : brand.label}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          words.state === 'connected' && 'bg-tint-green text-foreground',
                          words.state === 'reconnect' && 'bg-tint-amber text-foreground',
                          words.state === 'expired' && 'bg-tint-red text-foreground',
                          // neither good news nor bad: we do not know
                          words.state === 'unknown'
                            && 'border border-border bg-foreground/[0.06] text-muted-foreground',
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
                      {words.detail}{' '}
                      {view ? `${lastCheckedWords(view.checkedAt, now)}.` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      aria-label={`Edit ${a.name || brand.label}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
                    >
                      <Pencil className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                    </button>
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
        {view && (
          <div className="flex flex-col gap-2 rounded-inner border border-border bg-paper px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold">Group: {mapping.title}</span>
              {view.can.profile && (
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <label className="sr-only" htmlFor="profile-pick">Group of accounts</label>
                  <select
                    id="profile-pick"
                    value={mappedId ?? ''}
                    disabled={busy === 'profile'}
                    onChange={e => {
                      if (e.target.value) void setProfile({ profileId: e.target.value })
                    }}
                    className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold"
                  >
                    <option value="">Choose a group…</option>
                    {view.profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy === 'profile'}
                    onClick={() => void setProfile({ name: clientName })}
                    className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    {busy === 'profile' ? 'Working…' : `Make one called “${clientName}”`}
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
          {/* the button is only offered to somebody the server would let
              through: a "Change" that always answers "you may not" is a lie
              told in a button */}
          {clientId && view?.can.access && (
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="ml-auto flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
            >
              Change
            </Link>
          )}
        </div>

        {people.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {loading
              ? 'Loading…'
              : 'Nobody is on this client yet. A super admin puts people on a client from the client’s own page.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map(p => (
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

      {editing && client && (
        <EditAccount
          account={editing}
          client={client}
          onClose={() => setEditing(null)}
          onSaved={message => { setEditing(null); setNote(message) }}
        />
      )}

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

/**
 * Renaming an account, and the zone its posts go out in.
 *
 * Two fields that look like they belong to the same record and do not. The
 * NAME is ours — what a scheduler reads on a tile, saved on the account. The
 * ZONE belongs to the CLIENT: every time on Schedule is the client's, because
 * a posting time is a fact about the audience and not about one channel. The
 * dialog says so, rather than offering a per-account zone that would quietly
 * be a second answer to the same question.
 */
function EditAccount({ account, client, onClose, onSaved }: {
  account: SocialAccount
  client: Client
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState(account.name ?? '')
  const [zone, setZone] = useState(client.timezone ?? 'Australia/Melbourne')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose, busy])

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const zoneChanged = zone !== (client.timezone ?? '')
      if (zoneChanged && !isValidZone(zone)) {
        setProblem('That is not a time zone we recognise. Try “Australia/Melbourne”.')
        return
      }
      const calls: Promise<Response>[] = [
        fetch(`/api/social/accounts/${account.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        }),
      ]
      if (zoneChanged) {
        calls.push(fetch(`/api/website/clients/${client.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone: zone }),
        }))
      }
      for (const res of await Promise.all(calls)) {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          setProblem(friendlyError(String(json?.error ?? ''), 'Schedule'))
          return
        }
      }
      onSaved(zoneChanged
        ? `Saved. Every time on Schedule for ${client.name} is now ${zoneLabel(zone)}.`
        : 'Saved.')
    } catch {
      setProblem(loadFailedMessage('that change'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit this account"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
    >
      <div className="flex w-full max-w-[440px] flex-col gap-3 rounded-card bg-surface p-4 shadow-xl">
        <h2 className="text-section-title">
          {`Edit ${brandFor(account.platform).label}${account.username ? ` @${account.username}` : ''}`}
        </h2>
        {problem && (
          <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
            {problem}
          </p>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-muted-foreground">
            What we call it
          </span>
          <input
            value={name}
            maxLength={80}
            onChange={e => setName(e.target.value)}
            placeholder={brandFor(account.platform).label}
            className="min-h-11 w-full rounded-full border border-border bg-paper px-4 text-[14px] outline-none"
          />
          <span className="text-[12px] text-muted-foreground">
            Only on our screens. The handle comes from the platform and is read
            back from it every time we check.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-muted-foreground">
            Posting time zone
          </span>
          <input
            value={zone}
            onChange={e => setZone(e.target.value)}
            placeholder="Australia/Melbourne"
            className="min-h-11 w-full rounded-full border border-border bg-paper px-4 text-[14px] outline-none"
          />
          <span className="text-[12px] text-muted-foreground">
            {`This is ${client.name}’s zone and every one of their channels posts in it — a posting time is about the audience, not about one account.`}
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
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
