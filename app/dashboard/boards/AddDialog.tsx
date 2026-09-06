'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { defaultLinkLabel, isSafeUrl, linkService, SERVICE_LABEL } from '@/app/lib/board-canvas-core'

/**
 * The one small form the canvas needs for the items that start with words:
 * a link (a pasted Drive or Dropbox URL and what to call it), a heading
 * (its words) and a column (its title). A link is a link — it is shown and
 * opened where it lives, and nothing is ever written to Drive (trap 13).
 */
export type AddKind = 'link' | 'heading' | 'column'

const COPY: Record<AddKind, { title: string; description: string; field: string; placeholder: string; submit: string }> = {
  link: { title: 'Add a link', description: 'Paste a Google Drive or Dropbox link. It opens where it lives.', field: 'Link', placeholder: 'https://drive.google.com/…', submit: 'Add the link' },
  heading: { title: 'Add a heading', description: 'A coloured strip across the board, for dividing it into areas.', field: 'Words', placeholder: 'SHOOT CONCEPTS', submit: 'Add the heading' },
  column: { title: 'Add a column', description: 'A titled stack. Drop items into it and they line up.', field: 'Title', placeholder: 'Shoot Day 1 (day time)', submit: 'Add the column' },
}

export default function AddDialog({ kind, open, onOpenChange, onSubmit }: {
  kind: AddKind
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (v: { url?: string; label?: string; text?: string }) => Promise<void> | void
}) {
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const copy = COPY[kind]

  useEffect(() => { if (open) { setValue(''); setLabel(''); setReason(null) } }, [open, kind])

  const submit = async () => {
    const v = value.trim()
    if (kind === 'link') {
      if (!isSafeUrl(v)) { setReason('Paste a full link, starting with https://'); return }
    } else if (!v) {
      setReason(kind === 'heading' ? 'Give the heading some words' : 'Give the column a title'); return
    }
    setBusy(true)
    try {
      if (kind === 'link') await onSubmit({ url: v, label: label.trim() || defaultLinkLabel(v) })
      else await onSubmit({ text: v })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const service = kind === 'link' && isSafeUrl(value) ? SERVICE_LABEL[linkService(value)] : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); void submit() }}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-value">{copy.field}</Label>
            <Input
              id="add-value"
              value={value}
              onChange={e => { setValue(e.target.value); setReason(null) }}
              placeholder={copy.placeholder}
              autoFocus
              maxLength={kind === 'link' ? 2048 : 120}
              inputMode={kind === 'link' ? 'url' : 'text'}
            />
            {service && <p className="text-[13px] text-muted-foreground">Looks like {service}.</p>}
            {reason && <p className="text-[13px] text-accent-red">{reason}</p>}
          </div>
          {kind === 'link' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-label">What to call it <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="add-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="Raw footage — day 1" maxLength={120} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Adding…' : copy.submit}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
