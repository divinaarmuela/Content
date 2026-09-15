'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useTable } from '@/lib/db-client'
import type { TeamUser } from '@/lib/db-types'
import { EDITING_ROLES } from '../../lib/editor-transfer-core'
import { groupPeople, personWords } from '../../lib/people-groups-core'
import { friendlyError } from '../../lib/support-core'

/**
 * TRANSFER THE EDITING JOB (the owner, 15 Sep 2026: "an AM for that client
 * or a super admin should be able to transfer the editing job — move all
 * the editing data to another editor"). Pick who, say why if you like, and
 * the card — brief, scripts, folder, footage, versions, comments — is theirs.
 * On a card from a shoot, the shoot's editor follows.
 */
export default function TransferEditingDialog({ open, itemId, itemTitle, currentOwnerId, viewerId, onClose, onDone }: {
  open: boolean
  itemId: string
  itemTitle: string
  currentOwnerId: string | null
  viewerId: string
  onClose: () => void
  onDone?: () => void
}) {
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { rows: team } = useTable<TeamUser>('team_users', { enabled: open })
  useEffect(() => { setTo(''); setNote('') }, [open])

  // the editors first, then the managers who also cut — never the person
  // who already has it
  const groups = groupPeople(
    team.filter(t => t.active_status !== false && EDITING_ROLES.includes(t.role) && t.id !== currentOwnerId)
      .map(t => ({ id: t.id, name: t.name || t.email, email: t.email, role: t.role })),
    'editor',
  )
  const chosen = team.find(t => t.id === to) ?? null

  const transfer = async () => {
    if (!chosen) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/items/${itemId}/transfer-editing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editor_id: chosen.id, note: note.trim() }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; shoot_followed?: boolean }
      if (!res.ok) throw new Error(friendlyError(json.error ?? 'Could not transfer the editing', 'this page'))
      toast.success(`${itemTitle} is now with ${personWords({ name: chosen.name, email: chosen.email })}${json.shoot_followed ? ' — the shoot’s editor too' : ''}. They have been told.`)
      onDone?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not transfer the editing')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer the editing job</DialogTitle>
          <DialogDescription>
            The card moves to them with everything on it — the brief, the scripts, the folder, the footage, the versions and the comments. Nothing is copied or lost. On a card from a shoot, the shoot’s editor becomes them too.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="transfer-to">Who edits it now</Label>
            <Select value={to} onValueChange={v => v && setTo(v)}>
              <SelectTrigger id="transfer-to" className="h-11 rounded-full border-border bg-surface px-4">
                <SelectValue placeholder="Pick the editor" />
              </SelectTrigger>
              <SelectContent>
                {groups.map(g => (
                  <SelectGroup key={g.role}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.people.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.id === viewerId ? 'Me' : personWords(p)}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {groups.length === 0 && <p className="text-[13px] text-muted-foreground">Nobody else on the team can take an edit yet.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="transfer-note">A word for them (optional)</Label>
            <Textarea id="transfer-note" rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Why it is moving, and what to pick up first…"
              className="rounded-[20px] border-border bg-surface px-4 py-3" />
            <p className="text-[13px] text-muted-foreground">It goes in their email. The card itself is not changed.</p>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy || !chosen} onClick={() => void transfer()}
            className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90">
            {busy ? 'Transferring…' : 'Transfer the editing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
