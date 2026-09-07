'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, ClipboardCheck, Kanban } from 'lucide-react'
import PageTitle from '../../ui/PageTitle'
import {
  DEFAULT_SCHEDULE_VIEW, SCHEDULE_VIEWS, SCHEDULE_VIEW_KEY,
  type ScheduleView,
} from '../../../lib/schedule-page-core'
import { restoredChoice } from '../../../lib/work-pages-core'
import NewPostButton, { NEW_CARD_EVENT } from './NewPostButton'
import CalendarView from './CalendarView'
import BoardView from './BoardView'
import ApprovalsView from './ApprovalsView'

/**
 * THE SCHEDULE — one page, three views.
 *
 * There used to be two entries for one job. `/dashboard/scheduler` drew a
 * board behind its own pills, `/dashboard/social/schedule` drew the posting
 * calendar, and the same calendar was reachable three ways. The owner, looking
 * at the live app: "this page will be too confusing … why can't anything that
 * needs approving just be in the Schedule". So the Scheduler page is gone and
 * its board came here.
 *
 *   Calendar   the week, the media rail, the composer — what this address
 *              has always opened on
 *   Board      the five lanes, exactly as the Scheduler page drew them
 *   Approvals  everything sitting with a person, in one list
 *
 * THE ADDRESS STAYS. `/dashboard/social/schedule` is `SCHEDULE_PAGE` — it is
 * in emails, in notifications and in the portal — and the old Scheduler
 * addresses are permanent redirects onto the matching view, so nothing that
 * was ever sent to anybody stops working.
 *
 * The view is in the address (`?view=`), remembered per person, and a link
 * that names one beats the memory (`restoredChoice`) — otherwise somebody
 * sent to the Approvals list lands on whatever they looked at last.
 *
 * Only the Calendar wants the whole window; the other two are ordinary pages,
 * so the full-height frame is put on for one view rather than all three.
 */

const VIEW_PILLS: { view: ScheduleView; label: string; icon: typeof CalendarDays; blurb: string }[] = [
  {
    view: 'calendar',
    label: 'Calendar',
    icon: CalendarDays,
    blurb: "One client's week. Approved media on the left, what is going out on the right.",
  },
  {
    view: 'board',
    label: 'Board',
    icon: Kanban,
    blurb: 'Every card, Draft to Posted — what needs doing and where the work lives.',
  },
  {
    view: 'approvals',
    label: 'Approvals',
    icon: ClipboardCheck,
    blurb: 'Everything waiting on a person: posts sent for sign-off, and work with the client.',
  },
]

export default function SchedulePage() {
  /**
   * The view on screen. Read AFTER mount — this page prerenders, and reading
   * the address or localStorage while rendering on the server makes the first
   * client render disagree with it. Back and Forward are followed, so the
   * three views behave like the three pages they replaced.
   */
  const [view, setView] = useState<ScheduleView>(DEFAULT_SCHEDULE_VIEW)
  useEffect(() => {
    const read = () => {
      let fromUrl: string | null = null
      let fromStorage: string | null = null
      try { fromUrl = new URLSearchParams(window.location.search).get('view') } catch { /* no address */ }
      try { fromStorage = localStorage.getItem(SCHEDULE_VIEW_KEY) } catch { /* private mode */ }
      setView(restoredChoice(SCHEDULE_VIEWS, DEFAULT_SCHEDULE_VIEW, { fromUrl, fromStorage }))
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  /**
   * Move to a view, carrying anything the destination needs — the client and
   * the piece for the composer, the card for the board's panel.
   *
   * pushState, not a navigation: the address is honest and Back works, and
   * nothing else on the page reloads. The destination view mounts fresh and
   * reads those params the way it always has.
   */
  const go = useCallback((next: ScheduleView, extra: Record<string, string | null | undefined> = {}) => {
    setView(next)
    try { localStorage.setItem(SCHEDULE_VIEW_KEY, next) } catch { /* private mode */ }
    try {
      const url = new URL(window.location.href)
      // a move between views drops the last one's deep links — a stale
      // ?card= would reopen a panel nobody asked for
      for (const key of ['view', 'client', 'item', 'card', 'column', 'show']) url.searchParams.delete(key)
      url.searchParams.set('view', next)
      for (const [key, value] of Object.entries(extra)) {
        if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value)
      }
      window.history.pushState(null, '', url.toString())
    } catch { /* the view still changed */ }
  }, [])

  const active = VIEW_PILLS.find(p => p.view === view) ?? VIEW_PILLS[0]
  const pill = (isActive: boolean) =>
    `inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors ${
      isActive ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
    }`

  /** "New card" only means something on the board, so it takes you there and
   *  the board opens the dialog — rather than doing nothing where you stand. */
  const newCard = () => {
    if (view === 'board') { window.dispatchEvent(new CustomEvent(NEW_CARD_EVENT)); return }
    go('board')
    // the board has to mount before it can hear the ask
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(NEW_CARD_EVENT)), 0)
  }

  return (
    <div className={view === 'calendar'
      // the shell publishes what its chrome costs as `--dbx-chrome`; taking
      // that off the viewport is what makes the rail and the grid reach the
      // bottom of the window instead of stopping half way
      ? 'flex h-[calc(100vh-var(--dbx-chrome,9rem))] min-h-[560px] flex-col'
      : 'flex flex-col gap-4'}>
      <PageTitle
        title="Schedule"
        summary={active.blurb}
        actions={<>
          <nav aria-label="Schedule views"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface p-1">
            {VIEW_PILLS.map(p => {
              const Icon = p.icon
              const isActive = p.view === active.view
              return (
                <button
                  key={p.view}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => go(p.view)}
                  className={pill(isActive)}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} /> {p.label}
                </button>
              )
            })}
          </nav>

          {/* posting is decided here, so starting one belongs here — the same
              composer the rest of Social opens, not a second one to keep in
              step */}
          <NewPostButton onNewCard={newCard} />
        </>}
      />

      {view === 'calendar' ? <CalendarView />
        : view === 'board' ? <BoardView />
          : <ApprovalsView go={go} />}
    </div>
  )
}
