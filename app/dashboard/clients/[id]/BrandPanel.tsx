'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useRealtime } from 'inngest/react'
import { FileUp, Loader2, Palette, RefreshCw, Trash2, Type } from 'lucide-react'
import { sanitiseProfile, type BrandProfile } from '@/app/lib/brand-core'
import { brandChannel } from '@/app/inngest/channels'
import { fetchBrandSubscriptionToken } from './brandActions'

/**
 * The client's brand, embedded where the team works: colours as real
 * swatches, typefaces as specimens, voice and rules as prose. Filled by
 * scanning the client's own guidelines PDF; the extraction happens once and
 * this panel only ever reads the stored result.
 */

type Doc = { filename: string; url: string; scanned_at: string }

const isHex = (v?: string): v is string => Boolean(v && /^#[0-9a-f]{6}$/i.test(v))

function Section({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </h3>
      {children}
    </div>
  )
}

export default function BrandPanel({ clientId }: { clientId: string }) {
  const [profile, setProfile] = useState<BrandProfile | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; message?: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/brand`)
    if (!res.ok) return
    const json = await res.json()
    // sanitised on the way in as well as on the way out: profiles scanned
    // before this existed can still hold shapes React refuses to render
    setProfile(sanitiseProfile(json.profile))
    setDocs(json.docs ?? [])
    setCanManage(Boolean(json.can_manage))
    // a scan started before this page was opened is still ours to show
    if (json.scan?.status === 'scanning' || json.scan?.status === 'queued') {
      setScanning(true)
      setProgress({ done: json.scan.done, total: json.scan.total, message: json.scan.message ?? undefined })
    } else {
      setScanning(false)
      setProgress(null)
    }
    setLoaded(true)
  }, [clientId])

  useEffect(() => { void load() }, [load])

  /**
   * Realtime is a live stream, not a log: a browser suspends sockets on a
   * hidden tab, so the "done" published while you were elsewhere never
   * arrives and the panel waits forever. The stored status is the source of
   * truth, so poll it while a scan is running and re-read it the moment the
   * tab is looked at again.
   */
  useEffect(() => {
    if (!scanning) return
    const id = window.setInterval(() => void load(), 8000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [scanning, load])

  /**
   * Live: the scan runs as a background job, so progress arrives here rather
   * than on a held-open request. A page reload mid-scan rejoins the stream —
   * the work is not tied to the tab that started it.
   */
  const { messages } = useRealtime({
    channel: brandChannel,
    topics: ['progress'] as const,
    token: () => fetchBrandSubscriptionToken(),
    autoCloseOnTerminal: false,
    historyLimit: 20,
  })
  useEffect(() => {
    const latest = messages.last
    if (!latest) return
    const d = latest.data as {
      client_id: string; status: string; done: number; total: number; message?: string
    }
    if (!d || d.client_id !== clientId) return   // this channel carries every client

    if (d.status === 'scanning') {
      setScanning(true)
      setProgress({ done: d.done, total: d.total, message: d.message })
    } else if (d.status === 'done') {
      setScanning(false); setProgress(null)
      toast.success('Brand profile extracted')
      void load()
    } else if (d.status === 'failed') {
      setScanning(false); setProgress(null)
      toast.error(d.message || 'The scan failed')
    }
  }, [messages.last, clientId, load])

  const scan = async (file: File) => {
    if (file.type !== 'application/pdf') { toast.error('Brand guidelines must be a PDF'); return }
    setScanning(true)
    setProgress(null)
    try {
      const signRes = await fetch(`/api/clients/${clientId}/brand`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', name: file.name, size: file.size, type: file.type }),
      })
      if (!signRes.ok) throw new Error((await signRes.json()).error ?? 'Could not start the upload')
      const { signedUrl, publicUrl } = await signRes.json()

      const put = await fetch(signedUrl, {
        method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file,
      })
      if (!put.ok) throw new Error('Upload to storage failed')

      const scanRes = await fetch(`/api/clients/${clientId}/brand`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', url: publicUrl, filename: file.name }),
      })
      if (!scanRes.ok) throw new Error((await scanRes.json()).error ?? 'The scan failed')
      // queued, not finished: the realtime effect above takes it from here and
      // clears `scanning` when the job reports done or failed
      toast.info('Reading the document — this page updates as it goes')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      setScanning(false)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const reset = async () => {
    const res = await fetch(`/api/clients/${clientId}/brand`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not reset'); return }
    setProfile(null); setDocs([])
    toast.success('Brand profile cleared')
  }

  if (!loaded) return <Skeleton className="h-40 w-full" />

  const empty = !profile || Object.keys(profile).length === 0

  return (
    <div className="flex flex-col gap-4">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void scan(f) }} />

      {/* ── upload / rescan ── */}
      <div className={
        'rounded-lg border p-5 ' +
        (empty ? 'border-primary/40 bg-primary/[0.04]' : 'border-border bg-card')
      }>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {empty ? 'Scan the brand guidelines' : 'Brand guidelines'}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {scanning
                ? progress && progress.total > 1
                  ? `Reading the document — part ${progress.done} of ${progress.total}${progress.message ? ` · ${progress.message}` : ''}. You can leave this page.`
                  : `Reading the document${progress?.message ? ` — ${progress.message}` : ''}. A long deck takes a few minutes; you can leave this page.`
                : empty
                  ? 'Upload the client\'s brand PDF and the typography, colours and voice are extracted into this page.'
                  : 'Scanning another document merges it into the profile below.'}
            </p>
          </div>
          {canManage && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={scanning} onClick={() => fileRef.current?.click()}>
                {scanning
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : empty ? <FileUp className="mr-1.5 h-3.5 w-3.5" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                {scanning ? 'Scanning' : empty ? 'Upload PDF' : 'Scan another'}
              </Button>
              {!empty && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
        {scanning && progress && progress.total > 1 && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-1 rounded bg-primary transition-[width] duration-500"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        )}
        {docs.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            From {docs.map((d, i) => (
              <span key={d.url}>
                {i > 0 && ', '}
                <a href={d.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
                  {d.filename}
                </a>
              </span>
            ))}
          </p>
        )}
      </div>

      {!empty && profile && (
        <>
          {profile.summary && (
            <p className="px-1 text-sm leading-relaxed text-muted-foreground">{profile.summary}</p>
          )}

          {(profile.colors?.length ?? 0) > 0 && (
            <Section icon={Palette} title="Colours">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {profile.colors!.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md border border-border p-2.5">
                    <span className="h-9 w-9 shrink-0 rounded-md border border-border"
                      style={isHex(c.hex) ? { backgroundColor: c.hex } : { background: 'repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 0 0/12px 12px' }} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name || c.hex || 'Unnamed'}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {isHex(c.hex) ? c.hex.toUpperCase() : 'no hex given'}{c.usage ? ` · ${c.usage}` : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(profile.fonts?.length ?? 0) > 0 && (
            <Section icon={Type} title="Typography">
              <div className="flex flex-col gap-3">
                {profile.fonts!.map((f, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-3 last:border-0 last:pb-0">
                    <span className="text-lg font-semibold">{f.family}</span>
                    {f.usage && <span className="text-xs text-muted-foreground">{f.usage}</span>}
                    {(f.weights?.length ?? 0) > 0 && (
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {f.weights!.join(' · ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {profile.voice && (profile.voice.tone || profile.voice.description) && (
            <Section icon={Type} title="Voice">
              {profile.voice.tone && <p className="text-sm font-medium">{profile.voice.tone}</p>}
              {profile.voice.description && (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{profile.voice.description}</p>
              )}
              {(profile.voice.keywords?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.voice.keywords!.map(k => (
                    <span key={k} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          )}

          {[
            { title: 'Logo rules', items: profile.logo_rules },
            { title: 'Imagery', items: profile.imagery },
            { title: 'Other rules', items: profile.other_rules },
          ].filter(s => (s.items?.length ?? 0) > 0).map(s => (
            <Section key={s.title} icon={Palette} title={s.title}>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm leading-relaxed">
                {s.items!.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Section>
          ))}

          {profile.dos_and_donts && ((profile.dos_and_donts.dos?.length ?? 0) > 0 || (profile.dos_and_donts.donts?.length ?? 0) > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(profile.dos_and_donts.dos?.length ?? 0) > 0 && (
                <Section icon={Palette} title="Do">
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
                    {profile.dos_and_donts.dos!.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </Section>
              )}
              {(profile.dos_and_donts.donts?.length ?? 0) > 0 && (
                <Section icon={Palette} title="Don't">
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
                    {profile.dos_and_donts.donts!.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </Section>
              )}
            </div>
          )}
        </>
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the brand profile?</AlertDialogTitle>
            <AlertDialogDescription>
              The extracted profile and its document history go. The uploaded PDFs stay in storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void reset(); setConfirmReset(false) }}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
