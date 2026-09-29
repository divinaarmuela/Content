'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AGREED_VIA, AGREED_VIA_WORDS, APPROVAL_STEPS, APPROVAL_STEPS_LABEL, ROW_OF, approvalStepsOf, defaultApproveBy, isReminderSend,
  type AgreedVia, type ApprovalSteps, type OfferedAction, type PostState,
} from '../../../lib/post-stage-core'
import { postAct, type PostActRequest } from '../../../lib/post-act-contract'
import { postWindowHref } from '../../../lib/post-board-core'
import { defaultRecipients, type ClientRecipient } from '../../../lib/client-recipients-core'
import { SCHEDULE_PAGE } from '../../../lib/page-access-core'
import { DEFAULT_TZ, fromZonedInput, toZonedInput } from '../../../lib/timezone-core'

/**
 * PRESSING A POST'S BUTTON — the one place a move is sent, on this page.
 *
 * Every button on the board, every Move entry, every drop and every Waiting
 * row comes here with an `OfferedAction` from `boardActions`. A move that
 * needs words (a note, who makes the change, how the client agreed, who to
 * email, a new time, a yes to a question) asks for them in a dialog first;
 * the dialog's own error sits beside its button (the owner's decision 2).
 *
 * The move is ONE request to `POST /api/posts/<id>/act` (package P1). The
 * answer carries the post as the server now holds it; the toast is the
 * server's words, built from the stage the post LANDED in (audit B9), never a
 * guess made here. A refusal is shown next to the button that was pressed and
 * the live listener redraws the card from the database.
 */

/** Who can be asked to make a change: the people in the posting flow. */
export type Assignee = { id: string; name: string }

export type PostActDeps = {
  /** the client's addresses for a send (`clientRecipients`) */
  choicesFor: (post: PostState) => ClientRecipient[]
  /** people who can be asked to make a change */
  assignees: readonly Assignee[]
  /** the name of a person, for the dialog's default */
  nameOf: (id: string | null | undefined) => string | null
  /** the client's own approval setting — the steps dialog opens on what the card says (review fix) */
  clientOf?: (post: PostState) => { client_approval_required?: boolean | null } | null
}

type Pending = { post: PostState; action: OfferedAction } | null

const INPUT_NEEDS = ['note', 'agreed_via', 'assign_to', 'recipients', 'time', 'steps', 'confirm'] as const

/** Does this press ask a question before it goes? */
export function needsDialog(action: OfferedAction): boolean {
  return action.needs.some(n => (INPUT_NEEDS as readonly string[]).includes(n)) || action.confirm !== null
}

export function usePostActs(deps: PostActDeps): {
  busyId: string | null
  /** the refusal for this post's last press — drawn beside its buttons */
  errorFor: (postId: string) => string | null
  press: (post: PostState, action: OfferedAction) => void
  dialogs: React.ReactNode
} {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Pending>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  /** one request; null when it went through, else the sentence saying why not */
  const send = useCallback(async (post: PostState, action: OfferedAction, extra: Partial<PostActRequest> = {}): Promise<string | null> => {
    const row = ROW_OF[action.action]
    const body: PostActRequest = {
      action: action.action,
      expect_rev: post.rev,
      ...(row.versioned && post.sent_version != null ? { version: post.sent_version } : {}),
      ...extra,
    }
    setBusyId(post.id)
    setErrors(e => { const { [post.id]: _gone, ...rest } = e; return rest })
    try {
      const json = await postAct(post.id, body)
      if (json.ok) {
        // back to Draft to be changed: the change is made in the post window
        const reopen = (action.action === 'edit' || action.action === 'rebook') && json.stage === 'draft'
        if (json.link) {
          // a send by link: the link is theirs to paste — shown, and copied when the browser allows it
          void navigator.clipboard?.writeText(json.link).catch(() => {})
          toast.success(`${json.words}. The link is copied — paste it to the client.`, { description: json.link, duration: 20_000 })
          return null
        }
        toast.success(json.words, reopen ? {
          action: { label: 'Open it', onClick: () => { window.location.assign(postWindowHref(json.post ?? post, SCHEDULE_PAGE)) } },
        } : undefined)
        return null
      }
      setErrors(e => ({ ...e, [post.id]: json.reason }))
      toast.error(json.reason)
      return json.reason
    } finally {
      setBusyId(null)
    }
  }, [])

  const press = useCallback((post: PostState, action: OfferedAction) => {
    if (action.blocked) {
      // a stopped button is drawn disabled with its reason; a drop or a menu
      // entry that reaches here says the same reason where it was pressed
      setErrors(e => ({ ...e, [post.id]: action.blocked! }))
      toast.error(action.blocked)
      return
    }
    if (needsDialog(action)) { setDialogError(null); setPending({ post, action }); return }
    void send(post, action)
  }, [send])

  const submit = useCallback(async (extra: Partial<PostActRequest>) => {
    if (!pending) return
    setDialogError(null)
    const refused = await send(pending.post, pending.action, extra)
    if (refused === null) setPending(null)
    else setDialogError(refused)
  }, [pending, send])

  const dialogs = (
    <PostActDialog
      pending={pending}
      busy={pending !== null && busyId === pending.post.id}
      error={dialogError}
      deps={deps}
      onClose={() => { if (busyId === null) setPending(null) }}
      onSubmit={extra => void submit(extra)}
    />
  )

  return { busyId, errorFor: id => errors[id] ?? null, press, dialogs }
}

const primaryBtn = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60'
const quietBtn = 'h-11 rounded-full px-4 text-[14px] font-semibold'
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The words at the top of the dialog, per move. */
const DIALOG_WORDS: Partial<Record<string, string>> = {
  ask_change: 'Say what needs changing and who makes the change. They are told, in your words. The client never sees this note.',
  approve_for_client: 'The client said yes to this version somewhere else. Say how, so the record is true. It is saved as your approval for the client — never as the client’s own.',
  pass_send_client: 'This passes the quality check and emails the client a link to this version. It moves only once an email has gone out.',
  send_to_client: 'This emails the client a link to this version. It moves only once an email has gone out.',
  resend_new_time: 'Pick the new time. The client is emailed this version again, with the new time.',
  remind_client: 'The client is emailed the same version again, as a reminder. Nothing else changes — the posting time and the answer-by time stay as they are.',
  set_steps: 'Choose who approves this post. The client’s usual setting is the default.',
  team_decides: 'The team approves this version without waiting for the client. The client’s page will say the team decided it — never that they approved it.',
  change_time: 'Pick the new time. The files and words stay as they are, so nothing is checked again.',
}

/**
 * THE QUESTION BEFORE A PRESS — one dialog, its fields chosen by what the
 * move needs (`OfferedAction.needs`). The error from the server is drawn
 * directly above the button that sent it.
 */
function PostActDialog({ pending, busy, error, deps, onClose, onSubmit }: {
  pending: Pending
  busy: boolean
  error: string | null
  deps: PostActDeps
  onClose: () => void
  onSubmit: (extra: Partial<PostActRequest>) => void
}) {
  const post = pending?.post ?? null
  const action = pending?.action ?? null
  const needs = useMemo(() => new Set<string>(action?.needs ?? []), [action])
  const zone = post?.timezone || DEFAULT_TZ
  const { choicesFor } = deps
  const choices = useMemo(() => (post && needs.has('recipients') ? choicesFor(post) : []), [post, needs, choicesFor])

  const [note, setNote] = useState('')
  const [assignTo, setAssignTo] = useState('')
  const [agreed, setAgreed] = useState<AgreedVia | ''>('')
  const [picks, setPicks] = useState<string[]>([])
  const [when, setWhen] = useState('')
  const [steps, setSteps] = useState<ApprovalSteps>('team')
  const [byLink, setByLink] = useState(false)
  const [answerBy, setAnswerBy] = useState('')
  const [local, setLocal] = useState<string | null>(null)

  // a fresh question each time the dialog opens — and only then, so what the
  // person is typing is never wiped by a live update behind the dialog
  useEffect(() => {
    if (!pending) return
    const p = pending.post
    setNote('')
    setAssignTo(p.created_by ?? '')
    setAgreed('')
    setPicks(pending.action.needs.includes('recipients') ? defaultRecipients(choicesFor(p)) : [])
    setWhen(p.scheduled_for ? toZonedInput(p.scheduled_for, p.timezone || DEFAULT_TZ) : '')
    // what the card's chip says: this post's own choice, else the client's default — never "team" by guess
    setSteps(approvalStepsOf(p, deps.clientOf?.(p) ?? null))
    setByLink(false)
    // a resend picks a new posting time, so its answer-by starts empty: the server then takes the
    // default from the NEW time
    // a reminder keeps the answer-by the client already has, so it asks for none
    const by = pending.action.action === 'resend_new_time' || isReminderSend(pending.action.action) ? null : defaultApproveBy(p.scheduled_for, new Date())
    setAnswerBy(by ? toZonedInput(by, p.timezone || DEFAULT_TZ) : '')
    setLocal(null)
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!post || !action) return null
  const reminder = isReminderSend(action.action)

  const go = () => {
    setLocal(null)
    const extra: Partial<PostActRequest> = {}
    if (needs.has('note')) {
      const n = note.trim()
      const noteRequired = action.action !== 'approve_for_client' || agreed === 'other'
      if (!n && noteRequired) {
        setLocal(action.action === 'approve_for_client' ? 'Say how the client agreed.'
          : action.action === 'team_decides' ? 'Say why the team is deciding without the client.' : 'Say what needs changing.')
        return
      }
      if (n) extra.note = n
    }
    if (needs.has('assign_to')) {
      if (!assignTo) { setLocal('Choose who should make the change.'); return }
      extra.assign_to = assignTo
    }
    if (needs.has('agreed_via')) {
      if (!agreed) { setLocal('Say how the client agreed.'); return }
      extra.agreed_via = agreed
    }
    if (needs.has('recipients')) {
      if (byLink && !reminder) {
        extra.via = 'link'
      } else {
        if (choices.length === 0) { setLocal('This client has nobody to email. Copy the link instead, or add a contact on the client’s page first.'); return }
        if (picks.length === 0) { setLocal('Tick at least one person to send it to.'); return }
        extra.send_to = picks
        extra.via = 'email'
      }
      if (answerBy && !reminder) {
        const iso = fromZonedInput(answerBy, zone)
        if (!iso) { setLocal('Pick when the client should answer by.'); return }
        extra.approve_by = iso
      }
    }
    if (needs.has('time')) {
      const iso = fromZonedInput(when, zone)
      if (!iso) { setLocal('Pick the new time.'); return }
      extra.scheduled_for = iso
    }
    if (needs.has('steps')) extra.steps = steps
    if (needs.has('confirm') || action.confirm) extra.confirm = true
    onSubmit(extra)
  }

  const shownError = local ?? error
  const onlyConfirm = [...needs].every(n => n === 'confirm')
  const intro = DIALOG_WORDS[action.action] ?? action.confirm ?? null

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          {intro && <DialogDescription>{intro}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {needs.has('agreed_via') && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-semibold">How did the client agree?</legend>
              <div className="flex flex-wrap gap-2">
                {AGREED_VIA.map(v => (
                  <label key={v} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] ${agreed === v ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface'}`}>
                    <input type="radio" name="agreed-via" value={v} checked={agreed === v} onChange={() => setAgreed(v)} className="sr-only" />
                    {cap(AGREED_VIA_WORDS[v])}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {needs.has('recipients') && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-semibold">Email it to</legend>
              {choices.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">This client has no email address yet. Copy the link instead, or add one on the client’s page.</p>
              ) : choices.map(c => (
                <label key={c.email} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-inner border border-border bg-surface px-3">
                  <input type="checkbox" className="h-4 w-4 accent-foreground" checked={picks.includes(c.email)} disabled={byLink}
                    onChange={e => setPicks(p => (e.target.checked ? [...p, c.email] : p.filter(x => x !== c.email)))} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[14px] font-medium">{c.name}</span>
                    <span className="truncate text-[12px] text-muted-foreground">{c.label} · {c.email}</span>
                  </span>
                </label>
              ))}
              {!reminder && (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1 text-[14px]">
                  <input type="checkbox" className="h-4 w-4 accent-foreground" checked={byLink} onChange={e => setByLink(e.target.checked)} />
                  Copy the link instead — I will send it myself
                </label>
              )}
            </fieldset>
          )}

          {needs.has('recipients') && !reminder && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="post-act-answer-by">The client answers by</Label>
              <input id="post-act-answer-by" type="datetime-local" value={answerBy} onChange={e => setAnswerBy(e.target.value)}
                className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]" />
              <p className="text-[12px] text-muted-foreground">After this, the client can no longer approve it, and the post shows it needs a new time. Reminders go to the account manager 24 hours and 1 hour before. Left empty, it is two hours before the posting time.</p>
            </div>
          )}

          {needs.has('time') && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="post-act-time">New posting time</Label>
              <input id="post-act-time" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
                className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]" />
              <p className="text-[12px] text-muted-foreground">In the client’s time zone ({zone}). At least 15 minutes from now.</p>
            </div>
          )}

          {needs.has('steps') && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-semibold">Who approves it</legend>
              {APPROVAL_STEPS.map(s => (
                <label key={s} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-inner border border-border bg-surface px-3 text-[14px]">
                  <input type="radio" name="approval-steps" className="h-4 w-4 accent-foreground" checked={steps === s} onChange={() => setSteps(s)} />
                  {APPROVAL_STEPS_LABEL[s]}
                </label>
              ))}
            </fieldset>
          )}

          {needs.has('assign_to') && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="post-act-assign">Who makes the change</Label>
              <select id="post-act-assign" value={assignTo} onChange={e => setAssignTo(e.target.value)}
                className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]">
                <option value="">Choose a person</option>
                {post.created_by && !deps.assignees.some(a => a.id === post.created_by) && (
                  <option value={post.created_by}>{deps.nameOf(post.created_by) ?? 'The person who made it'}</option>
                )}
                {deps.assignees.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.id === post.created_by ? ' (made it)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {needs.has('note') && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="post-act-note">
                {action.action === 'approve_for_client'
                  ? agreed === 'other' ? 'How the client agreed' : 'A note (optional)'
                  : action.action === 'team_decides' ? 'Why the team is deciding' : 'What needs changing'}
              </Label>
              <Textarea id="post-act-note" rows={3} value={note} onChange={e => setNote(e.target.value)}
                autoFocus={!needs.has('agreed_via')} className="rounded-inner border-border bg-surface" />
              {action.action === 'ask_change' && (
                <p className="text-[12px] text-muted-foreground">Team only — the client never sees this.</p>
              )}
            </div>
          )}
        </div>

        {/* the answer sits right above the button that sent it (decision 2) */}
        {shownError && (
          <p role="alert" className="rounded-inner bg-tint-red px-3 py-2 text-[13px] text-foreground">{shownError}</p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className={quietBtn} disabled={busy} onClick={onClose}>
            {onlyConfirm ? 'Keep it' : 'Never mind'}
          </Button>
          <Button className={primaryBtn} disabled={busy} onClick={go}>
            {busy ? 'Working…' : action.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
