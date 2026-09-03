'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowRight, Users } from 'lucide-react'
import { topOverdue, type TeamActivityRow } from '../lib/team-activity-core'

/**
 * "Who is behind" on the Overview — three names, and a way in.
 *
 * It fetches its own data rather than riding on /api/overview: the workload
 * rollup is a heavier query than the Overview's, and only two roles ever see
 * this card. A quiet failure is the right failure here — the card simply does
 * not appear, and the Overview it sits on is unharmed.
 */
export default function TeamLoadCard() {
  const [rows, setRows] = useState<TeamActivityRow[] | null>(null)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/team/activity/workload')
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (live) setRows(j.rows ?? []) })
      .catch(() => { if (live) setDenied(true) })
    return () => { live = false }
  }, [])

  if (denied) return null

  const behind = rows ? topOverdue(rows, 3) : []
  const holding = (rows ?? []).reduce((n, r) => n + r.holding.total, 0)

  return (
    <Card>
      <CardHeader className="flex-row items-center">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" /> Team
        </CardTitle>
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href="/dashboard/team/activity">Who has what <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        {rows === null ? (
          <>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </>
        ) : behind.length === 0 ? (
          <p className="py-4 text-body-15 text-muted-foreground">
            Nobody is behind. {holding} piece{holding === 1 ? '' : 's'} in hand across the team.
          </p>
        ) : (
          behind.map(r => (
            <Link
              key={r.id}
              href="/dashboard/team/activity"
              className="flex items-baseline gap-3 rounded-tile px-2 py-1.5 hover:bg-foreground/[0.04]"
            >
              <span className="truncate text-body-15 font-medium">{r.name || r.email}</span>
              <span className="truncate text-secondary-13 text-muted-foreground">
                {r.holding.total} in hand
              </span>
              <span className="ml-auto shrink-0 font-mono text-secondary-13 tabular-nums text-accent-red">
                {r.due.overdue} overdue
              </span>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  )
}
