import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

/**
 * WHICH AI THE REPORTS USE (the owner, 27 Oct 2026: "use the keys from unlk"). UNLK.AI runs its AI through Vercel's
 * AI Gateway; with `AI_GATEWAY_API_KEY` set, so do the reports — the gateway speaks Anthropic's Messages API
 * (checked live: tools, inline pictures and streaming), so the same SDK calls go to `ai-gateway.vercel.sh` with the
 * gateway's model names. Without it, Anthropic directly, as before.
 *
 * The models, each overridable by env:
 *   REPORT_POSTS_MODEL   the post breakdowns — Qwen 3.7 Plus by default, UNLK's own model (about $0.001 a post)
 *   REPORT_WRITER_MODEL  the written client report — Claude Sonnet 5.5 by default: it goes to the client
 */

const GATEWAY = 'https://ai-gateway.vercel.sh'

export function viaGateway(): boolean {
  return !!process.env.AI_GATEWAY_API_KEY?.trim()
}

let client: Anthropic | null = null
export function aiClient(): Anthropic {
  if (client) return client
  const key = process.env.AI_GATEWAY_API_KEY?.trim()
  client = key ? new Anthropic({ apiKey: key, baseURL: GATEWAY }) : new Anthropic()
  return client
}

export function postsModel(): string {
  return process.env.REPORT_POSTS_MODEL?.trim() || (viaGateway() ? 'alibaba/qwen3.7-plus' : 'claude-opus-5-5')
}
export function writerModel(): string {
  return process.env.REPORT_WRITER_MODEL?.trim() || (viaGateway() ? 'anthropic/claude-sonnet-5.5' : 'claude-opus-5-5')
}

/** what the AI's account says, in words — a top-up is a person's job, not a retry */
export function aiError(e: unknown, what: string): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/credit balance is too low/i.test(m)) return 'The Anthropic account is out of credit — top it up under Plans & Billing at console.anthropic.com'
  if (viaGateway() && /insufficient|balance|credits|payment|top.?up|quota/i.test(m)) return 'The AI Gateway is out of credit — top it up in Vercel under AI Gateway'
  if (e instanceof Anthropic.RateLimitError) return 'The AI is busy right now — try again in a minute'
  if (e instanceof Anthropic.AuthenticationError) return viaGateway() ? 'The AI Gateway key is not valid — check AI_GATEWAY_API_KEY' : 'The Anthropic API key is not valid — check ANTHROPIC_API_KEY'
  return `The AI could not ${what}: ${m.slice(0, 200)}`
}

/** a picture fetched by us and sent inline: the AI providers cannot always download Instagram's links themselves
 *  (checked live, 27 Oct 2026: both Qwen and Claude refused a hotlinked picture). Null when it cannot be read. */
export async function inlinePicture(url: string): Promise<{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } } | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    const media = (['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const).find(t => t === type)
    if (!media) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > 4_500_000) return null
    return { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } }
  } catch {
    return null
  }
}
