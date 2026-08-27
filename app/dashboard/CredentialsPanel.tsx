'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Copy, Eye, EyeOff, KeyRound, Lock, Pencil, Plus, Trash2, ExternalLink } from 'lucide-react'
import ConfirmAction from './ConfirmAction'
import EmptyState from './EmptyState'
import { useRole } from './useRole'

type Credential = {
  id: string
  platform: string
  label: string
  username: string
  url: string
  notes: string
  has_secret: boolean
  updated_at: string
  updated_by_name: string
}

const BLANK = { platform: '', label: '', username: '', secret: '', url: '', notes: '' }

/** Sentinel for the free-text escape in the platform Select. */
const OTHER = '__other'
/** a bare 14px glyph is not a tap target — this gives the finger 44px on touch */
const ICON_TAP = 'inline-flex items-center justify-center rounded p-1 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11'

const SUGGESTED = [
  'Instagram', 'Facebook', 'Meta Business', 'Meta Ads', 'TikTok', 'LinkedIn',
  'Google Business', 'Google Ads', 'Google Analytics', 'Shopify', 'Squarespace',
  'WordPress', 'Mailchimp', 'Klaviyo', 'Canva',
]

export default function CredentialsPanel({ endpoint }: { endpoint: string }) {
  // Everyone who can open this panel can read and copy a credential — they
  // are the people who have to log into these accounts, and making them ask
  // every time just moves passwords into chat messages. Changing one is
  // super_admin, enforced in the API as well as here.
  const { can } = useRole()
  const canEdit = can('super_admin')

  const [items, setItems] = useState<Credential[] | null>(null)
  const [draft, setDraft] = useState<(Partial<Credential> & { secret?: string }) | null>(null)
  const [saving, setSaving] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  // a saved credential whose platform is not on the list opens in free-text mode
  const [custom, setCustom] = useState(false)
  const [maskDraft, setMaskDraft] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load credentials')
      setItems(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load credentials')
      setItems([])
    }
  }, [endpoint])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!draft?.platform?.trim()) return toast.error('A platform is required')
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success(draft.id ? 'Credential updated' : 'Credential added')
      setDraft(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const reveal = async (c: Credential) => {
    if (revealed[c.id]) {
      // hiding again clears it from memory rather than just from view
      setRevealed(r => { const { [c.id]: _drop, ...rest } = r; return rest })
      return
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reveal', credentialId: c.id }),
    })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? 'Could not reveal')
    setRevealed(r => ({ ...r, [c.id]: json.secret }))
  }

  if (items === null) return <Skeleton className="h-48 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {items.length} credential{items.length === 1 ? '' : 's'}
        </p>
        {!draft && canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => { setCustom(false); setDraft({ ...BLANK }) }}>
            <Plus className="h-4 w-4" /> Add credential
          </Button>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        Passwords are encrypted before they are stored and are never included when this list
        loads — click the eye to reveal one.{canEdit ? '' : ' Only a super admin can change them.'}
      </p>

      {draft && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Platform</Label>
              {/* A Select, not a datalist — the rest of the dashboard is shadcn
                  and a bare <input list> looks and behaves like neither.
                  "Something else" keeps the free-text escape the list needs:
                  a fixed list would be wrong the first time a client turns up
                  on a platform nobody anticipated. */}
              <Select
                value={custom ? OTHER : (draft.platform || '')}
                onValueChange={v => {
                  if (v === OTHER) { setCustom(true); setDraft(d => ({ ...d, platform: '' })) }
                  else { setCustom(false); setDraft(d => ({ ...d, platform: v })) }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Choose a platform" /></SelectTrigger>
                <SelectContent>
                  {SUGGESTED.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  <SelectItem value={OTHER}>Something else…</SelectItem>
                </SelectContent>
              </Select>
              {custom && (
                <Input
                  autoFocus
                  value={draft.platform ?? ''}
                  placeholder="Name the platform"
                  onChange={e => setDraft(d => ({ ...d, platform: e.target.value }))}
                />
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Label <span className="text-xs text-zinc-400">(which account)</span></Label>
              <Input value={draft.label ?? ''} placeholder="Main account, ads manager…"
                onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Username / email</Label>
              <Input value={draft.username ?? ''}
                onChange={e => setDraft(d => ({ ...d, username: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>
                Password
                {draft.id && <span className="ml-1 text-xs text-zinc-400">(blank = leave unchanged)</span>}
              </Label>
              {/* Visible while typing, with a toggle to mask it. Masking by
                  default only guards against someone reading your screen —
                  which is not the threat here — while guaranteeing typos in
                  the one field where a typo is invisible until it fails. */}
              <div className="relative">
                <Input
                  type={maskDraft ? 'password' : 'text'}
                  value={draft.secret ?? ''}
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-9 font-mono text-sm"
                  onChange={e => setDraft(d => ({ ...d, secret: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setMaskDraft(m => !m)}
                  aria-label={maskDraft ? 'Show password' : 'Hide password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {maskDraft ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Login URL</Label>
              <Input value={draft.url ?? ''} placeholder="https://…"
                onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Notes <span className="text-xs text-zinc-400">(2FA, recovery…)</span></Label>
              <Input value={draft.notes ?? ''}
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save credential'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && !draft ? (
        <EmptyState
          icon={KeyRound}
          title="No shared logins yet"
          body="Store the logins the whole team needs for this client here, so nobody keeps them in a chat message. Everyone with access to this client can see them."
          actionLabel={canEdit ? 'Add a login' : undefined}
          onAction={() => { setCustom(false); setDraft({ ...BLANK }) }}
        />
      ) : items.length > 0 && (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                <TableHead>Platform</TableHead>
                <TableHead>Username</TableHead>
                <TableHead className="w-64">Password</TableHead>
                <TableHead className="w-40">Last updated</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(c => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.platform}</p>
                        {c.label && <p className="truncate text-xs text-zinc-400">{c.label}</p>}
                      </div>
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noreferrer noopener"
                          className="text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                          aria-label={`Open ${c.platform}`}>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    {c.username ? (
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">
                          {c.username}
                        </span>
                        <button onClick={() => { navigator.clipboard.writeText(c.username); toast.success('Username copied') }}
                          aria-label="Copy username"
                          className={ICON_TAP}>
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    ) : <span className="text-xs text-zinc-400">—</span>}
                  </TableCell>

                  <TableCell>
                    {!c.has_secret ? (
                      <span className="text-xs text-zinc-400">none stored</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-700 dark:text-zinc-200">
                          {revealed[c.id] ?? '••••••••••'}
                        </span>
                        <button onClick={() => reveal(c)}
                          aria-label={revealed[c.id] ? 'Hide password' : 'Reveal password'}
                          className={ICON_TAP}>
                          {revealed[c.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        {revealed[c.id] && (
                          <button onClick={() => { navigator.clipboard.writeText(revealed[c.id]); toast.success('Password copied') }}
                            aria-label="Copy password"
                            className={ICON_TAP}>
                            <Copy className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(c.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                    </p>
                    {c.updated_by_name && (
                      <p className="truncate text-[11px] text-zinc-400">by {c.updated_by_name}</p>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex gap-0.5">
                      {!canEdit ? null : (
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => { setCustom(!SUGGESTED.includes(c.platform)); setDraft({ ...c, secret: '' }) }} aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      )}
                      {canEdit && (
                      <ConfirmAction
                        title={`Delete the ${c.platform} login?`}
                        body="Everyone on the team loses this password — there is no copy, and it cannot be restored. If it has only changed, edit it instead."
                        confirmLabel="Delete login"
                        onConfirm={async () => {
                          const res = await fetch(`${endpoint}?credentialId=${c.id}`, { method: 'DELETE' })
                          if (!res.ok) return toast.error((await res.json()).error ?? 'Delete failed')
                          toast.success(`${c.platform} login deleted`)
                          load()
                        }}
                      >
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-red-500 hover:text-red-600"
                          aria-label={`Delete the ${c.platform} login`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </ConfirmAction>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {items.some(c => c.notes) && (
        <div className="flex flex-col gap-1.5">
          {items.filter(c => c.notes).map(c => (
            <p key={c.id} className="text-xs text-zinc-500 dark:text-zinc-400">
              <Badge variant="outline" className="mr-2 font-normal">{c.platform}</Badge>
              {c.notes}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
