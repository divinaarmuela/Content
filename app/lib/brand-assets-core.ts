/**
 * BRAND ASSETS ON THE PORTAL, the pure half (the owner, 13 Nov 2026: "in portal can we add a new tab called brand
 * assets, this is essentially the files we gather from brand in clients … and also allow clients to add more files
 * on their portal … make sure it's like how we can add it [on the] brand tab, those kind of files").
 *
 * The client sees the brand guideline PDFs and the brand files on their record, and adds more. What they add goes
 * into the SAME list the dashboard's Brand tab keeps ("logos and brand files", the profile's `logo_files`), under the
 * same rules: the same kinds of file and the same size. No I/O.
 */

import { MAX_ITEMS, type BrandFile } from './brand-profile-core'

/** the kinds of file the dashboard's Brand tab takes; the portal takes exactly these */
export const BRAND_ASSET_EXT = /\.(png|jpe?g|webp|gif|svg|avif|heic|pdf|ai|eps|psd|indd|fig|sketch|zip|otf|ttf|woff2?|mp4|mov)$/i
/** 1 GB a file, the Brand tab's own limit: print masters and brand films are large, and they go straight to storage */
export const MAX_BRAND_ASSET_BYTES = 1024 * 1024 * 1024
export const BRAND_ASSET_WORDS = 'pictures, SVG, PDF, AI, EPS, PSD, fonts, a zip or a video'

export type PortalBrandFile = {
  name: string
  url: string
  /** 'guide' = a brand guidelines PDF the team holds; 'file' = a logo or brand file */
  source: 'guide' | 'file'
  /** a word for what it is: PDF, Picture, Font, Design file, Video, Zip, File */
  kind: string
}

export function assetKind(name: string): string {
  const ext = (name.split('?')[0].split('.').pop() ?? '').toLowerCase()
  if (ext === 'pdf') return 'PDF'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'heic'].includes(ext)) return 'Picture'
  if (['otf', 'ttf', 'woff', 'woff2'].includes(ext)) return 'Font'
  if (['ai', 'eps', 'psd', 'indd', 'fig', 'sketch'].includes(ext)) return 'Design file'
  if (['mp4', 'mov'].includes(ext)) return 'Video'
  if (ext === 'zip') return 'Zip'
  return 'File'
}

/** why this file cannot be added, in plain words, or null when it can */
export function brandAssetProblem(name: string, bytes: number): string | null {
  const n = name.trim()
  if (!n) return 'That file has no name.'
  if (!BRAND_ASSET_EXT.test(n)) return `${n} is not a brand file we can take here. We take ${BRAND_ASSET_WORDS}.`
  if (!Number.isFinite(bytes) || bytes <= 0) return `${n} is empty.`
  if (bytes > MAX_BRAND_ASSET_BYTES) return `${n} is over 1 GB. Send it to your account manager another way.`
  return null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rows = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as object) : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')

/**
 * Everything the client sees on the tab: the guideline PDFs first, then the brand files, each once (by its address).
 * Only real web addresses are listed.
 */
export function portalBrandFiles(docs: unknown, logoFiles: unknown): PortalBrandFile[] {
  const out: PortalBrandFile[] = []
  const seen = new Set<string>()
  const add = (name: string, url: string, source: PortalBrandFile['source']) => {
    if (!/^https:\/\//i.test(url) || seen.has(url)) return
    seen.add(url)
    const shown = name.trim() || decodeURIComponent(url.split('?')[0].split('/').pop() ?? 'file')
    out.push({ name: shown, url, source, kind: assetKind(shown) })
  }
  for (const d of rows(docs)) add(str(d.filename) || str(d.name), str(d.url), 'guide')
  for (const f of rows(logoFiles)) add(str(f.name), str(f.url), 'file')
  return out
}

/** the brand file list with one more on it: once only, and never past the list's own cap */
export function withBrandFile(current: readonly BrandFile[], file: BrandFile): { files: BrandFile[]; added: boolean; full: boolean } {
  if (current.some(f => f.url === file.url)) return { files: [...current], added: false, full: false }
  if (current.length >= MAX_ITEMS) return { files: [...current], added: false, full: true }
  return { files: [...current, { name: file.name.trim().slice(0, 120) || 'file', url: file.url }], added: true, full: false }
}

/** "2.4 MB" */
export function bytesWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
