'use client'

/**
 * Upload a file to storage without routing it through Vercel.
 *
 * Sending the file to our own API caps it at Vercel's ~4.5MB request-body
 * limit, and the platform rejects a larger one with an HTML error page — which
 * surfaced in the dashboard as an unexplained JSON parse error, since the
 * caller assumed every response was JSON. Videos never had a chance.
 *
 * Three steps: ask for a signed URL, PUT the bytes straight to storage, then
 * register the asset. Only the first and last touch our API, and both are tiny.
 *
 * ── Why the PUT is an XMLHttpRequest and not a fetch ──
 *
 * Because `fetch` cannot report upload progress. There is no progress event
 * for a request body in any shipping browser, and the streaming-request API
 * that might one day provide one is Chromium-only and requires HTTP/2. So the
 * dashboard could say "Uploading…" and never anything more — which on a
 * gigabyte clip is eleven minutes of a word that looks exactly like a hung
 * tab. `xhr.upload.onprogress` gives bytes, and bytes give a bar, a speed and
 * a time left.
 *
 * XHR also brings the other thing that was missing: `xhr.abort()`, so a file
 * dragged in by mistake can be cancelled instead of held hostage.
 *
 * The file is never read into memory. It is handed to `send()` as a Blob and
 * the browser streams it off disk — the same as before, and the reason a 2 GB
 * master does not freeze the page.
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

/** Thrown when the person cancelled — never shown as a failure. */
export class UploadCancelled extends Error {
  constructor() { super('Upload cancelled') ; this.name = 'UploadCancelled' }
}

export type UploadProgress = { loaded: number; total: number }

export type UploadOptions = {
  purpose?: string
  projectId?: string | null
  /** called with bytes as they leave the machine */
  onProgress?: (p: UploadProgress) => void
  /** abort the transfer — the same signal shape everything else in the app uses */
  signal?: AbortSignal
}

/**
 * PUT the bytes, reporting progress, cancellable.
 *
 * Resolves only on a 2xx. A signed-URL rejection from R2 arrives as XML, not
 * JSON, so the status is the honest signal and the body is only consulted for
 * a message when there is one worth reading.
 */
function putWithProgress(
  signedUrl: string, file: File, contentType: string, opts: UploadOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new UploadCancelled()); return }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUrl, true)
    // R2 signs the Content-Type into the signature, so this must be
    // byte-identical to the value the sign step used
    xhr.setRequestHeader('Content-Type', contentType)

    xhr.upload.onprogress = e => {
      // `lengthComputable` is false for a body of unknown size; a File always
      // has one, but a browser that says otherwise must not produce NaN%
      opts.onProgress?.({
        loaded: e.loaded,
        total: e.lengthComputable && e.total > 0 ? e.total : file.size,
      })
    }

    const onAbort = () => xhr.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => opts.signal?.removeEventListener('abort', onAbort)

    xhr.onload = () => {
      done()
      if (xhr.status >= 200 && xhr.status < 300) {
        // the last progress event can arrive slightly short of the total;
        // finishing the bar is the difference between 99% and a tick
        opts.onProgress?.({ loaded: file.size, total: file.size })
        resolve()
        return
      }
      if (xhr.status === 413) { reject(new Error('That file is too large to upload.')); return }
      let message = `Upload to storage failed (HTTP ${xhr.status})`
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string }
        if (parsed?.error) message = parsed.error
      } catch { /* XML or HTML — the status is the only honest signal */ }
      reject(new Error(message))
    }
    xhr.onerror = () => {
      done()
      // a network-level failure gives no status and no body, by design
      reject(new Error('The connection dropped during the upload'))
    }
    xhr.onabort = () => { done(); reject(new UploadCancelled()) }

    // the Blob is streamed off disk — never read into memory
    xhr.send(file)
  })
}

export async function uploadMedia(
  file: File,
  opts: UploadOptions = {},
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
  await putWithProgress(signedUrl, file, contentType, opts)

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
