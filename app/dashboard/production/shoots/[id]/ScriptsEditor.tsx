'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { newScriptId, sanitiseScripts, type ScriptBlock } from '../../../../lib/script-core'

/**
 * THE SCRIPTS, ONE PER VIDEO (the owner, 15 Sep 2026: "there will be
 * multiple scripts per brief — Add new script, a script name, the body in
 * it, then an option to add another script, same process — make sure it
 * looks good on the brief PDF and on the editor's card").
 *
 * Each script is a name and its words, typed as paragraphs. Saved as the
 * plan's script blocks (script-core), so the PDF prints each as its own
 * section, the editor's card lists each under its name, and the portal
 * shows the same. Saved on blur, the whole list at once.
 */
const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }

export default function ScriptsEditor({ scripts, onSave, disabled = false }: {
  scripts: unknown
  onSave: (blocks: ScriptBlock[]) => void
  disabled?: boolean
}) {
  const [blocks, setBlocks] = useState<ScriptBlock[]>(() => sanitiseScripts(scripts))
  const box = useRef<HTMLDivElement>(null)
  /** the last words this editor saved or adopted, so a server echo of our own
   *  save is recognised and never treated as somebody else's change */
  const known = useRef(JSON.stringify(sanitiseScripts(scripts)))
  /* NEVER OVERWRITE WHAT IS BEING TYPED (the owner, 15 Sep 2026: "the script
   * doesn't update properly — it shifts back to empty text"). Blurring the
   * name saved it; the echo of that save arrived while the words were being
   * typed, and the box was reset to what the server had. A row is adopted
   * only when it differs from what we last saved or saw, and never while a
   * box in here has the focus. */
  useEffect(() => {
    const incoming = JSON.stringify(sanitiseScripts(scripts))
    if (incoming === known.current) return
    if (box.current && box.current.contains(document.activeElement)) return
    known.current = incoming
    setBlocks(sanitiseScripts(scripts))
  }, [scripts])

  const commit = (next: ScriptBlock[]) => {
    setBlocks(next)
    const clean = sanitiseScripts(next)
    const json = JSON.stringify(clean)
    if (json === known.current) return          // nothing changed: no save, no echo
    known.current = json
    onSave(clean)
  }
  const blank = (): ScriptBlock => ({
    id: newScriptId(), title: '', presenter: '', voiceover: false, hook: '', prompts: [], visual: '', purpose: '', links: [], body: '',
  })

  return (
    <div ref={box} className="flex flex-col gap-3" data-scripts-editor>
      {blocks.map((b, i) => (
        <div key={b.id} className="flex flex-col gap-2 rounded-inner border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-[12px] uppercase tracking-wider text-muted-foreground">Script {i + 1}</span>
            <Input value={b.title} disabled={disabled} placeholder="Script name — e.g. The hotel project" aria-label={`Script ${i + 1} name`}
              className="h-11 flex-1 text-[15px]"
              onChange={e => setBlocks(cur => cur.map(x => x.id === b.id ? { ...x, title: e.target.value } : x))}
              onBlur={() => commit(blocks)} />
            {!disabled && (
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove script ${i + 1}`} title="Remove this script"
                className="h-11 w-11 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => commit(blocks.filter(x => x.id !== b.id))}>
                <X className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
          <Textarea value={b.body} disabled={disabled} rows={4} aria-label={`Script ${i + 1} words`}
            placeholder="The script — write it as it will be said, a paragraph at a time"
            className="min-h-11 text-[15px] leading-[1.5]"
            ref={el => { if (el) grow(el) }}
            onInput={e => grow(e.currentTarget)}
            onChange={e => setBlocks(cur => cur.map(x => x.id === b.id ? { ...x, body: e.target.value } : x))}
            onBlur={() => commit(blocks)} />
        </div>
      ))}
      {!disabled && (
        <Button type="button" variant="outline" className="h-11 w-fit rounded-full px-4 text-[13px] font-semibold"
          // a fresh script is kept here until it has words; an empty one is never saved
          onClick={() => setBlocks(cur => [...cur, blank()])}>
          <Plus className="h-4 w-4" aria-hidden /> {blocks.length === 0 ? 'Add a script' : 'Add another script'}
        </Button>
      )}
    </div>
  )
}
