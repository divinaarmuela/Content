import 'server-only'
import type { NotifyAttachment } from './mailer'
import type { IntakeFile } from './intake'

/**
 * Turn a client's uploaded files into email attachments — as many as will fit.
 *
 * Gmail rejects a message over 25MB, and base64 inflates a payload by roughly
 * a third, so the real ceiling on raw bytes is nearer 18MB. The intake form
 * accepts files up to 50MB each. Attaching everything unconditionally would
 * therefore mean the notification fails outright exactly when a client has
 * given you the most — a brand guide, a font pack, a folder of logos.
 *
 * So: attach in order until the budget is spent, and hand back whatever did
 * not fit so the caller can link it instead. Nobody is left wondering whether
 * a file existed.
 */

/** Raw bytes, before base64. Deliberately under Gmail's 25MB so the encoded
 *  message plus the PDF and the HTML body still clears it. */
const BUDGET_BYTES = 16 * 1024 * 1024
/** No single file may eat the whole budget and starve the rest. */
const PER_FILE_BYTES = 10 * 1024 * 1024

export type PackedAttachments = {
  attachments: NotifyAttachment[]
  /** Files left out, with the reason, so the email can link them honestly. */
  linked: { filename: string; url: string; reason: 'too large' | 'no room' | 'unavailable' }[]
}

export async function packIntakeFiles(files: IntakeFile[]): Promise<PackedAttachments> {
  const attachments: NotifyAttachment[] = []
  const linked: PackedAttachments['linked'] = []
  let spent = 0

  for (const file of files) {
    if (spent >= BUDGET_BYTES) {
      linked.push({ filename: file.filename, url: file.url, reason: 'no room' })
      continue
    }

    try {
      const res = await fetch(file.url)
      if (!res.ok) throw new Error(String(res.status))

      // Check the declared size before buffering: a 400MB object should not be
      // pulled into memory just to discover it is too big for an email.
      const declared = Number(res.headers.get('content-length') ?? '0')
      if (declared > PER_FILE_BYTES || spent + declared > BUDGET_BYTES) {
        linked.push({
          filename: file.filename, url: file.url,
          reason: declared > PER_FILE_BYTES ? 'too large' : 'no room',
        })
        continue
      }

      const buf = Buffer.from(await res.arrayBuffer())
      // content-length can lie or be absent; the buffer cannot
      if (buf.byteLength > PER_FILE_BYTES || spent + buf.byteLength > BUDGET_BYTES) {
        linked.push({
          filename: file.filename, url: file.url,
          reason: buf.byteLength > PER_FILE_BYTES ? 'too large' : 'no room',
        })
        continue
      }

      attachments.push({
        filename: file.filename,
        content: buf,
        contentType: res.headers.get('content-type') ?? undefined,
      })
      spent += buf.byteLength
    } catch (e) {
      // A file we cannot fetch is still a file the client uploaded. Link it
      // rather than pretending it does not exist.
      console.error(`intake attachment fetch failed for ${file.filename}:`, e)
      linked.push({ filename: file.filename, url: file.url, reason: 'unavailable' })
    }
  }

  return { attachments, linked }
}
