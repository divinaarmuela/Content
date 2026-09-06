'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '@/lib/db-client'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Copy, ExternalLink, MousePointerClick, Pencil, Plus, Trash2 } from 'lucide-react'
import { publicUrl } from '@/app/lib/public-url'

type Asset = {
  id: string
  client_id: string | null
  title: string
  platform: string | null
  slug: string
  dest_url: string | null
  post_url: string | null
  source: 'published' | 'external' | 'manual'
  offer_code: string | null
  keyword: string | null
  published_at: string | null
  created_at: string
  clients: { name: string } | null
  clicks: number
}

type ClientRow = { id: string; name: string }

const SOURCE_STYLE: Record<Asset['source'], string> = {
  published: 'bg-tint-blue text-foreground border-accent-blue/25',
  external: 'bg-tint-blue text-accent-blue-deep border-accent-blue/25',
  manual: 'bg-foreground/[0.06] text-muted-foreground border-border',
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—'

/**
 * The Content Register: every registered asset, its tracked link, and its
 * clicks — LIVE. A click anywhere in the world moves the number on this page
 * without a refresh, via the tracker realtime channel.
 */
export default function TrackerPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [editing, setEditing] = useState<Asset | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async (quiet = false) => {
    try {
      const res = await fetch('/api/tracker')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the register')
      setAssets(json.assets)
    } catch (e) {
      if (!quiet) toast.error(e instanceof Error ? e.message : 'Could not load the register')
      setAssets(prev => prev ?? [])
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/website/clients')
      .then(r => r.ok ? r.json() : [])
      .then((rows: ClientRow[]) => setClients(Array.isArray(rows) ? rows : []))
      .catch(() => {})
  }, [])

  // ── live: clicks and new assets push to this page; hints are hints,
  //    the authenticated API stays the single source of truth ──
  const onTrackerChange = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    const d = hint as { kind?: 'click' | 'asset'; label?: string }
    if (d.kind === 'click') toast.info(`Click — ${d.label}`, { duration: 2500 })
    else if (d.kind === 'asset') toast.success(`New asset registered — ${d.label}`)
    void load(true)
  }, [load])
  useLive('tracker', onTrackerChange)

  const visible = useMemo(
    () => (assets ?? []).filter(a => clientFilter === 'all' || a.client_id === clientFilter),
    [assets, clientFilter],
  )
  const totalClicks = useMemo(() => visible.reduce((n, a) => n + a.clicks, 0), [visible])

  const copyLink = (a: Asset) => {
    navigator.clipboard.writeText(publicUrl(`/go/${a.slug}`))
    toast.success('Tracked link copied')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-section-title">Content Register</h2>
          <p className="text-body-15 text-muted-foreground">
            Every asset, its tracked link, and its clicks — live. This register is the
            evidence behind every performance-fee claim.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 font-mono text-[12px] tabular-nums">
            <MousePointerClick className="h-3 w-3" /> {totalClicks} clicks
          </Badge>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Register asset
          </Button>
        </div>
      </div>

      <Card className="py-0">
        {assets === null ? (
          <CardContent className="flex flex-col gap-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        ) : visible.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <p className="max-w-md text-body-15 text-muted-foreground">
              Nothing registered yet. Posts published through the scheduler register
              themselves; anything else — printed QR, an offline campaign — goes in with
              &ldquo;Register asset&rdquo;.
            </p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-foreground/[0.04] hover:bg-foreground/[0.04]">
                  <TableHead>Asset</TableHead>
                  <TableHead className="hidden md:table-cell">Platform</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="hidden sm:table-cell">Published</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(a => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="max-w-72 truncate text-body-15 font-medium" title={a.title}>{a.title}</div>
                      <div className="font-mono text-secondary-13 text-muted-foreground">
                        {a.clients?.name ?? 'Unassigned'} · /go/{a.slug}
                        {a.offer_code ? ` · code ${a.offer_code}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="hidden capitalize text-body-15 text-muted-foreground md:table-cell">
                      {a.platform ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${SOURCE_STYLE[a.source]}`}>{a.source}</Badge>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-body-15 text-muted-foreground sm:table-cell">
                      {fmt(a.published_at ?? a.created_at)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-body-15 tabular-nums">{a.clicks}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy tracked link"
                          aria-label={`Copy tracked link for ${a.title}`} onClick={() => copyLink(a)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        {a.post_url && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                            <a href={a.post_url} target="_blank" rel="noreferrer noopener"
                              title="Open the live post" aria-label={`Open live post for ${a.title}`}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                          aria-label={`Edit ${a.title}`} onClick={() => setEditing(a)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-accent-red"
                              title="Delete" aria-label={`Delete ${a.title}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {a.title}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Its tracked link dies and its {a.clicks} logged clicks — evidence —
                                are deleted with it. An asset is usually kept forever.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep it</AlertDialogCancel>
                              <AlertDialogAction className="bg-accent-red hover:bg-accent-red"
                                onClick={async () => {
                                  const res = await fetch(`/api/tracker?id=${a.id}`, { method: 'DELETE' })
                                  if (res.ok) { toast.success('Deleted'); load(true) }
                                  else toast.error((await res.json()).error ?? 'Delete failed')
                                }}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <AssetDialog
        open={adding} asset={null} clients={clients}
        onClose={() => setAdding(false)}
        onSaved={() => { setAdding(false); load(true) }}
      />
      <AssetDialog
        open={editing !== null} asset={editing} clients={clients}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(true) }}
      />
    </div>
  )
}

/** Register or edit an asset. One dialog, two modes. */
function AssetDialog({ open, asset, clients, onClose, onSaved }: {
  open: boolean
  asset: Asset | null
  clients: ClientRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [platform, setPlatform] = useState('')
  const [destUrl, setDestUrl] = useState('')
  const [postUrl, setPostUrl] = useState('')
  const [offerCode, setOfferCode] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(asset?.title ?? '')
    setClientId(asset?.client_id ?? '')
    setPlatform(asset?.platform ?? '')
    setDestUrl(asset?.dest_url ?? '')
    setPostUrl(asset?.post_url ?? '')
    setOfferCode(asset?.offer_code ?? '')
    setSaving(false)
  }, [open, asset])

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const body = {
        ...(asset ? { id: asset.id } : {}),
        title, client_id: clientId, platform,
        dest_url: destUrl, post_url: postUrl, offer_code: offerCode,
      }
      const res = await fetch('/api/tracker', {
        method: asset ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success(asset ? 'Saved' : `Registered — tracked link /go/${json.asset.slug}`)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{asset ? 'Edit asset' : 'Register an asset'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Kitchen reno walkthrough reel" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Client</Label>
              <Select value={clientId || 'none'} onValueChange={v => setClientId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Platform</Label>
              <Input value={platform} onChange={e => setPlatform(e.target.value)} placeholder="instagram" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Link destination <span className="text-secondary-13 text-muted-foreground">(defaults to the client&rsquo;s website)</span></Label>
            <Input value={destUrl} onChange={e => setDestUrl(e.target.value)} placeholder="https://client-site.com/contact" />
          </div>
          <div className="grid gap-1.5">
            <Label>Live post URL <span className="text-secondary-13 text-muted-foreground">(optional)</span></Label>
            <Input value={postUrl} onChange={e => setPostUrl(e.target.value)} placeholder="https://instagram.com/p/…" />
          </div>
          <div className="grid gap-1.5">
            <Label>Offer code <span className="text-secondary-13 text-muted-foreground">(&ldquo;mention RENO10&rdquo; — offline attribution)</span></Label>
            <Input value={offerCode} onChange={e => setOfferCode(e.target.value)} placeholder="RENO10" />
          </div>
          <Button onClick={() => void submit()} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : asset ? 'Save changes' : 'Register asset'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
