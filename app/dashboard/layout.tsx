'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Toaster } from '@/components/ui/sonner'
import { ClerkProvider } from '@clerk/nextjs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Lock, RefreshCw } from 'lucide-react'
import { useRole } from './useRole'
import { rememberList } from './lastList'
import UploadTray from './UploadTray'
import Shell, { NAV_MAIN, NAV_SOCIAL_CHILDREN, NAV_TOOLS } from './ui/Shell'
import { canSeePage, visiblePages } from '@/app/lib/page-access-core'

// the shell's markup lives in ./ui/Shell; the nav data and the active-entry
// rule live there with it, and are re-exported here for anything that used to
// import them from the layout
export { activeNavHref, NAV_MAIN, NAV_SOCIAL_CHILDREN, NAV_TOOLS, PAGE_TITLES } from './ui/Shell'

/** Dashboard-scoped dark mode: toggles .dark on <html> so Radix portals get
 *  the dark tokens too, persists to localStorage, and cleans up on unmount so
 *  the marketing pages are never affected. */
function useDashTheme() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('md-dash-theme') === 'dark'
    setDark(saved)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    return () => document.documentElement.classList.remove('dark')
  }, [dark])

  const toggle = () => {
    setDark(d => {
      localStorage.setItem('md-dash-theme', d ? 'light' : 'dark')
      return !d
    })
  }
  return { dark, toggle }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // ClerkProvider is scoped here (and to the auth/sso routes) rather than the
  // root layout, so the public marketing pages don't load the Clerk SDK.
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <TooltipProvider>
        <DashboardInner>{children}</DashboardInner>
      </TooltipProvider>
    </ClerkProvider>
  )
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  // remember the last LIST page, so an item's "Back" returns where the person
  // came from rather than wherever its status happens to file it
  useEffect(() => { rememberList(path ?? '') }, [path])
  // The role comes from the server (team_users), not Clerk publicMetadata.
  // The old fallback here was `?? 'admin'`, so an identity whose metadata was
  // never stamped rendered the *full* admin navigation — a client included.
  // useRole starts as null and `visibleFor` shows nothing until it resolves,
  // so the failure now runs in the safe direction.
  const { role, loading: roleLoading, identity, noAccount, reason } = useRole()
  // pages a super admin has opened to THIS person; empty until it loads, so
  // the sidebar starts from the role ladder and only ever gains entries
  const [granted, setGranted] = useState<string[]>([])
  // pages this person chose to mute for themselves — wins over everything
  const [hidden, setHidden] = useState<string[]>([])
  const [grantsLoaded, setGrantsLoaded] = useState(false)
  useEffect(() => {
    fetch('/api/team/page-access')
      .then(r => r.ok ? r.json() : { mine: [], hidden: [] })
      .then(j => { setGranted(j.mine ?? []); setHidden(j.hidden ?? []) })
      .catch(() => {})
      .finally(() => setGrantsLoaded(true))
  }, [])
  const { dark, toggle } = useDashTheme()

  /**
   * Hiding a link is not a lock. Someone who types the address, follows an
   * old bookmark, or is sent a link lands on the page regardless — so the
   * page itself is checked here too. Child routes inherit their section's
   * permission (/dashboard/clients/123 is Clients), and nothing is blocked
   * until the role is known, or a slow role fetch would flash a refusal at
   * people who are perfectly entitled to be here.
   */
  const section = useMemo(() => {
    // Routes with no nav entry used to resolve to `null`, and a null section
    // SKIPS the access check below — so the pages nobody could find were also
    // the pages nobody was checked against. Each is pinned to the permission
    // it belongs under.
    const ORPHANS: Record<string, string> = {
      '/dashboard/calendar': '/dashboard/calendar',
      '/dashboard/tracker': '/dashboard/production',
      // the canvas is a view of the work, so it answers to Production's access
      '/dashboard/boards': '/dashboard/production',
    }
    if (ORPHANS[path]) return ORPHANS[path]
    // a board inside a board answers to Production too
    if (path.startsWith('/dashboard/boards/')) return '/dashboard/production'
    // The social children resolve to THEMSELVES: `canSeePage` falls back to
    // Social's permission for any of them, and a scheduler holds Schedule
    // on its own without holding Social — so the check has to be asked
    // about the child, not its parent.
    const all = [...NAV_MAIN, ...NAV_SOCIAL_CHILDREN, ...NAV_TOOLS]
    const exact = all.find(i => i.href === path)
    if (exact) return exact.href
    const nested = all
      .filter(i => path.startsWith(`${i.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]
    return nested?.href ?? null
  }, [path])

  /**
   * Nothing renders until access is KNOWN. Deciding optimistically showed a
   * page for the moment before the role arrived — a glimpse of Leads to
   * someone who is not allowed Leads, which is a disclosure, not a flicker.
   * Super admins skip the grants wait: nothing can change their answer.
   */
  //
  // `role === null` counts as "still loading" ONLY while the answer might
  // still arrive. For someone the server has already turned away it is the
  // final answer, and treating it as loading left a new starter watching two
  // skeletons that would never resolve — a blank dashboard with no way to
  // learn why. `noAccount` is that terminal state, and it renders words.
  const resolving = !noAccount
    && (roleLoading || role === null || (role !== 'super_admin' && !grantsLoaded))
  // an ITEM page is shared ground: all three work pages link straight to
  // /dashboard/production/<id>, so no team member is turned away at the door.
  // The API (loadItemForUser) decides what any one person may actually see —
  // a client is the one hat that never gets in this way.
  const isItemDetail = /^\/dashboard\/production\/[0-9a-f-]{36}$/i.test(path)
  const blocked = !resolving && section !== null && !canSeePage(role, section, granted, hidden)
    && !(isItemDetail && role !== 'client')
  const firstAllowed = visiblePages(role, [...NAV_MAIN, ...NAV_TOOLS], granted, hidden)[0] ?? null

  return (
    <>
      <Shell
        role={role}
        granted={granted}
        hidden={hidden}
        path={path}
        dark={dark}
        onToggleTheme={toggle}
      >
        {resolving ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : noAccount ? (
          /* Signed in with Clerk, but not a member of the team yet — or we
             could not reach the server to find out. Either way this is an
             answer, and a person needs to be able to read it and know what
             to do next. Anything is better than the skeleton that used to
             sit here for good. */
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface py-16 text-center">
            {identity === 'unreachable' ? (
              <>
                <RefreshCw className="h-6 w-6 text-muted-foreground" />
                <p className="text-[17px] font-semibold">We could not check your account</p>
                <p className="max-w-xs text-[13px] text-muted-foreground">
                  That is usually the connection rather than your account.
                  Try again in a moment.
                </p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </>
            ) : (
              <>
                <Lock className="h-6 w-6 text-muted-foreground" />
                <p className="text-[17px] font-semibold">Your account is not set up yet</p>
                <p className="max-w-xs text-[13px] text-muted-foreground">
                  {/* the server's own sentence, which is already written for
                      a person — "No invitation found for this account." */}
                  {reason ?? 'This sign-in is not linked to a team account yet.'}
                  {' '}Ask Manal or Divina to invite you — they can do it in a
                  minute, and you will not need to sign up again.
                </p>
                <p className="text-[13px] text-muted-foreground">
                  You are signed in — use the avatar above to sign out, or to
                  switch to a different account.
                </p>
              </>
            )}
          </div>
        ) : blocked ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface py-16 text-center">
            <Lock className="h-6 w-6 text-muted-foreground" />
            <p className="text-[17px] font-semibold">This page is not part of your access</p>
            {/* Naming the tab was a dead end: Page access is super-admin
                only, so following the instruction landed on "this section is
                for super admins". Name a person instead. */}
            <p className="max-w-xs text-[13px] text-muted-foreground">
              If you need it, ask Manal or Divina to open it for you — they can
              do it in a minute.
            </p>
            {firstAllowed && (
              <Button variant="outline" size="sm" asChild>
                <Link href={firstAllowed.href}>Go to {firstAllowed.label}</Link>
              </Button>
            )}
          </div>
        ) : children}
      </Shell>

      <Toaster />
      <UploadTray />
    </>
  )
}
