'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus, Star, Trash2, Upload, X } from 'lucide-react'
import { moveItem } from '@/app/lib/website-gallery-core'
import { uploadMedia } from '../uploadMedia'

type Section = { heading?: string; paragraphs: string[]; callout?: string }

type Post = {
  id: string
  slug: string
  title: string
  standfirst: string
  category: string
  cover_url: string
  read_mins: number
  published_at: string | null
  featured: boolean
  sections: Section[]
  sort_order: number
  published: boolean
}

const EMPTY: Omit<Post, 'id'> = {
  slug: '', title: '', standfirst: '', category: '', cover_url: '',
  read_mins: 3, published_at: null, featured: false, sections: [],
  sort_order: 100, published: false,
}

/** Slug from a title, so the author never has to think about URLs. */
function slugify(title: string): string {
  return title.toLowerCase().trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Rough reading time. Overwritable — it is a hint, not a measurement. */
function estimateReadMins(sections: Section[]): number {
  const words = sections
    .flatMap(s => [s.heading ?? '', ...s.paragraphs, s.callout ?? ''])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

function SectionEditor({ sections, onChange }: {
  sections: Section[]
  onChange: (next: Section[]) => void
}) {
  const patch = (i: number, next: Partial<Section>) =>
    onChange(sections.map((s, j) => (j === i ? { ...s, ...next } : s)))

  return (
    <div className="flex flex-col gap-3">
      {sections.map((section, i) => (
        <Card key={i} className="border-zinc-200 dark:border-zinc-800">
          <CardContent className="flex flex-col gap-2.5 py-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
                Section {i + 1}
              </span>
              <div className="ml-auto flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" type="button" disabled={i === 0}
                  onClick={() => onChange(moveItem(sections, i, -1))} aria-label="Move up">
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" type="button"
                  disabled={i === sections.length - 1}
                  onClick={() => onChange(moveItem(sections, i, 1))} aria-label="Move down">
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600"
                  type="button" onClick={() => onChange(sections.filter((_, j) => j !== i))}
                  aria-label="Remove section">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <Input
              value={section.heading ?? ''}
              placeholder="Heading (optional — leave blank for a continuation)"
              onChange={e => patch(i, { heading: e.target.value })}
            />
            <Textarea
              rows={5}
              value={section.paragraphs.join('\n\n')}
              placeholder="Paragraphs — separate them with a blank line"
              onChange={e => patch(i, {
                // a blank line is how writers already separate paragraphs;
                // asking them to manage an array would be a worse editor
                paragraphs: e.target.value.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean),
              })}
            />
            <Input
              value={section.callout ?? ''}
              placeholder="Pull quote (optional)"
              onChange={e => patch(i, { callout: e.target.value })}
            />
          </CardContent>
        </Card>
      ))}

      <Button variant="outline" size="sm" type="button" className="self-start"
        onClick={() => onChange([...sections, { paragraphs: [] }])}>
        <Plus className="h-3.5 w-3.5" /> Add section
      </Button>
    </div>
  )
}

export default function JournalAdmin() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [editing, setEditing] = useState<Partial<Post> | null>(null)
  const [deleting, setDeleting] = useState<Post | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const coverRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/website/journal')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setPosts(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load — has journal.sql been run?')
      setPosts([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const set = (patch: Partial<Post>) => setEditing(p => ({ ...p, ...patch }))

  const save = async () => {
    if (!editing?.title?.trim()) return toast.error('A title is required')
    setSaving(true)
    try {
      const slug = editing.slug?.trim() || slugify(editing.title)
      const payload = { ...editing, slug }
      const res = await fetch(
        editing.id ? `/api/website/journal/${editing.id}` : '/api/website/journal',
        {
          method: editing.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success(editing.id ? 'Post updated' : 'Post created')
      setEditing(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (posts === null) return <Skeleton className="h-64 w-full" />

  // ── editor ──
  if (editing) {
    const sections = editing.sections ?? []
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h3 className="text-sm font-semibold">{editing.id ? 'Edit post' : 'New post'}</h3>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={!!editing.published} onCheckedChange={v => set({ published: v })} />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Published</span>
            </div>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>

        <Card><CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Title</Label>
            <Input value={editing.title ?? ''} onChange={e => set({ title: e.target.value })} />
          </div>

          <div className="grid gap-1.5">
            <Label>Slug <span className="text-xs text-zinc-400">(auto from the title)</span></Label>
            <Input
              value={editing.slug ?? ''}
              placeholder={editing.title ? slugify(editing.title) : 'my-post'}
              onChange={e => set({ slug: e.target.value })}
              className="font-mono text-sm"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Topic <span className="text-xs text-zinc-400">(becomes a filter on /journal)</span></Label>
            <Input value={editing.category ?? ''} placeholder="Content, Branding, Paid…"
              onChange={e => set({ category: e.target.value })} />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Standfirst <span className="text-xs text-zinc-400">(the line under the title)</span></Label>
            <Textarea rows={2} value={editing.standfirst ?? ''}
              onChange={e => set({ standfirst: e.target.value })} />
          </div>

          <div className="grid gap-1.5">
            <Label>Publish date</Label>
            <Input type="date" value={editing.published_at ?? ''}
              onChange={e => set({ published_at: e.target.value || null })} />
          </div>

          <div className="grid gap-1.5">
            <Label>Read time <span className="text-xs text-zinc-400">(minutes)</span></Label>
            <div className="flex gap-2">
              <Input type="number" min={1} value={editing.read_mins ?? 3}
                onChange={e => set({ read_mins: Number(e.target.value) || 1 })} />
              <Button variant="outline" size="sm" type="button"
                onClick={() => set({ read_mins: estimateReadMins(sections) })}>
                Estimate
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Cover image</Label>
            <div className="flex items-center gap-3">
              {editing.cover_url
                ? /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={editing.cover_url} alt="" className="h-20 w-32 rounded-md border border-zinc-200 object-cover dark:border-zinc-800" />
                : <div className="h-20 w-32 rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800" />}
              <Input value={editing.cover_url ?? ''} placeholder="Paste a URL or upload →"
                onChange={e => set({ cover_url: e.target.value })} className="flex-1" />
              <Button variant="outline" type="button" disabled={busy}
                onClick={() => coverRef.current?.click()}>
                <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload'}
              </Button>
              <input ref={coverRef} type="file" accept="image/*,video/*" hidden
                onChange={async e => {
                  const file = e.target.files?.[0]; e.target.value = ''
                  if (!file) return
                  setBusy(true)
                  try {
                    const { url } = await uploadMedia(file, { purpose: 'journal' })
                    set({ cover_url: url })
                    toast.success('Cover uploaded')
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Upload failed')
                  } finally { setBusy(false) }
                }} />
            </div>
          </div>

          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch checked={!!editing.featured} onCheckedChange={v => set({ featured: v })} />
            <span className="text-sm">Feature this post</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              — only one post can be featured; unfeature the current one first
            </span>
          </div>
        </CardContent></Card>

        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400">Body</p>
          <SectionEditor sections={sections} onChange={next => set({ sections: next })} />
        </div>
      </div>
    )
  }

  // ── list ──
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold">Journal</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {posts.length} post{posts.length === 1 ? '' : 's'} · these are the articles on /journal
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {posts.length === 0 && (
            <Button variant="outline" size="sm" onClick={async () => {
              const res = await fetch('/api/website/journal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'import-shipped' }),
              })
              const json = await res.json()
              if (!res.ok) return toast.error(json.error ?? 'Import failed')
              toast.success(`Imported ${json.imported} article${json.imported === 1 ? '' : 's'}`)
              load()
            }}>
              Import the existing articles
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="h-4 w-4" /> New post
          </Button>
        </div>
      </div>

      {posts.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No posts yet. The site is still showing the articles written into the code —
              import them to make them editable.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                <TableHead>Title</TableHead>
                <TableHead className="w-28">Topic</TableHead>
                <TableHead className="w-28">Date</TableHead>
                <TableHead className="w-24">Published</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map(p => (
                <TableRow key={p.id} className={p.published ? '' : 'opacity-60'}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {p.featured && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.title}</p>
                        <p className="truncate font-mono text-xs text-zinc-400">/journal/{p.slug}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.category
                      ? <Badge variant="outline" className="font-normal">{p.category}</Badge>
                      : <span className="text-xs text-zinc-400">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500">
                    {p.published_at ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.published}
                      onCheckedChange={async v => {
                        const res = await fetch(`/api/website/journal/${p.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ published: v }),
                        })
                        if (!res.ok) return toast.error((await res.json()).error ?? 'Failed')
                        load()
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => setEditing(p)} aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => setDeleting(p)} aria-label="Delete">
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

      <AlertDialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the post and its URL permanently. Unpublishing hides it without losing it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!deleting) return
                const res = await fetch(`/api/website/journal/${deleting.id}`, { method: 'DELETE' })
                if (!res.ok) toast.error((await res.json()).error ?? 'Delete failed')
                else toast.success('Post deleted')
                setDeleting(null)
                load()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
