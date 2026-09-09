'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { publicUrl } from '@/app/lib/public-url'
import { CONNECTABLE, connectLinkPath } from '@/app/lib/connect-link-core'
import type { Platform } from '@/app/lib/publish-core'
import PlatformIcon, { brandFor } from './PlatformIcon'

/**
 * THE LINK YOU SEND THE CLIENT (the owner, 9 Sep 2026): "on Social channels
 * create a universal link that I can send to clients … we will pick which
 * platforms we want them to login from, like a checkbox … and then they
 * can sign in from there."
 *
 * Tick the networks, copy the link. The ticks travel IN the link, so a
 * different set of ticks is a different link and nothing is stored; the
 * client's page (/connect/<token>) shows exactly those networks with a
 * Connect button on each. The token is the client's portal token — the
 * same door the portal link opens — so only their managers see this.
 */
export default function ClientConnectLink({ token, connected }: {
  token: string
  /** the networks already connected — ticked off by default, since asking
   *  the client for those again is asking twice */
  connected: readonly string[]
}) {
  const [picked, setPicked] = useState<Platform[]>(() =>
    CONNECTABLE.filter(p => !connected.includes(p)).slice(0, 3))
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  const link = useMemo(() => publicUrl(connectLinkPath(token, picked)), [token, picked])

  const toggle = (p: Platform) =>
    setPicked(cur => cur.includes(p) ? cur.filter(x => x !== p) : CONNECTABLE.filter(x => x === p || cur.includes(x)))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Link copied — send it to the client')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the link and copy it by hand')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-inner border border-dashed border-border p-3">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-left text-[13px] font-semibold">
        <Link2 className="h-4 w-4" aria-hidden />
        Link for the client to connect their own accounts
        <span className="ml-auto text-[12px] font-normal text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <p className="text-[12px] text-muted-foreground">
            Tick the networks they should sign in to, copy the link, send it. They press Connect on each, sign
            in to the network, and the account lands here — no account of ours needed.
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Networks on the link">
            {CONNECTABLE.map(p => {
              const on = picked.includes(p)
              const have = connected.includes(p)
              return (
                <label key={p} className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium ${on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground'}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(p)} />
                  <PlatformIcon platform={p} size={16} className="rounded-full" />
                  {brandFor(p).label}
                  {have && <span className="opacity-70">· connected</span>}
                </label>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={link} onFocus={e => e.currentTarget.select()}
              aria-label="The client's connect link"
              className="min-h-10 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-[12px] text-foreground" />
            <button type="button" onClick={copy} disabled={picked.length === 0}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-50">
              {copied ? <><Check className="h-4 w-4" aria-hidden /> Copied</> : <><Copy className="h-4 w-4" aria-hidden /> Copy link</>}
            </button>
          </div>
          {picked.length === 0 && (
            <p className="text-[12px] text-accent-red">Tick at least one network.</p>
          )}
        </>
      )}
    </div>
  )
}
