'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { UserButton, useUser } from '@clerk/nextjs'
import './dashboard.css'

const NAV_MAIN = [
  { href: '/dashboard',            label: 'Dashboard',        icon: GridIcon,      badge: null },
  { href: '/dashboard/leads',      label: 'Leads',            icon: InboxIcon,     badge: null },
  { href: '/dashboard/clients',    label: 'Clients',          icon: UsersIcon,     badge: '8' },
  { href: '/dashboard/production', label: 'Production Board', icon: KanbanIcon,    badge: '3' },
  { href: '/dashboard/scheduler',  label: 'Scheduler Queue',  icon: ClockIcon,     badge: '2' },
  { href: '/dashboard/calendar',   label: 'Calendar',         icon: CalendarIcon,  badge: null },
  { href: '/dashboard/activity',   label: 'Activity Log',     icon: ActivityIcon,  badge: null },
  { href: '/dashboard/reports',    label: 'Reports',          icon: ChartIcon,     badge: null },
]

const NAV_TOOLS = [
  { href: '/dashboard/ai',            label: 'AI Assistant',  icon: SparkleIcon, badge: 'Beta' },
  { href: '/dashboard/notifications', label: 'Notifications', icon: BellIcon,    badge: '7' },
  { href: '/dashboard/settings',      label: 'Settings',      icon: CogIcon,     badge: null },
]

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':              'Dashboard',
  '/dashboard/leads':        'Leads',
  '/dashboard/clients':      'Clients',
  '/dashboard/production':   'Production Board',
  '/dashboard/scheduler':    'Scheduler Queue',
  '/dashboard/calendar':     'Calendar',
  '/dashboard/activity':     'Activity Log',
  '/dashboard/reports':      'Reports',
  '/dashboard/ai':           'AI Assistant',
  '/dashboard/notifications':'Notifications',
  '/dashboard/settings':     'Settings',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const path      = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const { user }  = useUser()
  const role      = (user?.publicMetadata?.role as string) ?? 'admin'

  return (
    <div className="db-shell">
      {/* Sidebar */}
      <aside className={`db-sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="db-logo">
          <div className="db-logo-mark">MD</div>
          {!collapsed && (
            <div className="db-logo-text">
              <span className="db-logo-brand">MD Media</span>
              <span className="db-logo-sub">Agency OS</span>
            </div>
          )}
          <button className="db-collapse-btn" onClick={() => setCollapsed(c => !c)} aria-label="Toggle sidebar">
            <ChevronIcon flipped={collapsed} />
          </button>
        </div>

        <nav className="db-nav">
          {!collapsed && <p className="db-nav-label">Main</p>}
          {NAV_MAIN.filter(item => {
            if (role === 'editor')    return ['/dashboard/production'].includes(item.href)
            if (role === 'scheduler') return ['/dashboard/scheduler', '/dashboard/calendar'].includes(item.href)
            if (role === 'client')    return false
            return true
          }).map(({ href, label, icon: Icon, badge }) => (
            <Link
              key={href}
              href={href}
              className={`db-nav-item${path === href ? ' active' : ''}`}
              title={collapsed ? label : undefined}
            >
              <Icon />
              {!collapsed && <span>{label}</span>}
              {!collapsed && badge && <span className="db-badge">{badge}</span>}
            </Link>
          ))}

          {!collapsed && !['editor','scheduler','client'].includes(role) && (
            <p className="db-nav-label" style={{ marginTop: 16 }}>Tools</p>
          )}
          {NAV_TOOLS.filter(() => !['editor','scheduler','client'].includes(role)).map(({ href, label, icon: Icon, badge }) => (
            <Link
              key={href}
              href={href}
              className={`db-nav-item${path === href ? ' active' : ''}`}
              title={collapsed ? label : undefined}
            >
              <Icon />
              {!collapsed && <span>{label}</span>}
              {!collapsed && badge && (
                <span className={`db-badge${badge === 'Beta' ? ' beta' : badge === '7' ? ' danger' : ''}`}>
                  {badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {!collapsed && (
          <button
            className="db-issues"
            onClick={() => toast.warning('4 issues need attention', {
              description: '2 overdue tasks · 1 failed approval · 1 missed post',
              action: { label: 'View', onClick: () => {} },
            })}
          >
            <div className="db-issues-dot" />
            <span>4 Issues</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#5a576b' }}>→</span>
          </button>
        )}
      </aside>

      {/* Main */}
      <div className="db-main">
        {/* Top header */}
        <header className="db-header">
          <span className="db-header-title">{PAGE_TITLES[path] ?? 'Dashboard'}</span>
          <div className="db-header-divider" />
          <span style={{ fontSize: 12, color: '#a8a5bb' }}>mdmmarketing.com.au</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {role && role !== 'admin' && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                background: '#eeeefd', color: '#5d5fef', letterSpacing: '0.04em', textTransform: 'capitalize',
              }}>
                {role.replace('_', ' ')}
              </span>
            )}
            {user && (
              <span style={{ fontSize: 12, color: '#7b7990' }}>
                {user.firstName ?? user.emailAddresses[0]?.emailAddress}
              </span>
            )}
            <UserButton
              appearance={{
                elements: {
                  avatarBox: { width: 28, height: 28, borderRadius: 8 },
                },
              }}
            />
          </div>
        </header>

        {children}
      </div>

      <Toaster />
    </div>
  )
}

/* ── Icons ────────────────────────────────────────────────────── */
function InboxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M1 9h4l1.5 2h3L11 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}
function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M11 7c1.1.4 2 1.6 2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="11.5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function KanbanIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="6" y="2" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="11" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 12l4-4 3 3 4-5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}
function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1a5 5 0 015 5v3l1.5 2H1.5L3 9V6a5 5 0 015-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M6.5 13a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}
function CogIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M2.9 13.1l1.4-1.4M11.7 4.3l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function ChevronIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      style={{ transform: flipped ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}>
      <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function ActivityIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 8h2l2-5 3 10 2-8 2 3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
