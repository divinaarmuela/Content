'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, ClipboardList, Copy, ExternalLink, KeyRound, MessageSquare, Share2, Users , Palette } from 'lucide-react'
import ContactsPanel from './ContactsPanel'
import NotesPanel from './NotesPanel'
import { publicUrl } from '@/app/lib/public-url'
import IntakePanel from './IntakePanel'
import BrandPanel from './BrandPanel'
import CredentialsPanel from '../../CredentialsPanel'
import SocialChannels from '../SocialChannels'

type Client = {
  id: string
  name: string
  slug: string
  industry: string
  status: string
  share_token: string | null
  social_profile_id: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
}

const STATUS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
  paused: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  archived: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
}

type Tab = 'overview' | 'contacts' | 'notes' | 'credentials' | 'social' | 'intake' | 'brand'

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [client, setClient] = useState<Client | null>(null)
  const [missing, setMissing] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/website/clients/${clientId}`)
      const json = await res.json()
      if (res.status === 404) { setMissing(true); return }
      if (!res.ok) throw new Error(json.error ?? 'Could not load client')
      setClient(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load client')
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

  if (missing) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">That client no longer exists.</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/clients">Back to clients</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!client) return <Skeleton className="h-96 w-full" />

  const portalUrl = client.share_token
    ? publicUrl(`/portal/${client.share_token}`)
    : null

  const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'overview', label: 'Overview', icon: Users },
    { key: 'contacts', label: 'Contacts', icon: Users },
    { key: 'notes', label: 'Notes', icon: MessageSquare },
    { key: 'credentials', label: 'Credentials', icon: KeyRound },
    { key: 'social', label: 'Social', icon: Share2 },
    { key: 'intake', label: 'Intake', icon: ClipboardList },
    { key: 'brand', label: 'Brand', icon: Palette },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* ── header ── */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/dashboard/clients">
            <ArrowLeft className="h-4 w-4" /> All clients
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-950 font-mono text-sm text-white">
            {client.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{client.name}</h2>
            <p className="font-mono text-[11px] text-zinc-400">
              {client.industry || 'No industry set'} · /{client.slug}
            </p>
          </div>

          <Badge variant="outline" className={`${STATUS[client.status] ?? STATUS.archived} capitalize`}>
            {client.status}
          </Badge>

          {portalUrl && (
            <Button variant="outline" size="sm" className="ml-auto"
              onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success('Portal link copied') }}>
              <Copy className="h-3.5 w-3.5" /> Portal link
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => v && setTab(v as Tab)}>
        <TabsList>
          {TABS.map(t => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === 'overview' && (
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
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  Original contact
                </p>
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 px-3 py-2.5 text-[13px] dark:border-zinc-800">
                  <span className="text-zinc-700 dark:text-zinc-300">{client.contact_name || '—'}</span>
                  {client.email && <span className="text-zinc-500">{client.email}</span>}
                  {client.phone && <span className="text-zinc-500">{client.phone}</span>}
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTab('contacts')}>
                    Move to Contacts →
                  </Button>
                </div>
              </div>
            )}

            {saving && <p className="text-xs text-zinc-400 sm:col-span-2">Saving…</p>}
          </CardContent>
        </Card>
      )}

      {tab === 'contacts' && <ContactsPanel clientId={clientId} />}
      {tab === 'notes' && <NotesPanel clientId={clientId} />}
      {tab === 'intake' && <IntakePanel clientId={clientId} />}
      {tab === 'brand' && <BrandPanel clientId={clientId} />}
      {tab === 'credentials' && <CredentialsPanel endpoint={`/api/website/clients/${clientId}/credentials`} />}
      {tab === 'social' && (
        <SocialChannels clientId={clientId} />
      )}
    </div>
  )
}
