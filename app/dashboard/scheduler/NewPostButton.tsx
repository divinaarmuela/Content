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
 * So this navigates NOWHERE. Pressing it opens, over this page:
 *
 *   1. who the post is for, when this person holds more than one client;
 *   2. the media — drop files, or take them out of the client's Google Drive
 *      folder (read only, trap 13), or pick a piece already approved;
 *   3. the composer, with the per-network preview on its own tab;
 *   4. the answer — "Send for approval" for somebody who needs one, or
 *      scheduling and posting for an account manager or a super admin who does
 *      not (`mayPostWithoutApproval`). Nobody is offered a button the server
 *      would refuse.
 *
 * Steps 2 to 4 are the Schedule page's OWN flow (`useComposeFlow`), not a copy
 * of it: one composer, one preview, one approval route.
 *
 * It does not appear for somebody who cannot publish — `/api/social/publish`
 * requires the scheduler role and would refuse them, and a button that exists
 * to say no is not a button.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRole } from '../useRole'
import SchedulerCompose from './SchedulerCompose'

export default function NewPostButton() {
  const { can, loading: roleLoading } = useRole()
  const [open, setOpen] = useState(false)

  // the role is still arriving: render nothing rather than a button that may
  // be about to disappear
  if (roleLoading || !can('scheduler')) return null

  return (
    <>
      <Button
        className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
        onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New post
      </Button>

      {/* mounted only while it is open — the listeners behind it belong to a
          post being written, not to a board being looked at */}
      {open && <SchedulerCompose onClose={() => setOpen(false)} />}
    </>
  )
}
