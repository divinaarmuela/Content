#!/usr/bin/env node
/**
 * THE LIST OF MILANOTE FILES TO COPY (20 Oct 2026, docs/MILANOTE_MERGE.md, step 1 of the merge).
 *
 * Reads the saved Milanote snapshot and writes one `milanote_media` row per file Milanote holds for us — every
 * image's original, every attached file, and the preview picture of every link — each `todo`. The background job
 * (`milanote-media-copy`, started from /api/production/team-boards/milanote-media) then copies them into R2.
 *
 * Re-runnable: a row already there (copied, copying or failed) is left exactly as it is; only new files are added.
 * Writes nothing to Milanote. Without --write it only counts.
 *
 *   node scripts/milanote-media-rows.mjs <snapshot.json>          # count
 *   node scripts/milanote-media-rows.mjs <snapshot.json> --write  # write the rows
 */
import { readFileSync } from 'node:fs'

const [, , snapPath, flag] = process.argv
if (!snapPath) { console.error('Usage: node scripts/milanote-media-rows.mjs <snapshot.json> [--write]'); process.exit(1) }
const write = flag === '--write'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const DB = (env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').replace(/\/$/, '')
if (!DB) { console.error('Missing NEXT_PUBLIC_FIREBASE_DATABASE_URL in .env.local'); process.exit(1) }

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime' }
const extOf = url => (String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? '').toLowerCase()
const nameOf = url => decodeURIComponent(String(url).split('?')[0].split('/').pop() || 'file')
const isMilanote = url => { try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'app.milanote.com' || u.hostname.endsWith('.milanote.com')) } catch { return false } }

const snap = JSON.parse(readFileSync(snapPath, 'utf8'))
const els = Object.values(snap.elements)
const now = new Date().toISOString()
const rows = {}
const add = (id, src, name, mime) => {
  if (!src || !isMilanote(src)) return
  rows[id] = { id, src, name: String(name).slice(0, 200), mime: mime || MIME[extOf(src)] || null, size: null, url: null, status: 'todo', attempts: 0, error: null, updated_at: now }
}
for (const e of els) {
  const c = e.content ?? {}
  if (e.elementType === 'IMAGE') add(`${e._id}_image`, c.image?.original, c.file?.filename || nameOf(c.image?.original), c.file?.mime)
  if (e.elementType === 'FILE') {
    add(`${e._id}_file`, c.file?.url, c.file?.filename || nameOf(c.file?.url), c.file?.mime)
    add(`${e._id}_preview`, c.image?.large ?? c.image?.regular, `${c.file?.filename || 'file'}-preview.png`, 'image/png')
  }
  if (e.elementType === 'LINK') add(`${e._id}_link`, c.image?.large ?? c.image?.regular, nameOf(c.image?.large ?? c.image?.regular), null)
}

const count = kind => Object.keys(rows).filter(k => k.endsWith(`_${kind}`)).length
console.log(`From the snapshot taken ${snap.takenAt}: ${count('image')} images, ${count('file')} files (+${count('preview')} previews), ${count('link')} link pictures — ${Object.keys(rows).length} in all`)

const res = await fetch(`${DB}/mdm/tables/milanote_media.json?shallow=true`)
const have = new Set(Object.keys((await res.json()) ?? {}))
const fresh = Object.values(rows).filter(r => !have.has(r.id))
console.log(`${have.size} already listed; ${fresh.length} new`)
if (!write) { console.log('Count only — add --write to write the new rows.'); process.exit(0) }

// a multi-path update, 300 rows a request; rows already there are never in it
for (let i = 0; i < fresh.length; i += 300) {
  const patch = Object.fromEntries(fresh.slice(i, i + 300).map(r => [r.id, r]))
  const w = await fetch(`${DB}/mdm/tables/milanote_media.json`, { method: 'PATCH', body: JSON.stringify(patch) })
  if (!w.ok) { console.error(`write failed at ${i}: ${w.status} ${await w.text()}`); process.exit(1) }
}
console.log(`Wrote ${fresh.length} rows.`)
