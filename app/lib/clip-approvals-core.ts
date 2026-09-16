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
    .map(r => ({ file_id: r.file_id, name: String(r.name ?? ''), at: r.at, by: String(r.by ?? '') }))
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
