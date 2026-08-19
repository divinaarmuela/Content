import 'server-only'
import { clerkClient } from '@clerk/nextjs/server'
import type { Mailbox } from './gmail'

/**
 * Per-user mailbox access via Clerk.
 *
 * When someone signs in with Google and grants the Gmail read scope, Clerk
 * stores the connection and hands us a fresh access token on demand — including
 * when the person isn't online, so scheduled scans work too. We never store
 * mailbox credentials ourselves.
 *
 * Requires (one-time, in Clerk dashboard): the Google connection configured
 * with CUSTOM credentials from a Google Cloud OAuth client whose publishing
 * status is "Internal", with this scope added:
 *   https://www.googleapis.com/auth/gmail.readonly
 */

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

/** Restrict per-user scanning to the company domain. */
export function allowedMailDomain(): string {
  return (process.env.TEAM_MAIL_DOMAIN ?? 'mdmmarketing.com.au').toLowerCase()
}

function hasGmailScope(scopes: string[] | undefined): boolean {
  return (scopes ?? []).some(s => s === GMAIL_READ_SCOPE || s === 'https://mail.google.com/')
}

/** Fresh Google access token for one user, or null when they haven't
 *  connected Google or didn't grant mailbox access. */
export async function getUserGmailToken(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient()
    const res = await client.users.getUserOauthAccessToken(userId, 'google')
    const withScope = res.data.find(t => hasGmailScope(t.scopes))
    return withScope?.token ?? null
  } catch {
    return null // no Google connection on this account
  }
}

/**
 * Access token able to SEND from this person's own Gmail, or null.
 *
 * This is what makes a notification genuinely between two people: the mail
 * leaves the actor's own account, sits in their Sent folder, and a reply goes
 * straight back to them. Works for personal Gmail too — it is their account,
 * so there is nothing to forge. Requires the gmail.send scope on the Clerk
 * Google connection (one-time dashboard change) and the person to have signed
 * in with Google after that.
 */
export async function getUserGmailSendToken(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient()
    const res = await client.users.getUserOauthAccessToken(userId, 'google')
    const withScope = res.data.find(t =>
      (t.scopes ?? []).some(s => s === GMAIL_SEND_SCOPE || s === 'https://mail.google.com/'))
    return withScope?.token ?? null
  } catch {
    return null
  }
}

export type ConnectionStatus = {
  connected: boolean
  email: string | null
  reason?: 'no_google_account' | 'scope_not_granted' | 'wrong_domain'
}

/** Whether the signed-in user's own inbox is connected for scanning. */
export async function getConnectionStatus(userId: string): Promise<ConnectionStatus> {
  const client = await clerkClient()
  const user = await client.users.getUser(userId)
  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null

  if (email && !email.endsWith(`@${allowedMailDomain()}`)) {
    return { connected: false, email, reason: 'wrong_domain' }
  }
  const hasGoogle = user.externalAccounts.some(a => a.provider.includes('google'))
  if (!hasGoogle) return { connected: false, email, reason: 'no_google_account' }

  const token = await getUserGmailToken(userId)
  if (!token) return { connected: false, email, reason: 'scope_not_granted' }
  return { connected: true, email }
}

/**
 * Every team mailbox currently connected through Clerk, ready for scanning.
 * Only company-domain addresses are ever included — a personal Gmail signed
 * into the dashboard is never scanned.
 */
export async function listConnectedMailboxes(): Promise<Mailbox[]> {
  const domain = allowedMailDomain()
  const out: Mailbox[] = []
  try {
    const client = await clerkClient()
    const { data: users } = await client.users.getUserList({ limit: 100 })
    for (const user of users) {
      const email = user.primaryEmailAddress?.emailAddress?.toLowerCase()
      if (!email || !email.endsWith(`@${domain}`)) continue
      if (!user.externalAccounts.some(a => a.provider.includes('google'))) continue
      const token = await getUserGmailToken(user.id)
      if (token) out.push({ email, accessToken: token })
    }
  } catch (e) {
    console.error('listing connected mailboxes failed:', e)
  }
  return out
}
