'use client'

import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  BUTTON_DM_LIMIT, BUTTON_TITLE_LIMIT, DEFAULT_KEYWORD, DM_LIMIT, MAX_VARIATIONS, NO_AUTOMATION, automationLine, dmText,
  normaliseKeywords, postAutomationProblem, withUtm,
  type AutomationStats, type PostAutomation,
} from '@/app/lib/comment-automation-core'

type RowState = { account_id: string; made: boolean; active: boolean; live: boolean; stats: AutomationStats | null }

/**
 * "AUTOMATION (COMMENT → DM)" IN THE POST WINDOW — set up while scheduling, ManyChat-style (the owner,
 * 29 Sep 2026). Part of the working copy like the caption: editable while the post is a draft, read-only
 * once it is frozen. It is made at Zernio when the post is booked, bound to THIS post only
 * (app/lib/comment-automation.ts armPostAutomations).
 */
export default function AutomationSection({
  automation, editable, onChange, clientSlug, postId, stage,
}: {
  automation: PostAutomation | null | undefined
  editable: boolean
  onChange: (next: PostAutomation) => void
  clientSlug: string | null
  postId: string | null
  stage: string | null
}) {
  const a = automation ?? NO_AUTOMATION
  const [kw, setKw] = useState(a.keywords.join(', '))
  // one per line while typing; blank lines are dropped when it is read (readVariations)
  const lines = (list: readonly string[] | undefined) => (list ?? []).join('\n')
  const split = (text: string) => text.split(/\r?\n/)
  const [rows, setRows] = useState<RowState[] | null>(null)
  const set = (patch: Partial<PostAutomation>) => onChange({ ...a, ...patch })

  const booked = stage === 'booked' || stage === 'posted'
  useEffect(() => {
    if (!postId || !booked || !automation?.on) return
    let live = true
    void fetch(`/api/social/automations?post_id=${encodeURIComponent(postId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (live && j) setRows(j.rows ?? []) })
      .catch(() => {})
    return () => { live = false }
  }, [postId, booked, automation?.on])

  const keywords = normaliseKeywords(a.keywords)
  const hasButton = !!(a.button_title && a.link)
  const tagged = a.link ? withUtm(a.link, { clientSlug: clientSlug || 'client', keyword: keywords[0] }) : null
  const finalDm = dmText(a.dm_message, tagged?.ok ? tagged.url : null, hasButton)
  const limit = hasButton ? BUTTON_DM_LIMIT : DM_LIMIT
  const problem = postAutomationProblem(a, clientSlug)

  const first = rows?.[0] ?? null
  const stats = rows?.length
    ? rows.reduce((s, r) => ({ dmsSent: s.dmsSent + (r.stats?.dmsSent ?? 0), linkClicks: s.linkClicks + (r.stats?.linkClicks ?? 0) }), { dmsSent: 0, linkClicks: 0 })
    : null
  const line = automationLine(automation ?? null, booked
    ? { made: !!first, active: rows?.some(r => r.active) ?? false, live: stage === 'posted' || !!rows?.some(r => r.live), stats }
    : null)

  const field = 'w-full rounded-inner border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground read-only:opacity-80'

  if (!editable) {
    if (!automation) return null
    return (
      <div className="flex flex-col gap-1.5 rounded-inner border border-border p-3" data-post-automation>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground"><Zap className="h-3.5 w-3.5" /> Automation (comment → DM)</span>
        {line && <span className="text-[13px]">{line}</span>}
        {automation.on && (
          <>
            <p className="whitespace-pre-line text-[13px] text-muted-foreground">{automation.dm_message}</p>
            {automation.button_title && <span className="text-[12px] text-muted-foreground">Button: {automation.button_title}</span>}
            {tagged?.ok && <code className="break-all font-mono text-[11px] text-muted-foreground">{tagged.url}</code>}
            {(automation.dm_variations ?? []).filter(t => t.trim()).length > 0 && (
              <span className="text-[12px] text-muted-foreground">Other DM texts: {(automation.dm_variations ?? []).filter(t => t.trim()).length}</span>
            )}
            {automation.comment_reply && (
              <span className="text-[12px] text-muted-foreground">
                Public reply: {[automation.comment_reply, ...(automation.reply_variations ?? []).filter(t => t.trim())].join(' / ')}
              </span>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-inner border border-border p-3" data-post-automation>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
          <Zap className="h-3.5 w-3.5" /> Automation (comment → DM)
        </span>
        <Switch checked={a.on} aria-label={a.on ? 'Turn the automation off' : 'Turn the automation on'}
          onCheckedChange={on => set({ on })} />
      </div>
      <p className="text-[12px] text-muted-foreground">
        Someone comments the keyword on THIS post and the account DMs them. It starts when the post is booked, and only ever answers on this post.
      </p>
      {a.on && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">Keyword · comma separated for more than one</span>
            <input className={field} value={kw} placeholder={DEFAULT_KEYWORD}
              onChange={e => setKw(e.target.value)}
              onBlur={() => set({ keywords: normaliseKeywords(kw) })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="flex justify-between text-[12px] text-muted-foreground">
              The DM it sends
              <span className={`font-mono tabular-nums ${(hasButton ? a.dm_message.length : finalDm.length) > limit ? 'text-accent-red' : ''}`}>
                {hasButton ? a.dm_message.length : finalDm.length}/{limit}
              </span>
            </span>
            <textarea className={field} rows={3} value={a.dm_message} placeholder="Hi! Thanks for commenting — here's the link to book a call."
              onChange={e => set({ dm_message: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">Other DM texts · optional, up to {MAX_VARIATIONS}, one per line — one is picked at random</span>
            <textarea className={field} rows={2} value={lines(a.dm_variations)}
              onChange={e => set({ dm_variations: split(e.target.value) })} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted-foreground">Link · optional</span>
              <input className={field} value={a.link ?? ''} placeholder="https://…" onChange={e => set({ link: e.target.value || null })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted-foreground">Button label · optional</span>
              <input className={field} value={a.button_title ?? ''} maxLength={BUTTON_TITLE_LIMIT} placeholder="Book a call"
                onChange={e => set({ button_title: e.target.value || null })} />
            </label>
          </div>
          {tagged && (
            <div className="rounded-inner bg-foreground/[0.04] px-2.5 py-1.5 text-[12px]">
              {tagged.ok ? (
                <>
                  <span className="font-medium">The link people get</span>
                  <span className="text-muted-foreground"> · {hasButton ? 'on the button, clicks counted' : 'at the end of the DM'}</span>
                  <code className="mt-0.5 block break-all font-mono text-[11px]">{tagged.url}</code>
                </>
              ) : <span className="text-accent-red">{tagged.error}</span>}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">Public reply under their comment · optional</span>
            <input className={field} value={a.comment_reply ?? ''} maxLength={300} placeholder="Just sent it to your DMs."
              onChange={e => set({ comment_reply: e.target.value || null })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">Other replies · optional, up to {MAX_VARIATIONS}, one per line</span>
            <textarea className={field} rows={2} value={lines(a.reply_variations)} placeholder="Check your DMs!"
              onChange={e => set({ reply_variations: split(e.target.value) })} />
          </label>
          {problem && <p className="text-[12px] text-accent-red">{problem}</p>}
        </>
      )}
    </div>
  )
}
