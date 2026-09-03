import 'server-only'
import { supabase } from '@/lib/supabase'
import { announce } from '@/lib/live'
import { extractBrandProfile, pdfPageCount } from './brand-extract'
import { mergeProfiles, type BrandProfile } from './brand-core'

/**
 * Scan one guidelines document into a client's brand profile.
 *
 * Runs as a background job: the document is uploaded to the model's Files API
 * and read whole, which for a 200MB image-only deck is about half a minute of
 * work — more than a request should hold, and it must survive the tab that
 * started it closing.
 */

/** Report progress twice: live for a page that is open, and onto the row for
 *  a page that is not — which is what makes a running scan visible after a
 *  reload, or to a teammate who never saw it start. */
async function say(
  clientId: string, status: string, done: number, total: number, message?: string,
): Promise<void> {
  announce('brand', {
    client_id: clientId, status, done, total,
    ...(message ? { message } : {}),
  })

  const { error } = await supabase.from('client_brand').upsert({
    client_id: clientId,
    scan_status: status,
    scan_done: done,
    scan_total: total,
    scan_message: message ?? null,
    // heartbeat: a "scanning" row that stops being touched is a dead job, and
    // the GET uses this to stop showing an eternal spinner
    updated_at: new Date().toISOString(),
  })
  if (error) console.error('brand status write failed:', error.message)
}

export async function runBrandScan(input: {
  clientId: string
  url: string
  filename: string
  by: string
}): Promise<{ pages: number }> {
  const { clientId, url, filename, by } = input

  // status writes MUST land in order: progress callbacks fire without being
  // awaited, and an unqueued late "scanning" write used to overwrite the
  // final "done", leaving the page spinning over a finished profile
  let queue: Promise<void> = Promise.resolve()
  const report = (status: string, done: number, total: number, message?: string): Promise<void> => {
    queue = queue.then(() => say(clientId, status, done, total, message)).catch(() => {})
    return queue
  }

  try {
    const file = await fetch(url)
    if (!file.ok) throw new Error(`Could not read the uploaded PDF (${file.status})`)
    const bytes = Buffer.from(await file.arrayBuffer())

    const pages = await pdfPageCount(bytes)
    await report('scanning', 0, 1, `${pages || '?'} pages`)

    const { data: existing } = await supabase.from('client_brand')
      .select('profile, docs').eq('client_id', clientId).maybeSingle()
    const previous = (existing?.profile ?? null) as BrandProfile | null

    const extracted = await extractBrandProfile(bytes, previous, (done, total) => {
      void report('scanning', done, total)
    })
    const profile = mergeProfiles(previous, extracted)

    const docs = [
      ...((existing?.docs ?? []) as Record<string, unknown>[]),
      { filename, url, scanned_at: new Date().toISOString(), pages },
    ]

    const { error } = await supabase.from('client_brand').upsert({
      client_id: clientId, profile, docs,
      updated_at: new Date().toISOString(), updated_by: by,
      scan_status: 'done', scan_done: 1, scan_total: 1, scan_message: null,
    })
    if (error) throw new Error(error.message)

    // Fold the scan's colours/fonts into the client's EDITABLE profile, filling
    // only what is still empty. Without this a scan's palette stays in the raw
    // row above and never reaches the Brand tab once the profile is non-null
    // (e.g. after intake enrichment wrote the voice) — it would wait for someone
    // to open the panel and accept a proposal. Best-effort: a fold failure must
    // not fail a completed scan.
    try {
      const { applyScanToEditableProfile } = await import('./brand-profile')
      await applyScanToEditableProfile(clientId, profile, by || 'brand scan')
    } catch (e) {
      console.error('brand scan: fold into editable profile failed:', e)
    }

    await report('done', 1, 1)
    return { pages }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await report('failed', 0, 0, message)
    throw e
  }
}
