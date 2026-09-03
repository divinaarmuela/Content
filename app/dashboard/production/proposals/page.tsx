'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Ban, Copy } from 'lucide-react'
import { publicUrl } from '@/app/lib/public-url'
import { CAL_TZ } from '../../../lib/gcal-core'
import { PROPOSAL_TAG, type ShootStatus } from '../../../lib/shoot-core'
import { useRole } from '../../useRole'

type Proposal = {
  id: string
  token: string
  title: string
  starts_at: string
  ends_at: string
  send_to: string
  status: ShootStatus
  created_at: string
  responded_at: string | null
  clients: { name: string } | null
}

const STATUS_STYLE: Record<ShootStatus, string> = {
  pending: 'bg-tint-amber text-foreground border-accent-amber/35',
  accepted: 'bg-tint-green text-foreground border-accent-green/30',
  declined: 'bg-tint-red text-foreground border-accent-red/30',
  cancelled: 'bg-foreground/[0.06] text-muted-foreground border-border',
}

const fmtWhen = (startsAt: string, endsAt: string) => {
  const day = new Date(startsAt).toLocaleDateString('en-AU', {
    timeZone: CAL_TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', { timeZone: CAL_TZ, hour: 'numeric', minute: '2-digit' })
  return `${day}, ${t(startsAt)}–${t(endsAt)}`
}

/** Every invitation ever sent, newest first — and the place to call one off. */
export default function ProposalsPage() {
  // schedulers read the register; cancelling stays editor+ (matches the API)
  const { can } = useRole()
  const canManage = can('editor')
  const [proposals, setProposals] = useState<Proposal[] | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/shoots')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load proposals')
      setProposals(json.proposals)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load proposals')
      setProposals([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const cancel = async (id: string) => {
    try {
      const res = await fetch(`/api/shoots/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not cancel')
      toast.success('Proposal cancelled — the answer link is now inactive')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cancel')
    }
  }

  if (proposals === null) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    )
  }

  if (proposals.length === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-body-15 text-muted-foreground">
            No shoot proposals yet — send one from a free day in the Availability view.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="py-0">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-foreground/[0.04] hover:bg-foreground/[0.04]">
              <TableHead>Shoot</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="hidden md:table-cell">Sent to</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map(p => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="text-body-15 font-medium">{p.title}</div>
                  <div className="font-mono text-secondary-13 text-muted-foreground">
                    {p.clients?.name ?? '—'}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-body-15 text-muted-foreground">
                  {fmtWhen(p.starts_at, p.ends_at)}
                </TableCell>
                <TableCell className="hidden max-w-56 md:table-cell">
                  <p className="truncate text-secondary-13 text-muted-foreground" title={p.send_to}>
                    {p.send_to}
                  </p>
                </TableCell>
                <TableCell>
                  {/* the raw enum, capitalised, used to sit here — the same
                       record read "Pending" on this page and "awaiting reply"
                       on Availability */}
                  <Badge variant="outline" className={STATUS_STYLE[p.status]}>
                    {PROPOSAL_TAG[p.status as ShootStatus] ?? p.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      title="Copy the client's answer link"
                      aria-label={`Copy answer link for ${p.title}`}
                      onClick={() => {
                        navigator.clipboard.writeText(publicUrl(`/shoot/${p.token}`))
                        toast.success('Answer link copied')
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {canManage && p.status !== 'cancelled' && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-accent-red"
                            title="Cancel this proposal" aria-label={`Cancel ${p.title}`}>
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel {p.title}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Everyone it was sent to receives a cancellation email, the answer
                              link stops working, and the slot is freed in the availability week.
                              {p.status === 'accepted' && ' This shoot was ACCEPTED — cancelling tells the client the confirmed date is off.'}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep it</AlertDialogCancel>
                            <AlertDialogAction onClick={() => cancel(p.id)} className="bg-accent-red hover:bg-accent-red">
                              Cancel proposal
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
