'use client'

import { useState } from 'react'
import { ChevronDown, Copy, ExternalLink, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import Chip from '../../../ui/Chip'
import { newScriptId, parseScriptDoc, type ScriptBlock } from '../../../../lib/script-core'

/**
 * SCRIPTS — the team's script doc, on the plan (13 Sep 2026). One block per
 * video, each folded to its title line until opened: title and presenter,
 * a voiceover switch, the hook, the prompts (one per line), the visual
 * direction, the purpose, and the reference links. "Paste from a doc" takes
 * a whole doc the way the team already writes it and turns it into blocks
 * to check before saving. Every change goes out through `onChange`, the
 * same coalesced PATCH the shot list uses.
 */

const outlineBtn = 'h-11 rounded-full px-4 text-[14px] font-semibold'
const label = 'text-[12px] font-semibold'
const field = 'min-h-11 text-[15px]'

export default function ScriptsSection({ scripts, team, onChange }: {
  scripts: ScriptBlock[]
  team?: readonly { id: string; name: string; role: string }[]
  onChange: (next: ScriptBlock[]) => void
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(scripts.length === 1 ? [scripts[0].id] : []))
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [preview, setPreview] = useState<ScriptBlock[] | null>(null)

  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const patch = (id: string, part: Partial<ScriptBlock>) => onChange(scripts.map(b => (b.id === id ? { ...b, ...part } : b)))
  const add = () => {
    const b: ScriptBlock = { id: newScriptId(), title: '', presenter: '', voiceover: false, hook: '', prompts: [], visual: '', purpose: '', links: [] }
    onChange([...scripts, b])
    setOpen(s => new Set([...s, b.id]))
  }
  const duplicate = (b: ScriptBlock) => {
    const copy = { ...b, id: newScriptId(), prompts: [...b.prompts], links: [...b.links] }
    const i = scripts.findIndex(x => x.id === b.id)
    onChange([...scripts.slice(0, i + 1), copy, ...scripts.slice(i + 1)])
    setOpen(s => new Set([...s, copy.id]))
  }
  const remove = (id: string) => onChange(scripts.filter(b => b.id !== id))

  const presenters = (team ?? []).filter(t => t.role !== 'client').map(t => t.name)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-muted-foreground">
          {scripts.length === 0
            ? 'No scripts yet. One block per video: the hook, the prompts to ask, the visual direction and why the video exists.'
            : `${scripts.length} script${scripts.length === 1 ? '' : 's'}. Tap a title to open it.`}
        </p>
      </div>

      {scripts.map((b, i) => {
        const isOpen = open.has(b.id)
        return (
          <div key={b.id} className="rounded-inner border border-border bg-surface">
            <div className="flex items-center gap-2 px-3">
              <button type="button" onClick={() => toggle(b.id)} aria-expanded={isOpen}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                <span className="font-mono text-[12px] text-muted-foreground">Video {i + 1}</span>
                <span className="truncate text-[15px] font-semibold">{b.title || 'Untitled'}</span>
                {b.presenter && <span className="truncate text-[13px] text-muted-foreground">· {b.presenter}</span>}
                {b.voiceover && <Chip tone="blue" className="text-[12px]">voiceover</Chip>}
                {!isOpen && b.hook && <span className="hidden truncate text-[13px] text-muted-foreground sm:inline">· {b.hook}</span>}
              </button>
              <button type="button" aria-label={`Duplicate video ${i + 1}`} title="Duplicate" onClick={() => duplicate(b)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
                <Copy className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`Remove video ${i + 1}`} title="Remove" onClick={() => remove(b.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent-red-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
                <X className="h-4 w-4" />
              </button>
            </div>

            {isOpen && (
              <div className="flex flex-col gap-3 border-t border-border p-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                  <label className={`flex flex-col gap-1 ${label}`}>
                    Title
                    <Input key={`t-${b.id}-${b.title}`} defaultValue={b.title} placeholder="The Adelaide hotel project" className={field}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== b.title) patch(b.id, { title: v }) }} />
                  </label>
                  <label className={`flex flex-col gap-1 ${label}`}>
                    Presenter
                    <Input key={`p-${b.id}-${b.presenter}`} defaultValue={b.presenter} placeholder="Who is on camera" list={`presenters-${b.id}`} className={field}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== b.presenter) patch(b.id, { presenter: v }) }} />
                    <datalist id={`presenters-${b.id}`}>{presenters.map(n => <option key={n} value={n} />)}</datalist>
                  </label>
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                  <input type="checkbox" className="h-5 w-5 accent-[var(--dbx-blue)]" checked={b.voiceover} onChange={e => patch(b.id, { voiceover: e.target.checked })} />
                  <span>Voiceover concept <span className="text-[12px] text-muted-foreground">— film the work, record the talk, cut the voice over b-roll</span></span>
                </label>
                <label className={`flex flex-col gap-1 ${label}`}>
                  Hook <span className="font-normal text-muted-foreground">— the first line, the one that stops the scroll</span>
                  <Textarea key={`h-${b.id}-${b.hook}`} defaultValue={b.hook} rows={2} placeholder="We're designing every sign for a new hotel in Adelaide, and this is where it's at right now." className={field}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== b.hook) patch(b.id, { hook: v }) }} />
                </label>
                <label className={`flex flex-col gap-1 ${label}`}>
                  Prompts <span className="font-normal text-muted-foreground">— the questions to ask, one per line</span>
                  <Textarea key={`q-${b.id}-${b.prompts.join('|')}`} defaultValue={b.prompts.join('\n')} rows={Math.max(3, b.prompts.length + 1)}
                    placeholder={'When the team first sat down with this project, where did you start?\nWhat is the feeling you are designing towards?'} className={field}
                    onBlur={e => {
                      const v = e.target.value.split('\n').map(x => x.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean)
                      if (v.join('\n') !== b.prompts.join('\n')) patch(b.id, { prompts: v })
                    }} />
                </label>
                <label className={`flex flex-col gap-1 ${label}`}>
                  Visual direction <span className="font-normal text-muted-foreground">— what the camera shows, the b-roll</span>
                  <Textarea key={`v-${b.id}-${b.visual}`} defaultValue={b.visual} rows={2} placeholder="B-roll of the process, designing, before and after." className={field}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== b.visual) patch(b.id, { visual: v }) }} />
                </label>
                <label className={`flex flex-col gap-1 ${label}`}>
                  Purpose <span className="font-normal text-muted-foreground">— why this video exists</span>
                  <Textarea key={`w-${b.id}-${b.purpose}`} defaultValue={b.purpose} rows={2} placeholder="A behind-the-scenes look at a live project; shows the design thinking, not just the finished product." className={field}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== b.purpose) patch(b.id, { purpose: v }) }} />
                </label>
                <div className={`flex flex-col gap-1 ${label}`}>
                  Reference links <span className="font-normal text-muted-foreground">— one per line, https only</span>
                  <Textarea key={`l-${b.id}-${b.links.join('|')}`} defaultValue={b.links.join('\n')} rows={Math.max(2, b.links.length + 1)}
                    placeholder="https://www.instagram.com/reels/…" aria-label="Reference links, one per line" className={`${field} font-mono text-[13px]`}
                    onBlur={e => {
                      const v = e.target.value.split('\n').map(x => x.trim()).filter(x => /^https:\/\/\S+$/.test(x))
                      if (v.join('\n') !== b.links.join('\n')) patch(b.id, { links: v })
                    }} />
                  {b.links.length > 0 && (
                    <ul className="flex flex-wrap gap-2 pt-1">
                      {b.links.map(l => (
                        <li key={l}>
                          <a href={l} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-normal underline underline-offset-4">
                            {l.replace(/^https:\/\/(www\.)?/, '').slice(0, 48)} <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">, opens in a new tab</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className={outlineBtn} onClick={add}>
          <Plus className="h-4 w-4" aria-hidden /> Add a script
        </Button>
        <Button variant="ghost" className={outlineBtn} onClick={() => { setPasting(v => !v); setPreview(null) }}>
          {pasting ? 'Cancel paste' : 'Paste from a doc'}
        </Button>
      </div>

      {pasting && (
        <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
          <p className="text-[13px] text-muted-foreground">
            Paste the whole doc. It reads &ldquo;Video 1: title - presenter&rdquo;, Hook, Prompts, Visual direction, the purpose paragraph and any links, and turns each video into a block for you to check.
          </p>
          <Textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={8} placeholder={'Video 1: The Adelaide hotel project - Kareen\nHook: …\nPrompts:\n…'}
            aria-label="Paste the script doc here" className="min-h-11 font-mono text-[13px]" />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className={outlineBtn} disabled={!pasted.trim()} onClick={() => setPreview(parseScriptDoc(pasted))}>Read it</Button>
            {preview && (
              <>
                <p className="text-[13px]" role="status">
                  {preview.length === 0 ? 'No “Video N:” lines found — check the paste.' : `${preview.length} video${preview.length === 1 ? '' : 's'} found: ${preview.map((b, i) => `${i + 1}. ${b.title || 'Untitled'}${b.presenter ? ` (${b.presenter})` : ''}`).join(' · ')}`}
                </p>
                {preview.length > 0 && (
                  <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
                    onClick={() => { onChange([...scripts, ...preview]); setOpen(s => new Set([...s, ...preview.map(b => b.id)])); setPasting(false); setPasted(''); setPreview(null) }}>
                    Add {preview.length === 1 ? 'this script' : `these ${preview.length} scripts`}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
