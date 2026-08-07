'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
 * Every real form we have sent was tailored to the client — the Turnkey form
 * names its founders and asks about a discrepancy someone spotted on their
 * website. So a template is a starting point, not the deliverable, and this is
 * where the tailoring happens.
 *
 * Reordering is drag-and-drop AND arrow buttons. Not belt-and-braces: native
 * drag events are mouse-only, so arrows are the keyboard path, and a grip that
 * does not drag is worse than no grip at all.
 */

const TYPE_LABELS: Record<BlockType, string> = {
  guidance: 'Guidance note (no answer)',
  short_text: 'Short text',
  long_text: 'Long text',
  link: 'Link',
  select: 'Choose one',
  multi_select: 'Choose several',
  checkbox: 'Checklist',
  file: 'File upload',
}

const NEEDS_OPTIONS: BlockType[] = ['select', 'multi_select']

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
  const [open, setOpen] = useState<number | null>(0)
  const [drag, setDrag] = useState<Drag>(null)
  const [over, setOver] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const setSections = (sections: Section[]) => setDraft({ ...draft, sections })

  const patchSection = (si: number, patch: Partial<Section>) =>
    setSections(draft.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)))

  const patchBlock = (si: number, bi: number, patch: Partial<Block>) =>
    patchSection(si, {
      blocks: draft.sections[si].blocks.map((b, i) => (i === bi ? { ...b, ...patch } : b)),
    })

  const addBlock = (si: number) =>
    patchSection(si, {
      blocks: [
        ...draft.sections[si].blocks,
        // no id — the server derives one from the label on save, which is what
        // keeps ids stable for questions that already exist
        { id: '', type: 'long_text', label: '' } as Block,
      ],
    })

  const addSection = () => {
    setSections([...draft.sections, { id: '', title: '', blocks: [] }])
    setOpen(draft.sections.length)
  }

  /** Drop a dragged section or block onto a target slot. A block can only move
   *  within its own section — dragging one across sections would silently
   *  change which heading a client reads it under. */
  const drop = (target: Drag) => {
    if (!drag || !target) return
    if (drag.kind === 'section' && target.kind === 'section') {
      setSections(moveItem(draft.sections, drag.si, target.si))
      if (open === drag.si) setOpen(target.si)
    } else if (drag.kind === 'block' && target.kind === 'block' && drag.si === target.si) {
      patchSection(drag.si, { blocks: moveItem(draft.sections[drag.si].blocks, drag.bi, target.bi) })
    }
    setDrag(null); setOver(null)
  }

  const questionCount = draft.sections
    .flatMap(s => s.blocks).filter(b => b.type !== 'guidance').length

  return (
    <div className="flex flex-col gap-4">
      {/* ── toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <div>
          <p className="text-sm font-medium">{preview ? 'Preview' : 'Editing questions'}</p>
          <p className="text-xs text-muted-foreground">
            {preview
              ? 'Exactly what the client sees. Nothing is saved until you save.'
              : `${draft.sections.length} section${draft.sections.length === 1 ? '' : 's'} · ${questionCount} question${questionCount === 1 ? '' : 's'} · drag to reorder`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPreview(!preview)}>
            {preview
              ? <><Pencil className="mr-1.5 h-3.5 w-3.5" /> Back to editing</>
              : <><Eye className="mr-1.5 h-3.5 w-3.5" /> Preview</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(draft)} disabled={saving}>
            {saving ? 'Saving…' : 'Save questions'}
          </Button>
        </div>
      </div>

      {preview ? <Preview definition={draft} /> : (
        <>
          <div className="flex flex-col gap-3">
            {draft.sections.map((section, si) => {
              const isOpen = open === si
              const isOver = over === `s-${si}`
              return (
                <div
                  key={`s-${si}`}
                  onDragOver={e => { if (drag?.kind === 'section') { e.preventDefault(); setOver(`s-${si}`) } }}
                  onDragLeave={() => setOver(o => (o === `s-${si}` ? null : o))}
                  onDrop={e => { e.preventDefault(); drop({ kind: 'section', si }) }}
                  className={
                    'rounded-lg border bg-card transition-colors ' +
                    (isOver ? 'border-primary ring-1 ring-primary' : 'border-border') +
                    (drag?.kind === 'section' && drag.si === si ? ' opacity-40' : '')
                  }
                >
                  {/* ── section header ── */}
                  <div className="flex items-center gap-2 border-b border-border p-3">
                    <span
                      draggable
                      onDragStart={() => setDrag({ kind: 'section', si })}
                      onDragEnd={() => { setDrag(null); setOver(null) }}
                      title="Drag to reorder"
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </span>
                    <Input
                      value={section.title}
                      placeholder={`Section ${si + 1} title`}
                      onChange={e => patchSection(si, { title: e.target.value })}
                      className="h-8 flex-1 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                    />
                    <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                      {section.blocks.length}
                    </span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={si === 0}
                      aria-label="Move section up"
                      onClick={() => { setSections(moveItem(draft.sections, si, si - 1)); if (isOpen) setOpen(si - 1) }}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      disabled={si === draft.sections.length - 1} aria-label="Move section down"
                      onClick={() => { setSections(moveItem(draft.sections, si, si + 1)); if (isOpen) setOpen(si + 1) }}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      aria-label="Delete section"
                      onClick={() => { setSections(draft.sections.filter((_, i) => i !== si)); setOpen(null) }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7"
                      onClick={() => setOpen(isOpen ? null : si)}>
                      {isOpen ? 'Collapse' : 'Edit'}
                    </Button>
                  </div>

                  {isOpen && (
                    <div className="flex flex-col gap-5 p-4">
                      <div>
                        <Label className="text-xs">Intro (optional)</Label>
                        <Input
                          value={section.intro ?? ''}
                          placeholder="The italic line that tells the client why we are asking"
                          onChange={e => patchSection(si, { intro: e.target.value })}
                          className="mt-1.5"
                        />
                      </div>

                      {section.blocks.map((block, bi) => {
                        const overBlock = over === `b-${si}-${bi}`
                        return (
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
                              'rounded-md border p-3 transition-colors ' +
                              (overBlock ? 'border-primary ring-1 ring-primary' : 'border-border') +
                              (drag?.kind === 'block' && drag.si === si && drag.bi === bi ? ' opacity-40' : '')
                            }
                          >
                            <div className="flex items-start gap-2">
                              <span
                                draggable
                                onDragStart={() => setDrag({ kind: 'block', si, bi })}
                                onDragEnd={() => { setDrag(null); setOver(null) }}
                                title="Drag to reorder"
                                className="mt-2 cursor-grab active:cursor-grabbing"
                              >
                                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                              </span>

                              <div className="flex-1 space-y-2">
                                <Input
                                  value={block.label}
                                  placeholder={block.type === 'guidance' ? 'The note the client reads' : 'The question'}
                                  onChange={e => patchBlock(si, bi, { label: e.target.value })}
                                  className="text-sm"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <Select value={block.type}
                                    onValueChange={v => patchBlock(si, bi, { type: v as BlockType })}>
                                    <SelectTrigger className="h-8 w-[190px] text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {BLOCK_TYPES.map(t => (
                                        <SelectItem key={t} value={t} className="text-xs">
                                          {TYPE_LABELS[t]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {block.type !== 'guidance' && (
                                    <Input
                                      value={block.help ?? ''}
                                      placeholder="Helper text (optional)"
                                      onChange={e => patchBlock(si, bi, { help: e.target.value })}
                                      className="h-8 flex-1 text-xs"
                                    />
                                  )}
                                </div>
                                {NEEDS_OPTIONS.includes(block.type) && (
                                  <Input
                                    value={(block.options ?? []).join(', ')}
                                    placeholder="Options, separated by commas"
                                    onChange={e => patchBlock(si, bi, {
                                      options: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                                    })}
                                    className="h-8 text-xs"
                                  />
                                )}
                                {block.id && (
                                  <p className="font-mono text-[10px] text-muted-foreground">
                                    id: {block.id} · answers are keyed to this, so it never changes
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-col">
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
                          </div>
                        )
                      })}

                      <Button size="sm" variant="secondary" onClick={() => addBlock(si)}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add question
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <Button size="sm" variant="secondary" onClick={addSection} className="self-start">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add section
          </Button>
        </>
      )}
    </div>
  )
}

/** The draft rendered with the client's own components, so what you approve is
 *  what they get — not an approximation of it. Inert: nothing here saves. */
function Preview({ definition }: { definition: TemplateDefinition }) {
  return (
    <div className={`${archivo.variable} ${sometype.variable} overflow-hidden rounded-lg border border-border`}>
      <div className="bg-ink px-6 py-10 sm:px-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-12">
          {definition.sections.map((section, i) => (
            <section key={`p-${i}`} className="flex flex-col gap-8">
              <div className="flex flex-col gap-3 border-b border-cream/15 pb-5">
                <div className="flex items-baseline gap-4">
                  <span className="font-lamam text-[10px] tabular-nums tracking-widest text-cream-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h2 className="font-lamah text-[22px] font-medium tracking-[-0.02em] text-cream">
                    {section.title || `Section ${i + 1}`}
                  </h2>
                </div>
                {section.intro && (
                  <p className="max-w-[60ch] font-lamah text-[14px] leading-relaxed text-cream-dim">
                    {section.intro}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-10">
                {section.blocks.map((block, bi) => {
                  const b = { ...block, id: block.id || `preview_${i}_${bi}`, label: block.label || 'Untitled question' }
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
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
