'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

/**
 * THE POST'S NAME, AND A WAY TO CHANGE IT, at the top of the post window (the owner, 27 Nov 2026: "how to edit name",
 * with a picture of this window — the rename had been put on the Post approval drawer, which is not where a post made
 * on the Schedule is opened). A post made here is named after its file ("131"), and that name is what the client
 * reads in their portal; anyone on the team may fix it (item-edit-core `canRenameItem`).
 *
 * The name belongs to the card the post came from, so it is saved there: PATCH /api/production/items/<id> { title }.
 * A post with no card has no name to change, and shows its words plainly.
 */
export default function PostName({ itemId, title, onRenamed }: {
  itemId: string | null
  title: string
  /** shown at once, before the live row catches up */
  onRenamed: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  if (!itemId) return <span className="min-w-0 truncate text-[14px] font-semibold">{title}</span>

  const save = async () => {
    const name = draft.trim()
    if (!name) { toast.error('Give it a name'); return }
    if (name === title) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/production/items/${itemId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: name }),
      })
      if (!res.ok) {
        const said = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(said?.error || 'Could not save the name')
      }
      onRenamed(name)
      toast.success('Renamed — the client sees the new name in their portal')
      setEditing(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the name')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" data-post-name-form
        onSubmit={e => { e.preventDefault(); void save() }}>
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={200} disabled={saving}
          aria-label="Name — the client sees it in their portal"
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }}
          className="min-h-11 min-w-0 flex-1 basis-40 rounded-inner border border-border bg-surface px-3 text-[14px] font-semibold" />
        <button type="submit" disabled={saving}
          className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted">
          Cancel
        </button>
      </form>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate text-[14px] font-semibold" data-post-name>{title}</span>
      <button type="button" onClick={() => { setDraft(title); setEditing(true) }} data-rename-post
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
        <Pencil className="h-3.5 w-3.5" aria-hidden /> Rename
      </button>
    </span>
  )
}
