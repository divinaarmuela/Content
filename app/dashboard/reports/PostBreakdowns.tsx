'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmt, type MonthKey, type TopPost } from '../../lib/client-report-core'
import { postKind, readPostsExplained, type ExplainedPost, type Factor } from '../../lib/post-breakdown-core'

/**
 * WHY THE POSTS WORKED — UNLK.AI's breakdowns on the report (the owner, 27 Oct 2026). Every Instagram post of the month
 * is scored against the account's own usual (50 = a normal post); the five best and up to three that fell behind get
 * the reasons the numbers support and the AI's read of them. What is saved here also goes into the written report.
 */

const MODE_WORDS: Record<ExplainedPost['mode'], string> = { work: 'Worked', underperform: 'Fell behind', early: 'Too early to tell' }
const MODE_TONE: Record<ExplainedPost['mode'], string> = {
  work: 'bg-tint-green text-foreground', underperform: 'bg-tint-red text-foreground', early: 'bg-tint-amber text-foreground',
}
const VERDICT_TONE: Record<Factor['verdict'], string> = {
  strong: 'border-accent-green/50 bg-tint-green', likely: 'border-accent-amber/50 bg-tint-amber', 'not supported': 'border-border bg-surface',
}

export default function PostBreakdowns({ raw, clientId, month, onChange }: {
  raw: unknown
  clientId: string
  month: MonthKey
  onChange: (report: unknown) => void
}) {
  const explained = useMemo(() => readPostsExplained(raw), [raw])
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map((explained?.posts ?? []).map(p => [p.id, p])), [explained])

  const explain = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/reports/monthly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, month, action: 'explain' }) })
      const j = await r.json().catch(() => ({}))
      // the scores and reasons are kept even when the AI could not be asked
      if (j.report) onChange(j.report)
      if (!r.ok) throw new Error(j.error ?? 'Could not explain the posts')
      toast.success('Posts explained — they also go into the written report')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not explain the posts') } finally { setBusy(false) }
  }

  return (
    <section className="no-print flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-[20px] font-semibold">Why the posts worked</h2>
          <p className="text-[13px] text-muted-foreground">Each post scored against this account’s usual: 50 is a normal post, 75 about twice it, 25 about half.</p>
        </div>
        {explained?.at && <span className="text-[13px] text-muted-foreground">Explained {new Date(explained.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
        <Button onClick={() => void explain()} disabled={busy} className="h-10 gap-2 rounded-full">
          <Sparkles className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} aria-hidden />
          {busy ? 'Reading 90 days of posts…' : explained ? 'Explain again' : 'Explain the posts'}
        </Button>
      </header>

      {!explained && !busy && (
        <p className="rounded-card border border-dashed border-border p-6 text-center text-[14px] text-muted-foreground">
          Not explained yet. It reads the last 90 days of posts, so each one is compared with the account’s own normal.
        </p>
      )}

      {explained && (
        <ol className="flex flex-col gap-3">
          {explained.items.map(item => <PostCard key={item.postId} item={item} post={byId.get(item.postId)} byId={byId} />)}
        </ol>
      )}
    </section>
  )
}

function Thumb({ post, className }: { post: TopPost | undefined; className: string }) {
  return (
    <div className={`overflow-hidden bg-muted ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the platform's own picture of the post */}
      {post?.thumbnail && <img src={post.thumbnail} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />}
    </div>
  )
}

function PostCard({ item, post, byId }: { item: ExplainedPost; post: TopPost | undefined; byId: Map<string, TopPost> }) {
  const b = item.breakdown
  // a post that worked shows what lifted it; one that fell behind shows where it fell short first, then anything that
  // still went well
  const lifted = item.factors.filter(f => !f.below && f.verdict !== 'not supported')
  const short = item.factors.filter(f => f.below)
  const reasons = item.mode === 'work' ? lifted : [...short, ...lifted]
  const date = post?.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''
  const kind = post ? postKind(post) : null
  return (
    <li className="grid gap-4 rounded-card border border-border bg-surface p-4 md:grid-cols-[160px_1fr]">
      <div className="flex flex-col gap-2">
        <Thumb post={post} className="aspect-[4/5] w-full rounded-inner" />
        {post?.url && <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] underline underline-offset-4">Open the post <ExternalLink className="h-3 w-3" aria-hidden /></a>}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[28px] font-semibold leading-none tabular-nums">{item.index.score}</span>
          <span className="text-[13px] text-muted-foreground">{item.index.multiple}× a typical post</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${MODE_TONE[item.mode]}`}>{MODE_WORDS[item.mode]}</span>
          <span className="ml-auto text-[13px] text-muted-foreground">{date}{kind ? ` · ${kind}` : ''}{post ? ` · ${fmt(post.views)} views` : ''}</span>
        </div>
        {b ? <p className="text-[16px] font-semibold leading-snug">{b.verdict}</p>
          : <p className="text-[14px] text-muted-foreground">{item.error ?? 'Not explained'} — the score and the reasons below still stand.</p>}

        {reasons.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {reasons.map(f => (
              <li key={f.key} className={`rounded-inner border px-3 py-2 text-[13px] ${f.below ? 'border-accent-red/40 bg-tint-red' : VERDICT_TONE[f.verdict]}`}>
                <span className="font-semibold">{f.label}</span>
                <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{f.below ? 'below usual' : f.verdict}</span>
                <span className="block text-muted-foreground">{f.evidence}</span>
              </li>
            ))}
          </ul>
        )}

        {b && (
          <>
            {b.firstLook && <p className="text-[13px]"><span className="font-semibold">First look: </span>{b.firstLook}</p>}
            {b.whatWorked.length > 0 && (
              <div>
                <p className="text-[13px] font-semibold">{item.mode === 'work' ? 'What worked' : 'What held it back'}</p>
                <ul className="mt-1 list-disc pl-5 text-[13px]">{b.whatWorked.map(w => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            {b.vsFlops.length > 0 && (
              <details className="rounded-inner border border-border p-3">
                <summary className="cursor-pointer text-[13px] font-semibold">Best posts vs weakest posts</summary>
                <ul className="mt-2 flex flex-col gap-3">
                  {b.vsFlops.map(c => (
                    <li key={c.point} className="text-[13px]">
                      <p className="font-semibold">{c.point}</p>
                      <div className="mt-1 grid gap-2 sm:grid-cols-2">
                        <Side words={stripCodes(c.hits)} ids={c.hitIds} byId={byId} title="The best do" />
                        <Side words={stripCodes(c.flops)} ids={c.flopIds} byId={byId} title="The weakest do" />
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {b.tryThis.length > 0 && (
              <details className="rounded-inner border border-border p-3" open={item.mode !== 'work'}>
                <summary className="cursor-pointer text-[13px] font-semibold">Try next month</summary>
                <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-[13px]">{b.tryThis.map(t => <li key={t}>{t}</li>)}</ol>
              </details>
            )}
          </>
        )}
      </div>
    </li>
  )
}

/** the [P3] codes are for the model; on the page the posts are shown, not named by code */
const stripCodes = (s: string) => s.replace(/\s*\[P\d+\]/g, '').trim()

function Side({ words, ids, byId, title }: { words: string; ids: string[]; byId: Map<string, TopPost>; title: string }) {
  const posts = ids.map(id => byId.get(id)).filter((p): p is TopPost => !!p).slice(0, 4)
  return (
    <div className="rounded-inner bg-muted/50 p-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-0.5">{words}</p>
      {posts.length > 0 && (
        <div className="mt-1.5 flex gap-1.5">
          {posts.map(p => (
            <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noreferrer" title={`${fmt(p.views)} views`}>
              <Thumb post={p} className="h-12 w-10 rounded" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
