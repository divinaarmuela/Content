'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clearGroup, dismissUpload, uploadFiles } from '../uploadQueue'
import { UploadRows, useUploadGroup } from '../UploadRows'
import { isSettled } from '../../lib/upload-progress-core'
import { probeFile } from './probeMedia'
import AssetCheck from './AssetCheck'
import {
  assessAssets, kindLabel, postingAs, verdictByPlatform, PLATFORM_MEDIA,
  type AssetProbe,
} from '../../lib/media-fit-core'
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
  AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, ImagePlus, Info, Loader2, Send, X,
} from 'lucide-react'
import PlatformIcon, { brandFor } from './PlatformIcon'
import {
  validatePost, postWarnings, PLATFORM_RULES, isPlatform, availableKinds, autoKindFor,
  // the per-format requirements are no longer restated here: the check panel
  // lists them per channel, from the same table the checks use
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
  // what the browser measured off each file: size, dimensions, duration. Kept
  // beside `media` rather than inside it, because `media` is sent to the
  // provider verbatim and an unexpected field there is a rejected payload.
  const [probes, setProbes] = useState<AssetProbe[]>([])
  // a frame from each video, so the strip shows the clip rather than the word
  // "video". Kept apart from `probes` because it is presentation, not a
  // measurement any rule is decided on.
  const [posters, setPosters] = useState<Record<string, string>>({})
  const [when, setWhen] = useState('')
  const [kind, setKind] = useState<PostKind | 'auto'>('auto')
  /** channels that have been set away from the default above. Absent = follow
   *  it; the map only ever holds a deliberate choice. */
  const [perKind, setPerKind] = useState<Partial<Record<Platform, PostKind>>>({})
  const [shareToFeed, setShareToFeed] = useState(true)
  const [firstComment, setFirstComment] = useState('')
  const [collaborators, setCollaborators] = useState('')
  const [thumbSeconds, setThumbSeconds] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /** This dialog's own corner of the dashboard-wide upload queue, so the bar,
   *  speed, ETA, cancel and retry are the same ones the rest of the app has
   *  rather than a fourth rendering of the word "Uploading…". Fixed for the
   *  life of the component: the rows have to survive a step change. */
  const [uploadGroup] = useState(
    () => `social:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`)
  const uploads = useUploadGroup(uploadGroup)
  const uploading = uploads.some(u => !isSettled(u.status))
  // a finished row would sit beside the thumbnail saying the same thing twice
  // — except for a video still being encoded for preview, which the thumbnail
  // cannot say
  const visibleUploads = uploads.filter(u => u.status !== 'done' || u.preview === 'pending')
  // link the post to the production item it delivers — that's what makes it
  // count toward the client's agreement when it goes live
  const [linkItemId, setLinkItemId] = useState('')
  const [linkable, setLinkable] = useState<{ id: string; title: string; content_type: string; status: string }[]>([])

  useEffect(() => { if (defaultClientId) setClientId(defaultClientId) }, [defaultClientId])
  useEffect(() => { setSelected([]); setLinkItemId('') }, [clientId])
  useEffect(() => { if (open) setStep(0) }, [open])

  useEffect(() => {
    if (!open || !clientId) { setLinkable([]); return }
    void fetch(`/api/production/items?client_id=${clientId}`)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: { id: string; title: string; content_type: string; status: string; work_kinds?: { slug?: string } | null }[]) =>
        setLinkable((Array.isArray(rows) ? rows : [])
          .filter(r => ['approved_for_scheduling', 'scheduled'].includes(r.status) && r.work_kinds?.slug !== 'shoot_brief')
          .map(({ id, title, content_type, status }) => ({ id, title, content_type, status }))))
      .catch(() => setLinkable([]))
  }, [open, clientId])

  const available = accounts.filter(a => a.active && a.client_id === clientId)
  const chosen = available.filter(a => selected.includes(a.id))
  const platforms = useMemo(
    () => [...new Set(chosen.map(a => a.platform))].filter(isPlatform) as Platform[],
    [chosen]
  )

  /**
   * What each channel is actually posting.
   *
   * One post type for every channel was wrong twice over: it called the same
   * upload a Reel on YouTube, where it is a Short, and it offered Story on
   * platforms that have none. Worse, "Automatic" guessed once, globally — a
   * three-image drop resolved to "carousel" and sent that to YouTube, which
   * has no carousel, failing validation on a choice nobody made.
   *
   * So the choice is per channel. The select at the top is the default that
   * every channel follows until one is set on its own, and every resolution
   * is clamped to what that platform actually has.
   */
  const resolveKind = useCallback((p: Platform): PostKind => {
    const chosen = perKind[p] ?? (kind === 'auto' ? null : kind)
    // clamped to what the platform will actually make of THIS media — a lone
    // video is a Reel on Instagram whatever the default above says, and the
    // row below shows that rather than echoing a choice that changes nothing
    if (chosen && availableKinds(p, media).includes(chosen)) return chosen
    return autoKindFor(p, media)
  }, [perKind, kind, media])

  const kinds = useMemo(
    () => Object.fromEntries(platforms.map(p => [p, resolveKind(p)])) as Partial<Record<Platform, PostKind>>,
    [platforms, resolveKind],
  )

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

  /**
   * Channels where a file will simply be refused.
   *
   * `issues` is counts and caption length; it cannot see the file, so a 600 MB
   * video or a .avi passed it and the panel said "Will not post" beside a fully
   * enabled Publish button. A verdict that the platform REFUSES the post is not
   * an advisory — it is the same class of fact as "too many images", and it
   * belongs on the same gate. Cropping and re-encoding stay advisory: those
   * post, and whether the trade is acceptable is the operator's call.
   */
  const blockedOn = useMemo(() => {
    if (platforms.length === 0 || probes.length === 0) return []
    const findings = assessAssets({ probes, platforms, kinds })
    return verdictByPlatform(findings, platforms)
      .filter(v => v.level === 'blocked')
      .map(v => PLATFORM_MEDIA[v.platform].label)
  }, [probes, platforms, kinds])

  // a settled-but-failed upload is not "still uploading", so it let a post go
  // out one file short with nothing but a dismissed toast to show for it
  const failedUploads = uploads.filter(u => u.status === 'failed').length

  // the Reel options — cover frame, share to feed — apply if ANY channel is
  // posting short-form, not only when every one of them is
  const isReel = platforms.some(p => kinds[p] === 'reel')

  const limit = platforms.length
    ? Math.min(...platforms.map(p => PLATFORM_RULES[p].captionMax))
    : null

  /** Only when EVERY channel is a Story is the caption genuinely unused. One
   *  Story among four feed posts must not disable the box the other three
   *  need — the old rule did exactly that. */
  const captionIgnored = platforms.length > 0 && platforms.every(p => kinds[p] === 'story')

  const reset = () => {
    clearGroup(uploadGroup)
    setSelected([]); setCaption(''); setMedia([]); setProbes([]); setPosters({}); setWhen('')
    setKind('auto'); setPerKind({}); setFirstComment(''); setCollaborators(''); setThumbSeconds('')
    setLinkItemId('')
    setStep(0)
  }

  /**
   * Send each file off on its own.
   *
   * One batch per file, sharing one group: the rows still render together,
   * but each settles independently — so one failed upload no longer takes the
   * four that succeeded with it, which is what the single try/catch around
   * the whole loop used to do.
   *
   * Measuring runs alongside the transfer rather than before it, because the
   * measurement reads the local file and has no reason to make the bytes wait.
   */
  const upload = (files: FileList) => {
    for (const file of Array.from(files)) {
      const measuring = probeFile(file)
      uploadFiles([file], { group: uploadGroup, purpose: 'social' }).done
        .then(async rows => {
          const landed = rows[0]
          if (!landed) return // cancelled — its row is already gone
          const { poster, ...probe } = await measuring
          setMedia(m => [...m, { url: landed.url, type: probe.type }])
          setProbes(p => [...p, { ...probe, url: landed.url }])
          if (poster) setPosters(p => ({ ...p, [landed.url]: poster }))
        })
        .catch(e => toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`))
    }
    // let the same file be chosen again after it is removed
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = async (publishNow: boolean) => {
    if (chosen.length === 0) return toast.error('Choose at least one channel')
    if (stopper) return toast.error(stopper)
    if (!publishNow && !when) return toast.error('Pick a date and time, or publish now')

    setBusy(true)
    try {
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          ...(linkItemId ? { contentItemId: linkItemId } : {}),
          caption: captionIgnored ? '' : caption,
          media,
          targets: chosen.map(a => {
            // each channel carries its OWN type — the payload has always had
            // room for it, only the composer was collapsing them into one
            const target = isPlatform(a.platform) ? resolveKind(a.platform) : undefined
            return {
            platform: a.platform,
            accountId: a.provider_account_id,
            options: {
              ...(target ? { kind: target } : {}),
              ...(target === 'reel' ? { shareToFeed } : {}),
              ...(firstComment.trim() ? { firstComment: firstComment.trim() } : {}),
              ...(collaborators.trim()
                ? { collaborators: collaborators.split(/[\s,]+/).filter(Boolean).slice(0, 3) }
                : {}),
              ...(thumbSeconds && Number(thumbSeconds) >= 0
                ? { thumbOffset: Math.round(Number(thumbSeconds) * 1000) }
                : {}),
            },
            }
          }),
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
      } else if (json.background) {
        // NOT a hiccup: a post with media is handed to the background worker
        // on purpose, because relaying a video takes longer than a request is
        // allowed to live. Saying "did not accept it yet" here would report a
        // problem that has not happened.
        // and WHERE to watch it — the whole reason that page exists
        toast.success(
          when && !publishNow
            ? `Scheduled for ${new Date(when).toLocaleString()} — the video is uploading in the background`
            : 'Sending — the video is uploading in the background, and it will go out as soon as that finishes',
          { action: { label: 'Watch it', onClick: () => { window.location.href = '/dashboard/social/activity' } } },
        )
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

  /** Why the buttons are off, said on the button itself — a disabled control
   *  with no reason is the most frustrating thing in a form. */
  const stopper =
    failedUploads > 0 ? `${failedUploads} file${failedUploads === 1 ? '' : 's'} failed to upload — retry or remove ${failedUploads === 1 ? 'it' : 'them'}`
    : blockedOn.length > 0 ? `${blockedOn.join(' and ')} will refuse a file in this post — swap it before sending`
    : issues.length > 0 ? 'Fix the problems listed before publishing'
    : uploading ? 'Waiting for the uploads to finish'
    : null

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

              {clientId && linkable.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>Production item <span className="font-normal text-zinc-400">(optional)</span></Label>
                  <Select value={linkItemId || 'none'} onValueChange={v => setLinkItemId(v === 'none' ? '' : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not a planned deliverable</SelectItem>
                      {linkable.map(i => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.title} · {i.content_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Link the approved item this post delivers — when it goes live, the
                    item is marked published and counts toward the client&rsquo;s agreement.
                  </p>
                </div>
              )}
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
                    {/* "Reel" is Instagram's word for it. YouTube calls the
                        same upload a Short and TikTok just calls it a video,
                        so the option is named for the thing rather than for
                        one platform's name for the thing. */}
                    <SelectItem value="reel">Short vertical video</SelectItem>
                    <SelectItem value="story">Story</SelectItem>
                    <SelectItem value="carousel">Carousel</SelectItem>
                  </SelectContent>
                </Select>

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {kind === 'auto'
                    ? `Each platform decides from what you attach: ${
                        media.length === 0 ? 'one video → short video, one image → feed post, several → carousel'
                          : media.length > 1 ? `${media.length} items → carousel`
                          : media[0].type === 'video' ? 'one video → short video'
                          : 'one image → feed post'
                      }. None of them will make a Story — choose Story for that.`
                    : kind === 'story'
                    ? 'A 24-hour post. Captions are not shown on it — put any wording into the image or video itself.'
                    : kind === 'carousel'
                    ? 'Two or more items, shown as a swipeable set.'
                    : kind === 'reel'
                    ? 'One vertical video, in whatever each platform calls its short-form slot.'
                    : 'A standard post in the main feed.'}
                </p>

                {/* One channel: the sentence says it. Several: they each get
                    their own row below, and a sentence listing four things is
                    harder to read than four lines. */}
                {platforms.length === 1 && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    Goes out as{' '}
                    <span className="font-medium">
                      {postingAs(platforms[0], kinds[platforms[0]], media[0]?.type ?? 'video')}
                    </span>.
                  </p>
                )}
              </div>

              {/* ── per channel ──────────────────────────────────────────
                  The same upload is a Reel on Instagram, a Short on YouTube
                  and a video on TikTok, and a Story is not a thing that
                  exists on most of them. Each channel picks from what it
                  actually has; the select above is only the default they
                  follow until one is set on its own. */}
              {platforms.length > 1 && (
                <div className="grid gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">Per channel</p>
                    {Object.keys(perKind).length > 0 && (
                      <button type="button" onClick={() => setPerKind({})}
                        className="ml-auto text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                        Reset to the choice above
                      </button>
                    )}
                  </div>

                  {platforms.map(p => {
                    const options = availableKinds(p, media)
                    const resolved = kinds[p]!
                    // the global choice does not exist here — say which one
                    // it fell back to rather than showing an unexplained
                    // difference between what was picked and what will happen
                    const overridden = kind !== 'auto' && !perKind[p] && !options.includes(kind)
                    return (
                      <div key={p} className="flex flex-wrap items-center gap-2">
                        <PlatformIcon platform={p} size={16} />
                        <span className="w-20 shrink-0 text-xs">{PLATFORM_MEDIA[p].label}</span>
                        <Select
                          value={perKind[p] ?? 'inherit'}
                          onValueChange={v => setPerKind(m => {
                            if (v === 'inherit') {
                              const { [p]: _drop, ...rest } = m
                              return rest
                            }
                            return { ...m, [p]: v as PostKind }
                          })}
                        >
                          <SelectTrigger className="h-8 w-44 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">
                              Same as above — {kindLabel(p, resolved)}
                            </SelectItem>
                            {options.map(k => (
                              <SelectItem key={k} value={k}>{kindLabel(p, k)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {overridden
                            ? `${PLATFORM_MEDIA[p].label} has no ${kindLabel(p, kind).toLowerCase()} — posting ${postingAs(p, resolved, media[0]?.type ?? 'video')}`
                            : postingAs(p, resolved, media[0]?.type ?? 'video')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="grid gap-1.5">
                <Label>Media</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {media.map((m, i) => (
                    <div key={m.url} className="relative">
                      {m.type === 'image' || posters[m.url] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={posters[m.url] ?? m.url} alt=""
                          className="h-16 w-16 rounded object-cover" />
                      ) : (
                        // no frame: a camera .mov the browser will not decode
                        <div className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          video
                        </div>
                      )}
                      {m.type === 'video' && (
                        <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] font-medium text-white">
                          {probes.find(p => p.url === m.url)?.seconds !== undefined
                            ? `${Math.round(probes.find(p => p.url === m.url)!.seconds!)}s`
                            : 'video'}
                        </span>
                      )}
                      <button type="button"
                        onClick={() => {
                          setMedia(x => x.filter((_, j) => j !== i))
                          setProbes(p => p.filter(x => x.url !== m.url))
                        }}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-900 p-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        aria-label="Remove">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {/* sr-only, not hidden: display:none file inputs can silently
                      refuse a programmatic .click() */}
                  <Input ref={fileRef} type="file" multiple accept="image/*,video/*" className="sr-only"
                    onChange={e => e.target.files && upload(e.target.files)} />
                  {/* not disabled while uploading — the transfers run in
                      parallel, and blocking the button was the reason a second
                      file meant waiting out the first */}
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="h-3.5 w-3.5" /> Add media
                  </Button>
                </div>

                {/* the same bar, speed, ETA, cancel and retry the upload tray
                    and the item pages use — one store, so they cannot disagree */}
                <UploadRows uploads={visibleUploads} onDismiss={dismissUpload} />
              </div>

              {/* what each platform will do to these exact files — shown here,
                  while the file can still be swapped for a better export */}
              <AssetCheck probes={probes} platforms={platforms} kinds={kinds} />


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

                {linkItemId && (
                  <>
                    <dt className="text-zinc-500 dark:text-zinc-400">Delivers</dt>
                    <dd className="truncate">{linkable.find(i => i.id === linkItemId)?.title ?? '—'}</dd>
                  </>
                )}

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

              {/* the verdict again at the last moment, without the detail —
                  the breakdown lives on the Content step, next to the files */}
              <AssetCheck probes={probes} platforms={platforms} kinds={kinds} compact />

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
              {/* Typing a time IS the decision. Once there is one, Schedule is
                  the primary button and Publish now steps back — before, both
                  looked equally live, and the eye went to the filled one,
                  which sent a post meant for Friday out immediately.

                  A post sent mid-transfer goes out without the file still
                  moving, and nothing afterwards says which one was missing. */}
              <Button
                variant={when ? 'default' : 'outline'}
                onClick={() => submit(false)}
                title={stopper ?? undefined}
                disabled={busy || uploading || issues.length > 0 || blockedOn.length > 0 || failedUploads > 0 || !when}
              >
                {busy && when
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Scheduling…</>
                  : <><CalendarClock className="h-4 w-4" /> Schedule</>}
              </Button>
              <Button
                variant={when ? 'outline' : 'default'}
                onClick={() => submit(true)}
                title={stopper ?? undefined}
                disabled={busy || uploading || issues.length > 0 || blockedOn.length > 0 || failedUploads > 0}
              >
                {busy && !when
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                  : <><Send className="h-4 w-4" /> Publish now</>}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
