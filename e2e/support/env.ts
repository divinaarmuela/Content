import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * THE E2E SETTINGS, AND THE GUARD THAT REFUSES AN UNSAFE RUN.
 *
 * Read by playwright.config.ts (for the dev server's env), by the global
 * setup (sign-in) and by every journey. Nothing here imports the app.
 *
 * Why a guard at all: this app has ONE database (Firebase project
 * test-agent-88a4c — docs/PROJECT_STATE.md). A local dev server reads and
 * writes the same rows the live site does. So:
 *   - every journey works on the ZZ E2E Test Client only, and says so;
 *   - a run against the live database needs a person to say yes
 *     (E2E_LIVE_DB_OK=1) — a script can never set it for them;
 *   - the journeys that BOOK a post (J1's last step, J5) never run against the
 *     live database at all. A booking writes a publish job, and the live
 *     site's own dispatcher sweep would pick that job up and post it with the
 *     REAL publisher — the dry run only covers the local server. They run only
 *     with E2E_ISOLATED_DB=1 and a separate database URL.
 */

/** The only client a journey may touch (SPEC §8.4). */
export const ZZ_CLIENT_ID = 'd59d3fb2-c775-4782-b966-d61700a5de93'

/** The live database's host. A URL on this host is the real thing. */
export const LIVE_DB_HOST = 'test-agent-88a4c-default-rtdb.firebaseio.com'

/** Read KEY=value lines into process.env without overwriting what is already set. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, key, raw] = m
    if (process.env[key] !== undefined) continue
    process.env[key] = raw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
}

const root = resolve(__dirname, '..', '..')
// .env.e2e first, so its values win over the app's own .env.local
loadEnvFile(resolve(root, '.env.e2e'))
loadEnvFile(resolve(root, '.env.local'))

const str = (k: string): string => (process.env[k] ?? '').trim()

export const E2E = {
  port: Number(str('E2E_PORT') || 3107),
  get baseURL() { return `http://localhost:${this.port}` },

  clientId: str('E2E_CLIENT_ID') || ZZ_CLIENT_ID,
  /** the ZZ client's portal share token (clients.share_token) */
  portalToken: str('E2E_PORTAL_TOKEN'),

  /** the Clerk users each role signs in as — dev instance only */
  users: {
    scheduler: str('E2E_SCHEDULER_EMAIL'),
    reviewer: str('E2E_REVIEWER_EMAIL'),
    manager: str('E2E_MANAGER_EMAIL'),
  },

  /** the ZZ client's test channels (social_accounts ids), test accounts only */
  channels: {
    instagram: str('E2E_CHANNEL_INSTAGRAM_ID'),
    linkedin: str('E2E_CHANNEL_LINKEDIN_ID'),
  },

  clerkPublishableKey: str('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'),
  clerkSecretKey: str('CLERK_SECRET_KEY'),

  /** the database the DEV SERVER and the cleanup use */
  databaseUrl: str('E2E_FIREBASE_DATABASE_URL') || str('NEXT_PUBLIC_FIREBASE_DATABASE_URL'),

  liveDbOk: str('E2E_LIVE_DB_OK') === '1',
  isolatedDb: str('E2E_ISOLATED_DB') === '1',
  /** a local Inngest dev server, needed for a booked post to reach Posted (isolated database only) */
  inngestUrl: str('E2E_INNGEST_URL'),
}

export type Role = keyof typeof E2E.users
export const ROLES: readonly Role[] = ['scheduler', 'reviewer', 'manager']

export function authFile(role: Role): string {
  return resolve(root, 'e2e', '.auth', `${role}.json`)
}

function dbHost(url: string): string {
  try { return new URL(url).host } catch { return '' }
}

export function onLiveDatabase(): boolean {
  return dbHost(E2E.databaseUrl) === LIVE_DB_HOST
}

/**
 * Everything that stops a run, in plain words. Empty means safe to start.
 * The global setup throws with this list, so a missing key is a red run that
 * says what is missing — never a quiet pass.
 */
export function unsafeReasons(): string[] {
  const out: string[] = []
  if (E2E.clientId !== ZZ_CLIENT_ID) out.push(`E2E_CLIENT_ID must be the ZZ E2E Test Client (${ZZ_CLIENT_ID}). Journeys never touch another client.`)
  if (!E2E.clerkPublishableKey.startsWith('pk_test_')) out.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a pk_test_ key (Clerk dev instance).')
  if (!E2E.clerkSecretKey.startsWith('sk_test_')) out.push('CLERK_SECRET_KEY must be an sk_test_ key (Clerk dev instance).')
  if (!E2E.databaseUrl) out.push('No database URL (E2E_FIREBASE_DATABASE_URL or NEXT_PUBLIC_FIREBASE_DATABASE_URL).')
  if (onLiveDatabase() && !E2E.liveDbOk) {
    out.push(`The database is the LIVE one (${LIVE_DB_HOST}). Set E2E_LIVE_DB_OK=1 only if the owner has agreed to test rows on the ZZ client there, or point E2E_FIREBASE_DATABASE_URL at a separate database and set E2E_ISOLATED_DB=1.`)
  }
  if (E2E.isolatedDb && onLiveDatabase()) out.push('E2E_ISOLATED_DB=1 but the database URL is the live one.')
  for (const role of ROLES) if (!E2E.users[role]) out.push(`E2E_${role.toUpperCase()}_EMAIL is not set (a Clerk dev user with the ${role} role on the ZZ client).`)
  if (!E2E.portalToken) out.push('E2E_PORTAL_TOKEN is not set (the ZZ client\'s share token).')
  if (!E2E.channels.instagram) out.push('E2E_CHANNEL_INSTAGRAM_ID is not set (a test Instagram channel on the ZZ client).')
  if (!E2E.channels.linkedin) out.push('E2E_CHANNEL_LINKEDIN_ID is not set (a test LinkedIn channel on the ZZ client).')
  return out
}

/** Why a BOOKING journey may not run here, or null when it may. */
export function bookingBlocked(): string | null {
  if (!E2E.isolatedDb || onLiveDatabase()) {
    return 'Booking journeys run only on a separate database (E2E_ISOLATED_DB=1): on the live one, the live site\'s dispatcher would post the booked job for real.'
  }
  return null
}

/** Why a journey that needs the post to reach Posted may not run here, or null. */
export function postingBlocked(): string | null {
  return bookingBlocked() ?? (E2E.inngestUrl ? null : 'E2E_INNGEST_URL is not set: a booked post reaches Posted only through a local Inngest dev server.')
}

/**
 * The dev server's environment. Everything that could reach the outside world
 * is switched to its test form HERE, and the server is always started fresh
 * (reuseExistingServer: false), so a server someone left running with real
 * settings is never used by mistake.
 */
export function devServerEnv(): Record<string, string> {
  return {
    // the provider answers itself: no post leaves this machine (app/lib/publisher.ts)
    PUBLISH_DRY_RUN: '1',
    // the mailer refuses every address that is not *.invalid (app/lib/mailer.ts)
    EMAIL_TEST_ONLY: '1',
    PAUSE_CLIENT_NOTIFICATIONS: '1',
    // Inngest in dev mode: events go to a LOCAL dev server, never to Inngest
    // Cloud (which would run the LIVE site's functions on these rows). With no
    // local server the address is a closed port, so a send fails loudly.
    INNGEST_DEV: '1',
    INNGEST_BASE_URL: E2E.inngestUrl || 'http://127.0.0.1:9',
    INNGEST_EVENT_KEY: '',
    INNGEST_SIGNING_KEY: '',
    NEXT_PUBLIC_FIREBASE_DATABASE_URL: E2E.databaseUrl,
    NEXT_PUBLIC_APP_URL: E2E.baseURL,
  }
}
