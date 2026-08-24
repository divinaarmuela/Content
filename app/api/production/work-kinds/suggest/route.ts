import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, authzErrorResponse } from '../../../../lib/authz'
import { KIND_COLORS, type WorkKind } from '../../../../lib/work-kinds-core'

const Suggestion = z.object({
  match: z.enum(['existing', 'new', 'none'])
    .describe('existing = one of the listed kinds fits; new = a genuinely different kind of work worth its own category; none = too vague to tell'),
  kind_slug: z.string().describe('When match is existing: the slug of the kind that fits, exactly as listed. Else empty.'),
  new_name: z.string().describe('When match is new: a short 1-3 word name for the category, e.g. "Competitor research". Else empty.'),
  new_color: z.string().describe(`When match is new: one colour from ${KIND_COLORS.join(', ')} not already heavily used. Else empty.`),
})

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY

/**
 * "What kind of work is this?" — one cheap Haiku call reads the title/brief
 * of a task being created and suggests a work kind: an existing one to
 * pre-select, or a new category (name + colour) a manager can accept with a
 * click. A suggestion, never a decision — the human always confirms.
 */
export async function POST(req: Request) {
  try {
    await requireSignedIn()
    const body = await req.json()
    const title = String(body.title ?? '').trim().slice(0, 200)
    const brief = String(body.brief ?? '').trim().slice(0, 2000)
    if (!title && !brief) return NextResponse.json({ suggestion: null })

    const { data: kindRows } = await supabase.from('work_kinds').select('id, slug, name, color')
    const kinds = ((kindRows ?? []) as Pick<WorkKind, 'id' | 'slug' | 'name' | 'color'>[])
      .filter(k => k.slug !== 'shoot_brief')
    if (kinds.length === 0) return NextResponse.json({ suggestion: null })

    const response = await anthropic.messages.parse({
      // Haiku by the same product decision as email screening: high volume,
      // low stakes, and the classification is well within its range
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system:
        'You classify tasks at MD Media, a Melbourne marketing agency. Given a task title and brief, ' +
        'pick which existing work kind fits, or propose a new category only when the task is clearly a ' +
        'different discipline (e.g. competitor research vs video editing). Prefer existing kinds. ' +
        'Never propose a new kind for a one-off variation of an existing one.',
      messages: [{
        role: 'user',
        content:
          `Existing work kinds (slug — name — colour):\n` +
          kinds.map(k => `${k.slug} — ${k.name} — ${k.color}`).join('\n') +
          `\n\nTask title: ${title || '(none)'}\nBrief: ${brief || '(none)'}`,
      }],
      output_config: { format: zodOutputFormat(Suggestion) },
    })
    const s = response.parsed_output
    if (!s || s.match === 'none') return NextResponse.json({ suggestion: null })

    if (s.match === 'existing') {
      const kind = kinds.find(k => k.slug === s.kind_slug)
      return NextResponse.json({ suggestion: kind ? { match: 'existing', kind_id: kind.id, name: kind.name } : null })
    }
    const name = s.new_name.trim().slice(0, 60)
    if (!name) return NextResponse.json({ suggestion: null })
    const color = (KIND_COLORS as readonly string[]).includes(s.new_color) ? s.new_color : 'zinc'
    return NextResponse.json({ suggestion: { match: 'new', name, color } })
  } catch (e) {
    // classification is a convenience — a missing API key or model hiccup
    // must never block creating the item
    console.error('work-kind suggest error:', e)
    const { error, status } = authzErrorResponse(e)
    return status === 401 || status === 403
      ? NextResponse.json({ error }, { status })
      : NextResponse.json({ suggestion: null })
  }
}
