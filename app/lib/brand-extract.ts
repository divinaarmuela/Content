import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import { mergeProfiles, planChunks, type BrandProfile } from './brand-core'

export type { BrandProfile } from './brand-core'

/**
 * Turn a brand guidelines document into a structured profile.
 *
 * Real guidelines are design documents: 60 image-heavy pages, often far past
 * the model's 32MB / 100-page per-request limits. So the PDF is SPLIT into
 * page chunks here and scanned in sequence, each chunk merging into the
 * profile built so far — one document of any size, one profile out.
 *
 * Cost discipline, because these run long:
 * - Haiku 4.5, the same model the inbox scanner uses. Extraction happens ONCE
 *   per document; the panel and anything downstream read the stored JSON,
 *   never the document again.
 * - Output is forced through a tool schema, so the result is valid JSON by
 *   construction — no retry loop burning a second pass through the pages.
 * - Each chunk carries the profile so far (small) rather than earlier pages.
 */

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

/** Split a PDF into page-range chunks. Returns the whole file untouched when
 *  it is small enough to send in one request. */
export async function splitPdf(bytes: Buffer): Promise<Buffer[]> {
  const src = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
  const ranges = planChunks(src.getPageCount())
  if (ranges.length <= 1) return [bytes]

  const out: Buffer[] = []
  for (const [start, end] of ranges) {
    const doc = await PDFDocument.create()
    const pages = await doc.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i))
    for (const page of pages) doc.addPage(page)
    out.push(Buffer.from(await doc.save()))
  }
  return out
}

/** How many pages the document has — for progress reporting before scanning. */
export async function pdfPageCount(bytes: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
    return doc.getPageCount()
  } catch {
    return 0
  }
}

/** One chunk, one model call. Exported so each chunk can be its own
 *  background step rather than all of them sharing one time budget. */
export async function extractChunk(
  anthropic: Anthropic, pdf: Buffer, previous: BrandProfile | null, part: string,
): Promise<BrandProfile> {
  return extractOne(anthropic, pdf.toString('base64'), previous, part)
}

async function extractOne(
  anthropic: Anthropic, pdfBase64: string, previous: BrandProfile | null, part: string,
): Promise<BrandProfile> {
  const mergeNote = previous && Object.keys(previous).length > 0
    ? `\n\nThe profile built from earlier pages follows. Report only what THESE pages add or correct; do not repeat what is already recorded verbatim.\n${JSON.stringify(previous)}`
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
        },
        {
          type: 'text',
          text:
            `These are ${part} of a client's brand guidelines. Extract the brand profile: every ` +
            'typeface with its usage and weights, every colour with hex where stated (convert ' +
            'CMYK/Pantone only when the document gives the conversion), logo usage rules, tone of ' +
            'voice, imagery direction, and explicit dos and don\'ts. Be faithful to the document; ' +
            'never invent values it does not contain. If these pages contain none of the above, ' +
            'return an empty object.' + mergeNote,
        },
      ],
    }],
  })

  const tool = res.content.find(b => b.type === 'tool_use')
  if (!tool || tool.type !== 'tool_use') return {}
  return tool.input as BrandProfile
}

/**
 * Extract a profile from a whole document, chunking as needed.
 * `onProgress` reports chunk completion so a long scan can show progress.
 * A failed chunk is logged and skipped — 58 good pages beat none.
 */
export async function extractBrandProfile(
  pdfBase64OrBytes: string | Buffer,
  previous: BrandProfile | null,
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<BrandProfile> {
  const bytes = Buffer.isBuffer(pdfBase64OrBytes)
    ? pdfBase64OrBytes
    : Buffer.from(pdfBase64OrBytes, 'base64')

  const anthropic = new Anthropic()
  const chunks = await splitPdf(bytes)
  let profile: BrandProfile | null = previous

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length === 1 ? 'the pages' : `pages ${i * 20 + 1}–${i * 20 + 20}`
    try {
      const extracted = await extractOne(anthropic, chunks[i].toString('base64'), profile, part)
      profile = mergeProfiles(profile, extracted)
    } catch (e) {
      console.error(`brand chunk ${i + 1}/${chunks.length} failed:`, e)
    }
    await onProgress?.(i + 1, chunks.length)
  }

  if (!profile) throw new Error('The document could not be read')
  return profile
}
