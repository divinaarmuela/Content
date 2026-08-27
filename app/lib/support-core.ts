/**
 * What a non-technical person sees when something is broken or switched off.
 *
 * The dashboard used to print its own plumbing at people: "run
 * supabase/identity.sql", "check NEXT_PUBLIC_SUPABASE_URL in .env.local",
 * "Could not find the table 'public.batches' in the schema cache". An editor in
 * Manila reading that learns two wrong things — that the app is broken, and
 * that it is somehow their fault.
 *
 * So: every such string is replaced by one plain sentence plus a way to tell
 * the people who can fix it. The technical detail is not thrown away — it goes
 * to console.error, and into the body of the support email, where it belongs.
 *
 * Pure, no I/O: the UI components in app/dashboard/NotSetUp.tsx and
 * LoadFailed.tsx render what these return.
 */

/** Where "Tell MD Media tech" goes. One constant so it cannot drift. */
export const TECH_EMAIL = 'hello@mdmmarketing.com.au'

/**
 * Markers of a message written for a developer. Anything matching one of these
 * must never reach a person: it is logged and replaced.
 */
const DEV_MARKERS: RegExp[] = [
  /\.sql\b/i,
  /supabase/i,
  /env\.local/i,
  /schema cache/i,
  /\bPGRST/i,
  /\bmigration\b/i,
  /\bSQL editor\b/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /\b[A-Z][A-Z0-9]*_(KEY|TOKEN|URL|USER|SECRET|ID)\b/,
  /\bINNGEST_/,
  /\bfetch failed\b/i,
  /\bECONN/,
  /\b(TypeError|ReferenceError|SyntaxError)\b/,
  /\bundefined is not\b/i,
]

/** Would this string teach a non-technical person anything? */
export function isTechnical(message: string): boolean {
  return DEV_MARKERS.some(re => re.test(message))
}

/** The sentence for a feature whose database or integration is not set up. */
export function notSetUpMessage(feature: string): string {
  return `${feature} isn't switched on for this workspace yet. Nothing you did caused this — someone on our side has to switch it on.`
}

/**
 * The sentence for a load that failed. Deliberately different from "nothing
 * here yet": an outage displayed as emptiness is a lie.
 */
export function loadFailedMessage(what: string): string {
  return `We couldn't load ${what}. This is usually temporary — try again in a moment.`
}

/**
 * Swap a developer-facing message for a human one, keeping messages that were
 * already written for people. `feature` names what failed, so the replacement
 * is specific rather than a generic shrug.
 */
export function friendlyError(message: string | null | undefined, feature = 'This page'): string {
  const raw = (message ?? '').trim()
  if (!raw) return notSetUpMessage(feature)
  return isTechnical(raw) ? notSetUpMessage(feature) : raw
}

/**
 * A mailto: that arrives already filled in. A person who cannot describe the
 * fault still sends us the page they were on and the exact error.
 */
export function techMailto(opts: {
  /** what they were trying to do — becomes the subject */
  subject: string
  /** the developer string we hid from them */
  detail?: string | null
  /** where they were */
  page?: string | null
  /** who they are, if known */
  who?: string | null
}): string {
  const lines = [
    `I hit a problem in the MD Media dashboard.`,
    ``,
    `What I was doing: ${opts.subject}`,
    opts.page ? `Page: ${opts.page}` : null,
    opts.who ? `Me: ${opts.who}` : null,
    ``,
    `--- technical detail for the developer ---`,
    opts.detail?.trim() || '(none captured)',
  ].filter((l): l is string => l !== null)

  const subject = `MD Media dashboard — ${opts.subject}`
  return `mailto:${TECH_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`
}
