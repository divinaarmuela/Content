'use client'

import Link from 'next/link'
import { useMemo, useState, type CSSProperties } from 'react'
import { UserButton, useUser } from '@clerk/nextjs'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import {
  LayoutGrid, Inbox, Users, Globe, Kanban, Activity, Camera, CalendarCheck, Send,
  BarChart3, Sparkles, Bell, Settings, Menu, Sun, Moon, Share2, Megaphone,
  CalendarClock, CalendarDays, Search,
} from 'lucide-react'
import NotificationBell from '../NotificationBell'
import { visiblePages } from '@/app/lib/page-access-core'
import { techMailto } from '@/app/lib/support-core'
import { roleLabel, type Role } from '@/app/lib/identity-core'

/**
 * The dashboard shell: ink sidebar, cream canvas, top bar.
 *
 * Everything here is presentation. The nav data, the role filtering, the
 * active-entry rule and the mobile sheet moved across from
 * `app/dashboard/layout.tsx` unchanged — the layout still owns the hooks, the
 * access decision and what actually renders inside <main>.
 */

export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }

/* ─────────────────────────────────────────────────────────────────────────
   Nav data.

   NAV_MAIN and NAV_TOOLS keep their original membership and ORDER: the
   layout's section lookup and its "go to the first page you can see"
   fallback both read them, so reordering them would quietly change who
   lands where. The sidebar's four visible groups below are a presentation
   layer over the same items — no item is added, removed or re-permissioned.
   ───────────────────────────────────────────────────────────────────────── */

export const NAV_MAIN: NavItem[] = [
  { href: '/dashboard',            label: 'Overview',         icon: LayoutGrid },
  { href: '/dashboard/leads',      label: 'Leads',            icon: Inbox },
  { href: '/dashboard/clients',    label: 'Clients',          icon: Users },
  { href: '/dashboard/audience',   label: 'Audience',         icon: Megaphone },
  { href: '/dashboard/social',     label: 'Social channels',  icon: Share2 },
  { href: '/dashboard/website',    label: 'Website',          icon: Globe },
  // one board became three pages, each answering one question: which shoots
  // am I planning, what is mine to edit, what is mine to post
  { href: '/dashboard/production', label: 'Production',       icon: Camera },
  { href: '/dashboard/editor',     label: 'Editor',           icon: Kanban },
  { href: '/dashboard/scheduler',  label: 'Scheduler',        icon: CalendarCheck },
  { href: '/dashboard/bookings',   label: 'Bookings',         icon: CalendarClock },
  { href: '/dashboard/activity',   label: 'Asana activity',   icon: Activity },
]

/**
 * Social's own pages. Inbox, Analytics and Automations existed only as three
 * outline buttons in the header of the channels list — so someone sent a direct
 * link to the Inbox, who then navigated away, could never find it again.
 *
 * They are children of Social rather than entries in GRANTABLE_PAGES: whoever
 * may see Social may see all of it, and inventing three more permissions for
 * one page's tabs is a permission model nobody would maintain.
 */
export const NAV_SOCIAL_CHILDREN: NavItem[] = [
  // first, because it is where the week is planned — the page people open to
  // decide what goes out and when, and the one the rest of Social feeds
  { href: '/dashboard/social/schedule',    label: 'Schedule',    icon: CalendarDays },
  // then "did it go out?", the question people come to Social with next
  { href: '/dashboard/social/activity',    label: 'Posts',       icon: Send },
  { href: '/dashboard/social/inbox',       label: 'Inbox',       icon: Inbox },
  { href: '/dashboard/social/analytics',   label: 'Analytics',   icon: BarChart3 },
  { href: '/dashboard/social/automations', label: 'Automations', icon: Sparkles },
]

export const NAV_TOOLS: NavItem[] = [
  { href: '/dashboard/reports',       label: 'Reports',       icon: BarChart3 },
  { href: '/dashboard/team',          label: 'Team',          icon: Users },
  // the directory says who exists; this says what each of them is holding
  { href: '/dashboard/team/activity', label: 'Team activity', icon: Activity },
  { href: '/dashboard/ai',            label: 'AI Assistant',  icon: Sparkles },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/settings',      label: 'Settings',      icon: Settings },
]

/** Which group each nav entry is shown under. Settings is pinned to the
 *  bottom of the sidebar rather than sitting in a group.
 *
 *  Exported so a test can prove the sidebar covers every nav entry: an item
 *  in NAV_MAIN or NAV_TOOLS that is in no group and is not the pinned one is
 *  simply never drawn, and nothing else would notice. */
export const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: 'General', hrefs: ['/dashboard', '/dashboard/leads', '/dashboard/clients', '/dashboard/audience'] },
  { label: 'Content', hrefs: ['/dashboard/production', '/dashboard/editor', '/dashboard/scheduler', '/dashboard/bookings', '/dashboard/website', '/dashboard/activity'] },
  { label: 'Social',  hrefs: ['/dashboard/social'] },
  { label: 'Team',    hrefs: ['/dashboard/team', '/dashboard/team/activity', '/dashboard/reports', '/dashboard/ai', '/dashboard/notifications'] },
]
export const PINNED_BOTTOM = '/dashboard/settings'

export const PAGE_TITLES: Record<string, string> = {
  '/dashboard':               'Overview',
  '/dashboard/leads':         'Leads',
  '/dashboard/clients':       'Clients',
  '/dashboard/audience':      'Audience',
  '/dashboard/social':        'Social channels',
  '/dashboard/social/schedule': 'Schedule',
  '/dashboard/social/activity': 'Posts',
  '/dashboard/social/inbox':  'Inbox',
  '/dashboard/social/analytics': 'Analytics',
  '/dashboard/social/automations': 'Automations',
  '/dashboard/website':       'Website',
  '/dashboard/production':    'Production',
  '/dashboard/editor':        'Editor',
  '/dashboard/bookings':      'Bookings',
  '/dashboard/production/availability': 'Availability',
  '/dashboard/production/proposals': 'Proposals',
  '/dashboard/scheduler':     'Scheduler',
  // "Calendar" meant three different things; each one now says which
  '/dashboard/scheduler/calendar': 'Posting calendar',
  '/dashboard/calendar':      'Posting calendar',
  '/dashboard/activity':      'Asana activity',
  '/dashboard/reports':       'Reports',
  '/dashboard/team':          'Team',
  '/dashboard/team/activity': 'Team activity',
  '/dashboard/ai':            'AI Assistant',
  '/dashboard/notifications': 'Notifications',
  '/dashboard/settings':      'Settings',
}

export function pageTitle(path: string): string {
  const exact = PAGE_TITLES[path]
  if (exact) return exact
  const prefix = Object.keys(PAGE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find(k => path.startsWith(`${k}/`))
  return (prefix && PAGE_TITLES[prefix]) || 'Dashboard'
}

/**
 * How much of the window the dashboard chrome takes: the 72px header, the
 * 8px above a page and the 64px below it. Exposed as a CSS variable on the
 * shell so a page that has to fill the screen — the Schedule calendar —
 * subtracts THIS rather than a copied-out `9rem` that stops being true the
 * day the header changes.
 */
// ACCEPTED LIMITATION: this is arithmetic (72 + 8 + 64 px) that nothing
// checks against the classes below — change the header's height or <main>'s
// padding and this has to change with it, by hand.
export const CHROME_HEIGHT = '9rem'

/**
 * Which nav entry the current page belongs to.
 *
 * An exact match only used to count, so opening a client, a shoot or a
 * settings tab un-highlighted the whole sidebar and the person lost track of
 * where they were. Longest prefix wins, so /dashboard/team/activity highlights
 * Team activity rather than Team, and bare '/dashboard' never swallows
 * everything below it.
 */
export function activeNavHref(path: string, hrefs: string[]): string | null {
  const exact = hrefs.find(h => h === path)
  if (exact) return exact
  return hrefs
    .filter(h => path.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0] ?? null
}

/** What this person may see, and where they are — worked out once per render
 *  of the shell rather than once per place the nav is drawn (the rail and the
 *  mobile sheet are both mounted at once, and the rail draws twice: the
 *  scrolling groups and the pinned footer). */
export type ResolvedNav = {
  /** every entry this person may see, by href */
  allowed: Map<string, NavItem>
  /** Social's children, empty when Social itself is not visible */
  children: NavItem[]
  /** the entry the current page belongs to */
  current: string | null
}

export function resolveNav(
  role: Role | null, granted: string[], hidden: string[], path: string,
): ResolvedNav {
  // the role ladder decides by default; a super admin's grants can only add
  const main = visiblePages(role, NAV_MAIN, granted, hidden)
  const tools = visiblePages(role, NAV_TOOLS, granted, hidden)
  // Social's children ride on Social's own permission
  const socialOpen = main.some(i => i.href === '/dashboard/social')
  const children = socialOpen ? NAV_SOCIAL_CHILDREN : []
  return {
    allowed: new Map([...main, ...tools].map(i => [i.href, i] as const)),
    children,
    current: activeNavHref(path, [...main, ...children, ...tools].map(i => i.href)),
  }
}

/**
 * The rail's links.
 *
 * Rendered in two halves so Settings can sit at the foot of the sidebar
 * whatever the height of the list above it: `groups` is the scrolling part,
 * `pinned` is the fixed footer. Fifteen 44px rows do not fit a laptop screen,
 * so the list has to scroll — and a Settings link that scrolls out of sight is
 * exactly the one people hunt for.
 */
function NavLinks({ nav, onNavigate, part }: {
  nav: ResolvedNav
  onNavigate?: () => void
  part: 'groups' | 'pinned'
}) {
  const { allowed, children, current } = nav

  const link = (item: NavItem, nested = false) => {
    const active = current === item.href
    const Icon = item.icon
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        // 44px tall: a nav row is a thumb target on a tablet, not a word
        className={`group flex min-h-11 items-center gap-3 rounded-inner py-2.5 text-[15px] transition-colors duration-150 ${
          nested ? 'ml-4 pl-4 pr-3' : 'px-3'
        } ${
          active
            ? 'bg-cream/[0.12] font-medium text-cream'
            : 'text-cream/[0.72] hover:bg-cream/[0.07] hover:text-cream'
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
        <span className="truncate">{item.label}</span>
      </Link>
    )
  }

  const groupLabel = (text: string) => (
    <p className="px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-cream/[0.38]">
      {text}
    </p>
  )

  if (part === 'pinned') {
    const settings = allowed.get(PINNED_BOTTOM)
    return settings ? <div className="px-3">{link(settings)}</div> : null
  }

  return (
    <nav className="flex flex-col gap-0.5 px-3 pb-4">
      {GROUPS.map(group => {
        const items = group.hrefs.map(h => allowed.get(h)).filter((i): i is NavItem => !!i)
        if (items.length === 0) return null
        return (
          <div key={group.label} className="contents">
            {groupLabel(group.label)}
            {items.map(item => (
              <div key={item.href} className="contents">
                {link(item)}
                {item.href === '/dashboard/social' && children.map(c => link(c, true))}
              </div>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

function SidebarHeader() {
  return (
    <div className="flex h-[72px] shrink-0 items-center px-5">
      {/* the wordmark is already white with the blue slash — used as is, never
          inverted and never re-coloured */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/MDLogo-trim.png" alt="MD Media" className="h-[26px] w-auto" />
    </div>
  )
}

/**
 * The search pill.
 *
 * NOT WIRED YET. There is no global search in the dashboard today — no command
 * palette, and no page (production included) reads a `q` query parameter — so
 * there is nothing honest to point this at. Rather than show a box that
 * swallows what you type, it renders disabled and says so, and the first task
 * that ships a real search should replace this whole component.
 */
function SearchPill() {
  return (
    <div className="relative hidden min-w-0 flex-1 sm:block sm:max-w-sm">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
      <input
        type="search"
        disabled
        aria-label="Search (not available yet)"
        placeholder="Search — coming soon"
        className="h-11 w-full cursor-not-allowed rounded-full border border-border bg-surface pl-11 pr-4 text-[15px] text-foreground placeholder:text-muted-foreground"
      />
    </div>
  )
}

/** name + initials, from the viewer Clerk already gives the shell */
function AvatarPill() {
  const { user } = useUser()
  const name = user?.firstName || user?.emailAddresses[0]?.emailAddress || ''
  return (
    <div className="flex h-11 items-center gap-2 rounded-full border border-border bg-surface pl-3 pr-1.5">
      {name && <span className="hidden max-w-[10rem] truncate text-[13px] font-medium sm:block">{name}</span>}
      {/* Signing out defaults to "/" on the CURRENT host, and this host also
          serves the marketing site — so the default drops a staff member on
          the homepage as if they had wandered onto the public site. The
          ClerkProvider in layout.tsx sends them to sign-in instead. */}
      <UserButton
        appearance={{ elements: { avatarBox: { width: 32, height: 32, borderRadius: 999 } } }}
      />
    </div>
  )
}

export default function Shell({
  role, granted, hidden, path, dark, onToggleTheme, children,
}: {
  role: Role | null
  granted: string[]
  hidden: string[]
  path: string
  dark: boolean
  onToggleTheme: () => void
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // one pass over the nav for the rail, its pinned footer and the mobile sheet
  const nav = useMemo(() => resolveNav(role, granted, hidden, path), [role, granted, hidden, path])

  return (
    // `--dbx-chrome` is what the header and <main>'s own padding take out of
    // the window: 72px of header, 8px above the page and 64px below it. A
    // full-height page (the Schedule calendar) subtracts it instead of
    // repeating the arithmetic as a magic number that goes stale the first
    // time this header changes height.
    <div
      className="dbx min-h-screen bg-background text-foreground antialiased"
      style={{ '--dbx-chrome': CHROME_HEIGHT } as CSSProperties}
    >
      {/* Desktop sidebar from `md`, not `lg`: at the old 1024px breakpoint an
          iPad in portrait — a real device on this team — lost the whole
          navigation and had to work through one hamburger. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col bg-ink text-cream md:flex dark:bg-surface">
        <SidebarHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks nav={nav} part="groups" />
        </div>
        <div className="shrink-0 border-t border-cream/10 pb-2 pt-2">
          <NavLinks nav={nav} part="pinned" />
          <a
            href="https://www.mdmmarketing.com.au"
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-h-11 items-center gap-2 px-6 text-[13px] text-cream/40 transition-colors hover:text-cream/80"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-green" />
            mdmmarketing.com.au
          </a>
        </div>
      </aside>

      {/* Main column */}
      <div className="md:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 bg-background/85 px-4 backdrop-blur sm:px-8">
          {/* Mobile nav — same nav, same filtering, 44px rows */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground md:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" strokeWidth={1.8} />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[280px] flex-col border-0 bg-ink p-0 text-cream dark:border-r dark:border-cream/10 dark:bg-surface">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarHeader />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NavLinks nav={nav} part="groups" onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="shrink-0 border-t border-cream/10 py-2">
                <NavLinks nav={nav} part="pinned" onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          {/* Kept from the old header so no page loses its name before the
              per-page titles land. */}
          <h1 className="shrink-0 text-[15px] font-semibold tracking-tight md:hidden">{pageTitle(path)}</h1>

          <SearchPill />

          <div className="ml-auto flex items-center gap-2">
            {/* Beta: this is in daily use while still being built, so the state
                is stated rather than left to be discovered on a rough edge.
                The badge is the way to tell us about a rough edge — which is
                why it shows on a phone too. It used to be `sm:` and up, so the
                people most likely to hit a rough edge had no way to report it.
                The search pill is the phone's spare width, and it is hidden. */}
            <a
              href={techMailto({ subject: 'Feedback on the dashboard', page: path })}
              className="inline-flex min-h-11 items-center rounded-full border border-accent-amber/40 bg-tint-amber px-3 text-[12px] font-semibold uppercase tracking-wider text-foreground transition-opacity hover:opacity-80"
            >
              Beta
            </a>
            {role && role !== 'super_admin' && (
              <span className="hidden min-h-11 items-center rounded-full border border-border bg-surface px-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground lg:inline-flex">
                {roleLabel(role)}
              </span>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-muted"
            >
              {dark ? <Sun className="h-[18px] w-[18px]" strokeWidth={1.8} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={1.8} />}
            </button>
            <NotificationBell />
            <AvatarPill />
          </div>
        </header>

        <main className="w-full px-4 pb-16 pt-2 sm:px-8">{children}</main>
      </div>
    </div>
  )
}
