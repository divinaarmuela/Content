'use client'

/**
 * Upload a file to Supabase Storage without routing it through Vercel.
 *
 * Sending the file to our own API caps it at Vercel's ~4.5MB request-body
 * limit, and the platform rejects a larger one with an HTML error page — which
 * surfaced in the dashboard as an unexplained JSON parse error, since the
 * caller assumed every response was JSON. Videos never had a chance.
 *
 * Three steps: ask for a signed URL, PUT the bytes straight to Supabase, then
 * register the asset. Only the first and last touch our API, and both are tiny.
 */

/** Read an error out of a response that may not be JSON at all. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(text)
    if (parsed?.error) return parsed.error
  } catch {
    // an HTML error page — the status is the only honest signal
  }
  if (res.status === 413) return 'That file is too large to upload.'
  return `${fallback} (HTTP ${res.status})`
}

export async function uploadMedia(
  file: File,
  opts: { purpose?: string; projectId?: string | null } = {},
): Promise<{ url: string; kind: 'image' | 'video' }> {
  const kind: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image'

  // R2 signs the Content-Type into the signature, so the value sent on the PUT
  // must be byte-identical to the one used to sign — otherwise Cloudflare
  // rejects it as a mismatch. Resolve it once and use the same string twice.
  const contentType = file.type || 'application/octet-stream'

  // 1. sign
  const signRes = await fetch('/api/website/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sign', name: file.name, size: file.size, type: contentType }),
  })
  if (!signRes.ok) throw new Error(await errorFrom(signRes, 'Could not start the upload'))
  const { signedUrl, publicUrl } = await signRes.json() as { signedUrl: string; publicUrl: string }

  // 2. straight to storage — this is the only request carrying the file
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  })
  if (!putRes.ok) throw new Error(await errorFrom(putRes, 'Upload to storage failed'))

  // 3. index it. The file is already stored, so a failure here is not worth
  //    failing the upload over — the URL is valid either way.
  await fetch('/api/website/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'register',
      url: publicUrl,
      kind,
      purpose: opts.purpose ?? 'general',
      project_id: opts.projectId ?? null,
    }),
  }).catch(() => {})

  return { url: publicUrl, kind }
}
