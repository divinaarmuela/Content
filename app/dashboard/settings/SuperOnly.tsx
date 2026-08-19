'use client'

import { Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useRole } from '../useRole'

/** Wrap a super-admin-only settings section: everyone else gets a quiet
 *  explanation instead of controls that error on use. */
export default function SuperOnly({ children }: { children: React.ReactNode }) {
  const { can, loading } = useRole()
  if (loading) return <Skeleton className="h-80 w-full" />
  if (!can('super_admin')) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-zinc-500 dark:text-zinc-400">
          <Lock className="h-4 w-4 shrink-0" />
          This section is for super admins.
        </CardContent>
      </Card>
    )
  }
  return <>{children}</>
}
