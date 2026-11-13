'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, FileText, Plus } from 'lucide-react'
import { BRAND_ASSET_WORDS, brandAssetProblem, bytesWords, type PortalBrandFile } from '../../lib/brand-assets-core'

/**
 * THE PORTAL'S BRAND ASSETS TAB (the owner, 13 Nov 2026): the client's brand guideline PDFs and brand files, and one
 * button to add more. A file goes straight from the client's device to storage, with its progress shown, and then
 * joins the list. Nothing here deletes: taking a file off is the team's, on the dashboard's Brand tab.
 */

const NAME_KEY = 'mdm-portal-name'
type Sending = { name: string; size: number; done: number; error?: string }

/** one file to storage, telling how far it has got */
function put(url: string, file: File, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload did not go through')))
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and add it again.'))
    xhr.send(file)
  })
}

export default function OnePortalBrand({ token, files: first, mayAdd }: {
  token: string
  files: PortalBrandFile[]
  /** the business's own link may add; a person's link only looks */
  mayAdd: boolean
}) {
  const [files, setFiles] = useState(first)
  const [sending, setSending] = useState<Sending[]>([])
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? '') } catch { /* private window */ } }, [])

  const api = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/portal/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(String(json.error ?? 'Something went wrong'))
    return json
  }

  const add = async (picked: File[]) => {
    if (picked.length === 0 || busy) return
    setBusy(true)
    const rows: Sending[] = picked.map(f => ({ name: f.name, size: f.size, done: 0 }))
    setSending(rows)
    const mark = (i: number, patch: Partial<Sending>) => setSending(list => list.map((r, n) => (n === i ? { ...r, ...patch } : r)))
    const uploaded: { name: string; url: string }[] = []
    for (let i = 0; i < picked.length; i++) {
      const file = picked[i]
      const problem = brandAssetProblem(file.name, file.size)
      if (problem) { mark(i, { error: problem }); continue }
      try {
        const signed = await api({ action: 'sign', name: file.name, size: file.size, type: file.type })
        await put(String(signed.signedUrl), file, sent => mark(i, { done: sent }))
        mark(i, { done: file.size })
        uploaded.push({ name: file.name, url: String(signed.publicUrl) })
      } catch (e) {
        mark(i, { error: e instanceof Error ? e.message : 'Could not add this file' })
      }
    }
    if (uploaded.length) {
      try {
        const json = await api({ action: 'add', files: uploaded, who: name.trim() })
        if (Array.isArray(json.files)) setFiles(json.files)
        toast.success(uploaded.length === 1 ? 'File added. Your team has been told.' : `${uploaded.length} files added. Your team has been told.`)
        setSending(list => list.filter(r => r.error))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not add the files')
      }
    }
    if (input.current) input.current.value = ''
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-5" data-portal-brand>
      <p className="max-w-2xl text-[15px] text-muted-foreground">
        Your brand guidelines, logos and brand files, in one place. {mayAdd ? `Add anything your team should work from: ${BRAND_ASSET_WORDS}, up to 1 GB each.` : ''}
      </p>

      {mayAdd && (
        <div className="flex flex-col gap-3 rounded-[22px] border border-border bg-card p-4 sm:flex-row sm:items-center">
          <input value={name} onChange={e => { setName(e.target.value); try { localStorage.setItem(NAME_KEY, e.target.value.trim()) } catch { /* private window */ } }}
            placeholder="Your name" aria-label="Your name"
            className="h-11 w-full min-w-0 shrink-0 rounded-full border border-border bg-background px-4 text-[15px] outline-none sm:w-[240px]" />
          <input ref={input} type="file" multiple className="sr-only" aria-label="Choose brand files to add"
            onChange={e => void add(Array.from(e.target.files ?? []))} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[15px] font-semibold text-background disabled:opacity-60">
            <Plus className="h-4 w-4" aria-hidden /> {busy ? 'Adding…' : 'Add files'}
          </button>
        </div>
      )}

      {sending.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {sending.map((r, i) => (
            <li key={`${r.name}-${i}`} className="rounded-[14px] border border-border p-3">
              <div className="flex items-center justify-between gap-3 text-[14px]">
                <span className="min-w-0 truncate font-semibold">{r.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{r.error ? 'Not added' : r.done >= r.size ? 'Uploaded' : `${Math.round((r.done / Math.max(1, r.size)) * 100)}%`}</span>
              </div>
              {r.error
                ? <p role="alert" className="mt-1 text-[13px] text-red-500 dark:text-red-300">{r.error}</p>
                : <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${Math.min(100, (r.done / Math.max(1, r.size)) * 100)}%` }} /></div>}
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-border px-4 py-12 text-center text-[15px] text-muted-foreground">
          No brand files yet. {mayAdd ? 'Add your logo, brand guidelines or fonts and your team will work from them.' : 'When there are some, they show here.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map(f => (
            <li key={f.url}>
              <a href={f.url} target="_blank" rel="noreferrer noopener"
                className="flex min-h-14 items-center gap-3 rounded-[18px] border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.06] text-muted-foreground"><FileText className="h-5 w-5" strokeWidth={1.6} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{f.name}</span>
                  <span className="block text-[13px] text-muted-foreground">{f.source === 'guide' ? 'Brand guidelines' : 'Brand file'} · {f.kind}</span>
                </span>
                <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">Open {f.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {sending.some(r => !r.error && r.done < r.size) && <p className="text-[13px] text-muted-foreground">Keep this page open until the upload finishes{sending[0] ? ` (${bytesWords(sending.reduce((n, r) => n + r.size, 0))})` : ''}.</p>}
    </div>
  )
}
