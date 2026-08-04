import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

/**
 * Encrypt client credentials at rest.
 *
 * These are other people's account passwords. Storing them as plaintext would
 * mean a database dump, a leaked backup, or read access to one table hands
 * over every client's logins — so the secret column holds ciphertext and
 * nothing else. Everything needed to *list* credentials (platform, username,
 * URL) is stored in the clear, so the common case never decrypts anything.
 *
 * AES-256-GCM: authenticated, so tampering is detected rather than silently
 * decrypting to garbage. A fresh random IV per encryption means the same
 * password stored twice produces different ciphertext, which stops anyone
 * inferring that two clients share a login.
 *
 * Format: base64(iv[12] ‖ authTag[16] ‖ ciphertext) — self-contained, so
 * nothing extra has to be stored alongside it.
 *
 * The key comes from CREDENTIALS_KEY. It lives only in the environment, never
 * in the database, so possession of the data is not possession of the key.
 */

const IV_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY
  if (!raw) {
    throw new Error(
      'CREDENTIALS_KEY is not set — refusing to store credentials unencrypted.',
    )
  }
  // SHA-256 of the passphrase gives exactly the 32 bytes AES-256 needs, so any
  // length of key material is accepted without silently truncating it.
  return createHash('sha256').update(raw).digest()
}

export function credentialsKeyConfigured(): boolean {
  return Boolean(process.env.CREDENTIALS_KEY)
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptSecret(packed: string): string {
  const buf = Buffer.from(packed, 'base64')
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('Malformed secret')
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)

  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  // throws if the tag does not verify — a wrong key or altered data fails
  // loudly rather than returning plausible nonsense
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
