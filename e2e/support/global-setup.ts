import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium, type FullConfig } from '@playwright/test'
import { clerk, clerkSetup } from '@clerk/testing/playwright'
import { E2E, ROLES, authFile, unsafeReasons } from './env'

/**
 * Before any journey: refuse an unsafe run, fetch a Clerk testing token, and
 * sign each role in once, saving its cookies for the journeys to reuse.
 *
 * Sign-in is Clerk's ticket strategy through the backend API
 * (`clerk.signIn({ emailAddress })`): no password is stored anywhere, and it
 * only works on a Clerk DEV instance (pk_test_/sk_test_ keys).
 */
function hatProblem(role: string, me: { role?: string; quality_reviewer?: boolean }): string | null {
  if (role === 'scheduler' && me.role !== 'scheduler') return `the team role is "${me.role}", not "scheduler".`
  // the reviewer must pass posts, and must NOT be a super admin, or the "only the reviewer passes" checks prove nothing
  if (role === 'reviewer' && (!me.quality_reviewer || me.role === 'super_admin')) return `must be the quality checker (and not a super admin); the team role is "${me.role}".`
  if (role === 'manager' && me.role !== 'account_manager') return `the team role is "${me.role}", not "account_manager".`
  return null
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const reasons = unsafeReasons()
  if (reasons.length > 0) {
    throw new Error(`E2E run refused — nothing was started:\n  - ${reasons.join('\n  - ')}\nSee .env.e2e.example.`)
  }

  await clerkSetup({ publishableKey: E2E.clerkPublishableKey, secretKey: E2E.clerkSecretKey })

  const baseURL = config.projects[0]?.use.baseURL ?? E2E.baseURL
  const browser = await chromium.launch()
  try {
    for (const role of ROLES) {
      const context = await browser.newContext({ baseURL })
      const page = await context.newPage()
      // a page that loads Clerk and is not protected
      await page.goto('/sign-in')
      await clerk.signIn({ page, emailAddress: E2E.users[role] })
      // the first dashboard request links the Clerk user to its team row (app/lib/authz.ts)
      const res = await page.goto('/dashboard')
      if (!res || res.status() >= 400) throw new Error(`${role} (${E2E.users[role]}) could not open the dashboard after signing in (HTTP ${res?.status()}).`)
      // the person must really wear the hat the journeys give them
      const me = await page.request.get('/api/team/me')
      if (!me.ok()) throw new Error(`${role} (${E2E.users[role]}): /api/team/me answered HTTP ${me.status()}.`)
      const body = await me.json() as { role?: string; quality_reviewer?: boolean }
      const wrong = hatProblem(role, body)
      if (wrong) throw new Error(`${role} (${E2E.users[role]}): ${wrong}`)
      console.log(`[e2e] ${role} signed in as ${E2E.users[role]} (team role: ${body.role})`)
      mkdirSync(dirname(authFile(role)), { recursive: true })
      await context.storageState({ path: authFile(role) })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
