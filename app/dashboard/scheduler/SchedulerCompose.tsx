'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScopeViewer } from '@/app/lib/scope-client'
import { loadFailedMessage } from '@/app/lib/support-core'
import { useSchedulePosts } from '../social/schedule/useSchedulePosts'
import {
  CLIENT_KEY, useComposeFlow, useSuggestedTimes,
} from '../social/schedule/useComposeFlow'
import { useRole } from '../useRole'

/**
 * THE SCHEDULER'S ONE ACTION, ON THE SCHEDULER PAGE.
 *
 * The owner: "ONE BUTTON… IT SHOULD BE ONE ACTION WHERE I CAN PUT FILES OR
 * DRIVE TO SEND TO MY AM FOR APPROVAL", and "where is this preview feature in
 * the Scheduler page? my New post is still taking me to the Schedule page."
 *
 * So nothing here navigates. The button mounts this, and this runs the
 * Schedule page's own `useComposeFlow` — the same media chooser (files, or the
 * client's Drive folder, read only), the same composer with the same
 * per-network preview, the same "Send for approval". There is no second
 * composer and no second approval route to keep in step.
 *
 * ONE thing this has to ask that the Schedule page does not: WHICH CLIENT.
 * That page is one client's week and already knows; the Scheduler board spans
 * every client this person holds. So the first step of the SAME window is the
 * client — skipped entirely when they only hold one, and offering the one they
 * worked on last first, because that is the answer nine times out of ten.
 *
 * It is mounted only while it is open: `useSchedulePosts` subscribes to a
 * client's posts, items, jobs and versions, and a board that is not composing
 * anything has no business holding those listeners open.
 */
export default function SchedulerCompose({ onClose }: { onClose: () => void }) {
  const { me } = useRole()
  const viewer: ScopeViewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])

  /** the client this post is for — null until it is answered */
  const [clientId, setClientId] = useState<string | null>(null)

  const data = useSchedulePosts(viewer, clientId)
  const suggested = useSuggestedTimes(
    clientId, data.accounts[0]?.platform ?? 'instagram', data.tz)
  const flow = useComposeFlow({ clientId, data, role: me?.role ?? null, suggested, reviewOnly: true })

  /** the client they worked on last, if they still hold them */
  const remembered = useMemo(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(CLIENT_KEY) } catch { /* private mode */ }
    return saved && data.clients.some(c => c.id === saved) ? saved : null
  }, [data.clients])

  const pick = (id: string) => {
    setClientId(id)
    try { localStorage.setItem(CLIENT_KEY, id) } catch { /* private mode */ }
  }

  // one client to hold means no question to ask
  useEffect(() => {
    if (clientId || data.clients.length !== 1) return
    pick(data.clients[0].id)
  }, [clientId, data.clients])

  /**
   * The client is answered: open the files step, once.
   *
   * `opened` is a ref rather than state because closing the chooser must NOT
   * re-open it — somebody who changed their mind would be trapped in a window
   * that reappears every time they dismiss it.
   */
  const opened = useRef(false)
  useEffect(() => {
    if (!clientId || opened.current) return
    opened.current = true
    flow.openAt(null)
  }, [clientId, flow.openAt])

  /**
   * …and when they close the last window, the whole thing is done.
   *
   * It has to have BEEN open first. Checking "not open" alone fires in the
   * same commit that asks for the chooser — before the state behind it has
   * landed — and shuts the window in the same breath as opening it.
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (flow.open) { wasOpen.current = true; return }
    if (wasOpen.current) onClose()
  }, [flow.open, onClose])

  // Escape gets out of the client step too, like every window it leads to
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !clientId) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [clientId, onClose])

  // the client step, and then the flow's own windows over the board
  return (
    <>
      {!clientId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New post"
          onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
        >
          <div className="flex max-h-full w-full max-w-[520px] flex-col gap-3.5 rounded-card bg-popover p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <h2 className="text-section-title">New post</h2>
                <p className="text-[13px] text-muted-foreground">Who is this post for?</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              </button>
            </div>

            {data.error ? (
              <p className="rounded-inner border border-border bg-paper px-3 py-2 text-[13px]">
                {loadFailedMessage('your clients')}
              </p>
            ) : data.loading ? (
              // the list is still arriving — saying "no clients" before it
              // lands is a lie somebody would act on
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Loading your clients…
              </p>
            ) : data.clients.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                You are not on any client yet.
              </p>
            ) : (
              <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
                {[...data.clients]
                  .sort((a, b) =>
                    Number(b.id === remembered) - Number(a.id === remembered)
                    || a.name.localeCompare(b.name))
                  .map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pick(c.id)}
                      className={cn(
                        'flex min-h-11 items-center justify-between gap-3 rounded-inner border border-border bg-paper px-4 text-left text-[14px] font-semibold hover:bg-muted',
                      )}
                    >
                      <span className="min-w-0 truncate">{c.name}</span>
                      {c.id === remembered && (
                        <span className="shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
                          Last time
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {flow.windows}
    </>
  )
}
