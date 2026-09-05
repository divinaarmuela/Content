'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { friendlyError } from '@/app/lib/support-core'

/**
 * DOES THIS CLIENT SIGN OFF EVERY POST?
 *
 * The one exception to "an account manager just posts" — and until now it
 * existed only in the database. Both server gates read the column and nothing
 * on any screen wrote it, so a client whose contract says they see every post
 * before it goes out was a client anybody could post without, and the only
 * way to honour that contract was to hand-edit a row.
 *
 * One sentence, one switch, and the sentence says what happens either way:
 * somebody turning this on has usually just come off a phone call about it
 * and needs to know it took effect, not to read a paragraph.
 *
 * The switch is drawn for everybody who can see the client's Social page and
 * only WRITES for an account manager or a super admin — the server decides
 * that, this only avoids offering a press that would come back 403. A
 * scheduler seeing the arrangement in plain words is the point: the Schedule
 * page's own buttons change with it.
 */
export default function ClientApproval({
  clientId, mayEdit,
}: {
  clientId: string
  /** an account manager on this client, or a super admin */
  mayEdit: boolean
}) {
  const [on, setOn] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const url = `/api/clients/${clientId}/approval`

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/approval`)
      const json = await res.json()
      setOn(res.ok ? json?.client_approval_required === true : false)
    } catch {
      setOn(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const save = async (next: boolean) => {
    // the server's answer is the truth, but the switch has to move under the
    // finger — it is put back if the save is refused
    const before = on
    setOn(next)
    setSaving(true)
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setOn(json?.client_approval_required === true)
      toast.success(next
        ? 'Saved. This client now signs off every post.'
        : 'Saved. An account manager can post without waiting.')
    } catch (e) {
      setOn(before)
      toast.error(friendlyError(e instanceof Error ? e.message : '', 'this client'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
          <h2 className="text-card-title">Approvals</h2>
        </div>

        {on === null ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <label className="flex min-h-11 items-start gap-3">
            <Switch
              checked={on}
              disabled={!mayEdit || saving}
              onCheckedChange={v => void save(v)}
              aria-label="This client signs off every post"
            />
            <span className="flex flex-col gap-1">
              <span className="text-[14px] font-medium">This client signs off every post</span>
              <span className="max-w-prose text-secondary-13 text-muted-foreground">
                {on
                  ? 'Every post goes to this client for their answer before it can be booked in. '
                    + 'Nobody here can skip that — not an account manager, not an admin.'
                  : 'An account manager can post this client’s work without waiting for them. '
                    + 'The app records who signed it off. Turn this on for a client whose '
                    + 'agreement says they see everything first.'}
              </span>
              {!mayEdit && (
                <span className="text-secondary-13 text-muted-foreground">
                  Only an account manager on this client can change this.
                </span>
              )}
            </span>
          </label>
        )}
      </CardContent>
    </Card>
  )
}
