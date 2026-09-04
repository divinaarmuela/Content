'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MapPin, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isPageId } from '@/app/lib/publish-core'
import { PAGE_ID_HELP, readLocations, type SavedLocation } from '@/app/lib/schedule-compose-core'
import { friendlyError } from '@/app/lib/support-core'

/**
 * THE PLACES THIS CLIENT TAGS POSTS AT.
 *
 * Instagram will show a post as being AT somewhere, and the API takes only a
 * numeric Facebook Page id to say where — there is no place search anywhere
 * in the chain, so nobody can look one up while writing a post at five to
 * five. A restaurant has one venue, a gym has three; they are looked up once,
 * here, and after that the composer is a dropdown.
 *
 * The id is checked as it is typed, because the mistake everybody makes is
 * pasting the @name — and Instagram answers that by refusing the post hours
 * later, with nobody watching.
 *
 * Every save sends ONE PLACE, never the list. Sending the array this browser
 * is holding would be a read-modify-write: two managers with this page open,
 * one adding a venue and one removing an old one, and whoever saved second
 * would silently erase the other's edit. The route applies the operation
 * inside a claim instead, and hands back the list as it now stands.
 */
export default function InstagramLocations({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<SavedLocation[] | null>(null)
  const [name, setName] = useState('')
  const [pageId, setPageId] = useState('')
  const [saving, setSaving] = useState(false)

  const url = `/api/clients/${clientId}/instagram-locations`

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/instagram-locations`)
      const json = await res.json()
      setRows(res.ok ? readLocations(json?.instagram_locations) : [])
    } catch {
      setRows([])
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  /** One change, applied to whatever is stored — never the whole list. */
  const send = async (init: RequestInit, path = '') => {
    setSaving(true)
    try {
      const res = await fetch(url + path, init)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setRows(readLocations(json?.instagram_locations))
      toast.success('Saved')
      return true
    } catch (e) {
      toast.error(friendlyError(e instanceof Error ? e.message : '', 'this client'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = async () => {
    const n = name.trim()
    const id = pageId.trim()
    // checked here so the answer is instant, and checked again on the server,
    // which is the check that counts
    if (!n) { toast.error('Give the place a name your team will recognise'); return }
    if (!isPageId(id)) {
      toast.error('That does not look like a Page ID — it is a long number, not the @name')
      return
    }
    const ok = await send({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, pageId: id }),
    })
    if (ok) { setName(''); setPageId('') }
  }

  const remove = (row: SavedLocation) =>
    send({ method: 'DELETE' }, `?pageId=${encodeURIComponent(row.pageId)}`)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-center gap-2">
          <MapPin className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
          <h2 className="text-card-title">Instagram locations</h2>
        </div>
        <p className="max-w-prose text-secondary-13 text-muted-foreground">
          Places this client&rsquo;s posts can be tagged at. Instagram asks for the
          place&rsquo;s Facebook Page ID and has no way to search for one while you are
          writing a post, so they are saved here once. {PAGE_ID_HELP}
        </p>

        {rows === null ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-secondary-13 text-muted-foreground">
            No places saved yet. A post can still name one by typing the Page ID in the
            composer.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map(row => (
              <li
                key={row.pageId}
                className="flex min-h-11 items-center gap-3 rounded-inner border border-border bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{row.name}</span>
                <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                  {row.pageId}
                </span>
                <button
                  type="button"
                  disabled={saving}
                  aria-label={`Remove ${row.name}`}
                  onClick={() => void remove(row)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="ig-loc-name">Place name</Label>
            <Input
              id="ig-loc-name"
              value={name}
              placeholder="Sui Kitchen Fitzroy"
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ig-loc-id">Facebook Page ID</Label>
            <Input
              id="ig-loc-id"
              value={pageId}
              inputMode="numeric"
              placeholder="102938475610293"
              onChange={e => setPageId(e.target.value)}
            />
          </div>
          <Button type="button" onClick={() => void add()} disabled={saving} className="min-h-11">
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={2.2} aria-hidden />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
