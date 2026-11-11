import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateDefinition } from '../app/lib/intake-core'

/**
 * The scan route at its seams: who may call it, what a wrong or oversized file
 * is told, a good draft, a model that answered in prose instead of using the
 * tool, and a model that says the document is not a form.
 *
 * NO NETWORK. The Anthropic SDK is replaced with a stub whose next reply each
 * test sets, so the route's own handling — the tool result, the repair path,
 * the refusals, the failure sentences — is what is under test.
 */

let role = 'super_admin'
const RANK: Record<string, number> = { client: 0, editor: 1, scheduler: 2, account_manager: 3, super_admin: 4 }
class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('../app/lib/authz', () => ({
  requireRole: async (required: string) => {
    if (RANK[role] < RANK[required]) throw new AuthzError('Insufficient permissions', 403)
    return { role, email: 'admin@example.invalid' }
  },
  authzErrorResponse: (e: unknown) => e instanceof AuthzError
    ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))

type Reply = { content: unknown[] } | Error
let nextReply: Reply = { content: [] }
let lastRequest: Record<string, unknown> | null = null

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = {
      create: async (body: Record<string, unknown>) => {
        lastRequest = body
        if (nextReply instanceof Error) throw nextReply
        return nextReply
      },
    }
  }
  return { default: FakeAnthropic }
})

const { POST } = await import('../app/api/intake-templates/scan/route')

const toolReply = (input: unknown) => ({ content: [{ type: 'tool_use', name: 'draft_intake_form', input }] })
const textReply = (text: string) => ({ content: [{ type: 'text', text }] })

const GOOD = {
  is_form: true,
  name: 'Client brief',
  sections: [{
    title: 'About you',
    questions: [
      { label: 'Business name', type: 'short_text', confidence: 'high' },
      { label: 'Business name:', type: 'short_text', confidence: 'high' },
      { label: 'Which services', type: 'multi_select', choices: ['Photo', 'Video'], confidence: 'high' },
      { label: 'Page 2 of 6', type: 'short_text', confidence: 'high' },
    ],
  }],
}

const post = async (
  file: { name: string; type: string; body?: string | Uint8Array } | null,
  key = 'one_off',
) => {
  const body = new FormData()
  if (file) {
    const bytes = typeof file.body === 'string' || file.body === undefined
      ? new TextEncoder().encode(file.body ?? 'Business name: ______')
      : file.body
    body.append('file', new File([bytes as BlobPart], file.name, { type: file.type }))
  }
  body.append('key', key)
  const res = await POST(new Request('https://x.test/api/intake-templates/scan', { method: 'POST', body }))
  return {
    status: res.status,
    json: await res.json() as {
      error?: string; definition?: TemplateDefinition; uncertain?: string[]; notes?: string[]
    },
  }
}

beforeEach(() => { role = 'super_admin'; nextReply = toolReply(GOOD); lastRequest = null })

describe('POST /api/intake-templates/scan — the gate', () => {
  it('refuses anyone below super_admin, the same bar as saving a template', async () => {
    role = 'account_manager'
    const { status, json } = await post({ name: 'form.pdf', type: 'application/pdf' })
    expect(status).toBe(403)
    expect(json.error).toBe('Insufficient permissions')
    expect(lastRequest).toBeNull()   // no model call behind a closed door
  })
})

describe('POST /api/intake-templates/scan — what it will read', () => {
  it('asks for a document when none was sent', async () => {
    const { status, json } = await post(null)
    expect(status).toBe(400)
    expect(json.error).toBe('Add a document first.')
  })

  it('refuses a spreadsheet in plain words, without calling the model', async () => {
    const { status, json } = await post({ name: 'leads.xlsx', type: 'application/vnd.ms-excel' })
    expect(status).toBe(415)
    expect(json.error).toMatch(/PDFs/)
    expect(lastRequest).toBeNull()
  })

  it('tells a Word user exactly what to do instead', async () => {
    const { status, json } = await post({ name: 'brief.docx', type: '' })
    expect(status).toBe(415)
    expect(json.error).toMatch(/save it as a PDF/i)
  })

  it('refuses a file over 20 MB before reading it', async () => {
    const big = new Uint8Array(21 * 1024 * 1024)
    const { status, json } = await post({ name: 'huge.pdf', type: 'application/pdf', body: big })
    expect(status).toBe(413)
    expect(json.error).toContain('20 MB')
    expect(lastRequest).toBeNull()
  })

  it('refuses an empty text file', async () => {
    const { status, json } = await post({ name: 'blank.txt', type: 'text/plain', body: '   ' })
    expect(status).toBe(400)
    expect(json.error).toMatch(/no text/)
  })
})

describe('POST /api/intake-templates/scan — a good draft', () => {
  it('returns repaired questions, the flags and the notes, and writes nothing', async () => {
    const { status, json } = await post({ name: 'form.pdf', type: 'application/pdf' }, 'rebrand')
    expect(status).toBe(200)
    const def = json.definition!
    expect(def.key).toBe('rebrand')
    expect(def.sections[0].blocks.map(b => b.label)).toEqual(['Business name', 'Which services'])
    expect(json.notes!.join(' ')).toMatch(/repeated question was merged/)
    expect(json.uncertain).toEqual([])
  })

  it('sends a PDF as a document block and an image as an image block', async () => {
    await post({ name: 'form.pdf', type: 'application/pdf' })
    let content = (lastRequest!.messages as { content: { type: string }[] }[])[0].content
    expect(content[0].type).toBe('document')
    expect(lastRequest!.model).toBe('claude-sonnet-5')

    await post({ name: 'page.png', type: 'image/png' })
    content = (lastRequest!.messages as { content: { type: string }[] }[])[0].content
    expect(content[0].type).toBe('image')
  })

  it('truncates a huge text document and says so in the notes', async () => {
    const { status, json } = await post({
      name: 'manual.txt', type: 'text/plain', body: 'question? '.repeat(20_000),
    })
    expect(status).toBe(200)
    expect(json.notes!.join(' ')).toMatch(/only the first \d+% of it was read/)
  })
})

describe('POST /api/intake-templates/scan — when the model misbehaves', () => {
  it('repairs a prose reply that wrapped its JSON in a fence', async () => {
    nextReply = textReply('Sure — here you go:\n```json\n' + JSON.stringify(GOOD) + ',\n```')
    const { status, json } = await post({ name: 'form.pdf', type: 'application/pdf' })
    expect(status).toBe(200)
    expect(json.definition!.sections[0].blocks[0].label).toBe('Business name')
  })

  it('says so plainly when the reply cannot be salvaged', async () => {
    nextReply = textReply('I could not help with that.')
    const { status, json } = await post({ name: 'form.pdf', type: 'application/pdf' })
    expect(status).toBe(422)
    expect(json.error).toMatch(/could not read a form out of that document/)
    expect(json.definition).toBeUndefined()
  })

  it('passes on a not-a-form verdict rather than drafting nonsense', async () => {
    nextReply = toolReply({ is_form: false, not_a_form_reason: 'It is an invoice.', sections: [] })
    const { status, json } = await post({ name: 'invoice.pdf', type: 'application/pdf' })
    expect(status).toBe(422)
    expect(json.error).toBe('This does not look like a form. It is an invoice.')
  })

  it('turns a timeout into one plain sentence', async () => {
    const timeout = new Error('Request timed out.')
    timeout.name = 'AbortError'
    nextReply = timeout
    const { status, json } = await post({ name: 'form.pdf', type: 'application/pdf' })
    expect(status).toBe(504)
    expect(json.error).toBe('That took too long — try a smaller document.')
  })

  it('turns a missing API key into a sentence an admin can act on', async () => {
    nextReply = Object.assign(new Error('401 authentication_error'), { status: 401 })
    const { status, json } = await post({ name: 'form.pdf', type: 'application/pdf' })
    expect(status).toBe(503)
    expect(json.error).toMatch(/not set up/)
  })

  it('never leaks an unexpected error to the browser', async () => {
    nextReply = new Error('socket hang up at Object.<anonymous> (/var/task/x.js:1:1)')
    const { status, json } = await post({ name: 'form.pdf', type: 'application/pdf' })
    expect(status).toBe(502)
    expect(json.error).toBe('We could not read that document. Try again, or add the questions yourself.')
  })
})
