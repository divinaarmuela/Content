'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, Folder } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { friendlyError } from '@/app/lib/support-core'
import { isFolder, type Crumb, type DriveEntry } from '@/app/lib/files-core'
import { buildQuery } from './useDriveBrowse'

/**
 * The four questions this page asks before it changes anything.
 *
 * They exist because of one instruction from the owner: the app must never
 * rename, move or delete anything in their Drive on its own. So every one of
 * these names the thing out loud — "Rename “Sui Kitchen” to …?", "Move 3 items
 * into “Clients”?" — and only pressing the button in it sends `confirm: true`,
 * which is the flag the server refuses to act without. A drag that lands, a
 * sync, a retry: none of them can produce it.
 *
 * There is no Delete dialog, because there is no delete. Nothing this page can
 * do removes a file from the owner's Drive.
 */

type Busy = { busy: boolean; error: string | null }

function useAction() {
  const [state, setState] = useState<Busy>({ busy: false, error: null })
  const run = async (fn: () => Promise<Response>, done: () => void) => {
    setState({ busy: true, error: null })
    try {
      const res = await fn()
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok || json?.error) {
        setState({ busy: false, error: friendlyError(json?.error ?? '', 'Files') })
        return
      }
      setState({ busy: false, error: null })
      done()
    } catch {
      setState({ busy: false, error: friendlyError('', 'Files') })
    }
  }
  return { ...state, run, reset: () => setState({ busy: false, error: null }) }
}

/* ── New folder ────────────────────────────────────────────────────────── */

export function NewFolderDialog({
  open, parent, onClose, onMade,
}: {
  open: boolean
  parent: Crumb | null
  onClose: () => void
  onMade: (id: string, created: boolean) => void
}) {
  const [name, setName] = useState('')
  const action = useAction()
  useEffect(() => { if (open) { setName(''); action.reset() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-popover">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            It goes inside “{parent?.name ?? 'this folder'}”. If a folder with this name is
            already there, we will open that one rather than make a second.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          autoFocus
          placeholder="Folder name"
          className="min-h-[44px]"
          onChange={e => setName(e.target.value)}
        />
        {action.error && <p className="text-secondary-13 text-accent-red">{action.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || action.busy || !parent}
            onClick={() => action.run(
              () => fetch('/api/drive/folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent: parent?.id, name: name.trim() }),
              }),
              () => onMade(parent!.id, true),
            )}
          >
            {action.busy ? 'Making it…' : 'Make the folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Rename ────────────────────────────────────────────────────────────── */

export function RenameDialog({
  entry, onClose, onDone,
}: {
  entry: DriveEntry | null
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const action = useAction()
  useEffect(() => { if (entry) { setName(entry.name); action.reset() } }, [entry]) // eslint-disable-line react-hooks/exhaustive-deps

  const changed = entry && name.trim() && name.trim() !== entry.name
  return (
    <Dialog open={!!entry} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-popover">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>
            {changed
              ? `Rename “${entry.name}” to “${name.trim()}”?`
              : 'This renames the real file in Google Drive. Nobody else is told.'}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          autoFocus
          className="min-h-[44px]"
          onChange={e => setName(e.target.value)}
        />
        {action.error && <p className="text-secondary-13 text-accent-red">{action.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!changed || action.busy}
            onClick={() => action.run(
              () => fetch('/api/drive/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // the flag the server will not act without
                body: JSON.stringify({ id: entry!.id, name: name.trim(), confirm: true }),
              }),
              onDone,
            )}
          >
            {action.busy ? 'Renaming…' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Move ──────────────────────────────────────────────────────────────── */

export type MoveRequest = {
  ids: string[]
  names: string[]
  /** set when a drop chose the folder; null when Move… must ask for one */
  target: Crumb | null
}

export function MoveDialog({
  request, root, onClose, onDone,
}: {
  request: MoveRequest | null
  root: Crumb | null
  onClose: () => void
  onDone: (targetId: string) => void
}) {
  const [picked, setPicked] = useState<Crumb | null>(null)
  const action = useAction()
  useEffect(() => {
    if (request) { setPicked(request.target ?? root); action.reset() }
  }, [request, root]) // eslint-disable-line react-hooks/exhaustive-deps

  const what = request
    ? request.names.length === 1 ? `“${request.names[0]}”` : `${request.names.length} items`
    : ''

  return (
    <Dialog open={!!request} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-popover">
        <DialogHeader>
          <DialogTitle>Move</DialogTitle>
          <DialogDescription>
            {picked
              ? `Move ${what} into “${picked.name}”?`
              : `Choose where ${what} should go.`}
          </DialogDescription>
        </DialogHeader>

        {/* a drop already chose the folder; Move… from the keyboard has to ask */}
        {!request?.target && <FolderPicker root={root} picked={picked} onPick={setPicked} />}

        {action.error && <p className="text-secondary-13 text-accent-red">{action.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!picked || action.busy}
            onClick={() => action.run(
              () => fetch('/api/drive/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: request!.ids, to: picked!.id, confirm: true }),
              }),
              () => onDone(picked!.id),
            )}
          >
            {action.busy ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Walking down the tree with a keyboard, for the person who cannot drag.
 *
 * One level at a time, from the root, showing the folders inside whatever is
 * currently chosen. Not a mirror of the left rail: this is a decision, and a
 * decision wants a short list and a clear "you are choosing this one".
 */
function FolderPicker({
  root, picked, onPick,
}: {
  root: Crumb | null
  picked: Crumb | null
  onPick: (crumb: Crumb) => void
}) {
  const [trail, setTrail] = useState<Crumb[]>([])
  const [folders, setFolders] = useState<DriveEntry[]>([])
  const [loading, setLoading] = useState(false)

  const at = picked ?? root

  useEffect(() => {
    if (!at) return
    let alive = true
    setLoading(true)
    void fetch(`/api/drive/list?${buildQuery({ parentId: at.id, foldersOnly: true })}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((json: { entries?: DriveEntry[] }) => {
        if (alive) setFolders((json.entries ?? []).filter(isFolder))
      })
      .catch(() => { if (alive) setFolders([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [at?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!root) return
    setTrail(t => {
      if (!picked) return [root]
      const at = t.findIndex(c => c.id === picked.id)
      return at === -1 ? [...t, picked] : t.slice(0, at + 1)
    })
  }, [picked, root])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 text-secondary-13 text-muted-foreground">
        {trail.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />}
            <button
              type="button"
              onClick={() => onPick(crumb)}
              className={cn('rounded px-1 hover:underline', index === trail.length - 1 && 'font-semibold text-foreground')}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>
      <div className="max-h-[220px] overflow-y-auto rounded-inner border border-border">
        {loading && <p className="p-3 text-secondary-13 text-muted-foreground">Looking…</p>}
        {!loading && folders.length === 0 && (
          <p className="p-3 text-secondary-13 text-muted-foreground">No folders in here.</p>
        )}
        {folders.map(folder => (
          <button
            key={folder.id}
            type="button"
            onClick={() => onPick({ id: folder.id, name: folder.name })}
            className="flex min-h-[44px] w-full items-center gap-2.5 border-b border-border px-3 text-left text-secondary-13 last:border-0 hover:bg-foreground/[0.04]"
          >
            <Folder className="h-4 w-4 shrink-0 text-accent-blue" strokeWidth={1.8} />
            <span className="truncate">{folder.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Get a link ────────────────────────────────────────────────────────── */

export function ShareDialog({
  entry, onClose,
}: {
  entry: DriveEntry | null
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const action = useAction()
  useEffect(() => { if (entry) { setUrl(null); action.reset() } }, [entry]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={!!entry} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-popover">
        <DialogHeader>
          <DialogTitle>Get a link</DialogTitle>
          <DialogDescription>
            Anyone with this link will be able to open “{entry?.name}”. They will not be
            able to change it, and it will not turn up in anybody&rsquo;s search.
          </DialogDescription>
        </DialogHeader>
        {url && (
          <Input readOnly value={url} className="min-h-[44px]" onFocus={e => e.currentTarget.select()} />
        )}
        {action.error && <p className="text-secondary-13 text-accent-red">{action.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{url ? 'Done' : 'Cancel'}</Button>
          {!url && (
            <Button
              disabled={action.busy}
              onClick={() => action.run(
                async () => {
                  const res = await fetch('/api/drive/share', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: entry!.id, confirm: true }),
                  })
                  const clone = res.clone()
                  const json = await clone.json().catch(() => null) as { url?: string } | null
                  if (res.ok && json?.url) setUrl(json.url)
                  return res
                },
                () => {},
              )}
            >
              {action.busy ? 'Making a link…' : 'Make a link'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
