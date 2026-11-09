/**
 * THE META REVIEWER'S LOGIN (9 Nov 2026) — the account Meta's App Review signs in with ("Meta Login",
 * mdmedia.review@gmail.com) may see ONE client, the test client, and nothing else of the agency.
 *
 * It is an account manager so the Meta card works for it, but many routes are role-gated only (leads, the content
 * tracker, client lists, social analytics), which would show a stranger every real client. Rather than change what
 * the real account managers see, this login alone is fenced in middleware: pages outside the test client go to the
 * test client's Social page, and an API answers only when it is on the short list below or names the test client.
 *
 * Pure: middleware.ts calls it with the Clerk user id and the URL.
 */
export const REVIEWER_CLERK_IDS: readonly string[] = ['user_3KFf2RcRERoLqtpWTvwkbwBIlj9', 'user_3LqUErloJO1148GwLyWXe8lhOzE'] // Meta Login (Oct), Meta App Review (mdmedia.metareview@, 9 Nov)
export const REVIEWER_CLIENT_ID = '459e2564-1089-45ed-abd7-56d5f53c2cf6'
export const REVIEWER_HOME = `/dashboard/clients/${REVIEWER_CLIENT_ID}/social`

/** APIs the reviewer's pages call that hold no other client's data (who am I, which pages, the Meta card) */
const OPEN_API = ['/api/meta/', '/api/team/me', '/api/team/page-access', '/api/team/getting-started']

export type ReviewerVerdict = 'allow' | 'home' | 'refuse'

export function isReviewer(clerkUserId: string | null | undefined): boolean {
  return !!clerkUserId && REVIEWER_CLERK_IDS.includes(clerkUserId)
}

/** What happens to the reviewer's request for `path` (+ its query string) */
export function reviewerVerdict(path: string, search = ''): ReviewerVerdict {
  const p = path.replace(/\/+$/, '') || '/'
  if (p.startsWith('/api/')) {
    if (OPEN_API.some(a => p === a.replace(/\/$/, '') || p.startsWith(a.endsWith('/') ? a : `${a}/`))) return 'allow'
    if (p.includes(REVIEWER_CLIENT_ID) || search.includes(REVIEWER_CLIENT_ID)) return 'allow'
    return 'refuse'
  }
  // ONLY the test client's Social page (9 Nov 2026): its other tabs (Credentials, Contacts, Notes…) are not part of the review
  if (p === REVIEWER_HOME) return 'allow'
  if (p === '/dashboard' || p.startsWith('/dashboard/')) return 'home'
  return 'allow' // the public site, sign-in and the legal pages
}
