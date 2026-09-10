'use client'

/**
 * THE ONE BUTTON ON THE SCHEDULER PAGE.
 *
 * The owner, more than once, in their words: "ONE BUTTON… IT SHOULD BE ONE
 * ACTION WHERE I CAN PUT FILES OR DRIVE TO SEND TO MY AM FOR APPROVAL" — and
 * "where is this preview feature in the Scheduler page? my New post is still
 * taking me to the Schedule page."
 *
 * It used to `router.push('/dashboard/social/schedule?new=1')`. That is the
 * thing they said not to do: the composer opened on the other page, and coming
 * back meant finding your place in the queue again.
 *
 * So this navigates NOWHERE. Pressing it opens ONE small window over this
 * page (`SendForApprovalDialog`, 8 Sep 2026 — the owner: "make it simple",
 * "why is the modal there when it's an approval stage"): the client, the
 * files, a name for the piece, and the one decision — send it to a manager,
 * or (a manager) approve it or send it to the client. No caption, no
 * channels, no network options: those are the Schedule page's, where an
 * approved piece is booked in.
 *
 * It does not appear for somebody who cannot publish — `/api/social/publish`
 * requires the scheduler role and would refuse them, and a button that exists
 * to say no is not a button.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRole } from '../useRole'
import SendForApprovalDialog from './SendForApprovalDialog'

export default function NewPostButton() {
  const { can, loading: roleLoading } = useRole()
  const [open, setOpen] = useState(false)

  // the role is still arriving: render nothing rather than a button that may
  // be about to disappear
  if (roleLoading || !can('scheduler')) return null

  return (
    <>
      <Button
        data-tour="board-new-post"
        className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
        onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New post
      </Button>

      {/* mounted only while it is open — the listeners behind it belong to a
          post being written, not to a board being looked at */}
      {open && <SendForApprovalDialog onClose={() => setOpen(false)} />}
    </>
  )
}
