'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { networkName } from '../../../lib/publish-core'
import type { AccountRef } from '../../../lib/post-stage-core'
import { plannerSaves, spreadTimes, spreadWords } from '../../../lib/post-batch-core'
import { BATCH_CHECK_LINE } from '../../../lib/post-window-core'
import { postAct } from '../../../lib/post-act-contract'
import { DEFAULT_TZ, formatInZone } from '../../../lib/timezone-core'
import type { BoardPost } from './usePostBoard'

/**
 * THE BATCH PLANNER (the owner, 1 Oct 2026): one card handed over is a batch of draft posts — eight
 * clips, eight posts. Instead of opening eight windows, the scheduler sets the channels ONCE, spreads
 * the times ("one a day at 9:00 am from Monday"), writes the captions in one list, and presses
 * "Send all for quality check".
 *
 * NO SECOND STATE MACHINE. For each draft, in batch order, it calls exactly what the post window
 * calls: the working-copy save (`PATCH /api/social/schedule/<id>`, which judges the composition) and
 * then the one act route with `send_to_qc` (post-stage.ts, the one writer of a stage). A post the
 * server refuses keeps its refusal beside its caption; the others go on.
 */

type Row = { id: string; status: 'waiting' | 'saving' | 'sent' | 'saved' | 'refused'; note: string | null }

const EVERY: { value: number; label: string }[] = [
  { value: 1, label: 'One a day' },
  { value: 2, label: 'Every 2 days' },
  { value: 3, label: 'Every 3 days' },
  { value: 7, label: 'One a week' },
]

const field = 'h-11 rounded-full border-border bg-surface px-4 text-[15px]'

export function BatchPlanner({ title, posts, channels, zone, onClose }: {
  /** "WALK TEST · 8 posts"; null = closed */
  title: string | null
  /** the batch, in batch order — only its drafts are planned */
  posts: readonly BoardPost[]
  /** this client's connected channels; null while they load */
  channels: readonly AccountRef[] | null
  /** the client's time zone — every time here is the client's */
  zone: string | null
  onClose: () => void
}) {
  const open = title !== null
  const drafts = useMemo(() => posts.filter(bp => bp.post.stage === 'draft'), [posts])
  const [chosen, setChosen] = useState<string[]>([])
  const [start, setStart] = useState('')
  const [time, setTime] = useState('09:00')
  const [every, setEvery] = useState(1)
  const [captions, setCaptions] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [busy, setBusy] = useState(false)

  // opened on a batch: the captions as they are, and the channels the drafts already share
  useEffect(() => {
    if (!open) return
    setCaptions(drafts.map(bp => bp.post.caption))
    const first = drafts[0]?.post.channels ?? []
    setChosen(drafts.every(bp => bp.post.channels.join(',') === first.join(',')) ? [...first] : [])
    setRows({})
  }, [open, title])

  const live = (channels ?? []).filter(a => a.live !== false)
  const toggle = (id: string) => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]))
  const plan = { start, time, count: drafts.length, everyDays: every, zone }
  const times = start && time ? spreadTimes(plan) : null
  const said = start && time ? spreadWords(plan) : null

  const run = async (send: boolean) => {
    if (drafts.length === 0) return
    setBusy(true)
    const saves = plannerSaves(drafts.map(bp => ({ id: bp.post.id, stage: bp.post.stage })), { channels: chosen, times, captions })
    let ok = 0
    for (const save of saves) {
      const bp = drafts.find(d => d.post.id === save.postId)!
      setRows(r => ({ ...r, [save.postId]: { id: save.postId, status: 'saving', note: null } }))
      const refuse = (note: string) => setRows(r => ({ ...r, [save.postId]: { id: save.postId, status: 'refused', note } }))
      try {
        const { postId, ...body } = save
        const res = await fetch(`/api/social/schedule/${encodeURIComponent(postId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, expect_rev: bp.post.rev }),
        })
        const json = await res.json().catch(() => ({})) as { post?: { rev?: number }; error?: string; problems?: string[] }
        if (!res.ok) { refuse(json.problems?.[0] ?? json.error ?? 'Could not save this post'); continue }
        if (!send) {
          ok++
          setRows(r => ({ ...r, [postId]: { id: postId, status: 'saved', note: null } }))
          continue
        }
        const moved = await postAct(postId, { action: 'send_to_qc', expect_rev: typeof json.post?.rev === 'number' ? json.post.rev : bp.post.rev + 1 })
        if (!moved.ok) { refuse(moved.reason); continue }
        ok++
        setRows(r => ({ ...r, [postId]: { id: postId, status: 'sent', note: null } }))
      } catch {
        refuse('Could not reach the server — nothing changed on this one. Try again.')
      }
    }
    setBusy(false)
    const total = saves.length
    if (ok === total) {
      toast.success(send ? `${total} post${total === 1 ? '' : 's'} sent for the quality check` : `${total} post${total === 1 ? '' : 's'} saved`)
      onClose()
    } else {
      toast.error(`${ok} of ${total} went through — the others say why below`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-popover sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plan {title}</DialogTitle>
          <DialogDescription>
            Set it once for every draft in this batch. {BATCH_CHECK_LINE}
          </DialogDescription>
        </DialogHeader>

        {drafts.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">Every post in this batch has been sent already — open one to change it.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* ── channels, once for all ── */}
            <div className="flex flex-col gap-2">
              <Label>Channels — for all {drafts.length}</Label>
              {channels === null ? (
                <p className="text-[13px] text-muted-foreground">Loading the channels…</p>
              ) : live.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">This client has no connected channels yet — connect one on the Schedule page’s Accounts first.</p>
              ) : (
                <div role="group" aria-label="Channels for every post" className="flex flex-wrap gap-2">
                  {live.map(a => {
                    const on = chosen.includes(a.id)
                    return (
                      <button key={a.id} type="button" aria-pressed={on} disabled={busy} onClick={() => toggle(a.id)}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-[14px] ${on ? 'border-accent-blue/25 bg-tint-blue text-foreground' : 'border-border text-muted-foreground hover:bg-foreground/[0.04]'}`}>
                        {networkName(a.platform)}{a.name ? ` · ${a.name}` : ''}
                        {on && <Check className="h-4 w-4" aria-hidden />}
                      </button>
                    )
                  })}
                </div>
              )}
              {chosen.length === 0 && channels !== null && live.length > 0 && (
                <p className="text-[13px] text-muted-foreground">None picked: each post keeps the channels it has.</p>
              )}
            </div>

            {/* ── spread the times ── */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="batch-start">Spread the times</Label>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="How often" value={every} disabled={busy} onChange={e => setEvery(Number(e.target.value))}
                  className="h-11 rounded-full border border-border bg-surface px-3 text-[14px]">
                  {EVERY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="text-[14px] text-muted-foreground">at</span>
                <Input aria-label="Time" type="time" value={time} disabled={busy} onChange={e => setTime(e.target.value)} className={`${field} w-[130px]`} />
                <span className="text-[14px] text-muted-foreground">from</span>
                <Input id="batch-start" type="date" value={start} disabled={busy} onChange={e => setStart(e.target.value)} className={`${field} w-[170px]`} />
              </div>
              <p className="text-[13px] text-muted-foreground">
                {said ? `${said} — in the client’s time${zone ? ` (${zone})` : ''}.` : 'No date picked: each post keeps the time it has.'}
              </p>
            </div>

            {/* ── captions, in a list ── */}
            <div className="flex flex-col gap-3">
              <Label>Captions</Label>
              {drafts.map((bp, i) => {
                const row = rows[bp.post.id]
                return (
                  <div key={bp.post.id} className="flex flex-col gap-1.5">
                    <p className="text-[13px] font-semibold">
                      {bp.face.title}
                      {bp.post.slides[0]?.name ? <span className="font-normal text-muted-foreground"> · {bp.post.slides[0].name}</span> : null}
                      {times?.[i] && <span className="font-normal text-muted-foreground"> · {formatInZone(times[i], zone ?? DEFAULT_TZ, 'full')}</span>}
                    </p>
                    <Textarea aria-label={`Caption for ${bp.face.title}`} rows={3} value={captions[i] ?? ''} disabled={busy}
                      onChange={e => setCaptions(c => { const n = [...c]; n[i] = e.target.value; return n })}
                      className="rounded-[20px] border-border bg-surface px-4 py-3" />
                    {row && row.status !== 'waiting' && (
                      <p role={row.status === 'refused' ? 'alert' : undefined}
                        className={`text-[13px] ${row.status === 'refused' ? 'font-medium text-accent-red-deep' : 'text-muted-foreground'}`}>
                        {row.status === 'saving' ? 'Saving…' : row.status === 'sent' ? 'Sent for the quality check' : row.status === 'saved' ? 'Saved' : row.note}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy || drafts.length === 0} onClick={() => void run(false)} className="min-h-11 rounded-full px-5">
            Save all
          </Button>
          <Button disabled={busy || drafts.length === 0} onClick={() => void run(true)} className="min-h-11 rounded-full px-5">
            {busy ? 'Working…' : `Send all ${drafts.length} for quality check`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
