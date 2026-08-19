'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Plus } from 'lucide-react'
import { addService, removeService, suggestServices } from '@/app/lib/services-core'

/**
 * Services as chips, picked from what already exists or typed fresh.
 *
 * Replaces a comma-separated text field. That field is why the CMS holds both
 * "Social Media" and "Social Media Management": nothing showed the author what
 * had been used before, so each project invented its own wording — and every
 * variant becomes a separate chip on the /work filter row.
 *
 * `known` is gathered from every project, so a new tag typed here appears in
 * the suggestions for the next project automatically. There is no separate
 * list to maintain, and nothing to keep in sync.
 */
export default function ServicePicker({
  value, known, onChange,
}: {
  value: string[]
  known: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const suggestions = useMemo(() => {
    const available = suggestServices(known, value)
    const q = draft.trim().toLowerCase()
    return q ? available.filter(s => s.toLowerCase().includes(q)) : available
  }, [known, value, draft])

  const commit = (raw: string) => {
    const next = addService(value, raw)
    // addService returns the list unchanged on a duplicate, so the field still
    // clears — retyping an existing tag should feel accepted, not ignored
    if (next !== value) onChange(next)
    setDraft('')
  }

  const isNew =
    draft.trim().length > 0 &&
    !known.some(s => s.toLowerCase() === draft.trim().toLowerCase())

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(s => (
            <Badge key={s} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 font-normal">
              {s}
              <button
                type="button"
                onClick={() => onChange(removeService(value, s))}
                aria-label={`Remove ${s}`}
                className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          // "type it, then click Save project" must not lose the tag — commit
          // whatever was typed the moment the field loses focus
          onBlur={() => draft.trim() && commit(draft)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              // this sits inside the project form — Enter must add a tag, not
              // submit and close the dialog
              e.preventDefault()
              commit(draft)
            }
          }}
          placeholder="Pick below, or type a new service and press Enter"
          className="bg-white dark:bg-zinc-900"
        />
        {draft.trim() && (
          <Button type="button" variant="outline" size="sm" onClick={() => commit(draft)}>
            <Plus className="h-3.5 w-3.5" /> {isNew ? 'Add new' : 'Add'}
          </Button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {isNew
          ? `“${draft.trim()}” is new — adding it here makes it available to every project, and it becomes a filter on the Work page.`
          : 'These are the filters visitors see on the Work page. Reuse an existing one where you can.'}
      </p>
    </div>
  )
}
