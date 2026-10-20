'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  BOARD_ICONS, CANVAS_COLOURS, COLOUR_LABEL, DEFAULT_COLOUR, DEFAULT_ICON, validateBoard,
  type BoardIcon, type CanvasColour,
} from '@/app/lib/board-canvas-core'
import { ICON, SWATCH_CLASS } from './canvasTone'
import { MILANOTE_ICONS, iconWords, milanoteIconUrl, searchIcons } from '@/app/lib/board-icons-core'

/**
 * One button makes a board: a name, an icon and a colour. The same dialog
 * renames one. Colours are the swatch row — never a picker — so a board
 * tile reads in both themes.
 */
export default function NewBoardDialog({ open, onOpenChange, onSubmit, initial, title = 'New board', submitLabel = 'Make the board', imageIcons = false }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `icon_url` only when `imageIcons`: one of Milanote's icons, or null for one of our own set */
  onSubmit: (v: { name: string; icon: BoardIcon; colour: CanvasColour; icon_url?: string | null }) => Promise<void> | void
  initial?: { name: string; icon: string; colour: string; icon_url?: string | null }
  /** offer Milanote's icons too (the team boards, 20 Oct 2026: "these icons are not available in our software?") */
  imageIcons?: boolean
  title?: string
  submitLabel?: string
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState<BoardIcon>(DEFAULT_ICON)
  const [colour, setColour] = useState<CanvasColour>(DEFAULT_COLOUR.board)
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const v = validateBoard({ name: initial?.name ?? 'x', icon: initial?.icon, colour: initial?.colour })
    setName(initial?.name ?? '')
    setIcon(v.ok ? v.icon : DEFAULT_ICON)
    setColour(v.ok ? v.colour : DEFAULT_COLOUR.board)
    setIconUrl(initial?.icon_url ?? null)
    setMore(!!initial?.icon_url)
    setFind('')
    setReason(null)
  }, [open, initial?.name, initial?.icon, initial?.colour, initial?.icon_url])

  const submit = async () => {
    const v = validateBoard({ name, icon, colour })
    if (!v.ok) { setReason(v.reason); return }
    setBusy(true)
    try {
      await onSubmit({ name: v.name, icon: v.icon, colour: v.colour, ...(imageIcons ? { icon_url: iconUrl } : {}) })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>A board is its own canvas. Put notes, images, links and more boards inside it.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); void submit() }}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-name">Name</Label>
            <Input id="board-name" value={name} onChange={e => { setName(e.target.value); setReason(null) }} placeholder="Shoot concepts" autoFocus maxLength={80} />
            {reason && <p className="text-[13px] text-accent-red">{reason}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1.5">
              {BOARD_ICONS.map(name => {
                const I = ICON[name]
                return (
                  <button
                    key={name}
                    type="button"
                    aria-label={name}
                    aria-pressed={!iconUrl && icon === name}
                    onClick={() => { setIcon(name); setIconUrl(null) }}
                    className={cn(
                      'inline-flex h-11 w-11 items-center justify-center rounded-tile border border-border bg-surface hover:bg-foreground/[0.04]',
                      !iconUrl && icon === name && 'border-foreground ring-2 ring-foreground',
                    )}
                  >
                    <I className="h-5 w-5" />
                  </button>
                )
              })}
            </div>
            {imageIcons && (
              <>
                <button type="button" onClick={() => setMore(m => !m)} className="self-start text-[13px] font-medium underline underline-offset-2">
                  {more ? 'Fewer icons' : `More icons (${MILANOTE_ICONS.length})`}
                </button>
                {more && (
                  <div className="flex flex-col gap-2">
                    <Input value={find} onChange={e => setFind(e.target.value)} placeholder="Find an icon — star, camera, file…" aria-label="Find an icon" />
                    <div className="grid max-h-56 grid-cols-8 gap-1.5 overflow-y-auto rounded-tile border border-border p-1.5">
                      {searchIcons(find).map(n => {
                        const url = milanoteIconUrl(n)
                        return (
                          <button key={n} type="button" title={iconWords(n)} aria-label={iconWords(n)} aria-pressed={iconUrl === url}
                            onClick={() => setIconUrl(url)}
                            className={cn('inline-flex h-10 w-10 items-center justify-center rounded-tile border border-transparent bg-surface hover:border-border',
                              iconUrl === url && 'border-foreground ring-2 ring-foreground')}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="h-6 w-6 object-contain dark:invert" />
                          </button>
                        )
                      })}
                      {searchIcons(find).length === 0 && <p className="col-span-8 p-2 text-[13px] text-muted-foreground">No icon called that.</p>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Colour</Label>
            <SwatchRow value={colour} onChange={setColour} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Making…' : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The swatch row — shared with the item bar on the canvas. */
export function SwatchRow({ value, onChange, size = 'lg' }: {
  value: CanvasColour | null
  onChange: (c: CanvasColour) => void
  size?: 'lg' | 'sm'
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
      {CANVAS_COLOURS.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOUR_LABEL[c]}
          title={COLOUR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn(
            'inline-flex items-center justify-center rounded-full',
            size === 'lg' ? 'h-11 w-11' : 'h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
            value === c && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
          )}
        >
          <span className={cn('block rounded-full', size === 'lg' ? 'h-7 w-7' : 'h-5 w-5', SWATCH_CLASS[c])} />
        </button>
      ))}
    </div>
  )
}
