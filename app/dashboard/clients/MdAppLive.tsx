'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'

/**
 * LIVE UPDATES (9 Nov 2026): one switch that subscribes the client's Page and Instagram account to MD App's webhooks,
 * so new comments, messages and leads arrive as they happen. What Meta's App Review watches for pages_manage_metadata.
 */
export default function MdAppLive({ clientId }: { clientId: string }) {
  const api = `/api/meta/md-app/leads?clientId=${encodeURIComponent(clientId)}`
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`${api}&view=live`).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    setOn(res?.ok ? !!json.on : null)
  }, [api])
  useEffect(() => { void load() }, [load])

  const flip = async (next: boolean) => {
    setBusy(true)
    try {
      const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'live', on: next }) })
      const json = await res.json().catch(() => ({})) as { error?: string; instagram?: string | null }
      if (!res.ok) { toast.error(json.error ?? 'That did not work'); return }
      toast.success(next ? 'Live updates on — new comments, messages and leads arrive as they happen' : 'Live updates off')
      if (next && json.instagram) toast.message(`Instagram: ${json.instagram}`)
      await load()
    } finally { setBusy(false) }
  }

  return (
    <label className="flex items-center gap-3 rounded-inner border border-border bg-surface px-3 py-2.5">
      <Switch checked={on === true} disabled={busy || on === null} onCheckedChange={v => void flip(v)} />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">Live updates</span>
        <span className="block text-[12px] text-muted-foreground">
          {on === null ? 'Checking…' : on ? 'On — new comments, messages and leads arrive as they happen.' : 'Off — switch on to get new comments, messages and leads as they happen.'}
        </span>
      </span>
    </label>
  )
}
