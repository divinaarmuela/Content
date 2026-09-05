'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { FileText, Upload } from 'lucide-react'
import type { TemplateDefinition, TemplateKey } from '@/app/lib/intake-core'

/**
 * "Create from a document" — drop in the form a client already has, get a draft
 * of it here.
 *
 * The document is read once and thrown away: it is not saved anywhere, which
 * this dialog says out loud because people are handing over other people's
 * paperwork. Nothing is written to the database either — the draft opens in the
 * builder and only Save creates anything.
 */

export type ScanDraft = {
  definition: TemplateDefinition
  uncertain: string[]
  notes: string[]
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown'
const MAX_BYTES = 20 * 1024 * 1024

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function IntakeScanDialog({
  open, onOpenChange, templateKey, hasQuestions, onDrafted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateKey: TemplateKey
  /** whether the form on screen already has questions — decides whether the
   *  "add to the end" choice is worth showing at all */
  hasQuestions: boolean
  onDrafted: (draft: ScanDraft, mode: 'replace' | 'append') => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => { setFile(null); setError(null); setBusy(false); setDragging(false) }

  const choose = (picked: File | null | undefined) => {
    setError(null)
    if (!picked) return
    // the same refusal the server gives, said here first so nobody waits for an
    // upload that was never going to work
    if (picked.size > MAX_BYTES) {
      setFile(null)
      setError('That file is bigger than 20 MB. Try a smaller document, or save just '
        + 'the pages with the questions on them.')
      return
    }
    setFile(picked)
  }

  const scan = async () => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('key', templateKey)
      const res = await fetch('/api/intake-templates/scan', { method: 'POST', body })
      // a failure at the edge (too big for the host, a proxy error) is not JSON
      const json = await res.json().catch(() => null) as
        { error?: string; definition?: TemplateDefinition; uncertain?: string[]; notes?: string[] } | null

      if (!res.ok || !json?.definition) {
        setError(json?.error
          ?? (res.status === 413
            ? 'That document was too big to send. Try a smaller one.'
            : 'We could not read that document. Try again, or add the questions yourself.'))
        setBusy(false)
        return
      }

      onDrafted({
        definition: json.definition,
        uncertain: json.uncertain ?? [],
        notes: json.notes ?? [],
      }, hasQuestions ? mode : 'replace')
      reset()
      onOpenChange(false)
    } catch {
      // an offline browser or a dropped connection — never a thrown error in
      // the page, and the builder behind this dialog is untouched
      setError('That did not go through. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) { if (!next) reset(); onOpenChange(next) } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create from a document</DialogTitle>
          <DialogDescription>
            Add a form you already have — a PDF, a photo of a printed page, or a text
            file — and we will draft the questions here for you to check. Your document
            is read once and not saved anywhere.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false)
            if (!busy) choose(e.dataTransfer.files?.[0])
          }}
          className={
            'flex flex-col items-center gap-2 rounded-inner border border-dashed p-6 text-center transition-colors '
            + (dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/30')
          }
        >
          <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-body-15">Drop your document here</p>
          <p className="text-secondary-13 text-muted-foreground">
            PDF, PNG, JPG, WEBP, TXT or MD · up to 20 MB
          </p>
          <input
            ref={inputRef} type="file" accept={ACCEPT} className="sr-only"
            onChange={e => choose(e.target.files?.[0])}
          />
          <Button size="sm" variant="secondary" disabled={busy}
            onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
        </div>

        {file && (
          <div className="flex items-center gap-2 rounded-inner border border-border bg-card p-3">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-15">{file.name}</p>
              <p className="text-secondary-13 text-muted-foreground">{sizeLabel(file.size)}</p>
            </div>
            {!busy && (
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>Remove</Button>
            )}
          </div>
        )}

        {file && hasQuestions && !busy && (
          <div className="flex flex-col gap-2">
            <p className="text-secondary-13 text-muted-foreground">
              This form already has questions. What should we do with the new ones?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={mode === 'replace' ? 'default' : 'secondary'}
                aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>
                Replace them
              </Button>
              <Button size="sm" variant={mode === 'append' ? 'default' : 'secondary'}
                aria-pressed={mode === 'append'} onClick={() => setMode('append')}>
                Add to the end
              </Button>
            </div>
          </div>
        )}

        {busy && (
          <p className="text-secondary-13 text-muted-foreground" role="status" aria-live="polite">
            Reading your document… this takes up to a minute for a long one.
          </p>
        )}

        {error && (
          <p className="rounded-inner border border-destructive/40 bg-destructive/10 p-3 text-secondary-13 text-destructive"
            role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy}
            onClick={() => { reset(); onOpenChange(false) }}>
            Cancel
          </Button>
          <Button disabled={!file || busy} onClick={() => void scan()}>
            {busy ? 'Reading…' : 'Draft the questions'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
