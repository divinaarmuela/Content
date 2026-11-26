/** Send one picture to the creators' picture store and hand back its address, or the words for why it did not go. */
export async function uploadPicture(file: File): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  try {
    const form = new FormData()
    form.set('file', file)
    const res = await fetch('/api/creators/photo', { method: 'POST', body: form })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.url) return { ok: false, reason: json?.error ?? 'That picture did not upload' }
    return { ok: true, url: String(json.url) }
  } catch {
    return { ok: false, reason: 'That picture did not upload. Check the connection and try again.' }
  }
}
