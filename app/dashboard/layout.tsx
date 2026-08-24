'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Toaster } from '@/components/ui/sonner'
import { ClerkProvider, UserButton, useUser } from '@clerk/nextjs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  LayoutGrid, Inbox, Users, Globe, Kanban, Activity,
  BarChart3, Sparkles, Bell, Settings, Menu, Sun, Moon, Share2, Megaphone, Lock, CalendarClock,
} from 'lucide-react'
import { useRole } from './useRole'
import UploadTray from './UploadTray'
import NotificationBell from './NotificationBell'
import { canSeePage, visiblePages } from '@/app/lib/page-access-core'
import type { Role } from '@/app/lib/identity-core'

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

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> }

const NAV_MAIN: NavItem[] = [
  { href: '/dashboard',            label: 'Overview',         icon: LayoutGrid },
  { href: '/dashboard/leads',      label: 'Leads',            icon: Inbox },
  { href: '/dashboard/clients',    label: 'Clients',          icon: Users },
  { href: '/dashboard/audience',   label: 'Audience',         icon: Megaphone },
  { href: '/dashboard/social',     label: 'Social channels',  icon: Share2 },
  { href: '/dashboard/website',    label: 'Website',          icon: Globe },
  { href: '/dashboard/production', label: 'Production',       icon: Kanban },
  { href: '/dashboard/bookings',   label: 'Bookings',         icon: CalendarClock },
  { href: '/dashboard/activity',   label: 'Team Activity',    icon: Activity },
]

const NAV_TOOLS: NavItem[] = [
  { href: '/dashboard/team',          label: 'Team',          icon: Users },
  { href: '/dashboard/ai',            label: 'AI Assistant',  icon: Sparkles },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/settings',      label: 'Settings',      icon: Settings },
]

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':               'Overview',
  '/dashboard/leads':         'Leads',
  '/dashboard/clients':       'Clients',
  '/dashboard/audience':      'Audience',
  '/dashboard/website':       'Website',
  '/dashboard/production':    'Production',
  '/dashboard/bookings':      'Bookings',
  '/dashboard/production/shoots': 'Shoots',
  '/dashboard/scheduler':     'Scheduler',
  '/dashboard/calendar':      'Calendar',
  '/dashboard/activity':      'Team Activity',
  '/dashboard/reports':       'Reports',
  '/dashboard/team':          'Team',
  '/dashboard/ai':            'AI Assistant',
  '/dashboard/notifications': 'Notifications',
  '/dashboard/settings':      'Settings',
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

function NavLinks({ role, granted, hidden, path, onNavigate }: {
  role: Role | null
  granted: string[]
  hidden: string[]
  path: string
  onNavigate?: () => void
}) {
  // the role ladder decides by default; a super admin's grants can only add
  const main = visiblePages(role, NAV_MAIN, granted, hidden)
  const tools = visiblePages(role, NAV_TOOLS, granted, hidden)
  const link = (item: NavItem) => {
    const active = path === item.href
    const Icon = item.icon
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm transition-all duration-150 ${
          active
            ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
        }`}
      >
        <Icon className={`h-4 w-4 shrink-0 transition-colors ${active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300'}`} />
        {item.label}
        {active && <span className="ml-auto h-1 w-1 rounded-full bg-blue-600 dark:bg-blue-400" />}
      </Link>
    )
  }
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      <p className="px-2.5 pb-1.5 pt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">Workspace</p>
      {main.map(link)}
      {tools.length > 0 && (
        <p className="px-2.5 pb-1.5 pt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">System</p>
      )}
      {tools.map(link)}
    </nav>
  )
}

function SidebarHeader() {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-zinc-100 px-4 dark:border-zinc-800">
      {/* the wordmark is white + blue slash, so it sits on a dark plate */}
      <div className="flex items-center rounded-lg bg-gradient-to-b from-zinc-800 to-zinc-950 px-2.5 py-2 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
      </div>
    </div>
  )
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user } = useUser()
  // The role comes from the server (team_users), not Clerk publicMetadata.
  // The old fallback here was `?? 'admin'`, so an identity whose metadata was
  // never stamped rendered the *full* admin navigation — a client included.
  // useRole starts as null and `visibleFor` shows nothing until it resolves,
  // so the failure now runs in the safe direction.
  const { role, loading: roleLoading } = useRole()
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
    const all = [...NAV_MAIN, ...NAV_TOOLS]
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
  const resolving = roleLoading || role === null
    || (role !== 'super_admin' && !grantsLoaded)
  // an ITEM page is shared ground: the scheduler queue links straight to
  // /dashboard/production/<id> for scheduling, so anyone who may see the
  // scheduler may open item detail — the API still scopes what it returns
  // (schedulers get approved+ items only, or a 404)
  const isItemDetail = /^\/dashboard\/production\/[^/]+$/.test(path)
  const blocked = !resolving && section !== null && !canSeePage(role, section, granted, hidden)
    && !(isItemDetail && canSeePage(role, '/dashboard/scheduler', granted, hidden))
  const firstAllowed = visiblePages(role, [...NAV_MAIN, ...NAV_TOOLS], granted, hidden)[0] ?? null

  return (
    <div className="dbx min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-200/80 bg-white lg:flex dark:border-zinc-800 dark:bg-zinc-900">
        <SidebarHeader />
        <div className="flex-1 overflow-y-auto pb-6">
          <NavLinks role={role} granted={granted} hidden={hidden} path={path} />
        </div>
        <div className="border-t border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
          <a
            href="https://www.mdmmarketing.com.au"
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-700"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            mdmmarketing.com.au
          </a>
        </div>
      </aside>

      {/* Main column */}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 backdrop-blur sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/85">
          {/* Mobile nav */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarHeader />
              <NavLinks role={role} granted={granted} hidden={hidden} path={path} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <h1 className="text-sm font-semibold tracking-tight">{PAGE_TITLES[path] ?? PAGE_TITLES[Object.keys(PAGE_TITLES).sort((a, b) => b.length - a.length).find(k => path.startsWith(`${k}/`)) ?? ''] ?? 'Dashboard'}</h1>
          {/* Beta: this is in daily use while still being built, so the state
              is stated rather than left to be discovered on a rough edge. */}
          <span
            title="In active development — expect rough edges, and tell us about them"
            className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400"
          >
            Beta
          </span>
          <Separator orientation="vertical" className="h-4 bg-zinc-200 dark:bg-zinc-700" />
          <p className="hidden rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-500 sm:block dark:bg-zinc-800 dark:text-zinc-400">
            {path}
          </p>

          <div className="ml-auto flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {role && role !== 'super_admin' && (
              <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-zinc-600">
                {role.replace('_', ' ')}
              </span>
            )}
            <NotificationBell />
            {user && (
              <span className="hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">
                {user.firstName ?? user.emailAddresses[0]?.emailAddress}
              </span>
            )}
            {/* Signing out defaults to "/" on the CURRENT host, and this host
                also serves the marketing site — so the default drops a staff
                member on the homepage as if they had wandered onto the public
                site. Send them to sign-in instead. */}
            <UserButton
              appearance={{ elements: { avatarBox: { width: 28, height: 28, borderRadius: 8 } } }}
            />
          </div>
        </header>

        <main className="w-full p-4 sm:p-6 xl:px-8">
          {resolving ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : blocked ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
              <Lock className="h-6 w-6 text-zinc-400" />
              <p className="text-sm font-medium">This page is not part of your access</p>
              <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
                Ask a super admin to open it for you in Settings → Page access.
              </p>
              {firstAllowed && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={firstAllowed.href}>Go to {firstAllowed.label}</Link>
                </Button>
              )}
            </div>
          ) : children}
        </main>
      </div>

      <Toaster />
      <UploadTray />
    </div>
  )
}
