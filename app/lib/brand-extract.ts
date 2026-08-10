import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

/**
 * Turn a brand guidelines document into a structured profile.
 *
 * Cost discipline, because these documents run to 30 pages:
 * - Haiku 4.5, the same model the inbox scanner uses — a 30-page PDF lands
 *   around 60–100k input tokens, roughly ten cents, and it happens ONCE per
 *   document. Everything downstream (the panel, the assistant) reads the
 *   stored JSON, which is a few hundred tokens, never the document again.
 * - Output is forced through a tool schema, so the result is valid JSON by
 *   construction — no retry loop burning a second pass through the PDF.
 * - Re-scanning with a second document sends the previous PROFILE (small)
 *   plus the new document, never two documents at once.
 */

export type BrandProfile = {
  summary?: string
  fonts?: { family: string; usage?: string; weights?: string[] }[]
  colors?: { name?: string; hex?: string; usage?: string }[]
  logo_rules?: string[]
  voice?: { tone?: string; description?: string; keywords?: string[] }
  imagery?: string[]
  dos_and_donts?: { dos?: string[]; donts?: string[] }
  other_rules?: string[]
}

const PROFILE_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string', description: 'Two sentences on the brand personality' },
    fonts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          family: { type: 'string' },
          usage: { type: 'string', description: 'e.g. headlines, body copy, captions' },
          weights: { type: 'array', items: { type: 'string' } },
        },
        required: ['family'],
      },
    },
    colors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          hex: { type: 'string', description: '#RRGGBB when stated or derivable' },
          usage: { type: 'string', description: 'e.g. primary, accent, backgrounds' },
        },
      },
    },
    logo_rules: { type: 'array', items: { type: 'string' } },
    voice: {
      type: 'object',
      properties: {
        tone: { type: 'string' },
        description: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
      },
    },
    imagery: { type: 'array', items: { type: 'string' } },
    dos_and_donts: {
      type: 'object',
      properties: {
        dos: { type: 'array', items: { type: 'string' } },
        donts: { type: 'array', items: { type: 'string' } },
      },
    },
    other_rules: { type: 'array', items: { type: 'string' } },
  },
}

export async function extractBrandProfile(
  pdfBase64: string,
  previous: BrandProfile | null,
): Promise<BrandProfile> {
  const anthropic = new Anthropic()

  const mergeNote = previous && Object.keys(previous).length > 0
    ? `\n\nAn existing profile from earlier documents follows. MERGE: keep facts it has that this document lacks, correct anything this document contradicts, add what is new.\n${JSON.stringify(previous)}`
    : ''

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    tools: [{
      name: 'record_brand_profile',
      description: 'Record the structured brand profile extracted from the document',
      input_schema: PROFILE_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'record_brand_profile' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          // prompt caching would only pay off if the same PDF were sent twice,
          // which the stored profile exists to prevent
        },
        {
          type: 'text',
          text:
            'These are a client\'s brand guidelines. Extract the brand profile: every typeface ' +
            'with its usage and weights, every colour with hex where stated (convert CMYK/Pantone ' +
            'only when the document gives the conversion), logo usage rules, tone of voice, ' +
            'imagery direction, and explicit dos and don\'ts. Be faithful to the document; ' +
            'never invent values it does not contain.' + mergeNote,
        },
      ],
    }],
  })

  const tool = res.content.find(b => b.type === 'tool_use')
  if (!tool || tool.type !== 'tool_use') throw new Error('The model returned no profile')
  return tool.input as BrandProfile
}
