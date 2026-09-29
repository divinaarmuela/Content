'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { STAGE_LABEL, type NowLike, type PostState } from '../../../lib/post-stage-core'
import { roundCandidates } from '../../../lib/post-board-core'
import { defaultRecipients, type ClientRecipient } from '../../../lib/client-recipients-core'
import type { BoardPost } from './usePostBoard'

/**
 * SEND SEVERAL POSTS TO ONE CLIENT IN ONE EMAIL (the owner's decision 15:
 * "one batched email per round, not one per post").
 *
 * For each client with two or more posts that can go to them right now (a
 * pass at the quality check, or a Send to client once passed), the person
 * ticks the posts and the people, and presses one button. The server checks
 * and claims every post first; if any of them cannot go, nothing is sent.
 * The email lists every post and opens on the client's page of everything
 * waiting on them. Presentation only: the rules are the server's.
 */
export default function ClientRound({ posts, now, choicesFor }: {
  posts: readonly BoardPost[]
  now: NowLike
  choicesFor: (post: Pick<PostState, 'client_id'>) => ClientRecipient[]
}) {
  const groups = useMemo(() => roundCandidates(posts, now).filter(g => g.posts.length >= 2), [posts, now])
  if (groups.length === 0) return null
  return (
    <section aria-label="Send several posts to a client in one email" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div>
        <h2 className="text-[15px] font-semibold">Send several to the client in one email</h2>
        <p className="text-[13px] text-muted-foreground">The client gets one email listing every post you tick, with one link to all of them.</p>
      </div>
      {groups.map(g => <RoundForClient key={g.clientId} group={g} choices={choicesFor({ client_id: g.clientId })} />)}
    </section>
  )
}

function RoundForClient({ group, choices }: {
  group: { clientId: string; clientName: string; posts: { bp: BoardPost; label: string }[] }
  choices: ClientRecipient[]
}) {
  const [open, setOpen] = useState(false)
  const [ticked, setTicked] = useState<string[]>(() => group.posts.map(p => p.bp.post.id))
  const [picks, setPicks] = useState<string[]>(() => defaultRecipients(choices))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const chosen = group.posts.filter(p => ticked.includes(p.bp.post.id))
  const send = async () => {
    setAnswer(null)
    if (chosen.length === 0) { setAnswer({ tone: 'error', text: 'Tick at least one post.' }); return }
    if (choices.length === 0) { setAnswer({ tone: 'error', text: 'This client has no email address yet. Add one on the client’s page first.' }); return }
    if (picks.length === 0) { setAnswer({ tone: 'error', text: 'Tick at least one person to send it to.' }); return }
    setBusy(true)
    try {
      const res = await fetch('/api/posts/round', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: group.clientId,
          posts: chosen.map(p => ({ post_id: p.bp.post.id, expect_rev: p.bp.post.rev, version: p.bp.post.sent_version })),
          send_to: picks,
          note: note.trim() || null,
        }),
      })
      const json = await res.json().catch(() => null) as
        | { ok: true; message: string; results: { post_id: string; ok: boolean; words: string }[] }
        | { ok: false; reason: string } | null
      if (json && json.ok) {
        const stuck = json.results.filter(r => !r.ok)
        const text = stuck.length === 0 ? json.message : `${json.message} ${stuck.map(r => r.words).join(' ')}`
        setAnswer({ tone: stuck.length === 0 ? 'ok' : 'error', text })
        if (stuck.length === 0) { toast.success(json.message); setOpen(false) }
      } else {
        setAnswer({ tone: 'error', text: json && 'reason' in json ? json.reason : 'That did not go through. Nothing was sent — try again.' })
      }
    } catch {
      setAnswer({ tone: 'error', text: 'Could not reach the server. Nothing was sent — try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-inner border border-border p-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-[14px] font-semibold">
        <span>{group.clientName} · {group.posts.length} posts can go to the client</span>
        <span className="text-[13px] font-normal text-muted-foreground">{open ? 'Close' : 'Choose'}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-semibold">Posts in this email</legend>
            {group.posts.map(({ bp, label }) => (
              <label key={bp.post.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-inner border border-border bg-surface px-3 text-[14px]">
                <input type="checkbox" className="h-4 w-4 accent-foreground" checked={ticked.includes(bp.post.id)}
                  onChange={e => setTicked(t => (e.target.checked ? [...t, bp.post.id] : t.filter(x => x !== bp.post.id)))} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{bp.face.title}</span>
                  <span className="truncate text-[12px] text-muted-foreground">{STAGE_LABEL[bp.post.stage]} · {label}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-semibold">Email it to</legend>
            {choices.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">This client has no email address yet. Add one on the client’s page first.</p>
            ) : choices.map(c => (
              <label key={c.email} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-inner border border-border bg-surface px-3">
                <input type="checkbox" className="h-4 w-4 accent-foreground" checked={picks.includes(c.email)}
                  onChange={e => setPicks(p => (e.target.checked ? [...p, c.email] : p.filter(x => x !== c.email)))} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] font-medium">{c.name}</span>
                  <span className="truncate text-[12px] text-muted-foreground">{c.label} · {c.email}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            A note for the client (optional)
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className="rounded-inner border-border bg-surface font-normal" />
          </label>
          {/* the answer sits right above the button that sent it (decision 2) */}
          {answer && (
            <p role={answer.tone === 'error' ? 'alert' : 'status'}
              className={`rounded-inner px-3 py-2 text-[13px] ${answer.tone === 'error' ? 'bg-tint-red' : 'bg-tint-green'}`}>{answer.text}</p>
          )}
          <div className="flex justify-end">
            <Button disabled={busy} onClick={() => void send()}
              className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60">
              {busy ? 'Sending…' : `Send ${chosen.length} ${chosen.length === 1 ? 'post' : 'posts'} in one email`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
