'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { useRole } from '../useRole'

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
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your profile, how work is filed, and the accounts this workspace is
          connected to. People and roles are on the Team page.
        </p>
      </div>

      {/* hold the shape until the role is known — no tab bar that morphs */}
      {loading ? (
        <Skeleton className="h-9 w-96" />
      ) : (
        <nav className="flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60 sm:w-fit">
          {TABS.filter(t => isSuper || !t.superOnly).map(t => {
            const active = pathname === t.href
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
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
