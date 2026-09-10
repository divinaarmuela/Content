'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScopeViewer } from '@/app/lib/scope-client'
import { loadFailedMessage, friendlyError } from '@/app/lib/support-core'
import { mayPostWithoutApproval } from '@/app/lib/social-schedule-core'
import { refusedFilesLine, usableUploadFiles } from '@/app/lib/schedule-upload-core'
import { slideTypeFromUrl, type Slide } from '@/app/lib/version-files-core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { clearGroup, dismissUpload, uploadFiles } from '../uploadQueue'
import { UploadRows, useUploadGroup } from '../UploadRows'
import { useSchedulePosts } from '../social/schedule/useSchedulePosts'
import { useRole } from '../useRole'

/** the client worked on last — the same key the Schedule page remembers */
const CLIENT_KEY = 'md-schedule-client'

/**
 * THE POST APPROVAL PAGE'S ONE WINDOW.
 *
 * The owner, 8 Sep 2026, on seeing the full composer open here as a super
 * admin: "why is it showing me posting in post approval page … this ui is
 * so confusing, so many unnecessary existing blocks … make it simple …
 * where is the send to client thing." And the rule behind it: "Post approval
 * page is where that happens; Schedule page is only for approved items to be
 * posted."
 *
 * So this asks four things and nothing else:
 *
 *   1. which client (skipped when this person holds one);
 *   2. the files;
 *   3. what to call the piece (the file's name stands in);
 *   4. the decision. Somebody who needs an approval picks WHO — the client's
 *      account managers and the super admins — and presses "Send for
 *      approval". A manager or super admin gets two buttons instead:
 *      "Approve" (it lands in Ready to post, and on the Schedule page) and
 *      "Send to <client>" (it lands in With client, on their portal).
 *
 * No caption, no channels, no network options, no time: those belong to the
 * Schedule page, where an APPROVED piece is booked in. One request does the
 * lot (`/api/social/schedule/from-upload` with `decision`), so the card is
 * in the right column the moment the window closes.
 */
export default function SendForApprovalDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { me } = useRole()
  const viewer: ScopeViewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])

  const [clientId, setClientId] = useState<string | null>(null)
  const data = useSchedulePosts(viewer, clientId)
  const client = data.clients.find(c => c.id === clientId) ?? null

  const remembered = useMemo(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(CLIENT_KEY) } catch { /* private mode */ }
    return saved && data.clients.some(c => c.id === saved) ? saved : null
  }, [data.clients])
  const pick = (id: string) => {
    setClientId(id)
    try { localStorage.setItem(CLIENT_KEY, id) } catch { /* private mode */ }
  }
  useEffect(() => {
    if (clientId || data.clients.length !== 1) return
    pick(data.clients[0].id)
  }, [clientId, data.clients])

  /* ── the files ────────────────────────────────────────────────────────── */
  const group = useMemo(() => `approval:${clientId ?? 'none'}`, [clientId])
  const uploads = useUploadGroup(group)
  const [chosen, setChosen] = useState<Slide[]>([])
  // the window may close; the upload may not be lost (the owner, 9 Sep 2026,
  // on the Schedule page's twin of this window). The group outlives the
  // window: a file that landed while it was closed is picked up here the
  // moment its row is done, and the group clears when the post is made.
  useEffect(() => {
    const landed = uploads.filter(u => u.status === 'done' && u.url)
    if (landed.length === 0) return
    setChosen(prev => {
      const have = new Set(prev.map(s => s.url))
      const fresh = landed.filter(u => !have.has(u.url!))
      if (fresh.length === 0) return prev
      return [...prev, ...fresh.map(u => ({
        url: u.url!, name: u.name, bytes: u.total, source: 'upload' as const,
        type: slideTypeFromUrl(u.url!),
      }))]
    })
  }, [uploads])
  const [problem, setProblem] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const takeFiles = useCallback(async (files: File[]) => {
    const { keep, refused } = usableUploadFiles(files)
    setProblem(refusedFilesLine(refused))
    if (keep.length === 0) return
    try {
      const { done } = uploadFiles(keep as unknown as File[], { group, purpose: 'social' })
      const landed = await done
      // by URL: the effect above may have listed it already
      setChosen(prev => {
        const byUrl = new Map(prev.map(s => [s.url, s] as const))
        for (const { file, url } of landed) {
          byUrl.set(url, {
            url, name: file.name, bytes: file.size, source: 'upload' as const,
            type: file.type.startsWith('video/') ? 'video' as const : slideTypeFromUrl(url),
          })
        }
        return [...byUrl.values()]
      })
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'the upload'))
    }
  }, [group])
  const uploading = uploads.some(u => u.status !== 'done' && u.status !== 'failed')

  /* ── the name, the note, the decision ─────────────────────────────────── */
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const signsOff = Boolean(client?.client_approval_required)
  const manager = mayPostWithoutApproval(me?.role ?? null, false)
  const [approvers, setApprovers] = useState<{ id: string; name: string }[]>([])
  const [approverId, setApproverId] = useState<string>('')
  /** the manager buttons are the default; "ask somebody to check it" opens
   *  the picker — an AM asking a super admin, or a super admin asking an AM
   *  (the owner, 10 Sep 2026: "can an AM create the card themselves, ask a
   *  super admin for review, then approve or self-approve and hand over") */
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    fetch(`/api/social/schedule/approvers?clientId=${encodeURIComponent(clientId)}`)
      .then(r => (r.ok ? r.json() : { people: [] }))
      .then((json: { people?: { id: string; name: string }[] }) => {
        if (cancelled) return
        // never yourself: asking yourself to check it is the Approve button
        const people = (json.people ?? []).filter(p => p.id !== me?.id)
        setApprovers(people)
        setApproverId(prev => prev || people[0]?.id || '')
      })
      .catch(() => { if (!cancelled) setApprovers([]) })
    return () => { cancelled = true }
  }, [clientId, me?.id])

  const [busy, setBusy] = useState<'ask' | 'approve' | 'client' | null>(null)
  const send = async (decision: 'ask' | 'approve' | 'client') => {
    if (!clientId || chosen.length === 0 || busy) return
    setBusy(decision)
    setProblem(null)
    try {
      const res = await fetch('/api/social/schedule/from-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId, files: chosen,
          title: title.trim() || null, note: note.trim() || null,
          decision, reviewer_ids: decision === 'ask' ? [approverId] : [],
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const list = Array.isArray(json?.problems) ? json.problems as string[] : []
        setProblem(list[0] ?? friendlyError(String(json?.error ?? ''), 'Post approval'))
        return
      }
      // the files are a post now; the queue rows have done their job
      clearGroup(group)
      toast.success(String(json.message ?? 'Done'))
      router.refresh()
      onClose()
    } catch {
      setProblem(friendlyError('', 'Post approval'))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const ready = chosen.length > 0 && !uploading && !busy
  const primary = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50'
  const secondary = 'h-11 rounded-full px-5 text-[14px] font-semibold'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
    >
      <div className="flex max-h-full w-full max-w-[560px] flex-col gap-4 overflow-y-auto rounded-card bg-popover p-4 shadow-xl sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-section-title">New post</h2>
            <p className="text-[13px] text-muted-foreground">
              {!clientId ? 'Who is this post for?'
                : manager ? 'Add the files, then approve it or send it to the client.'
                : 'Add the files, then send it to whoever approves it.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* ── 1. the client ── */}
        {!clientId ? (
          data.error ? (
            <p className="rounded-inner border border-border bg-paper px-3 py-2 text-[13px]">{loadFailedMessage('your clients')}</p>
          ) : data.loading ? (
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
                  className="-my-2 inline-flex min-h-11 items-center underline text-muted-foreground"
                  onClick={() => { setClientId(null); setChosen([]) }}>change</button>
              </p>
            )}

            {/* ── 2. the files ── */}
            <div
              onDragOver={e => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); void takeFiles(Array.from(e.dataTransfer.files)) }}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-inner border-2 border-dashed px-4 py-7 text-center',
                over ? 'border-foreground bg-muted' : 'border-border bg-paper',
              )}
            >
              <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="text-[14px] font-semibold">Drop the photos or videos here</p>
              <p className="text-[13px] text-muted-foreground">or</p>
              <Button type="button" variant="outline" className={secondary} onClick={() => fileInput.current?.click()}>
                Choose files
              </Button>
              <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden"
                onChange={e => { void takeFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
            </div>
            {uploads.length > 0 && <UploadRows uploads={uploads} onDismiss={dismissUpload} compact />}
            {chosen.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chosen.map(s => (
                  <div key={s.url} className="relative h-16 w-16 overflow-hidden rounded-inner border border-border bg-muted">
                    {s.type === 'video'
                      ? <video src={s.url} className="h-full w-full object-cover" muted playsInline />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={s.url} alt="" className="h-full w-full object-cover" />}
                    <button type="button" aria-label={`Remove ${s.name}`}
                      onClick={() => {
                        // out of the queue too, or the effect puts it straight back
                        for (const u of uploads) if (u.url === s.url) dismissUpload(u.id)
                        setChosen(prev => prev.filter(x => x.url !== s.url))
                      }}
                      className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-ink/80 text-cream hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream">
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── 3. the name, and a line ── */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="approval-title">What is it called? <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="approval-title" value={title} onChange={e => setTitle(e.target.value)}
                placeholder={chosen[0]?.name ? chosen[0].name.replace(/\.[^.]+$/, '') : 'e.g. Spring menu reel'}
                className="rounded-inner border-border bg-surface" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="approval-note">A line for them <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <textarea id="approval-note" value={note} onChange={e => setNote(e.target.value)} rows={2}
                placeholder={manager ? 'Anything the client should know' : 'Anything the approver should know'}
                className="rounded-inner border border-border bg-surface px-3 py-2 text-[14px]" />
            </div>

            {/* ── 4. the decision ── */}
            {(!manager || asking) && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="approval-who">Who checks it?</Label>
                <select id="approval-who" value={approverId} onChange={e => setApproverId(e.target.value)}
                  className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]">
                  {approvers.length === 0 && <option value="">Nobody to ask yet</option>}
                  {approvers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {approvers.length === 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    Nobody else on this client can approve yet. Add an account manager on the client, or approve it yourself.
                  </p>
                )}
              </div>
            )}

            {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px]">{problem}</p>}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              {manager ? (
                <>
                  {asking ? (
                    <Button type="button" variant="outline" className={secondary} disabled={!ready || !approverId} onClick={() => void send('ask')}>
                      {busy === 'ask' ? 'Sending…' : `Ask ${approvers.find(p => p.id === approverId)?.name ?? 'them'} to check it`}
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" className={secondary} disabled={!ready} onClick={() => setAsking(true)}>
                      Ask somebody to check it
                    </Button>
                  )}
                  <Button type="button" variant="outline" className={secondary} disabled={!ready} onClick={() => void send('client')}>
                    {busy === 'client' ? 'Sending…' : `Send to ${client?.name ?? 'the client'}`}
                  </Button>
                  {/* the client's "signs off every post" switch no longer takes
                      this button away from a manager (the owner, 9 Sep 2026)
                      — it is the line underneath, a reminder to send it on
                      when they mean to */}
                  <Button type="button" className={primary} disabled={!ready} onClick={() => void send('approve')}>
                    {busy === 'approve' ? 'Approving…' : 'Approve — ready to post'}
                  </Button>
                </>
              ) : (
                <Button type="button" className={primary} disabled={!ready || !approverId} onClick={() => void send('ask')}>
                  {busy === 'ask' ? 'Sending…' : 'Send for approval'}
                </Button>
              )}
            </div>
            {manager && signsOff && (
              <p className="text-[12px] text-muted-foreground">{client?.name} signs off every post — send it to them unless you mean to post it yourself.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
