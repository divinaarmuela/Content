'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Check, Copy, ExternalLink, FolderOpen, FolderPlus, Pencil, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatBytes } from '../../../lib/drive-pull-core'
import { PARALLEL_FILES, PROXY_CHUNK, versionFolderName } from '../../../lib/card-upload-core'

/**
 * THE CARD'S DRIVE FOLDER AND ITS UPLOADER (card-upload-core.ts has the why). Files go from this computer straight
 * into Clients / {Client} / {Card} / V{n} in Google Drive, three at a time, in resumable pieces; when they are in,
 * the card copies them on as its version. A file stopped half way is carried on by picking it again — today or
 * tomorrow. The folder's link sits here for anyone to open or copy, and folders can be added and renamed inside it.
 *
 * At ANY stage, approved too (the owner, 22 Oct 2026: "we can enter files at any given time"). A file on the card is
 * replaced through `replace()` — the card's Replace button: the new file goes into Drive the same way and lands as that
 * piece's next version ("to replace a version we pick the file and put the new version with it").
 */
export type CardUploadHandle = { replace: (assetId: string, assetName: string, file: File) => void }

type Node = { id: string; name: string; fixed: boolean; children: Node[] }
type State = {
  allowed: boolean
  folder?: { id: string; url: string } | null
  version?: number
  version_folder?: string | null
  tree?: Node[]
  unfinished?: { id: string; name: string; size: number | null; received: number; parent: string; version: number | null; replaces: string | null }[]
  waiting?: number
}
type Job = { key: string; file: File; sent: number; status: 'waiting' | 'sending' | 'done' | 'failed'; error?: string; upload?: string; replaces?: { id: string; name: string } }

const api = (id: string) => `/api/production/items/${id}/drive-upload`

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(String((j as { error?: string }).error ?? `Failed (${r.status})`))
  return j as T
}

/** one piece straight to Google; resolves Google's count, or null when the browser may not talk to Google */
function putDirect(uri: string, blob: Blob, start: number, total: number, onBytes: (n: number) => void): Promise<{ done: boolean; received: number } | null> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('PUT', uri)
    x.setRequestHeader('Content-Range', `bytes ${start}-${start + blob.size - 1}/${total}`)
    x.upload.onprogress = e => onBytes(start + e.loaded)
    x.onload = () => {
      if (x.status === 200 || x.status === 201) return resolve({ done: true, received: total })
      if (x.status === 308) {
        const m = /bytes=0-(\d+)/.exec(x.getResponseHeader('Range') ?? '')
        return resolve({ done: false, received: m ? Number(m[1]) + 1 : start + blob.size })
      }
      reject(new Error(`Google answered ${x.status}`))
    }
    x.onerror = () => resolve(null)
    x.send(blob)
  })
}

export default function CardDriveUpload({ itemId, onAllowed, ref }: {
  itemId: string
  /** told once the server has said whether this client's cards upload into Drive — the card hides its older buttons */
  onAllowed?: (allowed: boolean) => void
  ref?: Ref<CardUploadHandle>
}) {
  const [state, setState] = useState<State | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [naming, setNaming] = useState<{ mode: 'new' | 'rename'; id: string | null; name: string } | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const proxy = useRef(false)

  const load = useCallback(async () => {
    const r = await fetch(api(itemId)).then(x => x.json()).catch(() => null)
    if (r) { setState(r as State); onAllowed?.((r as State).allowed === true) }
  }, [itemId, onAllowed])
  useEffect(() => { void load() }, [load])

  const busy = jobs.some(j => j.status === 'sending' || j.status === 'waiting')
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const patch = (key: string, p: Partial<Job>) => setJobs(js => js.map(j => (j.key === key ? { ...j, ...p } : j)))

  /** one file, start to finish: a session (or the old one carried on), then pieces until Google has it all */
  const send = async (job: Job, parent: string | null): Promise<string | null> => {
    patch(job.key, { status: 'sending' })
    try {
      const s = await postJson<{ upload: string; uri: string; received: number; done: boolean; chunk: number }>(api(itemId), {
        action: 'start', name: job.file.name, size: job.file.size, mime: job.file.type, ...(parent ? { parent } : {}), ...(job.replaces ? { replaces: job.replaces.id } : {}),
      })
      let at = s.received
      patch(job.key, { upload: s.upload, sent: at })
      let fails = 0
      while (!s.done && at < job.file.size) {
        const size = proxy.current ? PROXY_CHUNK : s.chunk
        const piece = job.file.slice(at, Math.min(at + size, job.file.size))
        let out: { done: boolean; received: number } | null
        try {
          out = proxy.current ? null : await putDirect(s.uri, piece, at, job.file.size, n => patch(job.key, { sent: n }))
          if (out === null) {
            // the browser may not send to Google itself here: every piece goes through the server from now on
            if (!proxy.current) { proxy.current = true; continue }
            const r = await fetch(`${api(itemId)}/chunk?upload=${encodeURIComponent(s.upload)}&offset=${at}`, { method: 'POST', body: piece })
            const j = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(String((j as { error?: string }).error ?? `Failed (${r.status})`))
            out = j as { done: boolean; received: number }
          }
        } catch (e) {
          // a dropped piece: ask Google where it got to, and carry on from there
          if (++fails > 6) throw e
          await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** fails)))
          const again = await postJson<{ received: number; done: boolean }>(api(itemId), { action: 'start', name: job.file.name, size: job.file.size, mime: job.file.type, ...(parent ? { parent } : {}), ...(job.replaces ? { replaces: job.replaces.id } : {}) })
          if (again.done) break
          at = again.received
          continue
        }
        fails = 0
        at = out.received
        patch(job.key, { sent: at })
        if (out.done) break
      }
      patch(job.key, { status: 'done', sent: job.file.size })
      return s.upload
    } catch (e) {
      patch(job.key, { status: 'failed', error: e instanceof Error ? e.message : 'Upload failed' })
      return null
    }
  }

  /** the finished files go on the card; while another copy is running, ask again in 20 s */
  const finish = async (uploads: string[]) => {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await postJson<{ handedIn: number; waiting: boolean }>(api(itemId), { action: 'finish', uploads })
        if (!r.waiting) {
          if (r.handedIn > 0) toast.success(`${r.handedIn} ${r.handedIn === 1 ? 'file is' : 'files are'} in Drive — copying onto the card`)
          return
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not put the files on the card')
        return
      } finally {
        void load()
      }
      await new Promise(r => setTimeout(r, 20_000))
    }
  }

  const start = async (files: File[], replaces?: { id: string; name: string }) => {
    if (files.length === 0) return
    const parent = target
    const added: Job[] = files.map(f => ({ key: `${f.name}:${f.size}:${f.lastModified}:${Math.random()}`, file: f, sent: 0, status: 'waiting', ...(replaces ? { replaces } : {}) }))
    setJobs(js => [...js.filter(j => j.status !== 'done'), ...added])
    const queue = [...added]
    const done: string[] = []
    await Promise.all(Array.from({ length: Math.min(PARALLEL_FILES, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const id = await send(job, parent)
        if (id) done.push(id)
      }
    }))
    if (input.current) input.current.value = ''
    if (done.length > 0) await finish(done)
  }

  useImperativeHandle(ref, () => ({ replace: (id, name, file) => { void start([file], { id, name }) } }))

  const saveName = async () => {
    if (!naming || !naming.name.trim()) return
    try {
      await postJson(api(itemId), naming.mode === 'new'
        ? { action: 'folder', parent: naming.id, name: naming.name }
        : { action: 'rename', id: naming.id, name: naming.name })
      toast.success(naming.mode === 'new' ? 'Folder made' : 'Folder renamed')
      setNaming(null)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not do that')
    }
  }

  if (!state?.allowed) return null
  const v = state.version ?? 1
  const vName = versionFolderName(v)
  const vNode = state.tree?.find(n => n.id === state.version_folder) ?? null
  const targets: { id: string | null; label: string }[] = [
    { id: null, label: vName },
    ...(vNode ? flat(vNode.children, `${vName}/`) : []),
  ]

  return (
    <section className="rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[15px] font-semibold">This card’s Drive folder</h2>
        {state.folder ? (
          <>
            <a href={state.folder.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-muted">
              <FolderOpen className="h-4 w-4" aria-hidden /> Open in Drive <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(state.folder!.url); toast.success('Link copied — anyone with it can view') }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-muted">
              <Copy className="h-4 w-4" aria-hidden /> Copy link
            </button>
          </>
        ) : <span className="text-[13px] text-muted-foreground">Made when the first file is uploaded</span>}
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Anyone with the link can view. You can also drop files into it from Google Drive on your computer.
      </p>

      <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-semibold">Upload into</span>
            <select value={target ?? ''} onChange={e => setTarget(e.target.value || null)} className="rounded-inner border border-border bg-background px-2 py-1.5">
              {targets.map(t => <option key={t.id ?? 'v'} value={t.id ?? ''}>{t.label}</option>)}
            </select>
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); void start([...e.dataTransfer.files]) }}
            className={`mt-3 flex flex-col items-center gap-2 rounded-inner border-2 border-dashed px-4 py-6 text-center ${over ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-[13px]">Drop videos here, or</p>
            <Button size="sm" onClick={() => input.current?.click()} className="h-9 rounded-full px-4 text-[13px] font-semibold">Choose files</Button>
            <input ref={input} type="file" multiple className="hidden" onChange={e => void start([...(e.target.files ?? [])])} />
            <p className="text-[12px] text-muted-foreground">New files go into {vName} in Drive and onto the card. To swap one in, press Replace on that file below. Keep this page open until it says done.</p>
          </div>
      </>

      {jobs.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {jobs.map(j => (
            <li key={j.key} className="rounded-inner border border-border px-3 py-2 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{j.file.name}{j.replaces && <span className="font-normal text-muted-foreground"> — new version of {j.replaces.name}</span>}</span>
                <span className="shrink-0 text-muted-foreground">
                  {j.status === 'done' ? <span className="inline-flex items-center gap-1 text-accent-green"><Check className="h-3.5 w-3.5" aria-hidden />In Drive</span>
                    : j.status === 'failed' ? <span className="text-destructive">Stopped — pick it again to carry on</span>
                      : j.status === 'waiting' ? 'Waiting'
                        : `${formatBytes(j.sent)} of ${formatBytes(j.file.size)}`}
                </span>
              </div>
              {j.status !== 'done' && j.status !== 'failed' && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.floor((j.sent / Math.max(1, j.file.size)) * 100)}%` }} />
                </div>
              )}
              {j.error && <p className="mt-1 text-[12px] text-destructive">{j.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {(state.unfinished ?? []).filter(u => !jobs.some(j => j.upload === u.id)).length > 0 && (
        <div className="mt-4 rounded-inner bg-tint-amber/40 px-3 py-2 text-[13px]">
          <p className="font-semibold">Not finished yet — pick these files again and they carry on where they stopped</p>
          <ul className="mt-1">
            {(state.unfinished ?? []).filter(u => !jobs.some(j => j.upload === u.id)).map(u => (
              <li key={u.id}>{u.name} — {formatBytes(u.received)} of {u.size ? formatBytes(u.size) : '?'} sent{u.replaces ? ' (a replacement — press Replace on that file and pick it again)' : ''}</li>
            ))}
          </ul>
        </div>
      )}
      {(state.waiting ?? 0) > 0 && !busy && (
        <p className="mt-3 text-[13px] text-muted-foreground">{state.waiting} {state.waiting === 1 ? 'file is' : 'files are'} in Drive, waiting to go on the card.</p>
      )}

      {state.folder && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <h3 className="mr-auto text-[13px] font-semibold">Folders</h3>
            <button type="button" onClick={() => setNaming({ mode: 'new', id: state.version_folder ?? null, name: '' })}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12px] font-semibold hover:bg-muted">
              <FolderPlus className="h-3.5 w-3.5" aria-hidden /> New folder in {vName}
            </button>
          </div>
          {naming && (
            <div className="mt-2 flex items-center gap-2">
              <Input autoFocus value={naming.name} onChange={e => setNaming({ ...naming, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setNaming(null) }}
                placeholder={naming.mode === 'new' ? 'Folder name, e.g. Reels' : 'New name'} className="h-8 text-[13px]" />
              <Button size="sm" onClick={() => void saveName()} className="h-8 rounded-full px-3 text-[12px]">{naming.mode === 'new' ? 'Make' : 'Rename'}</Button>
              <button type="button" aria-label="Cancel" onClick={() => setNaming(null)} className="rounded-full p-1 hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
            </div>
          )}
          <Tree nodes={state.tree ?? []} onRename={n => setNaming({ mode: 'rename', id: n.id, name: n.name })} onAdd={n => setNaming({ mode: 'new', id: n.id, name: '' })} />
        </div>
      )}
    </section>
  )
}

function flat(nodes: Node[], prefix: string): { id: string; label: string }[] {
  return nodes.flatMap(n => [{ id: n.id, label: `${prefix}${n.name}` }, ...flat(n.children, `${prefix}${n.name}/`)])
}

function Tree({ nodes, onRename, onAdd, depth = 0 }: { nodes: Node[]; onRename: (n: Node) => void; onAdd: (n: Node) => void; depth?: number }) {
  if (nodes.length === 0) return depth === 0 ? <p className="mt-2 text-[12px] text-muted-foreground">No folders yet.</p> : null
  return (
    <ul className={depth === 0 ? 'mt-2' : 'ml-4'}>
      {nodes.map(n => (
        <li key={n.id}>
          <div className="group flex items-center gap-1.5 py-0.5 text-[13px]">
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span>{n.name}</span>
            <button type="button" onClick={() => onAdd(n)} aria-label={`New folder in ${n.name}`} className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"><FolderPlus className="h-3 w-3" aria-hidden /></button>
            {!n.fixed && <button type="button" onClick={() => onRename(n)} aria-label={`Rename ${n.name}`} className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"><Pencil className="h-3 w-3" aria-hidden /></button>}
          </div>
          <Tree nodes={n.children} onRename={onRename} onAdd={onAdd} depth={depth + 1} />
        </li>
      ))}
    </ul>
  )
}
