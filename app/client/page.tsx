'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { CheckCircle2, MessageSquare } from 'lucide-react'
import PortalBoard from '../components/portal/PortalBoard'
import { CommitmentCards, PortalHelpLine } from '../components/portal/PortalSections'
import SlideCarousel from '../components/media/SlideCarousel'
import { slidesFor } from '../lib/slide-carousel-core'
import PortalTabbedView from '../components/portal/PortalTabbedView'
import { changesSentToast, contentTypeLabel, scheduledWhen } from '../lib/portal-words'
import type { PortalData, PortalItem } from '../lib/portal-data'

/** The portal components are themed by --p-* variables; inside the dashboard
 *  shell they take the dashboard's own tokens so they follow light/dark with
 *  everything else. */
const DASH_TOKENS: React.CSSProperties = {
  ['--p-bg' as string]: 'hsl(var(--background))',
  ['--p-ink' as string]: 'hsl(var(--foreground))',
  ['--p-surface' as string]: 'hsl(var(--card))',
  ['--p-border' as string]: 'hsl(var(--border))',
  ['--p-accent' as string]: 'hsl(var(--primary))',
  ['--p-accent-ink' as string]: 'hsl(var(--primary-foreground))',
}

/**
 * The signed-in client portal. The same board the share link shows — one
 * card per piece and per shoot, one tap to approve — acting through the item
 * API the viewer is already signed in to.
 */
export default function ClientPortalPage() {
  const [data, setData] = useState<(PortalData & { viewer_role: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** the FINAL POST being sent back for changes — a different ask from the
   *  piece itself, so it gets its own dialog state */
  const [postChanging, setPostChanging] = useState<PortalItem | null>(null)
  const [postChangeText, setPostChangeText] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/portal')
    if (!res.ok) {
      setError((await res.json()).error ?? 'Could not load your workspace')
      return
    }
    setData(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  /** the client's yes (or note) on the FINAL POST — caption and timing */
  const actOnPost = async (item: PortalItem, action: 'approve' | 'request_changes', note?: string) => {
    setBusy(item.id)
    try {
      const res = await fetch(`/api/production/items/${item.id}/posting-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(note?.trim() ? { note: note.trim() } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Something went wrong')
      toast.success(action === 'approve'
        ? 'Post approved — it will go out as planned.'
        : changesSentToast(data?.am_name))
      setPostChanging(null)
      setPostChangeText('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-14 text-center text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8" style={DASH_TOKENS}>
      {/* an intake tab appears only when a form is toggled on; with none, this
          renders the board alone */}
      <PortalTabbedView intake={data.intake} themeStyle={DASH_TOKENS}>
        <div className="flex flex-col gap-8">
          <PortalBoard
            cards={data.cards}
            clientName={data.client.name}
            amName={data.am_name}
            brand={data.brand}
            logoUrl={data.brand_logo_url}
            surface={{ loggedIn: true, onChanged: load }}
          />

          {/* the FINAL POST — the caption and the timing — waiting on the
              client. A different decision from approving the piece, and the
              card says so in as many words. Drawn only when something is
              waiting. */}
          {data.post_approvals.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[17px] font-semibold">Ready to post — needs your OK</h2>
              {data.post_approvals.map(item => (
                <div key={item.id} className="overflow-hidden rounded-inner border border-border bg-surface">
                  <SlideCarousel slides={slidesFor(item)} aspect="natural" naturalMax="max-h-96"
                    mode="full" chromeClassName="px-3" label={item.title} />
                  <div className="flex flex-col gap-3 p-3.5">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{item.title}</p>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
                        {[contentTypeLabel(item.content_type)?.replace('Graphic', 'Image'), 'Final post'].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="rounded-tile bg-foreground/[0.04] px-3 py-2.5">
                      <p className="mb-1 text-[12px] text-muted-foreground">The caption, as it will post</p>
                      {item.caption?.trim()
                        ? <p className="whitespace-pre-wrap text-[14px]">{item.caption}</p>
                        : <p className="text-[14px] text-muted-foreground">No caption — it would go out with just the title.</p>}
                    </div>
                    {item.schedule.filter(s => s.scheduled_at && !s.live_url).map(s => (
                      <p key={s.platform} className="text-[13px] text-muted-foreground">
                        {s.platform} · {scheduledWhen(s.scheduled_at, data.client.timezone)}
                      </p>
                    ))}
                    <p className="text-[13px] text-muted-foreground">
                      You approved this piece already — this is the caption and timing, exactly as it will post.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button className="min-h-11" disabled={busy === item.id} onClick={() => actOnPost(item, 'approve')}>
                        <CheckCircle2 className="h-4 w-4" /> {busy === item.id ? 'Working…' : 'Approve this post'}
                      </Button>
                      <Button variant="ghost" className="min-h-11" disabled={busy === item.id}
                        onClick={() => { setPostChanging(item); setPostChangeText('') }}>
                        <MessageSquare className="h-4 w-4" /> Ask for a change
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}

          <CommitmentCards data={data} />

          {/* who to reach, always visible — a portal must never dead-end */}
          <div className="border-t border-border pt-4">
            <PortalHelpLine amName={data.am_name} className="text-muted-foreground opacity-100" />
          </div>
        </div>
      </PortalTabbedView>

      {/* what should change about the POST? — the note rides the request */}
      <Dialog open={postChanging !== null} onOpenChange={o => !o && setPostChanging(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What should change about this post?</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={4}
            value={postChangeText}
            autoFocus
            onChange={e => setPostChangeText(e.target.value)}
            placeholder="e.g. “Take out the second hashtag, and post it Friday morning instead.”"
          />
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setPostChanging(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11" disabled={busy !== null || !postChangeText.trim()}
              onClick={() => postChanging && actOnPost(postChanging, 'request_changes', postChangeText)}>
              {busy !== null ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
