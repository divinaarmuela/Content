import 'server-only'
import { table } from '@/lib/db'
import type { CalendarAccount as CalendarAccountRow } from '@/lib/db-types'
import { decryptSecret, encryptSecret } from './secret-box'
import { googleAccessToken, inboxClientId, inboxClientSecret, redirectUriFor } from './inbox-connect'
import type { CalEvent } from './gcal-core'

/**
 * Google Calendar for shoot planning — "when are we free".
 *
 * Reuses the inbox-connect Internal app (only @mdmmarketing.com.au accounts
 * can consent; Google enforces the domain). calendar.readonly is a separate
 * grant from gmail.readonly, so connecting a calendar is its own consent even
 * for a mailbox that is already scanned.
 */

// readonly feeds the availability week; events lets an accepted shoot be
// WRITTEN to the booking calendar. Tokens minted before the second scope was
// added keep working for reading — writing through them just fails softly.
const CAL_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'

/** The calendar accepted shoots are booked into. */
export function bookingCalendarEmail(): string {
  return (process.env.GCAL_BOOKING_CALENDAR ?? 'hello@mdmmarketing.com.au').toLowerCase()
}

export type CalendarAccount = {
  email: string
  enabled: boolean
  connected: boolean
  connected_at: string | null
  connected_by: string | null
}

/** Where to send someone to grant calendar access. Same shape as the inbox
 *  consent URL; prompt=consent + access_type=offline forces a refresh token. */
export function calendarConsentUrl(req: Request, state: string): string {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: inboxClientId(),
    redirect_uri: calendarRedirectUri(req),
    response_type: 'code',
    scope: CAL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
}

export function calendarRedirectUri(req: Request): string {
  return `${new URL(req.url).origin}/api/gcal/connect/callback`
}

export type CalConnectResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'exchange_failed' | 'no_refresh_token' | 'no_email'; detail?: string }

export async function completeCalendarConnect(
  req: Request, code: string, by: string,
): Promise<CalConnectResult> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: inboxClientId(),
      client_secret: inboxClientSecret(),
      redirect_uri: calendarRedirectUri(req),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) return { ok: false, reason: 'exchange_failed', detail: (await res.text()).slice(0, 200) }

  const token = await res.json() as { access_token?: string; refresh_token?: string }
  if (!token.refresh_token) return { ok: false, reason: 'no_refresh_token' }

  // whose calendar is it? The primary calendar's id IS the account email —
  // no extra scope needed to learn it.
  const calRes = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary',
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  )
  const email = String(((await calRes.json()) as { id?: string })?.id ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return { ok: false, reason: 'no_email' }

  const accounts = table<CalendarAccountRow>('calendar_accounts')
  const existing = (await accounts.list({ by: { email }, limit: 1 }))[0] ?? null

  try {
    await table('calendar_accounts').upsert({
      email,
      refresh_token_encrypted: encryptSecret(token.refresh_token),
      connected_at: new Date().toISOString(),
      connected_by: by,
      ...(existing ? {} : { enabled: true }),
    }, { onConflict: 'email' })
  } catch (e) {
    return { ok: false, reason: 'exchange_failed', detail: e instanceof Error ? e.message : String(e) }
  }

  return { ok: true, email }
}

/** All calendar accounts, tokens never included. */
export async function listCalendarAccounts(): Promise<CalendarAccount[]> {
  const rows = await table<CalendarAccountRow>('calendar_accounts')
    .list({ orderBy: [['email', 'asc']] })
  return rows.map(r => ({
    email: r.email,
    enabled: r.enabled,
    connected: Boolean(r.refresh_token_encrypted),
    connected_at: r.connected_at,
    connected_by: r.connected_by,
  }))
}

export async function setCalendarEnabled(email: string, enabled: boolean): Promise<void> {
  const accounts = table<CalendarAccountRow>('calendar_accounts')
  const rows = await accounts.list({ by: { email: email.toLowerCase() } })
  await Promise.all(rows.map(r => accounts.update(r.id, { enabled })))
}

/** Forget the token; the row keeps its enabled state for a reconnect. */
export async function disconnectCalendar(email: string): Promise<void> {
  const accounts = table<CalendarAccountRow>('calendar_accounts')
  const rows = await accounts.list({ by: { email: email.toLowerCase() } })
  await Promise.all(rows.map(r => accounts.update(r.id, {
    refresh_token_encrypted: null, connected_at: null, connected_by: null,
  })))
}

// the refresh-token exchange and its cache live in inbox-connect.ts, shared
// with Drive — the Internal app is the same app, and two caches would each
// re-mint a token the other already holds
const accessToken = googleAccessToken

/** The stored token for one connected account, or null if not connected. */
async function tokenFor(email: string): Promise<string | null> {
  const row = (await table<CalendarAccountRow>('calendar_accounts').list({
    by: { email: email.toLowerCase() },
    where: r => r.refresh_token_encrypted != null,
    limit: 1,
  }))[0]
  if (!row?.refresh_token_encrypted) return null
  return accessToken(decryptSecret(row.refresh_token_encrypted))
}

/**
 * Book an accepted shoot into the booking calendar. Best-effort by contract:
 * returns the Google event id, or null when the booking calendar is not
 * connected (or its token predates the write scope) — the caller already has
 * the .ics email as the fallback path, so a null is a log line, not an error.
 */
export async function createBookingEvent(input: {
  summary: string
  description?: string | null
  location?: string | null
  startIso: string
  endIso: string
}): Promise<string | null> {
  try {
    const token = await tokenFor(bookingCalendarEmail())
    if (!token) return null
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: input.summary,
        ...(input.description ? { description: input.description } : {}),
        ...(input.location ? { location: input.location } : {}),
        start: { dateTime: input.startIso },
        end: { dateTime: input.endIso },
      }),
    })
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`)
    return ((await res.json()) as { id?: string }).id ?? null
  } catch (e) {
    console.error('booking calendar event create failed:', e)
    return null
  }
}

/** Remove a booked event after a cancellation. Already-gone is success. */
export async function deleteBookingEvent(eventId: string): Promise<void> {
  try {
    const token = await tokenFor(bookingCalendarEmail())
    if (!token) return
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`)
    }
  } catch (e) {
    console.error('booking calendar event delete failed:', e)
  }
}

type GoogleEvent = {
  status?: string
  summary?: string
  transparency?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

/**
 * Events from every ENABLED connected calendar in [timeMin, timeMax).
 *
 * One calendar failing (revoked token, suspended account) must not blank the
 * whole availability view — its error is reported alongside the others'
 * events. Google marks "free" (transparent) events; they are kept, because a
 * placeholder like "maybe shoot?" is exactly what shoot planning wants to see.
 */
export async function listCalendarEvents(
  timeMin: string, timeMax: string,
): Promise<{ events: CalEvent[]; errors: { calendar: string; message: string }[] }> {
  const rows = await table<CalendarAccountRow>('calendar_accounts').list({
    by: { enabled: true },
    where: r => r.refresh_token_encrypted != null,
  })

  const events: CalEvent[] = []
  const errors: { calendar: string; message: string }[] = []

  await Promise.all(rows.map(async row => {
    try {
      const token = await accessToken(decryptSecret(row.refresh_token_encrypted!))
      const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' +
        new URLSearchParams({
          timeMin, timeMax,
          singleEvents: 'true',   // expand recurring events into instances
          orderBy: 'startTime',
          maxResults: '250',
          fields: 'items(status,summary,transparency,start,end)',
        })
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`)
      const json = await res.json() as { items?: GoogleEvent[] }

      for (const e of json.items ?? []) {
        if (e.status === 'cancelled') continue
        const allDay = Boolean(e.start?.date)
        const start = e.start?.dateTime ?? e.start?.date
        const end = e.end?.dateTime ?? e.end?.date
        if (!start || !end) continue
        events.push({
          calendar: row.email,
          title: e.summary?.trim() || '(untitled)',
          start, end, allDay,
        })
      }
    } catch (err) {
      errors.push({ calendar: row.email, message: err instanceof Error ? err.message : String(err) })
    }
  }))

  return { events, errors }
}
