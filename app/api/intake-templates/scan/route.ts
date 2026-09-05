import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import {
  classifyUpload, isRefusal, normaliseScan, repairJson, truncateDocument,
  MAX_SCAN_BYTES, MAX_DOC_CHARS,
} from '../../../lib/intake-scan-core'
import type { TemplateKey } from '../../../lib/intake-core'

/**
 * Draft an intake form from a document someone drops in.
 *
 * Read, used, dropped. THE DOCUMENT IS NEVER STORED — not in R2, not in the
 * database, not on the Anthropic Files API. It arrives in the request body,
 * goes into one model call as base64, and dies with the request. Somebody's
 * signed contract or a scan of a client's letterhead is not ours to keep, and
 * a feature that quietly kept a copy would be a nasty surprise.
 *
 * Nothing here writes anything at all: the reply is a DRAFT, which opens in the
 * normal builder for a human to check and save through the existing save path.
 * That makes the route idempotent by construction — running it twice on the
 * same document costs two model calls and changes nothing.
 *
 * Gated exactly like saving a template (`PUT /api/intake-templates`) and like
 * editing one client's questions: super_admin.
 *
 * MODEL: claude-sonnet-5, not the haiku-4-5 this app uses for email
 * classification. Classification picks one label from a short list; this reads
 * a whole document's layout — a two-column scan, a table of tick boxes, a
 * heading that is really a section — and writes the structure back out. Haiku
 * flattened sections and guessed question types badly enough that the review
 * step became a rewrite. One Sonnet call per document, a handful of times a
 * month, is a few cents against a job that otherwise takes half an hour of
 * typing.
 *
 * BUDGET: one call, no retries beyond the SDK's own, max_tokens 8000 (about
 * 200 questions of JSON), a 50 s request timeout inside the route's 60 s.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-sonnet-5'
const MAX_OUTPUT_TOKENS = 8000
const CALL_TIMEOUT_MS = 50_000

const KEYS: TemplateKey[] = ['one_off', 'launch', 'rebrand', 'ongoing']

/** The shape we want back, expressed as a tool so the model fills fields rather
 *  than composing prose. It is still validated field by field in
 *  intake-scan-core.ts — a schema is a request, not a guarantee. */
const FORM_SCHEMA = {
  type: 'object' as const,
  properties: {
    is_form: {
      type: 'boolean',
      description:
        'True only if this document is a questionnaire, form, survey, brief or '
        + 'intake sheet — something with questions for a person to answer. '
        + 'False for a menu, an invoice, a contract, a brochure, an article or a report.',
    },
    not_a_form_reason: {
      type: 'string',
      description: 'When is_form is false: one short sentence saying what the document is instead. Empty otherwise.',
    },
    unreadable: {
      type: 'boolean',
      description: 'True if the pages are too blurry, too dark or too messy to read the words.',
    },
    unreadable_reason: {
      type: 'string',
      description: 'When unreadable is true: one short sentence on why. Empty otherwise.',
    },
    name: { type: 'string', description: 'A short name for the form, from its title if it has one.' },
    sections: {
      type: 'array',
      description: 'The form broken into sections, in document order.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The section heading, or a short one you write.' },
          intro: { type: 'string', description: 'Any introductory sentence for the section. Empty if none.' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'The question, worded as the person answering reads it.' },
                type: {
                  type: 'string',
                  enum: ['short_text', 'long_text', 'link', 'select', 'multi_select', 'file', 'guidance'],
                  description:
                    'short_text: one line. long_text: a paragraph. link: a URL. '
                    + 'select: pick one of the choices. multi_select: pick several. '
                    + 'file: they upload something. guidance: explanatory text with no answer.',
                },
                choices: {
                  type: 'array', items: { type: 'string' },
                  description: 'Required for select and multi_select — the options printed in the document. Empty otherwise.',
                },
                help: { type: 'string', description: 'A hint printed under the question. Empty if none.' },
                confidence: {
                  type: 'string', enum: ['high', 'low'],
                  description: 'low if you had to guess the wording, the type or the choices.',
                },
              },
              required: ['label', 'type', 'confidence'],
            },
          },
        },
        required: ['title', 'questions'],
      },
    },
  },
  required: ['is_form', 'sections'],
}

const PROMPT =
  'This document was given to a marketing agency to turn into an online intake form. '
  + 'Read it and record its questions with the draft_intake_form tool.\n\n'
  + 'Rules:\n'
  + '- Copy each question\'s wording from the document. Do not invent questions it does not ask, '
  + 'and do not improve the ones it does.\n'
  + '- Keep the document\'s own sections and order. If it has no sections, group the questions sensibly.\n'
  + '- Every question printed with tick boxes or a list of options is select (one) or multi_select '
  + '(several), and its choices must be the options actually printed.\n'
  + '- Explanatory text with no answer — "tell us as much as you can", a paragraph of context — is guidance.\n'
  + '- Ignore page furniture: page numbers, running headers and footers, logos, form codes, '
  + 'signature blocks and "for office use only" boxes.\n'
  + '- Do not repeat a question the document repeats on several pages.\n'
  + '- Mark confidence "low" whenever you had to guess.\n'
  + '- If this is NOT a questionnaire — a menu, an invoice, a contract, a brochure, an article — '
  + 'set is_form false, say in one sentence what it is, and return no sections. Do not invent a form.\n'
  + '- If the pages cannot be read at all, set unreadable true and return no sections.'

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

/** One plain sentence for anything that goes wrong out there, so the builder
 *  never sees a stack trace or a raw API error. */
function readerFailure(e: unknown): { error: string; status: number } {
  const message = e instanceof Error ? e.message : String(e)
  const name = e instanceof Error ? e.name : ''
  const status = (e as { status?: number })?.status

  if (name === 'AbortError' || name === 'TimeoutError' || status === 408
    || /timed? ?out/i.test(message)) {
    return { error: 'That took too long — try a smaller document.', status: 504 }
  }
  if (status === 401 || status === 403 || /api[_ ]key/i.test(message)) {
    return {
      error: 'The document reader is not set up on this site yet. Ask an admin to add the AI key.',
      status: 503,
    }
  }
  if (status === 413 || /too large|request too big/i.test(message)) {
    return {
      error: 'That document was too big to read. Try a smaller one, or just the pages with questions on them.',
      status: 413,
    }
  }
  if (status === 429 || status === 529) {
    return { error: 'The document reader is busy right now. Try again in a minute.', status: 503 }
  }
  console.error('intake scan failed:', e)
  return {
    error: 'We could not read that document. Try again, or add the questions yourself.',
    status: 502,
  }
}

export async function POST(req: Request) {
  try {
    await requireRole('super_admin')

    // multipart: the document is a byte stream, and base64 in JSON would be a
    // third bigger for no gain
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Add a document first.' }, { status: 400 })
    }

    const requestedKey = String(form?.get('key') ?? '') as TemplateKey
    const key: TemplateKey = KEYS.includes(requestedKey) ? requestedKey : 'one_off'

    const verdict = classifyUpload(file.name ?? '', file.type ?? '', file.size)
    if (isRefusal(verdict)) {
      return NextResponse.json({ error: verdict.message }, { status: verdict.status })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
    if (bytes.length > MAX_SCAN_BYTES) {
      return NextResponse.json({
        error: 'That file is bigger than 20 MB. Try a smaller document, or save just '
          + 'the pages with the questions on them.',
      }, { status: 413 })
    }

    const notes: string[] = []
    const content: ContentBlock[] = []

    if (verdict.kind === 'text') {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      const { text, note } = truncateDocument(decoded, MAX_DOC_CHARS)
      if (!text.trim()) {
        return NextResponse.json({ error: 'That file has no text in it.' }, { status: 400 })
      }
      if (note) notes.push(note)
      content.push({ type: 'text', text: `Document (${file.name}):\n\n${text}` })
    } else if (verdict.kind === 'pdf') {
      // Anthropic reads PDFs natively — pages, layout and scanned images — so
      // there is no PDF parser in this project to keep working
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
      })
    } else {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: verdict.mediaType, data: bytes.toString('base64') },
      })
    }
    content.push({ type: 'text', text: PROMPT })

    // built per request, not at module load: a missing key must fail this
    // request rather than the build (CLAUDE.md trap 7)
    const anthropic = new Anthropic({ maxRetries: 1 })

    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      tools: [{
        name: 'draft_intake_form',
        description: 'Record the questions found in the document, or say it is not a form',
        input_schema: FORM_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'draft_intake_form' },
      messages: [{ role: 'user', content: content as never }],
    }, { timeout: CALL_TIMEOUT_MS })

    // the tool result is the happy path; a model that answered in prose instead
    // still gets its JSON pulled out and repaired rather than thrown away
    const tool = res.content.find(b => b.type === 'tool_use')
    const raw: unknown = tool && tool.type === 'tool_use'
      ? tool.input
      : repairJson(res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n'))

    const outcome = normaliseScan(raw, key, { notes })
    if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: 422 })

    return NextResponse.json({
      definition: outcome.definition,
      uncertain: outcome.uncertain,
      notes: outcome.notes,
    })
  } catch (e) {
    // authz first: "not signed in" and "insufficient permissions" are already
    // plain sentences with the right status
    const authz = authzErrorResponse(e)
    if (authz.status === 401 || authz.status === 403) {
      return NextResponse.json({ error: authz.error }, { status: authz.status })
    }
    const failure = readerFailure(e)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
