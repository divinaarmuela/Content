'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { uploadMedia } from '../uploadMedia'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ImagePlus, Info, Loader2, Send, X,
} from 'lucide-react'
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

/** Four steps, each answering one question. Putting them on one screen made a
 *  dialog taller than the viewport, which hid the validation at the bottom —
 *  the part that prevents bad posts. */
const STEPS = ['Where', 'Content', 'Options', 'Review'] as const

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
  const [step, setStep] = useState(0)
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
  useEffect(() => { setSelected([]) }, [clientId])
  useEffect(() => { if (open) setStep(0) }, [open])

  const available = accounts.filter(a => a.active && a.client_id === clientId)
  const chosen = available.filter(a => selected.includes(a.id))
  const platforms = useMemo(
    () => [...new Set(chosen.map(a => a.platform))].filter(isPlatform) as Platform[],
    [chosen]
  )

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

  const isReel = effectiveKind === 'reel'
    || (kind === 'auto' && media.length === 1 && media[0]?.type === 'video')

  const limit = platforms.length
    ? Math.min(...platforms.map(p => PLATFORM_RULES[p].captionMax))
    : null

  const captionIgnored = effectiveKind === 'story'

  const reset = () => {
    setSelected([]); setCaption(''); setMedia([]); setWhen('')
    setKind('auto'); setFirstComment(''); setCollaborators(''); setThumbSeconds('')
    setStep(0)
  }

  const upload = async (files: FileList) => {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        // direct to R2 — a reel is comfortably past Vercel's ~4.5MB body cap
        const { url, kind } = await uploadMedia(file, { purpose: 'social' })
        setMedia(m => [...m, { url, type: kind === 'video' ? 'video' : 'image' }])
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
          caption: captionIgnored ? '' : caption,
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
      } else if (json.status === 'queued') {
        // a retryable provider hiccup: the job is saved and will retry, but
        // nothing has been posted yet — success would be a lie here
        toast.message('The platform did not accept it yet — the post is queued and will retry automatically')
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

  // what each step needs before it will let you move on
  const canAdvance =
    step === 0 ? Boolean(clientId) && chosen.length > 0
    : step === 1 ? media.length > 0 || caption.trim().length > 0
    : true

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>New post</DialogTitle>
          <ol className="mt-2 flex items-center gap-1.5">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs transition-colors ${
                    i === step
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : i < step
                      ? 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      : 'text-zinc-400 dark:text-zinc-600'
                  }`}
                >
                  {i < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{i + 1}</span>}
                  {label}
                </button>
                {i < STEPS.length - 1 && <span className="text-zinc-300 dark:text-zinc-700">·</span>}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {/* ── 1. where ──────────────────────────────────────────────── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label>Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Choose a client…" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

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
                          key={a.id} type="button"
                          onClick={() => setSelected(s => on ? s.filter(x => x !== a.id) : [...s, a.id])}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                            on
                              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                              : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500'
                          }`}
                        >
                          <PlatformIcon platform={a.platform} size={18} />
                          <span>{a.username ? `@${a.username}` : brandFor(a.platform).label}</span>
                          {on && <Check className="h-3 w-3" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 2. content ────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="kind">Post type</Label>
                <Select value={kind} onValueChange={v => setKind(v as PostKind | 'auto')}>
                  <SelectTrigger id="kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic — from the media</SelectItem>
                    <SelectItem value="feed">Feed post</SelectItem>
                    <SelectItem value="reel">Reel</SelectItem>
                    <SelectItem value="story">Story</SelectItem>
                    <SelectItem value="carousel">Carousel</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {kind === 'auto'
                    ? `Instagram decides from what you attach: ${
                        media.length === 0 ? 'one video → Reel, one image → feed post, several → carousel'
                          : media.length > 1 ? `${media.length} items → carousel`
                          : media[0].type === 'video' ? 'one video → Reel'
                          : 'one image → feed post'
                      }. It will never make a Story — choose Story for that.`
                    : kind === 'reel'
                    ? `${REEL_REQUIREMENTS.aspect}, up to ${REEL_REQUIREMENTS.maxSeconds}s, ${REEL_REQUIREMENTS.formats}.`
                    : kind === 'story'
                    ? `${STORY_REQUIREMENTS.aspect}, up to ${STORY_REQUIREMENTS.maxSeconds}s. Captions are not shown.`
                    : kind === 'carousel'
                    ? 'Two or more items, shown as a swipeable set.'
                    : 'A standard post in the main feed.'}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label>Media</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {media.map((m, i) => (
                    <div key={m.url} className="relative">
                      {m.type === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt="" className="h-16 w-16 rounded object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 text-[11px] dark:bg-zinc-800">
                          video
                        </div>
                      )}
                      <button type="button" onClick={() => setMedia(x => x.filter((_, j) => j !== i))}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-900 p-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        aria-label="Remove">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <Input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden"
                    onChange={e => e.target.files && upload(e.target.files)} />
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                      : <><ImagePlus className="h-3.5 w-3.5" /> Add media</>}
                  </Button>
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center">
                  <Label htmlFor="caption">Caption</Label>
                  {limit !== null && !captionIgnored && (
                    <span className={`ml-auto font-mono text-xs tabular-nums ${
                      caption.length > limit ? 'text-red-600 dark:text-red-400' : 'text-zinc-400 dark:text-zinc-500'
                    }`}>
                      {caption.length}/{limit}
                    </span>
                  )}
                </div>
                <Textarea id="caption" rows={5} value={caption}
                  onChange={e => setCaption(e.target.value)}
                  disabled={captionIgnored}
                  placeholder={captionIgnored ? 'Stories do not display captions' : 'Write the post…'} />
              </div>
            </div>
          )}

          {/* ── 3. options ────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              {isReel && (
                <div className="grid gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-xs font-medium">Reel</p>
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
                      value={thumbSeconds} onChange={e => setThumbSeconds(e.target.value)} placeholder="0" />
                  </div>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="fc">First comment</Label>
                <Textarea id="fc" rows={2} value={firstComment}
                  onChange={e => setFirstComment(e.target.value)}
                  placeholder="Hashtags, or the link — posted automatically once live" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Instagram allows no clickable links in captions or stickers, so this
                  is where a link usually goes.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="collab">Collaborators</Label>
                <Input id="collab" value={collaborators}
                  onChange={e => setCollaborators(e.target.value)} placeholder="username, username" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Up to 3, Business or Creator accounts only. The post appears on their
                  profile too.
                </p>
              </div>
            </div>
          )}

          {/* ── 4. review ─────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">Client</dt>
                <dd>{clients.find(c => c.id === clientId)?.name ?? '—'}</dd>

                <dt className="text-zinc-500 dark:text-zinc-400">Channels</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  {chosen.map(a => (
                    <span key={a.id} className="inline-flex items-center gap-1">
                      <PlatformIcon platform={a.platform} size={16} />
                      <span className="font-mono text-xs">@{a.username ?? a.name}</span>
                    </span>
                  ))}
                </dd>

                <dt className="text-zinc-500 dark:text-zinc-400">Type</dt>
                <dd>{kind === 'auto' ? (isReel ? 'Reel (automatic)' : 'Automatic') : kind}</dd>

                <dt className="text-zinc-500 dark:text-zinc-400">Media</dt>
                <dd>{media.length === 0 ? 'None' : `${media.length} item${media.length === 1 ? '' : 's'}`}</dd>

                <dt className="text-zinc-500 dark:text-zinc-400">Caption</dt>
                <dd className="truncate">
                  {captionIgnored ? <span className="text-zinc-400">Not shown on Stories</span>
                    : caption.trim() ? caption.slice(0, 80) + (caption.length > 80 ? '…' : '')
                    : <span className="text-zinc-400">None</span>}
                </dd>
              </dl>

              <div className="grid gap-1.5">
                <Label htmlFor="when">Schedule for</Label>
                <Input id="when" type="datetime-local" value={when}
                  onChange={e => setWhen(e.target.value)} className="w-fit" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Leave blank to publish immediately.
                </p>
              </div>

              {warnings.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <ul className="flex flex-col gap-0.5">
                    {warnings.map((w, n) => <li key={n}>{w}</li>)}
                  </ul>
                </div>
              )}

              {issues.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <ul className="flex flex-col gap-0.5">
                    {issues.map((i, n) => <li key={n}>{i.problem}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep(s => s - 1))}
            disabled={busy}
          >
            {step === 0 ? 'Cancel' : <><ArrowLeft className="h-4 w-4" /> Back</>}
          </Button>

          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canAdvance}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => submit(false)}
                disabled={busy || issues.length > 0 || !when}>
                Schedule
              </Button>
              <Button onClick={() => submit(true)} disabled={busy || issues.length > 0}>
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</>
                      : <><Send className="h-4 w-4" /> Publish now</>}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
