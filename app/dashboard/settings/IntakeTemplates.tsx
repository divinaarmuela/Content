'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RotateCcw, Pencil } from 'lucide-react'
import type { TemplateDefinition } from '@/app/lib/intake-core'
import IntakeEditor from '../clients/[id]/IntakeEditor'

type Row = {
  key: string
  name: string
  definition: TemplateDefinition
  customised: boolean
  updated_at: string | null
  updated_by: string | null
}

/**
 * The question templates a new intake form starts from.
 *
 * Managed here rather than while editing a client's form: "tailor this one for
 * Turnkey" and "change what every ongoing client is asked" are different
 * intentions, and a tickbox that did both meant a global change could happen
 * without anyone deciding to make one.
 */
export default function IntakeTemplates() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/intake-templates')
    if (!res.ok) { toast.error('Could not load templates'); return }
    setRows((await res.json()).templates ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  const save = async (key: string, definition: TemplateDefinition) => {
    setBusy(true)
    const res = await fetch('/api/intake-templates', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, definition }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(json.error ?? 'Could not save')
    else { toast.success('Template saved — new forms will start from it'); setEditing(null) }
    await load(); setBusy(false)
  }

  const reset = async (key: string, name: string) => {
    setBusy(true)
    const res = await fetch(`/api/intake-templates?key=${key}`, { method: 'DELETE' })
    if (!res.ok) toast.error('Could not reset')
    else toast.success(`${name} reset to the original questions`)
    await load(); setBusy(false)
  }

  if (!rows) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-body-15 font-semibold">Question templates</h3>
        <p className="text-secondary-13 text-muted-foreground">
          What a new intake form starts from. Editing one never changes a form
          that already exists — each keeps its own copy, so nobody has questions
          change while they are answering.
        </p>
      </div>

      {rows.map(r => {
        const count = r.definition.sections
          .flatMap(s => s.blocks).filter(b => b.type !== 'guidance').length
        return (
          <div key={r.key} className="rounded-inner border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0">
                <p className="text-body-15 font-medium">{r.name}</p>
                <p className="text-secondary-13 text-muted-foreground">
                  {r.definition.sections.length} sections · {count} questions
                  {r.customised
                    ? ` · edited${r.updated_by ? ` by ${r.updated_by}` : ''}`
                    : ' · original'}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                {r.customised && (
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => void reset(r.key, r.name)}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
                  </Button>
                )}
                <Button size="sm" variant="secondary"
                  onClick={() => setEditing(editing === r.key ? null : r.key)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  {editing === r.key ? 'Close' : 'Edit'}
                </Button>
              </div>
            </div>

            {editing === r.key && (
              <div className="mt-4">
                <IntakeEditor
                  definition={r.definition}
                  saving={busy}
                  onCancel={() => setEditing(null)}
                  onSave={next => void save(r.key, next)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
