'use client'

import { useEffect, useMemo, useState } from 'react'
import { Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * THE ORDER THE FILES GO IN, BY WHICH WAS PICKED FIRST (the owner, 25 Oct 2026: "make sure arrangement of the files for
 * that scheduling is arranged based on whichever's picked first"). The computer's file window does not say which file
 * was clicked first — Windows hands them over by name, or with the last one clicked at the top — so the person taps
 * them here in the order they go: the first tap is 1, the next 2. A second tap takes a number off.
 */
export default function PickOrderDialog({ files, onDone, onCancel }: {
  files: File[] | null
  onDone: (ordered: File[]) => void
  onCancel: () => void
}) {
  const [order, setOrder] = useState<number[]>([])
  useEffect(() => { setOrder([]) }, [files])
  const previews = useMemo(() => (files ?? []).map(f => (f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null)), [files])
  useEffect(() => () => previews.forEach(u => u && URL.revokeObjectURL(u)), [previews])
  if (!files) return null
  const tap = (i: number) => setOrder(o => (o.includes(i) ? o.filter(x => x !== i) : [...o, i]))
  const all = order.length === files.length
  // the ones not tapped keep their place after the tapped ones
  const finish = () => onDone([...order, ...files.map((_, i) => i).filter(i => !order.includes(i))].map(i => files[i]))
  return (
    <Dialog open onOpenChange={o => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Which goes first?</DialogTitle>
          <DialogDescription>Tap the files in the order they go in the post — the first tap is 1. Tap again to take its number off.</DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
          {files.map((f, i) => {
            const n = order.indexOf(i)
            return (
              <li key={`${f.name}-${i}`}>
                <button type="button" onClick={() => tap(i)} aria-pressed={n >= 0} aria-label={`${f.name}${n >= 0 ? `, number ${n + 1}` : ''}`}
                  className={`relative flex w-full flex-col overflow-hidden rounded-inner border text-left ${n >= 0 ? 'border-foreground ring-2 ring-foreground/30' : 'border-border'}`}>
                  <span className="relative block aspect-[4/5] w-full bg-muted">
                    {previews[i] && f.type.startsWith('image/')
                      // eslint-disable-next-line @next/next/no-img-element -- a local file's preview
                      ? <img src={previews[i]!} alt="" className="h-full w-full object-cover" />
                      : previews[i]
                        ? <video src={`${previews[i]}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        : <span className="flex h-full items-center justify-center"><Film className="h-5 w-5 text-muted-foreground" aria-hidden /></span>}
                    {n >= 0 && <span className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[13px] font-bold text-background">{n + 1}</span>}
                  </span>
                  <span className="truncate px-2 py-1.5 text-[12px]">{f.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} className="rounded-full">Cancel</Button>
          {order.length > 0 && !all && <Button variant="outline" onClick={() => setOrder([])} className="rounded-full">Start again</Button>}
          <Button onClick={finish} className="rounded-full">{all ? 'Upload in this order' : order.length === 0 ? 'Upload as they are' : `Upload — ${order.length} numbered, the rest after`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
