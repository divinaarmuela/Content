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
 */
export default function InstagramLocations({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<SavedLocation[] | null>(null)
  const [name, setName] = useState('')
  const [pageId, setPageId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/website/clients/${clientId}`)
      const json = await res.json()
      setRows(res.ok ? readLocations(json?.instagram_locations) : [])
    } catch {
      setRows([])
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const save = async (next: SavedLocation[]) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/website/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagram_locations: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setRows(readLocations(json?.instagram_locations))
      toast.success('Saved')
    } catch (e) {
      toast.error(friendlyError(e instanceof Error ? e.message : '', 'this client'))
    } finally {
      setSaving(false)
    }
  }

  const add = () => {
    const n = name.trim()
    const id = pageId.trim()
    if (!n) { toast.error('Give the place a name your team will recognise'); return }
    if (!isPageId(id)) {
      toast.error('That does not look like a Page ID — it is a long number, not the @name')
      return
    }
    if ((rows ?? []).some(r => r.pageId === id)) {
      toast.error('That place is already on the list')
      return
    }
    void save([...(rows ?? []), { name: n, pageId: id }])
    setName(''); setPageId('')
  }

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
                  onClick={() => void save(rows.filter(r => r.pageId !== row.pageId))}
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
          <Button type="button" onClick={add} disabled={saving} className="min-h-11">
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={2.2} aria-hidden />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
