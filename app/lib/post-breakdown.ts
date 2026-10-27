import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { table } from '@/lib/db'
import type { ClientReport } from '@/lib/db-types'
import { monthRange, readReportData, reportId, type MonthKey, type TopPost } from './client-report-core'
import { accountsOf, postsBetween } from './client-report'
import {
  BREAKDOWN_SYSTEM, BREAKDOWN_TOOL, buildBreakdownPrompt, codesFor, evidenceFor, indexPosts, pickComparison, postKind,
  postsToExplain, tidyBreakdown, type ExplainedPost, type PostsExplained,
} from './post-breakdown-core'

/**
 * THE POST BREAKDOWNS — the server half (post-breakdown-core.ts has the why). For one client's month: every Instagram
 * post of the month and the 90 days before it, read from Zernio (read only), scored against the account's own normal;
 * the five best and up to three that fell behind each get their ranked reasons and Claude's breakdown, kept on the
 * month's report (`client_reports.posts_explained`). The numbers are kept even when Claude cannot be asked.
 */

const MODEL = 'claude-opus-5-5'
const HISTORY_DAYS = 90
const anthropic = new Anthropic()

const minusDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10)

/** what Claude's account says, in words — the same wording the report's Generate uses */
function said(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/credit balance is too low/i.test(m)) return 'The Anthropic account is out of credit — top it up under Plans & Billing at console.anthropic.com'
  if (e instanceof Anthropic.RateLimitError) return 'Claude is busy right now — try again in a minute'
  if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key is not valid — check ANTHROPIC_API_KEY'
  return `Claude could not explain this post: ${m.slice(0, 200)}`
}

async function ask(prompt: string, pictures: string[]): Promise<{ ok: true; input: unknown } | { ok: false; error: string }> {
  const call = (withPictures: boolean) => anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: BREAKDOWN_SYSTEM,
    tools: [BREAKDOWN_TOOL],
    tool_choice: { type: 'tool', name: BREAKDOWN_TOOL.name },
    messages: [{
      role: 'user',
      content: [
        ...(withPictures ? pictures.map(url => ({ type: 'image' as const, source: { type: 'url' as const, url } })) : []),
        { type: 'text' as const, text: withPictures || !pictures.length ? prompt : `${prompt}\n\n(The pictures could not be loaded: judge from the numbers and the caption only, and leave firstLook empty.)` },
      ],
    }],
  })
  let msg
  try {
    msg = await call(pictures.length > 0)
  } catch (e) {
    // Instagram's picture links expire: a picture Claude cannot fetch must not lose the breakdown
    if (pictures.length && e instanceof Anthropic.BadRequestError && /image|url|fetch|download/i.test(e.message)) {
      try { msg = await call(false) } catch (e2) { return { ok: false, error: said(e2) } }
    } else return { ok: false, error: said(e) }
  }
  if (msg.stop_reason === 'refusal') return { ok: false, error: 'Claude declined to explain this post' }
  const use = msg.content.find(b => b.type === 'tool_use')
  if (!use || use.type !== 'tool_use') return { ok: false, error: 'Claude returned no breakdown — try again' }
  return { ok: true, input: use.input }
}

/** run `f` over `xs`, `n` at a time */
async function inBatches<T, R>(xs: readonly T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < xs.length; i += n) out.push(...await Promise.all(xs.slice(i, i + n).map(f)))
  return out
}

export async function explainMonth(clientId: string, m: MonthKey): Promise<{ ok: true; explained: PostsExplained } | { ok: false; error: string }> {
  const ig = (await accountsOf(clientId)).find(a => a.platform === 'instagram')
  if (!ig) return { ok: false, error: 'This client has no Instagram account connected in Zernio' }
  const id = reportId(clientId, m)
  const saved = await table<ClientReport>('client_reports').get(id)
  const data = readReportData(saved?.data)
  const followers = data?.platforms.find(p => p.platform === 'instagram')?.followers.end ?? null

  const { from, to } = monthRange(m)
  const history = await postsBetween(ig, minusDays(from, HISTORY_DAYS), to)
  const inMonth = (p: TopPost) => { const d = (p.publishedAt ?? '').slice(0, 10); return d >= from && d <= to }
  const month = history.filter(inMonth)
  if (!month.length) return { ok: false, error: 'No Instagram posts this month to explain' }
  const index = indexPosts(history)
  const chosen = postsToExplain(month, index)
  if (!chosen.length) return { ok: false, error: 'Not enough posts yet to compare them with the account’s usual' }

  const items: ExplainedPost[] = await inBatches(chosen, 3, async ({ post, mode }) => {
    const factors = evidenceFor(post, history, followers, index)
    const { hits, flops } = pickComparison(history, post.id, index)
    const codes = codesFor([post, ...hits, ...flops])
    const prompt = buildBreakdownPrompt({ post, mode, account: `@${ig.handle ?? 'the account'}`, followers, index, hits, flops, factors, codes })
    const pictures = postKind(post) === 'carousel' && post.images?.length ? post.images.slice(0, 3) : post.thumbnail ? [post.thumbnail] : []
    const base = { postId: post.id, mode, index: index.get(post.id)!, factors }
    const r = await ask(prompt, pictures)
    if (!r.ok) return { ...base, breakdown: null, error: r.error }
    const breakdown = tidyBreakdown(r.input, codes)
    return breakdown ? { ...base, breakdown } : { ...base, breakdown: null, error: 'Claude’s answer could not be read — try again' }
  })

  // the posts each breakdown names (the explained ones and every hit and flop they cite), so the page can show them
  // without reading Zernio again
  const named = new Set(items.flatMap(i => [i.postId, ...(i.breakdown?.vsFlops ?? []).flatMap(c => [...c.hitIds, ...c.flopIds])]))
  const explained: PostsExplained = {
    at: new Date().toISOString(),
    model: MODEL,
    items,
    posts: history.filter(p => named.has(p.id)).map(p => ({ ...p, images: undefined })),
  }
  const now = explained.at
  await table<ClientReport>('client_reports').claim(id, cur => ({
    ...(cur ?? { id, client_id: clientId, month: m, created_at: now }), posts_explained: explained as never, updated_at: now,
  } as ClientReport))
  // every post failed the same way (no credit, a bad key): say that one thing
  const errors = [...new Set(items.filter(i => !i.breakdown).map(i => i.error))]
  if (items.every(i => !i.breakdown) && errors.length === 1) return { ok: false, error: `${errors[0]} — the scores and reasons are saved` }
  return { ok: true, explained }
}
