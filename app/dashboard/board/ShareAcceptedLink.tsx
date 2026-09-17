'use client'

import { useState } from 'react'
import { Link as LinkIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { maySharePublicly, sharePath } from '../../lib/share-link-core'

/**
 * THE SHARE LINK ON THE CARD (share-link-core): once the card is accepted,
 * one press mints the public link and copies it; the link is then shown with
 * a Stop sharing. Offered to whoever on the team is looking at the card.
 */
export default function ShareAcceptedLink({ item }: { item: { id: string; status?: unknown; share_token?: unknown } }) {
  const [busy, setBusy] = useState(false)
  if (!maySharePublicly(item.status)) return null
  const token = typeof item.share_token === 'string' && /^[a-f0-9]{32}$/.test(item.share_token) ? item.share_token : null
  const url = token && typeof window !== 'undefined' ? `${window.location.origin}${sharePath(token)}` : null

  const copy = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast.success('Share link copied — anyone with it can download the accepted version') }
    catch { toast.error('Could not copy the link') }
  }
  const make = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}/share`, { method: 'POST' })
      const json = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Could not make the link')
      await copy(json.url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not make the link')
    } finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}/share`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not switch the link off')
      toast.success('Share link switched off')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not switch the link off')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3" data-share-link>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Share the accepted version</p>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-[13px] underline underline-offset-4">{url}<span className="sr-only">, opens in a new tab</span></a>
          <Button variant="outline" className="h-10 rounded-full px-4 text-[13px] font-semibold" disabled={busy} onClick={() => void copy(url)}>
            <LinkIcon className="h-4 w-4" aria-hidden /> Copy
          </Button>
          <Button variant="ghost" className="h-10 rounded-full px-3 text-[13px] font-semibold text-muted-foreground" disabled={busy} onClick={() => void stop()}>
            <X className="h-4 w-4" aria-hidden /> Stop sharing
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-10 rounded-full px-4 text-[13px] font-semibold" disabled={busy} onClick={() => void make()}>
            <LinkIcon className="h-4 w-4" aria-hidden /> {busy ? 'Making the link…' : 'Get a public link'}
          </Button>
          <span className="text-[12px] text-muted-foreground">Anyone with the link can download the accepted files — no sign-in.</span>
        </div>
      )}
    </div>
  )
}
