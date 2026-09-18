/**
 * WHICH CLIPS THE CLIENT APPROVED (the owner, 16 Sep 2026: "each video for
 * the client portal gets a nice Approved button, so it's easier for the
 * team or editor to see which files in Drive to work from").
 *
 * A tick per clip of the finished edit, on the card. It is a note, not a
 * move: the client approving every clip does not move the card anywhere —
 * the account manager or a super admin logs the approval or sends it back
 * for changes from the card (the owner, 16 Sep 2026: "even though the
 * client approves all items it does not send back to draft; the AM or
 * super admin presses the button"). A second cut is a new folder with new
 * files, so it starts unapproved.
 */
export type ClipApproval = {
  file_id: string
  name: string
  /** when, ISO */
  at: string
  /** who at the client, as they signed it; the client's name when nobody did */
  by: string
  /** WHERE IT CAME FROM (the owner, 16 Sep 2026: "who clicked approve? can't
   *  you track where it is from?" — an unsigned press could not be traced):
   *  the address and the device the press came from, kept on the tick */
  ip?: string | null
  device?: string | null
  /** A TEAM TICK (the owner, 18 Sep 2026: "sometimes the client will call us"):
   *  an account manager or super admin approved it for the client; `by` is theirs */
  team?: boolean
}

/** the words on the green badge: whose approval it was */
export function approvalBadge(a: ClipApproval | null | undefined): string | null {
  if (!a) return null
  const who = String(a.by ?? '').trim()
  return a.team ? `Approved by ${who || 'the team'}` : `Approved by client${who ? ` · ${who}` : ''}`
}

/** OPTIONAL CAPTIONS, ONE PER ASSET (the owner, 18 Sep 2026: "add optional
 *  captions for each asset, for post approval once handed over"): a map of
 *  file id → words, kept on the card and carried to the handover card. */
export function captionsOf(item: { asset_captions?: unknown } | null | undefined): Record<string, string> {
  const raw = item?.asset_captions
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const words = typeof v === 'string' ? v.trim() : ''
    if (k && words) out[k] = words.slice(0, 2000)
  }
  return out
}

export function sanitiseCaptions(raw: unknown): { ok: true; captions: Record<string, string> } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, captions: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Captions are a map of file to words' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > 200) return { ok: false, error: 'Too many captions' }
  const captions: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (!/^[A-Za-z0-9_.@-]{1,120}$/.test(k)) return { ok: false, error: 'That is not a file on the card' }
    if (typeof v !== 'string') return { ok: false, error: 'A caption is words' }
    const words = v.trim()
    if (words) captions[k] = words.slice(0, 2000)
  }
  return { ok: true, captions }
}

/** the address a request came through, as the edge reports it */
export function requestOrigin(headers: { get(name: string): string | null }): { ip: string | null; device: string | null } {
  const ip = (headers.get('x-forwarded-for') ?? headers.get('x-real-ip') ?? '').split(',')[0].trim() || null
  const device = (headers.get('user-agent') ?? '').trim().slice(0, 200) || null
  return { ip, device }
}

export function clipApprovalsOf(item: { clip_approvals?: unknown } | null | undefined): ClipApproval[] {
  const raw = item?.clip_approvals
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is ClipApproval =>
    !!r && typeof r === 'object'
    && typeof (r as ClipApproval).file_id === 'string' && (r as ClipApproval).file_id.length > 0
    && typeof (r as ClipApproval).at === 'string')
    .map(r => ({
      file_id: r.file_id, name: String(r.name ?? ''), at: r.at, by: String(r.by ?? ''),
      // whose tick it was, and where it came from — kept when the row has them (18 Sep 2026)
      ...(r.team === true ? { team: true } : {}),
      ...(typeof r.ip === 'string' ? { ip: r.ip } : {}),
      ...(typeof r.device === 'string' ? { device: r.device } : {}),
    }))
}

/** the list with this clip approved — a second press replaces the first, never doubles it */
export function withClipApproved(list: readonly ClipApproval[], next: ClipApproval): ClipApproval[] {
  return [...list.filter(a => a.file_id !== next.file_id), next]
}

/** the list with this clip's tick taken back */
export function withClipUnapproved(list: readonly ClipApproval[], fileId: string): ClipApproval[] {
  return list.filter(a => a.file_id !== fileId)
}

export function clipApproval(list: readonly ClipApproval[], fileId: string): ClipApproval | null {
  return list.find(a => a.file_id === fileId) ?? null
}

/** "2 of 6 clips approved by the client" — the one line on the card */
export function approvedClipsWords(approved: number, total: number): string | null {
  if (total === 0 || approved === 0) return null
  if (approved >= total) return `All ${total} ${total === 1 ? 'clip' : 'clips'} approved by the client`
  return `${approved} of ${total} clips approved by the client`
}

/** THE QUALITY CHECK, ONE CLIP AT A TIME (the owner, 18 Sep 2026): the
 *  reviewer's passes, kept apart from the client's approvals. */
export function qcApprovalsOf(item: { qc_approvals?: unknown } | null | undefined): ClipApproval[] {
  return clipApprovalsOf({ clip_approvals: item?.qc_approvals })
}
/** the words on the reviewer's badge */
export function qcBadge(a: ClipApproval | null | undefined): string | null {
  if (!a) return null
  const who = String(a.by ?? '').trim()
  return `Passed quality check${who ? ` · ${who}` : ''}`
}
