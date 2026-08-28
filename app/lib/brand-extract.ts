import 'server-only'
import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import { mergeProfiles, planChunks, type BrandProfile } from './brand-core'

export type { BrandProfile } from './brand-core'

/**
 * Turn a brand guidelines document into a structured profile.
 *
 * Real guidelines are export-from-Canva decks: every page a flat image, no
 * extractable text, 200MB+ for 30 pages. Inlining that as base64 is hopeless —
 * the API caps a REQUEST at 32MB, and one full-bleed page here measured 28MB
 * on its own. So the PDF is uploaded to the Files API once (500MB ceiling) and
 * referenced by id, which keeps the request tiny and the document whole.
 *
 * Only the 100-PAGE limit still bites, and only for a brand bible that long;
 * such a document is split by page range and merged chunk by chunk.
 *
 * Cost: Haiku 4.5, ~50k input tokens for a 31-page deck — cents, once per
 * document. Everything downstream reads the stored JSON, never the PDF.
 */

const FILES_BETA = ['files-api-2025-04-14']
const MAX_PAGES_PER_REQUEST = 100

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

const PROMPT =
  'These are a client\'s brand guidelines. Extract the brand profile in full.\n' +
  'COLOURS: capture EVERY colour in the palette. A palette page usually lists each swatch with ' +
  'its label and codes — a HEX (#RRGGBB), and/or RGB and CMYK values. Record the HEX for each; ' +
  'if only RGB is given, convert it to HEX; if only CMYK/Pantone is given, convert only when the ' +
  'document itself provides the conversion. Include neutrals like black (#000000) and white ' +
  '(#FFFFFF) when they are part of the palette. Do not skip a colour just because it is a plain ' +
  'labelled value rather than a big swatch.\n' +
  'FONTS: capture EVERY named typeface with its usage (headline / body / caption) and any weights. ' +
  'Use the human-facing family name as written (e.g. "GTF Solina Medium", "Helvetica Bold ' +
  'Condensed"), not just an embedded PostScript name.\n' +
  'Also capture logo usage rules, tone of voice, imagery direction, and explicit dos and don\'ts. ' +
  'The pages may be flat images, so read them VISUALLY as well as any selectable text. Be faithful ' +
  'to the document; never invent values it does not contain.'

export async function pdfPageCount(bytes: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
    return doc.getPageCount()
  } catch {
    return 0
  }
}

/** Page-range slices, only ever needed past the 100-page request limit. */
async function splitByPages(bytes: Buffer, pageCount: number): Promise<Buffer[]> {
  if (pageCount <= MAX_PAGES_PER_REQUEST) return [bytes]
  const src = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
  const out: Buffer[] = []
  for (const [start, end] of planChunks(pageCount, MAX_PAGES_PER_REQUEST)) {
    const doc = await PDFDocument.create()
    const pages = await doc.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i))
    for (const page of pages) doc.addPage(page)
    out.push(Buffer.from(await doc.save()))
  }
  return out
}

/** Upload once, read once, delete. The uploaded copy is scratch: the document
 *  itself already lives in our own storage. */
async function scanOnePart(
  anthropic: Anthropic, part: Buffer, name: string, previous: BrandProfile | null,
  prompt: string = PROMPT,
): Promise<BrandProfile> {
  const uploaded = await anthropic.beta.files.upload({
    file: await toFile(part, name, { type: 'application/pdf' }),
    betas: FILES_BETA,
  })

  try {
    const mergeNote = previous && Object.keys(previous).length > 0
      ? `\n\nThe profile from earlier pages follows; report what these pages add or correct.\n${JSON.stringify(previous)}`
      : ''

    const res = await anthropic.beta.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      betas: FILES_BETA,
      tools: [{
        name: 'record_brand_profile',
        description: 'Record the structured brand profile extracted from the document',
        input_schema: PROFILE_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'record_brand_profile' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'file', file_id: uploaded.id } },
          { type: 'text', text: prompt + mergeNote },
        ],
      }],
    })

    const tool = res.content.find(b => b.type === 'tool_use')
    return tool && tool.type === 'tool_use' ? (tool.input as BrandProfile) : {}
  } finally {
    // never leave scratch files behind on the account
    await anthropic.beta.files.delete(uploaded.id, { betas: FILES_BETA })
      .catch(e => console.error('brand scratch file delete failed:', e))
  }
}

/** Laser-focused second pass for when the main extraction comes back with no
 *  colours or no fonts. A brand deck lists its palette and typography as literal
 *  TEXT ("#957B60  RGB 149 123 96  CMYK 0 17 36 42", "GTF Solina — Medium"), so
 *  this tells the model to read that text verbatim rather than infer from
 *  swatches — the exact failure seen where a page listing "#957B60" returned
 *  nothing. */
const PALETTE_PROMPT =
  'Look ONLY at the COLOUR PALETTE and TYPOGRAPHY pages of this brand document. ' +
  'These pages list their values as TEXT — read that text literally, do not infer from swatches alone. ' +
  'Return EVERY colour as a HEX string like #957B60: if a swatch shows RGB (e.g. "149 123 96"), convert it to HEX; ' +
  'if it shows CMYK or Pantone, convert only when a HEX or RGB is also given; include neutrals like black (#000000) and white (#FFFFFF) when they appear. ' +
  'Return EVERY font family name exactly as written (e.g. "GTF Solina Medium", "GTF Solina Regular", "Helvetica Bold Condensed") with its usage. ' +
  'Do not skip a value because it is small label text rather than a large swatch. Never invent a value the pages do not contain.'

/**
 * Extract a profile from a whole document.
 * `onProgress` reports part completion for documents long enough to split.
 */
export async function extractBrandProfile(
  bytes: Buffer,
  previous: BrandProfile | null,
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<BrandProfile> {
  const anthropic = new Anthropic()
  const pages = await pdfPageCount(bytes)
  const parts = await splitByPages(bytes, pages)

  let profile: BrandProfile | null = previous
  for (let i = 0; i < parts.length; i++) {
    const extracted = await scanOnePart(
      anthropic, parts[i], `brand-${i + 1}.pdf`, profile,
    )
    profile = mergeProfiles(profile, extracted)
    await onProgress?.(i + 1, parts.length)
  }

  // Belt-and-braces: if the main pass found no palette or no fonts, run one more
  // pass over the first part that reads the palette/typography TEXT verbatim.
  // This is what makes a page literally listing "#957B60 / GTF Solina Medium"
  // land, instead of the model returning an empty palette from the swatches.
  const noColours = (profile?.colors?.length ?? 0) === 0
  const noFonts = (profile?.fonts?.length ?? 0) === 0
  if ((noColours || noFonts) && parts.length > 0) {
    try {
      const palette = await scanOnePart(anthropic, parts[0], 'brand-palette.pdf', profile, PALETTE_PROMPT)
      profile = mergeProfiles(profile, palette)
    } catch (e) {
      console.error('brand palette fallback pass failed:', e)
    }
  }

  return profile ?? {}
}
