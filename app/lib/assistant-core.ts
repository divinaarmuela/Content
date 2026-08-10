/**
 * Pure logic for the dashboard assistant — no I/O, fully unit-tested,
 * following the workflow-core model.
 */

/** The subset of a UIMessage this module needs. Structural on purpose:
 *  the SDK's type is generic over tools and would drag I/O types in here. */
export type ChatMessage = {
  role: string
  parts?: { type: string; text?: string }[]
}

const MAX_TITLE = 60

/**
 * A chat's title is its first user message, collapsed to one line. "New chat"
 * only when there is genuinely nothing to name it by.
 */
export function chatTitleFrom(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')
  const text = (first?.parts ?? [])
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'New chat'
  return text.length <= MAX_TITLE ? text : `${text.slice(0, MAX_TITLE - 1).trimEnd()}…`
}

export const MAX_INSTRUCTIONS = 2000

/**
 * Standing instructions are typed by people and pasted from anywhere; cap the
 * length so a paste cannot balloon every future request, and strip control
 * characters that have no business in a prompt.
 */
export function clampInstructions(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_INSTRUCTIONS)
}

/**
 * Compose the assistant's system prompt from the base and a person's standing
 * instructions. The base always comes first and the personal block is clearly
 * labelled as preferences, not policy — it must never read as overriding the
 * ground rules above it.
 */
export function composeInstructions(base: string, personal: string): string {
  const p = personal.trim()
  if (!p) return base
  return `${base}

Standing preferences from this user (style and focus only; the ground rules above always win):
${p}`
}

const MAX_MODEL_MESSAGES = 40

/**
 * A long chat should not grow the model's input forever. Send a bounded tail:
 * the newest messages matter, and the stored history keeps everything for the
 * humans. Always cut at a user message so the model never opens mid-answer
 * with an orphaned tool exchange.
 */
export function trimForModel<T extends ChatMessage>(messages: T[]): T[] {
  if (messages.length <= MAX_MODEL_MESSAGES) return messages
  const tail = messages.slice(-MAX_MODEL_MESSAGES)
  const firstUser = tail.findIndex(m => m.role === 'user')
  return firstUser <= 0 ? tail : tail.slice(firstUser)
}

/** A chat id is minted in the browser; trust its shape, not its origin. */
export function isChatId(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
