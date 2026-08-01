'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { AlertTriangle, ImagePlus, Info, Loader2, Send, X } from 'lucide-react'
import PlatformIcon, { brandFor } from './PlatformIcon'
import {
  validatePost, postWarnings, PLATFORM_RULES, isPlatform,
  REEL_REQUIREMENTS, STORY_REQUIREMENTS,
  type MediaItem, type Platform, type PostKind,
} from '../../lib/publish-core'

type Account = {
  id: string; client_id: string | null; platform: string
  provider_account_id: string; username: string | null; name: string | null; active: boolean
}
type Client = { id: string; name: string }

export default function ComposeDialog({
  open, onOpenChange, clients, accounts, defaultClientId, onPublished,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  clients: Client[]
  accounts: Account[]
  defaultClientId?: string
  onPublished?: () => void
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [selected, setSelected] = useState<string[]>([])
  const [caption, setCaption] = useState('')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [when, setWhen] = useState('')
  const [kind, setKind] = useState<PostKind | 'auto'>('auto')
  const [shareToFeed, setShareToFeed] = useState(true)
  const [firstComment, setFirstComment] = useState('')
  const [collaborators, setCollaborators] = useState('')
  const [thumbSeconds, setThumbSeconds] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (defaultClientId) setClientId(defaultClientId) }, [defaultClientId])

  // changing client invalidates the chosen accounts — they belong to the old one
  useEffect(() => { setSelected([]) }, [clientId])

  const available = accounts.filter(a => a.active && a.client_id === clientId)
  const chosen = available.filter(a => selected.includes(a.id))
  const platforms = useMemo(
    () => [...new Set(chosen.map(a => a.platform))].filter(isPlatform) as Platform[],
    [chosen]
  )

  // 'auto' leaves it to the provider: a lone video becomes a Reel, several
  // images become a carousel. Only override when the operator says so.
  const effectiveKind: PostKind | undefined = kind === 'auto' ? undefined : kind
  const kinds = useMemo(() => {
    if (!effectiveKind) return undefined
    return Object.fromEntries(platforms.map(p => [p, effectiveKind])) as Partial<Record<Platform, PostKind>>
  }, [platforms, effectiveKind])

  const issues = useMemo(
    () => (platforms.length === 0 && !caption && media.length === 0
      ? []
      : validatePost({ caption, media, platforms, kinds })),
    [caption, media, platforms, kinds]
  )

  const warnings = useMemo(
    () => (platforms.length === 0 ? [] : postWarnings({ caption, media, kinds })),
    [caption, media, kinds, platforms]
  )

  const isReel = effectiveKind === 'reel' || (kind === 'auto' && media.length === 1 && media[0]?.type === 'video')

  // the tightest caption limit among the chosen platforms is what actually binds
  const limit = platforms.length
    ? Math.min(...platforms.map(p => PLATFORM_RULES[p].captionMax))
    : null

  const reset = () => {
    setSelected([]); setCaption(''); setMedia([]); setWhen('')
  }

  const upload = async (files: FileList) => {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('purpose', 'social')
        const res = await fetch('/api/website/upload', { method: 'POST', body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Upload failed')
        setMedia(m => [...m, { url: json.url, type: json.kind === 'video' ? 'video' : 'image' }])
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submit = async (publishNow: boolean) => {
    if (chosen.length === 0) return toast.error('Choose at least one channel')
    if (issues.length > 0) return toast.error('Fix the problems listed before publishing')
    if (!publishNow && !when) return toast.error('Pick a date and time, or publish now')

    setBusy(true)
    try {
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          caption,
          media,
          targets: chosen.map(a => ({
            platform: a.platform,
            accountId: a.provider_account_id,
            options: {
              ...(effectiveKind ? { kind: effectiveKind } : {}),
              ...(isReel ? { shareToFeed } : {}),
              ...(firstComment.trim() ? { firstComment: firstComment.trim() } : {}),
              ...(collaborators.trim()
                ? { collaborators: collaborators.split(/[\s,]+/).filter(Boolean).slice(0, 3) }
                : {}),
              ...(thumbSeconds && Number(thumbSeconds) >= 0
                ? { thumbOffset: Math.round(Number(thumbSeconds) * 1000) }
                : {}),
            },
          })),
          scheduledFor: publishNow ? null : new Date(when).toISOString(),
          publishNow,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (Array.isArray(json.issues)) json.issues.forEach((i: string) => toast.error(i))
        throw new Error(json.error ?? 'Could not queue the post')
      }

      if (json.status === 'failed') {
        toast.error('The provider rejected the post — check the job for details')
      } else {
        toast.success(
          json.status === 'published' ? 'Published'
            : json.status === 'scheduled' ? `Scheduled for ${new Date(when).toLocaleString()}`
            : json.status === 'duplicate' ? 'An identical post already exists — nothing sent'
            : 'Sent to the platform'
        )
      }
      reset(); onOpenChange(false); onPublished?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not queue the post')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>New post</DialogTitle></DialogHeader>

        <div className="flex flex-col gap-4">
          {/* who ── */}
          <div className="grid gap-1.5">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Choose a client…" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* where ── */}
          <div className="grid gap-1.5">
            <Label>Channels</Label>
            {!clientId ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Choose a client first.</p>
            ) : available.length === 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This client has no connected channels yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {available.map(a => {
                  const on = selected.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelected(s => on ? s.filter(x => x !== a.id) : [...s, a.id])}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        on
                          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
                      }`}
                    >
                      <PlatformIcon platform={a.platform} size={18} />
                      <span>{a.username ? `@${a.username}` : brandFor(a.platform).label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* what ── */}
          <div className="grid gap-1.5">
            <div className="flex items-center">
              <Label htmlFor="caption">Caption</Label>
              {limit !== null && (
                <span className={`ml-auto font-mono text-[11px] tabular-nums ${
                  caption.length > limit ? 'text-red-600 dark:text-red-400' : 'text-zinc-400 dark:text-zinc-500'
                }`}>
                  {caption.length}/{limit}
                </span>
              )}
            </div>
            <Textarea
              id="caption" rows={5} value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Write the post…"
            />
          </div>

          {/* media ── */}
          <div className="grid gap-1.5">
            <Label>Media</Label>
            <div className="flex flex-wrap items-center gap-2">
              {media.map((m, i) => (
                <div key={m.url} className="relative">
                  {m.type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" className="h-16 w-16 rounded object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 text-[10px] dark:bg-zinc-800">
                      video
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setMedia(x => x.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-900 p-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <Input
                ref={fileRef} type="file" multiple accept="image/*,video/*"
                className="hidden"
                onChange={e => e.target.files && upload(e.target.files)}
              />
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => fileRef.current?.click()} disabled={uploading}
              >
                {uploading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                  : <><ImagePlus className="h-3.5 w-3.5" /> Add media</>}
              </Button>
            </div>
          </div>

          {/* post type ── */}
          <div className="grid gap-1.5">
            <Label htmlFor="kind">Post type</Label>
            <Select value={kind} onValueChange={v => setKind(v as PostKind | 'auto')}>
              <SelectTrigger id="kind" className="w-fit min-w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic</SelectItem>
                <SelectItem value="feed">Feed post</SelectItem>
                <SelectItem value="reel">Reel</SelectItem>
                <SelectItem value="story">Story</SelectItem>
                <SelectItem value="carousel">Carousel</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {kind === 'auto'
                ? 'One video becomes a Reel, several images become a carousel.'
                : kind === 'reel'
                ? `${REEL_REQUIREMENTS.aspect}, up to ${REEL_REQUIREMENTS.maxSeconds}s, ${REEL_REQUIREMENTS.formats}.`
                : kind === 'story'
                ? `${STORY_REQUIREMENTS.aspect}, up to ${STORY_REQUIREMENTS.maxSeconds}s. Captions are not shown.`
                : kind === 'carousel'
                ? 'Two or more items, shown as a swipeable set.'
                : 'A standard post in the main feed.'}
            </p>
          </div>

          {/* reel-only controls ── */}
          {isReel && (
            <div className="grid gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-start gap-3">
                <Switch id="stf" checked={shareToFeed} onCheckedChange={setShareToFeed} />
                <div>
                  <Label htmlFor="stf">Also show in the main feed</Label>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Off puts it in the Reels tab only.
                  </p>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="thumb">Cover frame (seconds into the video)</Label>
                <Input id="thumb" type="number" min={0} step="0.5" className="w-32"
                  value={thumbSeconds} onChange={e => setThumbSeconds(e.target.value)}
                  placeholder="0" />
              </div>
            </div>
          )}

          {/* extras ── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="fc">First comment</Label>
              <Textarea id="fc" rows={2} value={firstComment}
                onChange={e => setFirstComment(e.target.value)}
                placeholder="Hashtags, or the link — posted automatically once live" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="collab">Collaborators</Label>
              <Input id="collab" value={collaborators}
                onChange={e => setCollaborators(e.target.value)}
                placeholder="username, username" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Up to 3, Business or Creator accounts only.
              </p>
            </div>
          </div>

          {/* when ── */}
          <div className="grid gap-1.5">
            <Label htmlFor="when">Schedule for (leave blank to publish now)</Label>
            <Input
              id="when" type="datetime-local" value={when}
              onChange={e => setWhen(e.target.value)}
              className="w-fit"
            />
          </div>

          {/* advisories — true, but not reasons to block ── */}
          {warnings.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <ul className="flex flex-col gap-0.5">
                {warnings.map((w, n) => <li key={n}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* problems, before they become failed posts ── */}
          {issues.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <ul className="flex flex-col gap-0.5">
                {issues.map((i, n) => <li key={n}>{i.problem}</li>)}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(false)}
            disabled={busy || issues.length > 0 || chosen.length === 0 || !when}
          >
            Schedule
          </Button>
          <Button
            onClick={() => submit(true)}
            disabled={busy || issues.length > 0 || chosen.length === 0}
          >
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</> : <><Send className="h-4 w-4" /> Publish now</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
