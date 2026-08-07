import 'server-only'
import { supabase } from '@/lib/supabase'
import { encryptSecret, credentialsKeyConfigured } from './secret-box'
import { allowedMailDomain } from './clerk-gmail'

/**
 * "Connect my inbox" — a team member grants Gmail read access to their own
 * mailbox, once.
 *
 * This is a SEPARATE Google app from the one that handles sign-in, and the
 * separation is the whole point. Sign-in uses an External app so employees on
 * personal addresses can log in; an External app cannot carry a restricted
 * scope like gmail.readonly without Google's verification. So scanning keeps
 * the original Internal app, which Google will only let @mdmmarketing.com.au
 * accounts consent to. The domain rule is enforced by Google, not by us
 * checking a string and hoping.
 *
 * The refresh token is encrypted with the same envelope as client credentials
 * and is never returned by any read endpoint.
 */

const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/**
 * The inbox-connect app is NOT the app that sends mail.
 *
 * GMAIL_CLIENT_ID belongs to a Google Cloud project nobody here can reach any
 * more, and hello@'s refresh token is bound to it — repointing it would break
 * the contact form's email. So the connect flow gets its own pair, and falls
 * back to the old one only so local development without them still runs.
 */
export function inboxClientId(): string {
  return process.env.INBOX_CLIENT_ID?.trim() || process.env.GMAIL_CLIENT_ID?.trim() || ''
}
export function inboxClientSecret(): string {
  return process.env.INBOX_CLIENT_SECRET?.trim() || process.env.GMAIL_CLIENT_SECRET?.trim() || ''
}

export function inboxConnectConfigured(): boolean {
  return Boolean(inboxClientId() && inboxClientSecret() && credentialsKeyConfigured())
}

/**
 * Must match a URI registered on the Google client, character for character.
 *
 * Derived from the REQUEST, not from configuration. Env-derived versions of
 * this were wrong twice: NEXT_PUBLIC_APP_URL points at the marketing host
 * (Asana and social OAuth callbacks are registered against it), and any other
 * variable is a second place for the value to drift out of step with what is
 * registered in Google.
 *
 * The browser is on the app host when it starts the flow and when Google sends
 * it back, so the origin is identical on both legs by construction — which is
 * the only property the token exchange actually requires.
 */
export function redirectUriFor(req: Request): string {
  return `${new URL(req.url).origin}/api/inbox/connect/callback`
}

/**
 * Where to send someone to grant access.
 *
 * `prompt=consent` with `access_type=offline` is what forces Google to return
 * a REFRESH token. Without it a second consent returns only an access token,
 * which expires in an hour and leaves a mailbox that scans once and then
 * silently stops.
 */
export function inboxConsentUrl(req: Request, state: string): string {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: inboxClientId(),
    redirect_uri: redirectUriFor(req),
    response_type: 'code',
    scope: GMAIL_READ_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
}

export type ConnectResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'exchange_failed' | 'no_refresh_token' | 'wrong_domain' | 'no_email'; detail?: string }

/**
 * Exchange the code, confirm which mailbox it is, and store it.
 *
 * The domain is re-checked here even though the Internal app already enforces
 * it: a consent screen is a UI, and this is the boundary that actually writes
 * a scannable mailbox to the database.
 */
export async function completeInboxConnect(req: Request, code: string, by: string): Promise<ConnectResult> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: inboxClientId(),
      client_secret: inboxClientSecret(),
      redirect_uri: redirectUriFor(req),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) return { ok: false, reason: 'exchange_failed', detail: (await res.text()).slice(0, 200) }

  const token = await res.json() as { access_token?: string; refresh_token?: string }
  if (!token.refresh_token) return { ok: false, reason: 'no_refresh_token' }

  const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  const email = String(((await profRes.json()) as { emailAddress?: string })?.emailAddress ?? '')
    .trim().toLowerCase()
  if (!email) return { ok: false, reason: 'no_email' }
  if (!email.endsWith(`@${allowedMailDomain()}`)) return { ok: false, reason: 'wrong_domain' }

  // upsert, not insert: reconnecting a mailbox should replace its token, and
  // must not silently re-enable one an admin deliberately switched off
  const { data: existing } = await supabase
    .from('scan_mailboxes').select('email, enabled').eq('email', email).maybeSingle()

  const { error } = await supabase.from('scan_mailboxes').upsert({
    email,
    source: 'self',
    refresh_token_encrypted: encryptSecret(token.refresh_token),
    connected_at: new Date().toISOString(),
    connected_by: by,
    ...(existing ? {} : { enabled: true }),
  }, { onConflict: 'email' })
  if (error) return { ok: false, reason: 'exchange_failed', detail: error.message }

  return { ok: true, email }
}

/** Forget a mailbox's token. The row stays so its history and enabled state
 *  survive, but it stops being scannable until someone reconnects. */
export async function disconnectInbox(email: string): Promise<void> {
  const { error } = await supabase.from('scan_mailboxes')
    .update({ refresh_token_encrypted: null, connected_at: null, connected_by: null })
    .eq('email', email.toLowerCase())
  if (error) throw new Error(error.message)
}
