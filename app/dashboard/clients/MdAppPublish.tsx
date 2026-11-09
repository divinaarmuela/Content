'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, X, Send, Pencil, Trash2, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PlatformIcon from '../social/PlatformIcon'
import { uploadMedia } from '../uploadMedia'
import type { InboxPost } from '@/app/lib/md-app-inbox-core'

/**
 * THE META CARD'S PUBLISH TAB (9 Nov 2026). Write a post for the client's Instagram or Facebook Page, see it as it will
 * look, and publish it now through the client's own MD App connection; Facebook Page posts can then be edited or
 * deleted from the list below. What Meta's App Review watches for instagram_content_publish and pages_manage_posts.
 */

type Platform = 'instagram' | 'facebook'
type Posts = { instagram: InboxPost[]; facebook: InboxPost[]; igUsername: string | null; pageName: string | null }

const when = (t: string | null) => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)

export default function MdAppPublish({ clientId }: { clientId: string }) {
  const api = (p: string) => `/api/meta/md-app/${p}?clientId=${encodeURIComponent(clientId)}`
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [posts, setPosts] = useState<Posts | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [last, setLast] = useState<{ link: string | null; platform: Platform } | null>(null)
  const key = useRef(newKey())
  const file = useRef<HTMLInputElement>(null)

  const loadPosts = useCallback(async () => {
    const res = await fetch(`${api('inbox')}&view=posts`).catch(() => null)
    if (res?.ok) setPosts(await res.json())
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadPosts() }, [loadPosts])

  const name = platform === 'instagram' ? (posts?.igUsername ?? 'instagram') : (posts?.pageName ?? 'Facebook Page')
  const max = platform === 'instagram' ? 2200 : 5000
  const canPublish = !busy && !uploading && (platform === 'instagram' ? !!image : !!(image || text.trim()))

  const pick = async (f: File | undefined) => {
    if (!f) return
    if (!/^image\/(jpeg|png)$/.test(f.type)) { toast.error('Use a JPEG or PNG photo'); return }
    setUploading(true)
    try { setImage((await uploadMedia(f, { purpose: 'production' })).url) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
    finally { setUploading(false); if (file.current) file.current.value = '' }
  }

  const send = async (k: string, body: Record<string, unknown>) => {
    setBusy(k)
    try {
      const res = await fetch(api('publish'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({})) as { error?: string; link?: string | null }
      if (!res.ok) { toast.error(json.error ?? 'That did not work'); return null }
      return json
    } finally { setBusy(null) }
  }

  const publish = async () => {
    if (!confirm(`Publish this to ${platform === 'instagram' ? `@${name}` : name} now? It goes live straight away.`)) return
    const out = await send('publish', { action: 'publish', platform, imageUrl: image, text, key: key.current })
    if (!out) return
    toast.success(platform === 'instagram' ? 'Published to Instagram' : 'Published to the Page')
    setLast({ link: out.link ?? null, platform }); setText(''); setImage(null); key.current = newKey()
    setTimeout(() => void loadPosts(), 1500)
  }

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-full border border-border bg-surface p-1">
        {(['instagram', 'facebook'] as const).map(p => (
          <button key={p} type="button" onClick={() => setPlatform(p)}
            className={`flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors ${platform === p ? 'bg-ink text-cream dark:bg-cream dark:text-ink' : 'text-muted-foreground hover:text-foreground'}`}>
            <PlatformIcon platform={p} size={14} />{p === 'instagram' ? 'Instagram' : 'Facebook Page'}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── the composer ── */}
        <div className="space-y-3 rounded-inner border border-border bg-surface p-4">
          <input ref={file} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => void pick(e.target.files?.[0])} />
          {image ? (
            <div className="relative w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" className="h-40 rounded-tile object-cover" />
              <button type="button" aria-label="Remove photo" onClick={() => setImage(null)} className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => file.current?.click()} disabled={uploading}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-tile border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground">
              <ImagePlus className="h-6 w-6" />
              <span className="text-[13px]">{uploading ? 'Uploading…' : `Add a photo${platform === 'instagram' ? ' (required)' : ' (optional)'}`}</span>
              <span className="text-[11px]">JPEG or PNG</span>
            </button>
          )}
          <div>
            <textarea value={text} onChange={e => setText(e.target.value.slice(0, max))} rows={5}
              placeholder={platform === 'instagram' ? 'Write a caption…' : 'What do you want to say?'}
              className="w-full resize-y rounded-inner border border-border bg-background px-3 py-2.5 text-[14px] outline-none focus:ring-2 focus:ring-ring" />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{text.length.toLocaleString()} / {max.toLocaleString()}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canPublish} onClick={() => void publish()}><Send className="h-4 w-4" /> {busy === 'publish' ? 'Publishing…' : 'Publish now'}</Button>
            <span className="text-[12px] text-muted-foreground">Goes live on {platform === 'instagram' ? `@${name}` : name} straight away.</span>
          </div>
          {last && (
            <p className="rounded-inner bg-tint-green px-3 py-2 text-[13px]">
              Published. {last.link && <a href={last.link} target="_blank" rel="noreferrer noopener" className="font-medium underline">See it on {last.platform === 'instagram' ? 'Instagram' : 'Facebook'}</a>}
            </p>
          )}
        </div>

        {/* ── the preview ── */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
          <div className="overflow-hidden rounded-inner border border-border bg-background">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <PlatformIcon platform={platform} size={28} />
              <span className="text-[13px] font-semibold">{name}</span>
            </div>
            {platform === 'facebook' && text && <p className="whitespace-pre-wrap px-3 pb-2.5 text-[14px] leading-snug">{text}</p>}
            {image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={image} alt="" className="aspect-square w-full object-cover" />
              : platform === 'instagram' && <div className="flex aspect-square w-full items-center justify-center bg-paper text-[12px] text-muted-foreground">Your photo</div>}
            {platform === 'instagram' && (
              <p className="whitespace-pre-wrap px-3 py-2.5 text-[13px] leading-snug"><span className="font-semibold">{name}</span> {text || <span className="text-muted-foreground">Your caption</span>}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── recent posts: Facebook ones can be edited or deleted ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[14px] font-semibold">Recent {platform === 'instagram' ? 'Instagram posts' : 'Page posts'}</h4>
          <Button size="sm" variant="outline" onClick={() => void loadPosts()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
        {!posts ? <p className="text-sm text-muted-foreground">Loading…</p>
          : posts[platform].length === 0 ? <p className="text-sm text-muted-foreground">Nothing posted yet.</p>
          : (
            <ul className="divide-y divide-border overflow-hidden rounded-inner border border-border bg-surface">
              {posts[platform].slice(0, 8).map(p => (
                <li key={p.id} className="flex flex-wrap items-start gap-3 p-3">
                  {p.thumb
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.thumb} alt="" className="h-14 w-14 shrink-0 rounded-tile object-cover" />
                    : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-tile bg-paper"><PlatformIcon platform={platform} size={18} /></span>}
                  <div className="min-w-0 flex-1">
                    {editing?.id === p.id ? (
                      <div className="space-y-2">
                        <textarea value={editing.text} onChange={e => setEditing({ id: p.id, text: e.target.value })} rows={3}
                          className="w-full resize-y rounded-inner border border-border bg-background px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-ring" />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={!!busy || !editing.text.trim()} onClick={async () => {
                            if (await send(`e:${p.id}`, { action: 'edit', postId: p.id, text: editing.text })) { toast.success('Post updated'); setEditing(null); void loadPosts() }
                          }}>{busy === `e:${p.id}` ? 'Saving…' : 'Save'}</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="line-clamp-2 whitespace-pre-wrap text-[14px] leading-snug">{p.caption || <span className="text-muted-foreground">No text</span>}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">{when(p.time)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {p.link && <Button size="sm" variant="outline" asChild><a href={p.link} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3.5 w-3.5" /> Open</a></Button>}
                    {platform === 'facebook' && editing?.id !== p.id && <>
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setEditing({ id: p.id, text: p.caption })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={async () => {
                        if (!confirm('Delete this post from the Page? This cannot be undone.')) return
                        if (await send(`d:${p.id}`, { action: 'delete', postId: p.id })) { toast.success('Post deleted'); void loadPosts() }
                      }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                    </>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  )
}
