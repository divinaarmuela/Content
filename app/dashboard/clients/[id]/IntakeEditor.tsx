'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ChevronDown, ChevronUp, Eye, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { archivo, sometype } from '@/app/components/lama/fonts'
import {
  BLOCK_TYPES, moveItem,
  type Block, type BlockType, type Section, type TemplateDefinition,
} from '@/app/lib/intake-core'
import {
  GuidanceBlock, TextBlock, SelectBlock, MultiSelectBlock, FileBlock,
} from '@/app/intake/[token]/blocks'

/**
 * Edit one form's questions.
 *
 * Every real form we have sent was tailored to the client, so a template is a
 * starting point rather than the deliverable, and this is where the tailoring
 * happens.
 *
 * Deliberately flat: everything is visible at once, no collapsing, no modes.
 * An earlier version hid each section behind an Edit/Collapse toggle, which
 * meant finding a question took a click before it took a scroll. Reordering
 * controls only appear on hover so the resting state is just the questions.
 */

/** Plain language. "long_text" is a database word; "Paragraph" is what the
 *  person choosing it is actually thinking. */
const TYPES: { value: BlockType; label: string; hint: string }[] = [
  { value: 'short_text', label: 'Short answer', hint: 'A line' },
  { value: 'long_text', label: 'Paragraph', hint: 'A few sentences or more' },
  { value: 'select', label: 'Pick one', hint: 'From your options' },
  { value: 'multi_select', label: 'Pick several', hint: 'From your options' },
  { value: 'link', label: 'Link', hint: 'A URL' },
  { value: 'file', label: 'File upload', hint: 'Logos, brand guide' },
  { value: 'guidance', label: 'Note (no answer)', hint: 'Text they read' },
]

const TYPE_LABEL = (t: BlockType) => TYPES.find(x => x.value === t)?.label ?? t

type Drag = { kind: 'section'; si: number } | { kind: 'block'; si: number; bi: number } | null

export default function IntakeEditor({
  definition, onSave, onCancel, saving,
}: {
  definition: TemplateDefinition
  onSave: (next: TemplateDefinition) => void
  onCancel: () => void
  saving: boolean
}) {
  const [draft, setDraft] = useState<TemplateDefinition>(definition)
  const [drag, setDrag] = useState<Drag>(null)
  const [over, setOver] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  /**
   * Raw text of the options field while it is being typed, keyed by block.
   *
   * The field cannot be driven straight from `options`. Parsing on every
   * keystroke and rendering the joined result back means the comma you just
   * typed is stripped before it reaches the screen — filter(Boolean) drops the
   * empty segment after it — so a second option is impossible to type. The raw
   * string is held here and parsed on blur.
   */
  const [optionsDraft, setOptionsDraft] = useState<Record<string, string>>({})

  const setSections = (sections: Section[]) => setDraft({ ...draft, sections })
  const patchSection = (si: number, patch: Partial<Section>) =>
    setSections(draft.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)))
  const patchBlock = (si: number, bi: number, patch: Partial<Block>) =>
    patchSection(si, {
      blocks: draft.sections[si].blocks.map((b, i) => (i === bi ? { ...b, ...patch } : b)),
    })

  const addBlock = (si: number, type: BlockType = 'long_text') =>
    // no id: the server derives one from the label on save, which is what keeps
    // ids stable for questions that already exist
    patchSection(si, { blocks: [...draft.sections[si].blocks, { id: '', type, label: '' }] })

  const drop = (target: Drag) => {
    if (!drag || !target) return
    if (drag.kind === 'section' && target.kind === 'section') {
      setSections(moveItem(draft.sections, drag.si, target.si))
    } else if (drag.kind === 'block' && target.kind === 'block' && drag.si === target.si) {
      patchSection(drag.si, { blocks: moveItem(draft.sections[drag.si].blocks, drag.bi, target.bi) })
    }
    setDrag(null); setOver(null)
  }

  const questionCount = draft.sections.flatMap(s => s.blocks).filter(b => b.type !== 'guidance').length

  return (
    <div className="flex flex-col gap-4">
      {/* ── sticky toolbar, so Save is never a scroll away ── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div>
          <p className="text-sm font-medium">{preview ? 'Client preview' : 'Editing questions'}</p>
          <p className="text-xs text-muted-foreground">
            {preview
              ? 'Exactly what they see. Nothing saves until you press Save.'
              : `${draft.sections.length} sections · ${questionCount} questions`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPreview(!preview)}>
            {preview
              ? <><Pencil className="mr-1.5 h-3.5 w-3.5" /> Keep editing</>
              : <><Eye className="mr-1.5 h-3.5 w-3.5" /> Preview</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Discard</Button>
          <Button size="sm" onClick={() => onSave(draft)} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {preview ? <Preview definition={draft} /> : (
        <>
          {draft.sections.map((section, si) => (
            <div
              key={`s-${si}`}
              onDragOver={e => { if (drag?.kind === 'section') { e.preventDefault(); setOver(`s-${si}`) } }}
              onDragLeave={() => setOver(o => (o === `s-${si}` ? null : o))}
              onDrop={e => { e.preventDefault(); drop({ kind: 'section', si }) }}
              className={
                'group/section rounded-lg border bg-card transition-colors ' +
                (over === `s-${si}` ? 'border-primary ring-1 ring-primary' : 'border-border') +
                (drag?.kind === 'section' && drag.si === si ? ' opacity-40' : '')
              }
            >
              {/* ── section title ── */}
              <div className="flex items-center gap-1 border-b border-border px-3 py-2">
                <span
                  draggable
                  onDragStart={() => setDrag({ kind: 'section', si })}
                  onDragEnd={() => { setDrag(null); setOver(null) }}
                  title="Drag to reorder this section"
                  className="cursor-grab p-1 text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-100 active:cursor-grabbing"
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <span className="w-6 shrink-0 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
                  {si + 1}
                </span>
                <Input
                  value={section.title} placeholder="Section name"
                  onChange={e => patchSection(si, { title: e.target.value })}
                  className="h-8 flex-1 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                />
                <div className="flex opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={si === 0}
                    aria-label="Move section up"
                    onClick={() => setSections(moveItem(draft.sections, si, si - 1))}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    disabled={si === draft.sections.length - 1} aria-label="Move section down"
                    onClick={() => setSections(moveItem(draft.sections, si, si + 1))}>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                    aria-label="Delete section"
                    onClick={() => setSections(draft.sections.filter((_, i) => i !== si))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2 p-3">
                <Input
                  value={section.intro ?? ''}
                  placeholder="Optional intro: why you are asking this section"
                  onChange={e => patchSection(si, { intro: e.target.value })}
                  className="h-8 border-0 bg-muted/50 text-xs italic"
                />

                {section.blocks.map((block, bi) => (
                  <div
                    key={`b-${si}-${bi}`}
                    onDragOver={e => {
                      if (drag?.kind === 'block' && drag.si === si) {
                        e.preventDefault(); setOver(`b-${si}-${bi}`)
                      }
                    }}
                    onDragLeave={() => setOver(o => (o === `b-${si}-${bi}` ? null : o))}
                    onDrop={e => { e.preventDefault(); drop({ kind: 'block', si, bi }) }}
                    className={
                      'group/block flex items-start gap-1 rounded-md border p-2 transition-colors ' +
                      (over === `b-${si}-${bi}` ? 'border-primary ring-1 ring-primary' : 'border-transparent hover:border-border') +
                      (drag?.kind === 'block' && drag.si === si && drag.bi === bi ? ' opacity-40' : '')
                    }
                  >
                    <span
                      draggable
                      onDragStart={() => setDrag({ kind: 'block', si, bi })}
                      onDragEnd={() => { setDrag(null); setOver(null) }}
                      title="Drag to reorder this question"
                      className="cursor-grab p-1 pt-2 text-muted-foreground opacity-0 transition-opacity group-hover/block:opacity-100 active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>

                    <div className="flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={block.label}
                          placeholder={block.type === 'guidance'
                            ? 'The note they read, no answer box'
                            : 'Type the question exactly as they should read it'}
                          onChange={e => patchBlock(si, bi, { label: e.target.value })}
                          className="h-9 min-w-[14rem] flex-1 text-sm"
                        />
                        <Select value={block.type}
                          onValueChange={v => patchBlock(si, bi, { type: v as BlockType })}>
                          <SelectTrigger className="h-9 w-[160px] text-xs">
                            <SelectValue>{TYPE_LABEL(block.type)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TYPES.map(t => (
                              <SelectItem key={t.value} value={t.value} className="text-xs">
                                <span className="font-medium">{t.label}</span>
                                <span className="ml-2 text-muted-foreground">{t.hint}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {block.type !== 'guidance' && (
                        <Input
                          value={block.help ?? ''}
                          placeholder="Optional hint under the question"
                          onChange={e => patchBlock(si, bi, { help: e.target.value })}
                          className="h-8 border-dashed text-xs"
                        />
                      )}

                      {(block.type === 'select' || block.type === 'multi_select') && (() => {
                        const key = `${si}-${bi}`
                        const draft = optionsDraft[key]
                        const commit = (raw: string) => {
                          patchBlock(si, bi, {
                            options: raw.split(',').map(o => o.trim()).filter(Boolean),
                          })
                          setOptionsDraft(d => { const n = { ...d }; delete n[key]; return n })
                        }
                        return (
                          <Input
                            value={draft ?? (block.options ?? []).join(', ')}
                            placeholder="Their choices, separated by commas"
                            onChange={e => setOptionsDraft(d => ({ ...d, [key]: e.target.value }))}
                            onBlur={e => commit(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            className="h-8 text-xs"
                          />
                        )
                      })()}
                    </div>

                    <div className="flex flex-col opacity-0 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={bi === 0}
                        aria-label="Move question up"
                        onClick={() => patchSection(si, { blocks: moveItem(section.blocks, bi, bi - 1) })}>
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        disabled={bi === section.blocks.length - 1} aria-label="Move question down"
                        onClick={() => patchSection(si, { blocks: moveItem(section.blocks, bi, bi + 1) })}>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                        aria-label="Delete question"
                        onClick={() => patchSection(si, { blocks: section.blocks.filter((_, i) => i !== bi) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2 pl-8">
                  <Button size="sm" variant="secondary" className="h-7 text-xs"
                    onClick={() => addBlock(si, 'long_text')}>
                    <Plus className="mr-1 h-3 w-3" /> Question
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => addBlock(si, 'select')}>
                    <Plus className="mr-1 h-3 w-3" /> Choice
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => addBlock(si, 'guidance')}>
                    <Plus className="mr-1 h-3 w-3" /> Note
                  </Button>
                </div>
              </div>
            </div>
          ))}

          <Button size="sm" variant="secondary" className="self-start"
            onClick={() => setSections([...draft.sections, { id: '', title: '', blocks: [] }])}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a section
          </Button>
        </>
      )}
    </div>
  )
}

/** The draft rendered with the client's own components, so what you approve is
 *  what they get rather than an approximation of it. Inert: nothing saves. */
function Preview({ definition }: { definition: TemplateDefinition }) {
  return (
    <div className={`${archivo.variable} ${sometype.variable} overflow-hidden rounded-lg border border-border`}>
      <div className="bg-ink px-6 py-10 sm:px-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-14">
          {/* div, not section: globals.css gives a bare <section> 100px padding
              and a dark border for the marketing site (CLAUDE.md trap 2) */}
          {definition.sections.map((section, i) => (
            <div key={`p-${i}`} className="flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <span className="font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                  {String(i + 1).padStart(2, '0')} / {String(definition.sections.length).padStart(2, '0')}
                </span>
                <h2 className="font-lamah text-[28px] font-medium tracking-[-0.03em] text-cream">
                  {section.title || `Section ${i + 1}`}
                </h2>
                {section.intro && (
                  <p className="max-w-[58ch] font-lamah text-[15px] leading-relaxed text-cream-dim">
                    {section.intro}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-9">
                {section.blocks.map((block, bi) => {
                  const b: Block = {
                    ...block,
                    id: block.id || `preview_${i}_${bi}`,
                    label: block.label || 'Untitled question',
                  }
                  if (b.type === 'guidance') return <GuidanceBlock key={bi} block={b} />
                  if (b.type === 'file') {
                    return <FileBlock key={bi} block={b} files={[]} uploading={false} disabled onUpload={() => {}} />
                  }
                  if (b.type === 'select') return <SelectBlock key={bi} block={b} value="" onChange={() => {}} />
                  if (b.type === 'multi_select' || b.type === 'checkbox') {
                    return <MultiSelectBlock key={bi} block={b} value={[]} onChange={() => {}} />
                  }
                  return <TextBlock key={bi} block={b} long={b.type === 'long_text'} value="" onChange={() => {}} />
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
