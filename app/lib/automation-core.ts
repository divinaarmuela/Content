/**
 * Pure validation for comment→DM automations — no I/O.
 *
 * The provider's create endpoint wants profileId, accountId, name, keywords
 * and dmMessage (verified against the live API; the docs are looser). This
 * checks everything a browser can get wrong BEFORE the provider sees it, so
 * the operator gets a specific message rather than a schema error.
 */

export type AutomationDraft = {
  name: string
  trigger: 'comment' | 'story_reply'
  keywords: string[]
  dmMessage: string
  alsoMatchInDms: boolean
  buttonTitle?: string
  buttonUrl?: string
  platformPostId?: string
}

export type ParseResult =
  | { ok: true; value: AutomationDraft }
  | { ok: false; error: string }

/** Meta's hard cap on a DM that carries buttons. */
export const BUTTON_MESSAGE_LIMIT = 640
export const MESSAGE_LIMIT = 1000
export const MAX_KEYWORDS = 20

/** Accepts keywords as an array or a comma-separated string. */
export function normaliseKeywords(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' ? raw.split(',') : []
  const out: string[] = []
  for (const item of list) {
    const k = String(item ?? '').trim().slice(0, 80)
    if (k && !out.some(x => x.toLowerCase() === k.toLowerCase())) out.push(k)
  }
  return out.slice(0, MAX_KEYWORDS)
}

export function parseAutomationDraft(raw: unknown): ParseResult {
  const r = (raw ?? {}) as Record<string, unknown>

  const name = String(r.name ?? '').trim().slice(0, 80)
  if (!name) return { ok: false, error: 'Give the automation a name' }

  const trigger = r.trigger === 'story_reply' ? 'story_reply' as const : 'comment' as const

  const keywords = normaliseKeywords(r.keywords)
  if (keywords.length === 0) {
    return { ok: false, error: 'Add at least one keyword to listen for' }
  }

  const dmMessage = String(r.dmMessage ?? '').trim()
  if (!dmMessage) return { ok: false, error: 'Write the DM to send' }

  const buttonTitle = String(r.buttonTitle ?? '').trim().slice(0, 20)
  const buttonUrl = String(r.buttonUrl ?? '').trim()
  if (buttonTitle && !buttonUrl) return { ok: false, error: 'The button needs a link' }
  if (buttonUrl && !buttonTitle) return { ok: false, error: 'The button needs a label' }
  if (buttonUrl) {
    let parsed: URL
    try { parsed = new URL(buttonUrl) } catch { return { ok: false, error: 'The button link is not a valid URL' } }
    if (parsed.protocol !== 'https:') return { ok: false, error: 'The button link must start with https://' }
    if (dmMessage.length > BUTTON_MESSAGE_LIMIT) {
      return { ok: false, error: `With a button, the DM must be ${BUTTON_MESSAGE_LIMIT} characters or fewer` }
    }
  }
  if (dmMessage.length > MESSAGE_LIMIT) {
    return { ok: false, error: `The DM must be ${MESSAGE_LIMIT} characters or fewer` }
  }

  const platformPostId = String(r.platformPostId ?? '').trim()

  return {
    ok: true,
    value: {
      name, trigger, keywords, dmMessage,
      alsoMatchInDms: r.alsoMatchInDms === true,
      ...(buttonUrl ? { buttonTitle, buttonUrl } : {}),
      ...(platformPostId ? { platformPostId } : {}),
    },
  }
}

/** The provider payload for a validated draft (ids supplied by the server). */
export function automationPayload(
  draft: AutomationDraft,
  ids: { profileId: string; accountId: string },
): Record<string, unknown> {
  return {
    profileId: ids.profileId,
    accountId: ids.accountId,
    name: draft.name,
    trigger: draft.trigger,
    keywords: draft.keywords,
    dmMessage: draft.dmMessage,
    ...(draft.alsoMatchInDms ? { alsoMatchInDms: true } : {}),
    // this endpoint's discriminator is 'url' | 'postback' | 'phone' — NOT the
    // 'web_url' the private-reply endpoint takes
    ...(draft.buttonUrl
      ? { buttons: [{ type: 'url', title: draft.buttonTitle, url: draft.buttonUrl }] }
      : {}),
    ...(draft.platformPostId ? { platformPostId: draft.platformPostId } : {}),
  }
}
