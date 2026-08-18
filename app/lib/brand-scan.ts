import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'
import { inngest } from '../inngest/client'
import { brandChannel } from '../inngest/channels'
import { extractChunk, pdfPageCount, splitPdf } from './brand-extract'
import { putObject } from './storage'
import { mergeProfiles, type BrandProfile } from './brand-core'

/**
 * Scanning one guidelines document into a client's brand profile, in three
 * movements so each is a separate background step with its own time budget:
 *
 *   splitBrandPdf   — read the upload once, cut it into page-range chunks,
 *                     park them in storage. Nothing else ever loads the whole
 *                     document again, which is what makes a 300MB print
 *                     master survivable.
 *   scanBrandChunk  — one chunk, one model call, merged straight into the
 *                     stored profile. Called once per chunk, so the panel
 *                     fills in progressively and a retry resumes mid-document.
 *   finishBrandScan — record the document and announce completion.
 */

const say = (
  clientId: string, status: string, done: number, total: number, message?: string,
) =>
  void inngest.realtime.publish(brandChannel.progress, {
    client_id: clientId, status, done, total,
    ...(message ? { message } : {}), ts: Date.now(),
  }).catch(e => console.error('brand realtime publish failed:', e))

export async function splitBrandPdf(input: { clientId: string; url: string }): Promise<{
  chunks: string[]; pages: number
}> {
  const { clientId, url } = input
  try {
    const file = await fetch(url)
    if (!file.ok) throw new Error(`Could not read the uploaded PDF (${file.status})`)
    const bytes = Buffer.from(await file.arrayBuffer())

    const pages = await pdfPageCount(bytes)
    const parts = await splitPdf(bytes)
    say(clientId, 'scanning', 0, parts.length, `${pages || '?'} pages`)

    // a single-chunk document needs no copy in storage
    if (parts.length === 1) return { chunks: [url], pages }

    const chunks: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const { publicUrl } = await putObject(`brand-part-${i + 1}.pdf`, parts[i], 'application/pdf')
      chunks.push(publicUrl)
    }
    return { chunks, pages }
  } catch (e) {
    say(clientId, 'failed', 0, 0, e instanceof Error ? e.message : String(e))
    throw e
  }
}

export async function scanBrandChunk(input: {
  clientId: string; chunkUrl: string; index: number; total: number; by: string
}): Promise<{ merged: boolean }> {
  const { clientId, chunkUrl, index, total, by } = input
  try {
    const file = await fetch(chunkUrl)
    if (!file.ok) throw new Error(`Could not read part ${index + 1} (${file.status})`)
    const bytes = Buffer.from(await file.arrayBuffer())

    const { data: existing } = await supabase.from('client_brand')
      .select('profile').eq('client_id', clientId).maybeSingle()
    const previous = (existing?.profile ?? null) as BrandProfile | null

    const part = total === 1 ? 'the pages' : `pages ${index * 20 + 1}–${index * 20 + 20}`
    const extracted = await extractChunk(new Anthropic(), bytes, previous, part)
    const merged = mergeProfiles(previous, extracted)

    // written per chunk, so the panel fills in as it goes and a failure later
    // in the document never costs the pages already read
    const { error } = await supabase.from('client_brand').upsert({
      client_id: clientId, profile: merged,
      updated_at: new Date().toISOString(), updated_by: by,
    })
    if (error) throw new Error(error.message)

    say(clientId, 'scanning', index + 1, total)
    return { merged: true }
  } catch (e) {
    // one bad chunk must not lose the rest of the document
    console.error(`brand chunk ${index + 1}/${total} failed:`, e)
    say(clientId, 'scanning', index + 1, total, `part ${index + 1} could not be read`)
    return { merged: false }
  }
}

export async function finishBrandScan(input: {
  clientId: string; url: string; filename: string; by: string; pages: number; chunks: number
}): Promise<{ pages: number; chunks: number }> {
  const { clientId, url, filename, by, pages, chunks } = input

  const { data: existing } = await supabase.from('client_brand')
    .select('docs').eq('client_id', clientId).maybeSingle()
  const docs = [
    ...((existing?.docs ?? []) as Record<string, unknown>[]),
    { filename, url, scanned_at: new Date().toISOString(), pages },
  ]
  await supabase.from('client_brand').upsert({
    client_id: clientId, docs, updated_at: new Date().toISOString(), updated_by: by,
  })

  say(clientId, 'done', chunks, chunks)
  return { pages, chunks }
}
