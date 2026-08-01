'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Toaster } from '@/components/ui/sonner'
import { ClerkProvider, UserButton, useUser } from '@clerk/nextjs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  LayoutGrid, Inbox, Users, Globe, Kanban, Clock,
  Activity, BarChart3, Sparkles, Bell, Settings, Menu, Sun, Moon, Share2,
} from 'lucide-react'

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
  { href: '/dashboard/social',     label: 'Social channels',  icon: Share2 },
  { href: '/dashboard/website',    label: 'Website',          icon: Globe },
  { href: '/dashboard/production', label: 'Production',       icon: Kanban },
  { href: '/dashboard/scheduler',  label: 'Scheduler',        icon: Clock },
  { href: '/dashboard/activity',   label: 'Activity',         icon: Activity },
  { href: '/dashboard/reports',    label: 'Reports',          icon: BarChart3 },
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
  '/dashboard/website':       'Website',
  '/dashboard/production':    'Production',
  '/dashboard/scheduler':     'Scheduler',
  '/dashboard/calendar':      'Calendar',
  '/dashboard/activity':      'Activity',
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
    <ClerkProvider>
      <TooltipProvider>
        <DashboardInner>{children}</DashboardInner>
      </TooltipProvider>
    </ClerkProvider>
  )
}

function visibleFor(role: string, items: NavItem[]) {
  if (role === 'editor')    return items.filter(i => i.href === '/dashboard/production')
  if (role === 'scheduler') return items.filter(i => ['/dashboard/scheduler', '/dashboard/calendar'].includes(i.href))
  if (role === 'client')    return []
  return items
}

function NavLinks({ role, path, onNavigate }: { role: string; path: string; onNavigate?: () => void }) {
  const main = visibleFor(role, NAV_MAIN)
  const tools = ['editor', 'scheduler', 'client'].includes(role) ? [] : NAV_TOOLS
  const link = (item: NavItem) => {
    const active = path === item.href
    const Icon = item.icon
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-all duration-150 ${
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
      <p className="px-2.5 pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">Workspace</p>
      {main.map(link)}
      {tools.length > 0 && (
        <p className="px-2.5 pb-1.5 pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">System</p>
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
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-400">Agency OS</p>
    </div>
  )
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user } = useUser()
  const role = (user?.publicMetadata?.role as string) ?? 'admin'
  const { dark, toggle } = useDashTheme()

  return (
    <div className="dbx min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-200/80 bg-white lg:flex dark:border-zinc-800 dark:bg-zinc-900">
        <SidebarHeader />
        <div className="flex-1 overflow-y-auto pb-6">
          <NavLinks role={role} path={path} />
        </div>
        <div className="border-t border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
          <a
            href="https://www.mdmmarketing.com.au"
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-700"
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
              <NavLinks role={role} path={path} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <h1 className="text-sm font-semibold tracking-tight">{PAGE_TITLES[path] ?? 'Dashboard'}</h1>
          <Separator orientation="vertical" className="h-4 bg-zinc-200 dark:bg-zinc-700" />
          <p className="hidden rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-500 sm:block dark:bg-zinc-800 dark:text-zinc-400">
            {path}
          </p>

          <div className="ml-auto flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {role !== 'admin' && (
              <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                {role.replace('_', ' ')}
              </span>
            )}
            {user && (
              <span className="hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">
                {user.firstName ?? user.emailAddresses[0]?.emailAddress}
              </span>
            )}
            <UserButton
              appearance={{ elements: { avatarBox: { width: 28, height: 28, borderRadius: 8 } } }}
            />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6">{children}</main>
      </div>

      <Toaster />
    </div>
  )
}
