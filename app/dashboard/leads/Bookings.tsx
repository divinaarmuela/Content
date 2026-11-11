'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoadFailed } from '../NotSetUp'
import { monthWords, type BookingsReport } from '../../lib/bookings-core'

/**
 * THE BOOKINGS TAB ON LEADS (11 Nov 2026, the owner: "how many people have gone through and booked a call with us …
 * show a page called bookings in leads page"). Read straight from Calendly, all time — so it includes calls booked
 * before the webhook started filling the Leads list on 9 Nov. Counted by the month the call was BOOKED.
 */
export default function Bookings() {
  const [report, setReport] = useState<BookingsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/calendly/bookings', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Calendly did not answer')
      setReport(json as BookingsReport)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calendly did not answer')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (loading && !report) {
    return <Card><CardContent className="flex flex-col gap-3 p-6">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>
  }
  if (error && !report) return <LoadFailed what="the bookings from Calendly" detail={error} onRetry={() => void load()} />
  if (!report) return null

  const since = report.oldest ? new Date(report.oldest).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'long', year: 'numeric' }) : null
  const tiles: [string, number, string][] = [
    ['Calls booked', report.total, since ? `since ${since}` : 'all time'],
    ['Still on', report.kept, 'not cancelled'],
    ['Cancelled', report.cancelled, report.total ? `${Math.round((report.cancelled / report.total) * 100)}% of bookings` : '—'],
    ['Coming up', report.upcoming, 'calls still ahead'],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-secondary-13 text-muted-foreground">Straight from Calendly, every call ever booked. Counted by the month it was booked.</p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, n, note]) => (
          <Card key={label} className="py-0">
            <CardContent className="p-4">
              <p className="text-secondary-13 text-muted-foreground">{label}</p>
              <p className="text-[28px] font-semibold leading-tight tabular-nums">{n}</p>
              <p className="text-[12px] text-muted-foreground">{note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {report.total === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="py-10 text-center text-body-15 text-muted-foreground">No calls have been booked through Calendly yet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-foreground/[0.04] hover:bg-foreground/[0.04]">
                  <TableHead>Month booked</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Still on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.months.map(m => (
                  <TableRow key={m.month}>
                    <TableCell className="text-body-15">{monthWords(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.booked}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{m.cancelled}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{m.booked - m.cancelled}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-foreground/[0.04] hover:bg-foreground/[0.04]">
                  <TableHead>Calendar</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.types.map(t => (
                  <TableRow key={t.name}>
                    <TableCell className="text-secondary-13">{t.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  )
}
