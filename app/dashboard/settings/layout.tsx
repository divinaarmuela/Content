'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { useRole } from '../useRole'
import PageTitle from '../ui/PageTitle'

/**
 * Settings shell. Each tab is a real child route, so a refresh keeps your
 * place and any section can be linked directly — no tab state to lose.
 * Super-admin sections simply don't render in the nav for anyone else; their
 * pages and APIs refuse independently.
 */

const TABS = [
  { href: '/dashboard/settings', label: 'Profile', superOnly: false },
  // its own tab, not the bottom of "Profile" — it governs every dropdown in
  // the New item dialog, which is nobody's idea of a personal preference
  { href: '/dashboard/settings/work-types', label: 'Work types', superOnly: false },
  { href: '/dashboard/settings/scanner', label: 'Inbox scanner', superOnly: true },
  { href: '/dashboard/settings/intake', label: 'Intake templates', superOnly: true },
  { href: '/dashboard/settings/access', label: 'Page access', superOnly: true },
  { href: '/dashboard/settings/credentials', label: 'Credentials', superOnly: false },
  { href: '/dashboard/settings/integrations', label: 'Integrations', superOnly: false },
  { href: '/dashboard/settings/glossary', label: 'What the words mean', superOnly: false },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { can, loading } = useRole()
  const isSuper = can('super_admin')

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Settings"
        summary="Your profile, how work is filed, and the accounts this workspace is connected to. People and roles are on the Team page."
      />

      {/* hold the shape until the role is known — no tab bar that morphs */}
      {loading ? (
        <Skeleton className="h-9 w-96" />
      ) : (
        <nav className="flex flex-wrap items-center gap-1 rounded-inner bg-foreground/[0.06] p-1 sm:w-fit">
          {TABS.filter(t => isSuper || !t.superOnly).map(t => {
            const active = pathname === t.href
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-tile px-3 py-1.5 text-body-15 transition-colors ${
                  active
                    ? 'bg-surface font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      )}

      {children}
    </div>
  )
}
