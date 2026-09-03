'use client'

/**
 * Start a post from the Scheduler.
 *
 * The Scheduler is where posting is decided, and until now the only way to
 * make a post was to leave it: over to Social, find the client, open the
 * composer there. Every ad-hoc post — the reactive one, the story that has to
 * go out this afternoon — meant navigating away from the queue you were
 * working, and coming back to find your place again.
 *
 * The composer itself is the one on the Social page, not a second one. A
 * second composer is a second set of platform rules to keep in step, and they
 * would not stay in step.
 *
 * Two things it will not do:
 *
 *  - Appear for someone who cannot publish. `/api/social/publish` requires the
 *    scheduler role and would refuse them; offering the button anyway is a
 *    button that exists to say no.
 *  - Open an empty composer. Clients and channels are fetched on the click and
 *    the dialog opens once they are in hand, because a composer that opens
 *    with no channels in it looks exactly like a client with none connected.
 */

import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import ComposeDialog from '../social/ComposeDialog'
import { NotSetUp } from '../NotSetUp'
import { useRole } from '../useRole'
import { notifyProductionChange } from '../production/useProductionLive'
import { friendlyError } from '../../lib/support-core'

type Client = { id: string; name: string; status?: string | null }
type Account = {
  id: string; client_id: string | null; platform: string
  provider_account_id: string; username: string | null; name: string | null; active: boolean
}

export default function NewPostButton() {
  const { can, loading: roleLoading } = useRole()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  /** the publishing provider is not configured for this workspace */
  const [notSetUp, setNotSetUp] = useState<string | null>(null)
  /** fetched once per page — channels change rarely, and a second click
   *  should open the composer immediately rather than pause again */
  const fetched = useRef(false)

  const load = useCallback(async () => {
    const [cRes, aRes] = await Promise.all([
      fetch('/api/website/clients'),
      fetch('/api/social/accounts', { cache: 'no-store' }),
    ])

    if (!cRes.ok) {
      throw new Error((await cRes.json().catch(() => ({}))).error ?? 'Could not load clients')
    }
    const clientRows = await cRes.json() as Client[]

    const accountBody = await aRes.json().catch(() => ({})) as { accounts?: Account[]; error?: string }
    if (!aRes.ok) {
      // 503 is the provider being switched off, not a failure of this click
      if (aRes.status === 503) { setNotSetUp(accountBody.error ?? null); return false }
      throw new Error(accountBody.error ?? 'Could not load the connected channels')
    }

    setClients((Array.isArray(clientRows) ? clientRows : []).filter(c => c.status !== 'archived'))
    setAccounts(accountBody.accounts ?? [])
    fetched.current = true
    return true
  }, [])

  const start = async () => {
    if (fetched.current) { setOpen(true); return }
    setLoading(true)
    try {
      if (await load()) setOpen(true)
    } catch (e) {
      const raw = e instanceof Error ? e.message : ''
      // never put a developer string on screen — support-core decides
      toast.error(friendlyError(raw, 'Scheduler'))
    } finally {
      setLoading(false)
    }
  }

  // the role is still arriving: render nothing rather than a button that may
  // be about to disappear
  if (roleLoading || !can('scheduler')) return null

  return (
    <>
      <Button size="sm" onClick={start} disabled={loading}>
        {loading
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening…</>
          : <><Plus className="h-3.5 w-3.5" /> New post</>}
      </Button>

      {/* the provider is off for this workspace — say so once, properly,
          instead of opening a composer with nowhere to send anything */}
      <Dialog open={notSetUp !== null} onOpenChange={o => { if (!o) setNotSetUp(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Posting is not switched on yet</DialogTitle>
          </DialogHeader>
          <NotSetUp feature="Publishing" detail={notSetUp} />
        </DialogContent>
      </Dialog>

      <ComposeDialog
        open={open}
        onOpenChange={setOpen}
        clients={clients}
        accounts={accounts}
        // the queue and the calendar both refetch on this, so a post made here
        // appears where it belongs without waiting for the poll
        onPublished={notifyProductionChange}
      />
    </>
  )
}
