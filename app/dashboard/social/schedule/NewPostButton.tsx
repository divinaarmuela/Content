'use client'

/**
 * Start a post, from anywhere on the Schedule page.
 *
 * The header's one button, on all three views. Posting is decided here, and
 * until this existed the only way to make an off-plan post — the reactive
 * one, the story that has to go out this afternoon — was to leave the page
 * you were working and come back to find your place again.
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
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import ComposeDialog from '../ComposeDialog'
import { NotSetUp } from '../../NotSetUp'
import { useRole } from '../../useRole'
import { notifyProductionChange } from '../../production/useProductionLive'
import { friendlyError } from '../../../lib/support-core'

type Client = { id: string; name: string; status?: string | null }
type Account = {
  id: string; client_id: string | null; platform: string
  provider_account_id: string; username: string | null; name: string | null; active: boolean
}

/** The board VIEW owns the New card dialog (it has the clients, kinds and
 *  team already loaded); the header owns the button. One asks, the other
 *  answers — so the page keeps ONE button instead of growing a second.
 *
 *  On the Calendar and Approvals views nothing is listening, so "New card"
 *  hands the page over to the board first and the dialog opens there — the
 *  card has to land on the board either way. */
export const NEW_CARD_EVENT = 'mdm:new-card'

export default function NewPostButton({ onNewCard }: {
  /** the page's own answer to "New card": show the board, then ask it to
   *  open the dialog. Left out, the ask is broadcast where it stands. */
  onNewCard?: () => void
}) {
  const newCard = onNewCard ?? (() => window.dispatchEvent(new CustomEvent(NEW_CARD_EVENT)))
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
      toast.error(friendlyError(raw, 'Schedule'))
    } finally {
      setLoading(false)
    }
  }

  // the role is still arriving: render nothing rather than a button that may
  // be about to disappear
  if (roleLoading || !can('scheduler')) return null

  return (
    <>
      {/* ONE button, two things it can make: something that goes out now or
          at a time, and a piece of work to track. Two buttons side by side
          made people choose before they knew the difference. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60"
            disabled={loading}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</>
              : <><Plus className="h-4 w-4" /> New <ChevronDown className="h-4 w-4" /></>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem className="min-h-11 flex-col items-start gap-0.5" onClick={start}>
            <span className="font-semibold">New post</span>
            <span className="text-[12px] text-muted-foreground">Goes out on a channel, now or at a time.</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 flex-col items-start gap-0.5" onClick={newCard}>
            <span className="font-semibold">New card</span>
            <span className="text-[12px] text-muted-foreground">A piece of work to track on the board.</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
