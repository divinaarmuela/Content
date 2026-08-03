'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ArrowLeft, ChevronDown, ChevronUp, Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { moveItem } from '@/app/lib/website-gallery-core'

type Project = {
  id: string
  slug: string
  name: string
  industry: string
  tag: string
  services: string[]
  description: string
  card_media_url: string
  hero_media_url: string
  gallery_urls: string[]
  website_url: string | null
  result: string | null
  challenge: string[]
  approach: string[]
  outcome: string[]
  sort_order: number
  published: boolean
}

const EMPTY: Omit<Project, 'id'> = {
  slug: '', name: '', industry: '', tag: '', services: [], description: '',
  card_media_url: '', hero_media_url: '', gallery_urls: [], website_url: null, result: null,
  challenge: [], approach: [], outcome: [], sort_order: 100, published: false,
}

function MediaThumb({ url, size = 'sm' }: { url: string; size?: 'sm' | 'lg' }) {
  const cls = size === 'sm'
    ? 'h-11 w-16 rounded-md object-cover bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-800'
    : 'h-20 w-32 rounded-md object-cover bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-800'
  if (!url) return <div className={cls} />
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return <video src={url} muted className={cls} />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={cls} />
}

function UploadField({ label, hint, value, onChange, purpose }: {
  label: string; hint: string; value: string; onChange: (url: string) => void; purpose: string
}) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', purpose)
      const res = await fetch('/api/website/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      onChange(json.url)
      toast.success(`${label} uploaded`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      <div className="flex items-center gap-3">
        <MediaThumb url={value} size="lg" />
        <Input
          value={value}
          placeholder="Paste a URL or upload →"
          onChange={e => onChange(e.target.value)}
          className="flex-1"
        />
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} type="button">
          <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
        />
      </div>
    </div>
  )
}

function GalleryField({ urls, onChange }: { urls: string[]; onChange: (urls: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const append = (url: string) => {
    const clean = url.trim()
    if (clean) onChange([...urls, clean])
  }

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'gallery')
      const res = await fetch('/api/website/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      append(json.url)
      toast.success('Gallery media uploaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-1.5">
      <Label>Gallery</Label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Media strip shown when the homepage row is expanded, in this order. Images or videos.
      </p>
      {urls.length > 0 && (
        <div className="flex flex-col gap-2">
          {urls.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-3">
              <MediaThumb url={url} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{url}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled={i === 0}
                onClick={() => onChange(moveItem(urls, i, -1))} aria-label="Move up">
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled={i === urls.length - 1}
                onClick={() => onChange(moveItem(urls, i, 1))} aria-label="Move down">
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                type="button" onClick={() => onChange(urls.filter((_, j) => j !== i))} aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Input
          value={draft}
          placeholder="Paste a URL and press Add, or upload →"
          onChange={e => setDraft(e.target.value)}
          className="flex-1"
        />
        <Button variant="outline" type="button" disabled={!draft.trim()}
          onClick={() => { append(draft); setDraft('') }}>
          Add
        </Button>
        <Button variant="outline" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
        />
      </div>
    </div>
  )
}

export default function WebsiteAdminPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [editing, setEditing] = useState<Partial<Project> | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/website/projects')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
      setProjects(await res.json())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load — has website_cms.sql been run in Supabase?')
      setProjects([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const seed = async () => {
    const res = await fetch('/api/website/seed', { method: 'POST' })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? 'Import failed')
    toast.success(`Imported ${json.created} projects (${json.skipped} already existed)`)
    load()
  }

  const togglePublish = async (p: Project) => {
    const res = await fetch(`/api/website/projects/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: !p.published }),
    })
    if (!res.ok) return toast.error('Update failed')
    toast.success(!p.published ? `${p.name} published` : `${p.name} unpublished`)
    load()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/website/projects/${deleting.id}`, { method: 'DELETE' })
    if (!res.ok) return toast.error('Delete failed')
    toast.success(`${deleting.name} deleted`)
    setDeleting(null)
    load()
  }

  const save = async () => {
    if (!editing) return
    if (!editing.name || !editing.slug) return toast.error('Name and slug are required')
    setSaving(true)
    try {
      const isNew = !editing.id
      const res = await fetch(isNew ? '/api/website/projects' : `/api/website/projects/${editing.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success(isNew ? 'Project created' : 'Project saved')
      setEditing(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const set = (patch: Partial<Project>) => setEditing(e => ({ ...e, ...patch }))
  const paras = (v: string) => v.split('\n\n').map(s => s.trim()).filter(Boolean)

  /* ── Edit view ── */
  if (editing) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h2 className="text-lg font-semibold tracking-tight">
            {editing.id ? `Edit · ${editing.name}` : 'New project'}
          </h2>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={!!editing.published} onCheckedChange={v => set({ published: v })} id="pub" />
              <Label htmlFor="pub" className="text-sm">{editing.published ? 'Published' : 'Draft'}</Label>
            </div>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save project'}</Button>
          </div>
        </div>

        <Card>
          <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input value={editing.name ?? ''} onChange={e => set({ name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Slug * <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">/work/…</span></Label>
              <Input value={editing.slug ?? ''} onChange={e => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} className="font-mono text-sm" />
            </div>
            <div className="grid gap-1.5">
              <Label>Industry</Label>
              <Input value={editing.industry ?? ''} onChange={e => set({ industry: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Tag <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">e.g. HOSP_01</span></Label>
              <Input value={editing.tag ?? ''} onChange={e => set({ tag: e.target.value })} className="font-mono text-sm" />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Services <span className="text-xs text-zinc-400 dark:text-zinc-500">(comma separated)</span></Label>
              <Input value={(editing.services ?? []).join(', ')} onChange={e => set({ services: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Description <span className="text-xs text-zinc-400 dark:text-zinc-500">(card + case page intro)</span></Label>
              <Textarea rows={2} value={editing.description ?? ''} onChange={e => set({ description: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <UploadField
                label="Card media"
                hint="Homepage row thumbnail + work grid card. Image or video; portrait works."
                value={editing.card_media_url ?? ''}
                onChange={url => set({ card_media_url: url })}
                purpose="card"
              />
            </div>
            <div className="sm:col-span-2">
              <UploadField
                label="Hero media"
                hint="Top of the case study page. Landscape image or video recommended."
                value={editing.hero_media_url ?? ''}
                onChange={url => set({ hero_media_url: url })}
                purpose="hero"
              />
            </div>
            <div className="sm:col-span-2">
              <GalleryField
                urls={editing.gallery_urls ?? []}
                onChange={gallery_urls => set({ gallery_urls })}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Website URL <span className="text-xs text-zinc-400 dark:text-zinc-500">(optional — adds a &ldquo;Visit website&rdquo; button to the homepage row)</span></Label>
              <Input
                value={editing.website_url ?? ''}
                placeholder="https://client-site.com"
                onChange={e => set({ website_url: e.target.value || null })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Result <span className="text-xs text-zinc-400 dark:text-zinc-500">(optional, e.g. 0 → 30 bookings / day)</span></Label>
              <Input value={editing.result ?? ''} onChange={e => set({ result: e.target.value || null })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Sort order <span className="text-xs text-zinc-400 dark:text-zinc-500">(lower = first)</span></Label>
              <Input type="number" value={editing.sort_order ?? 100} onChange={e => set({ sort_order: Number(e.target.value) })} className="font-mono" />
            </div>
            {(['challenge', 'approach', 'outcome'] as const).map(key => (
              <div key={key} className="grid gap-1.5 sm:col-span-2">
                <Label className="capitalize">The {key} <span className="text-xs text-zinc-400 dark:text-zinc-500">(blank line between paragraphs)</span></Label>
                <Textarea rows={4} value={(editing[key] ?? []).join('\n\n')} onChange={e => set({ [key]: paras(e.target.value) })} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ── List view ── */
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Website projects</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Drives the homepage rows, /work grid, and case study pages. Changes go live within 5 minutes.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {projects !== null && projects.length === 0 && (
            <Button variant="outline" size="sm" onClick={seed}>
              <Download className="h-4 w-4" /> Import current site projects
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="h-4 w-4" /> New project
          </Button>
        </div>
      </div>

      {projects === null ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No projects in the database yet — the site currently serves the built-in list.<br />
            Click <span className="font-medium">Import current site projects</span> to bring them in, then edit freely.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                <TableHead className="w-20">Media</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Live</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map(p => (
                <TableRow key={p.id}>
                  <TableCell><MediaThumb url={p.card_media_url} /></TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">/work/{p.slug}</div>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-600 dark:text-zinc-400">{p.industry || '—'}</TableCell>
                  <TableCell>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {p.services.slice(0, 2).map(s => (
                        <Badge key={s} variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch checked={p.published} onCheckedChange={() => togglePublish(p)} aria-label={`Publish ${p.name}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(p)} aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300" onClick={() => setDeleting(p)} aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes this case study from the website (within 5 minutes). This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
