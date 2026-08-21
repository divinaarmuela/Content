'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ExternalLink } from 'lucide-react'
import { publicUrl } from '@/app/lib/public-url'
import ManagersCard from './ManagersCard'
import MonthProgress from './MonthProgress'

/** Overview — the client's own details. Header and tabs live in the layout. */

type Client = {
  id: string
  name: string
  slug: string
  industry: string
  status: string
  share_token: string | null
  website: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
}

export default function ClientOverviewPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [client, setClient] = useState<Client | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/website/clients/${clientId}`)
      const json = await res.json()
      if (!res.ok) return
      setClient(json)
    } catch {
      /* the layout reports a missing or unreachable client */
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const patch = async (fields: Partial<Client>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/website/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setClient(json)
      toast.success('Saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!client) return <Skeleton className="h-96 w-full" />

  const portalUrl = client.share_token ? publicUrl(`/portal/${client.share_token}`) : null

  return (
    <div className="flex flex-col gap-5">
      <ManagersCard clientId={clientId} />
      <MonthProgress clientId={clientId} />
      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input defaultValue={client.name} onBlur={e => {
              if (e.target.value !== client.name) patch({ name: e.target.value })
            }} />
          </div>
          <div className="grid gap-1.5">
            <Label>Industry</Label>
            <Input defaultValue={client.industry ?? ''} onBlur={e => {
              if (e.target.value !== client.industry) patch({ industry: e.target.value })
            }} />
          </div>
          <div className="grid gap-1.5">
            <Label>Slug</Label>
            <Input defaultValue={client.slug} className="font-mono text-sm" onBlur={e => {
              if (e.target.value !== client.slug) patch({ slug: e.target.value })
            }} />
          </div>
          <div className="grid gap-1.5">
            <Label>Website</Label>
            <div className="flex items-center gap-2">
              <Input defaultValue={client.website ?? ''} placeholder="https://…" onBlur={e => {
                if (e.target.value.trim() !== (client.website ?? '')) patch({ website: e.target.value })
              }} />
              {client.website && (
                <Button variant="outline" size="sm" asChild>
                  <a href={client.website} target="_blank" rel="noreferrer noopener" aria-label="Open website">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={client.status} onValueChange={v => patch({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {portalUrl && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Client portal <span className="text-xs text-zinc-400">(no login required)</span></Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={portalUrl} className="font-mono text-xs" />
                <Button variant="outline" size="sm" asChild>
                  <a href={portalUrl} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </a>
                </Button>
              </div>
            </div>
          )}

          {/* The legacy single-contact columns still hold data for clients
              created before Contacts existed. Shown read-only so nothing
              looks lost, with a route to the replacement. */}
          {(client.contact_name || client.email || client.phone) && (
            <div className="sm:col-span-2">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400">
                Original contact
              </p>
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 px-3 py-2.5 text-sm dark:border-zinc-800">
                <span className="text-zinc-700 dark:text-zinc-300">{client.contact_name || '—'}</span>
                {client.email && <span className="text-zinc-500">{client.email}</span>}
                {client.phone && <span className="text-zinc-500">{client.phone}</span>}
                <Button variant="ghost" size="sm" className="ml-auto" asChild>
                  <a href={`/dashboard/clients/${clientId}/contacts`}>Move to Contacts →</a>
                </Button>
              </div>
            </div>
          )}

          {saving && <p className="text-xs text-zinc-400 sm:col-span-2">Saving…</p>}
        </CardContent>
      </Card>
    </div>
  )
}
