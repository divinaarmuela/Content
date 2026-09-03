import 'server-only'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
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
    { expiresIn: 60 * 60 }, // an hour — a 200MB master on a slow line is not quick
  )
  return {
    signedUrl,
    publicUrl: `${R2_PUBLIC_BASE!.replace(/\/$/, '')}/${key}`,
    key,
    backend: 'r2',
  }
}
