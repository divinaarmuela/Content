'use client'

/**
 * THE ONE BUTTON ON THE POST APPROVAL PAGE.
 *
 * The owner, more than once: "ONE BUTTON… IT SHOULD BE ONE ACTION WHERE I CAN
 * PUT FILES OR DRIVE TO SEND TO MY AM FOR APPROVAL" — and it must not take
 * anyone to another page.
 *
 * Since the posting rebuild (29 Sep 2026) it opens the SAME flow the Schedule
 * page runs (`useComposeFlow`): pick the client, pick the files, and the one
 * post window opens on the new post — with "Send for quality check" as its
 * main button, because every post passes the quality check first (the owner's
 * decision 3). There is no second small window with its own approve and send
 * buttons any more: that was a second copy of the rules, and it wrote to the
 * edit card instead of the post (audit V13, W10).
 *
 * It navigates nowhere, and it does not appear for somebody who does not make
 * posts (`mayCreatePost`).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ScopeViewer } from '@/app/lib/scope-client'
import { loadFailedMessage } from '@/app/lib/support-core'
import { useRole } from '../useRole'
import { mayCreatePost } from '../../lib/overview-links-core'
import { contactIdOf, ownerChoices } from '../../lib/account-owner-core'
import { useSchedulePosts } from '../social/schedule/useSchedulePosts'
import { CLIENT_KEY, useComposeFlow } from '../social/schedule/useComposeFlow'

export default function NewPostButton() {
  const { me, can, loading: roleLoading } = useRole()
  const [open, setOpen] = useState(false)
  if (roleLoading || !can('scheduler') || !mayCreatePost(me?.role)) return null
  return (
    <>
      <Button
        data-tour="board-new-post"
        className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
        onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New post
      </Button>
      {/* mounted only while open — the listeners behind it belong to a post being made */}
      {open && <NewPostFlow onClose={() => setOpen(false)} />}
    </>
  )
}

/** Pick the client (and whom it is for), then the Schedule page's own flow. */
function NewPostFlow({ onClose }: { onClose: () => void }) {
  const { me } = useRole()
  const viewer: ScopeViewer | null = useMemo(() => (me ? { id: me.id, role: me.role } : null), [me])
  const [clientId, setClientId] = useState<string | null>(null)
  const [postFor, setPostFor] = useState('company')
  const data = useSchedulePosts(viewer, clientId)
  const client = data.clients.find(c => c.id === clientId) ?? null

  const remembered = useMemo(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(CLIENT_KEY) } catch { /* private mode */ }
    return saved && data.clients.some(c => c.id === saved) ? saved : null
  }, [data.clients])
  const pick = (id: string) => {
    setClientId(id)
    setPostFor('company')
    try { localStorage.setItem(CLIENT_KEY, id) } catch { /* private mode */ }
  }
  useEffect(() => {
    if (clientId || data.clients.length !== 1) return
    pick(data.clients[0].id)
  }, [clientId, data.clients])

  const people = data.contacts.filter(c => data.accounts.some(a => a.contact_id === c.id))
  const [ready, setReady] = useState(false)
  const flow = useComposeFlow({
    clientId: ready ? clientId : null,
    data,
    role: me?.role ?? null,
    userId: me?.id ?? null,
    suggested: [],
    forContact: contactIdOf(postFor),
  })

  // once the client is chosen, the files window opens; when every window of
  // the flow has closed again, so does this
  const started = useRef(false)
  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    flow.openAt(null)
  }, [ready, flow])
  const wasOpen = useRef(false)
  useEffect(() => {
    if (flow.open) { wasOpen.current = true; return }
    if (wasOpen.current) onClose()
  }, [flow.open, onClose])

  useEffect(() => {
    if (ready) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [ready, onClose])

  if (ready) return <>{flow.windows}</>

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
    >
      <div className="flex max-h-full w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-card bg-popover p-4 text-popover-foreground shadow-xl sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-section-title">New post</h2>
            <p className="text-[13px] text-muted-foreground">
              {!clientId ? 'Who is this post for?' : 'Then pick the files. The post goes to the quality check before anyone else sees it.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {!clientId ? (
          data.error ? (
            <p className="rounded-inner border border-border bg-paper px-3 py-2 text-[13px]">{loadFailedMessage('your clients')}</p>
          ) : data.loading && data.clients.length === 0 ? (
            <p role="status" className="py-6 text-center text-[13px] text-muted-foreground">Loading your clients…</p>
          ) : data.clients.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">You are not on any client yet.</p>
          ) : (
            <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
              {[...data.clients]
                .sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered) || a.name.localeCompare(b.name))
                .map(c => (
                  <button key={c.id} type="button" onClick={() => pick(c.id)}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-inner border border-border bg-paper px-4 text-left text-[14px] font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
                    <span className="min-w-0 truncate">{c.name}</span>
                    {c.id === remembered && <span className="shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">Last time</span>}
                  </button>
                ))}
            </div>
          )
        ) : (
          <>
            {data.clients.length > 1 && (
              <p className="text-[13px]">
                For <span className="font-semibold">{client?.name}</span>
                {' '}<button type="button" aria-label="Change the client this post is for"
                  className="-my-2 inline-flex min-h-11 items-center text-muted-foreground underline"
                  onClick={() => setClientId(null)}>change</button>
              </p>
            )}
            {people.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Posting for</span>
                <select value={postFor} onChange={e => setPostFor(e.target.value)}
                  className="min-h-11 w-full rounded-full border border-border bg-paper px-4 text-[14px] outline-none">
                  {ownerChoices(client?.name ?? 'The business', people).map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={() => setReady(true)} disabled={data.loading && data.accounts.length === 0}
                className="min-h-11 rounded-full bg-foreground px-5 text-[13px] font-semibold text-background disabled:opacity-60">
                Pick the files
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
