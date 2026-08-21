'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Plus } from 'lucide-react'
import { KIND_COLORS } from '../../lib/work-kinds-core'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Kind = {
  id: string; slug: string; name: string; color: string
  uses_media: boolean; active: boolean; default_roles: string[]
}

const COLOR_DOT: Record<string, string> = {
  zinc: 'bg-zinc-400', pink: 'bg-pink-500', sky: 'bg-sky-500', indigo: 'bg-indigo-500',
  violet: 'bg-violet-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500',
}

/**
 * The team's work types — how tasks are filed (video edit, graphics, copy…).
 * Data, not code: an account manager adds or archives one here and every
 * dialog and board chip follows. Archived kinds keep labelling old items.
 */
export default function WorkKindsSettings() {
  const [kinds, setKinds] = useState<Kind[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [draft, setDraft] = useState({ name: '', color: 'zinc' })

  const load = useCallback(async () => {
    const res = await fetch('/api/production/work-kinds')
    if (!res.ok) { setKinds([]); return }
    setKinds((await res.json()).kinds ?? [])
  }, [])
  useEffect(() => {
    void load()
    fetch('/api/overview').then(r => (r.ok ? r.json() : null))
      .then(j => setCanManage(['account_manager', 'super_admin'].includes(j?.role ?? '')))
      .catch(() => {})
  }, [load])

  const patch = async (kind: Kind, body: Record<string, unknown>, done: string) => {
    setBusy(kind.id)
    try {
      const res = await fetch(`/api/production/work-kinds/${kind.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      toast.success(done)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    const name = draft.name.trim()
    if (!name) { toast.error('Name the work type'); return }
    setBusy('new')
    try {
      const res = await fetch('/api/production/work-kinds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
          name,
          color: draft.color,
          default_roles: ['editor'],
          uses_media: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not add')
      toast.success(`"${name}" added — it appears in the item dialog now`)
      setDraft({ name: '', color: 'zinc' }); setAdding(false)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add')
    } finally {
      setBusy(null)
    }
  }

  // managing work types shapes everyone's filing — AM and up only
  if (!canManage || kinds === null || kinds.length === 0) return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold">Work types</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How tasks are filed — each type suggests its usual assignees. Archive, never delete:
              old items keep their label.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAdding(v => !v)}>
            <Plus className="h-3.5 w-3.5" /> Add type
          </Button>
        </div>

        {adding && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
            <Input autoFocus value={draft.name} placeholder="e.g. Motion graphics" className="w-56"
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && create()} />
            <Select value={draft.color} onValueChange={v => v && setDraft(d => ({ ...d, color: v }))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KIND_COLORS.map(c => (
                  <SelectItem key={c} value={c}>
                    <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${COLOR_DOT[c]}`} />{c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={busy !== null} onClick={create}>
              {busy === 'new' ? 'Adding…' : 'Add'}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {kinds.map(k => (
            <div key={k.id}
              className={`flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 ${k.active ? '' : 'opacity-50'}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_DOT[k.color] ?? COLOR_DOT.zinc}`} />
              <Input key={`${k.id}:${k.name}`} defaultValue={k.name} disabled={busy !== null}
                className="h-8 w-48 border-transparent bg-transparent px-1 text-sm shadow-none hover:border-zinc-200 dark:hover:border-zinc-800"
                onBlur={e => {
                  const v = e.target.value.trim()
                  if (v && v !== k.name) void patch(k, { name: v }, `Renamed to "${v}"`)
                }} />
              <span className="font-mono text-[11px] text-muted-foreground">
                suggests {k.default_roles.length ? k.default_roles.map(r => r.replace('_', ' ')).join(', ') : 'anyone'}
              </span>
              {!k.active && <Badge variant="outline" className="font-normal text-muted-foreground">archived</Badge>}
              <button type="button" disabled={busy !== null}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={() => void patch(k, { active: !k.active }, k.active ? `"${k.name}" archived` : `"${k.name}" is back`)}>
                {k.active ? 'Archive' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
