import 'server-only'
import { supabase } from '@/lib/supabase'
import { inngest } from '../inngest/client'
import { brandChannel } from '../inngest/channels'
import { extractBrandProfile, pdfPageCount } from './brand-extract'
import { mergeProfiles, type BrandProfile } from './brand-core'

/**
 * Scan one uploaded document into a client's brand profile.
 *
 * Runs as a background job because a 60-page design document is minutes of
 * model time — far past a serverless request's budget — and progress is
 * published so the panel fills in live rather than holding a spinner.
 */

export async function runBrandScan(input: {
  clientId: string
  url: string
  filename: string
  by: string
}): Promise<{ pages: number; chunks: number }> {
  const { clientId, url, filename, by } = input

  const say = (status: string, done: number, total: number, message?: string) =>
    void inngest.realtime.publish(brandChannel.progress, {
      client_id: clientId, status, done, total,
      ...(message ? { message } : {}), ts: Date.now(),
    }).catch(e => console.error('brand realtime publish failed:', e))

  try {
    const file = await fetch(url)
    if (!file.ok) throw new Error(`Could not read the uploaded PDF (${file.status})`)
    const bytes = Buffer.from(await file.arrayBuffer())

    const pages = await pdfPageCount(bytes)
    const chunks = Math.max(1, Math.ceil(pages / 20))
    say('scanning', 0, chunks, `${pages || '?'} pages`)

    const { data: existing } = await supabase.from('client_brand')
      .select('profile, docs').eq('client_id', clientId).maybeSingle()

    const profile = await extractBrandProfile(
      bytes,
      (existing?.profile ?? null) as BrandProfile | null,
      (done, total) => { say('scanning', done, total) },
    )

    // merged again here: extractBrandProfile already merges chunk by chunk,
    // and this keeps the contract explicit if that ever changes
    const merged = mergeProfiles((existing?.profile ?? null) as BrandProfile | null, profile)

    const docs = [
      ...((existing?.docs ?? []) as { filename: string; url: string; scanned_at: string }[]),
      { filename, url, scanned_at: new Date().toISOString(), pages },
    ]

    const { error } = await supabase.from('client_brand').upsert({
      client_id: clientId, profile: merged, docs,
      updated_at: new Date().toISOString(), updated_by: by,
    })
    if (error) throw new Error(error.message)

    say('done', chunks, chunks)
    return { pages, chunks }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    say('failed', 0, 0, message)
    throw e
  }
}
