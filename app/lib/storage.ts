import 'server-only'
import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Where uploaded media lives.
 *
 * ONE store for every file. A shoot delivers stills and video together, so
 * routing by file type would mean two upload paths, two URL shapes and a rule
 * everyone has to remember — and the rule would be broken the first time
 * someone dragged in a mixed folder.
 *
 * Cloudflare R2, and only R2. It takes objects to 5TB and charges no egress,
 * and it hands the browser a presigned URL and takes the bytes directly, so
 * nothing large crosses Vercel's ~4.5MB request-body limit.
 */

const R2_BUCKET = process.env.R2_BUCKET
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
/** Where the public reads the file: an r2.dev subdomain or a custom domain. */
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE_URL

export function r2Configured(): boolean {
  return Boolean(
    R2_BUCKET && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_PUBLIC_BASE,
  )
}

export function storageBackend(): 'r2' {
  return 'r2'
}

// Built lazily. Constructing a client at module load would make a missing
// variable a build failure rather than a request-time fallback (CLAUDE.md
// trap 7), and R2 is meant to be optional until it is configured.
let client: S3Client | null = null
function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return client
}

/** Collision-proof, readable, and safe in a URL. */
export function objectKey(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
}

export type SignedUpload = {
  /** PUT the file here, with the same Content-Type used to sign. */
  signedUrl: string
  /** Where it will be readable once uploaded. */
  publicUrl: string
  key: string
  backend: 'r2'
}

/**
 * Upload bytes from the SERVER and return where they are readable.
 *
 * Used for derived files the browser never sees — the page-range chunks a
 * large brand PDF is split into, so each scan step downloads only its own
 * slice instead of the whole document.
 */
export async function putObject(
  filename: string, bytes: Buffer, contentType: string,
): Promise<{ publicUrl: string; key: string }> {
  if (!r2Configured()) throw new Error('File storage is not configured')
  const key = objectKey(filename)

  await r2().send(new PutObjectCommand({
    Bucket: R2_BUCKET!, Key: key, Body: bytes, ContentType: contentType,
  }))
  return { publicUrl: `${R2_PUBLIC_BASE!.replace(/\/$/, '')}/${key}`, key }
}

/**
 * A URL the browser can upload one file to.
 *
 * contentType is part of the R2 signature: the PUT must send exactly the same
 * value or the request is rejected as a signature mismatch, which is why the
 * caller is handed back what it must use rather than choosing for itself.
 */
export async function signUpload(
  filename: string,
  contentType: string,
  opts?: { expiresIn?: number },
): Promise<SignedUpload> {
  if (!r2Configured()) throw new Error('File storage is not configured')
  const key = objectKey(filename)

  const signedUrl = await getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: R2_BUCKET!,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    }),
    // an hour — a 200MB master on a slow line is not quick. The encoder asks
    // for longer: it downloads a 2 GB master, encodes for up to 45 minutes and
    // only then PUTs, and a URL that expired mid-job would lose the whole
    // encode with nothing to show for the CPU.
    { expiresIn: opts?.expiresIn ?? 60 * 60 },
  )
  return {
    signedUrl,
    publicUrl: `${R2_PUBLIC_BASE!.replace(/\/$/, '')}/${key}`,
    key,
    backend: 'r2',
  }
}

/**
 * A URL to upload one file to a key we have ALREADY chosen.
 *
 * `signUpload` mints a fresh key every time, which is right for a person
 * dragging in a file and wrong for a retry: the encoder job stores its key on
 * the row before the encoder is told anything, and a retry that presigned a
 * NEW key would leave the row naming an object nothing ever wrote — a copy
 * that reads back `ready` and 404s when the post tries to use it. So the
 * retry re-signs the same key, and the key on the row is always the key the
 * bytes went to.
 *
 * The caller owns the key, so it must be one WE made (`objectKey`): anything
 * with a slash or a `..` in it is refused rather than trusted.
 */
export async function signUploadForKey(
  key: string,
  contentType: string,
  opts?: { expiresIn?: number },
): Promise<SignedUpload> {
  if (!r2Configured()) throw new Error('File storage is not configured')
  if (!key || key.includes('/') || key.includes('..')) throw new Error('That is not one of our storage keys')

  const signedUrl = await getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: R2_BUCKET!,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    }),
    { expiresIn: opts?.expiresIn ?? 60 * 60 },
  )
  return {
    signedUrl,
    publicUrl: `${R2_PUBLIC_BASE!.replace(/\/$/, '')}/${key}`,
    key,
    backend: 'r2',
  }
}

/**
 * Where the public reads our files from, for anything that has to ask "is
 * this URL one of ours?" — the crop save, above all, which writes a file into
 * a version the client has already approved.
 */
export function publicBase(): string | null {
  return R2_PUBLIC_BASE ? R2_PUBLIC_BASE.replace(/\/$/, '') : null
}

/**
 * The biggest a file may be to go onto a post.
 *
 * Not R2's 5GB single-PUT ceiling: this is the cap on a DERIVED file — a
 * cropped picture or a cover frame the browser just wrote out. A 4096px JPEG
 * is a couple of megabytes; anything past this is not one of ours whatever
 * its URL says.
 */
export const MAX_DERIVED_BYTES = 64 * 1024 * 1024

/**
 * What the storage host says about a file, or null if it will not say.
 *
 * A HEAD against the public URL, because the bucket is public-read and this
 * needs no credentials — and because it asks the same question the browser
 * would: is there really a picture there.
 */
export async function headStoredObject(
  url: string,
): Promise<{ contentType: string | null; bytes: number | null } | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return null
    const length = res.headers.get('content-length')
    return {
      contentType: res.headers.get('content-type'),
      bytes: length === null ? null : Number(length),
    }
  } catch {
    return null
  }
}

/**
 * Throw away a file we uploaded and then could not use.
 *
 * The crop path has to upload before it can save — the save needs a URL — so a
 * refusal afterwards (somebody else changed the piece, the file is not what it
 * claimed to be) leaves bytes in the bucket with nothing pointing at them.
 * Best effort by design: an orphan costs a fraction of a cent, and failing the
 * person's edit because the tidy-up failed would be the worse trade.
 *
 * It only ever deletes something on OUR public base, and only by the key that
 * base prefixes — it cannot be pointed at anything else.
 */
export async function deleteStoredObject(url: string): Promise<void> {
  const base = publicBase()
  if (!base || !r2Configured()) return
  if (!url.startsWith(`${base}/`)) return
  const key = url.slice(base.length + 1)
  if (!key || key.includes('..') || key.includes('/')) return
  try {
    await r2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET!, Key: key }))
  } catch (e) {
    console.error('could not remove an unused upload:', (e as Error).message)
  }
}
