'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  BLOCK_TYPES, moveItem,
  type Block, type BlockType, type Section, type TemplateDefinition,
} from '@/app/lib/intake-core'

/**
 * Edit one form's questions.
 *
 * Every real form we have sent was tailored to the client — the Turnkey form
 * names its founders and asks about a discrepancy someone spotted on their
 * website. So a template is a starting point, not the deliverable, and this is
 * where the tailoring happens.
 *
 * Editing is only offered before the client has started; the server enforces
 * that with a status guard, and refusing here as well would just hide the
 * reason.
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

export default function IntakeEditor({
  definition, onSave, onCancel, saving,
}: {
  definition: TemplateDefinition
  onSave: (next: TemplateDefinition) => void
  onCancel: () => void
  saving: boolean
}) {
  const [draft, setDraft] = useState<TemplateDefinition>(definition)
  const [open, setOpen] = useState<string | null>(draft.sections[0]?.id ?? null)

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
    const section: Section = { id: '', title: '', blocks: [] }
    setSections([...draft.sections, section])
    setOpen(null)
  }

  const questionCount = draft.sections
    .flatMap(s => s.blocks).filter(b => b.type !== 'guidance').length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <div>
          <p className="text-sm font-medium">Editing questions</p>
          <p className="text-xs text-muted-foreground">
            {draft.sections.length} section{draft.sections.length === 1 ? '' : 's'} ·{' '}
            {questionCount} question{questionCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(draft)} disabled={saving}>
            {saving ? 'Saving…' : 'Save questions'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {draft.sections.map((section, si) => {
          const isOpen = open === (section.id || `new-${si}`)
          const key = section.id || `new-${si}`
          return (
            <div key={key} className="rounded-lg border border-border bg-card">
              {/* ── section header ── */}
              <div className="flex items-center gap-2 border-b border-border p-3">
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  value={section.title}
                  placeholder={`Section ${si + 1} title`}
                  onChange={e => patchSection(si, { title: e.target.value })}
                  className="h-8 flex-1 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                />
                <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                  {section.blocks.length} block{section.blocks.length === 1 ? '' : 's'}
                </span>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={si === 0}
                  onClick={() => setSections(moveItem(draft.sections, si, si - 1))}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  disabled={si === draft.sections.length - 1}
                  onClick={() => setSections(moveItem(draft.sections, si, si + 1))}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                  onClick={() => setSections(draft.sections.filter((_, i) => i !== si))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7"
                  onClick={() => setOpen(isOpen ? null : key)}>
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

                  {section.blocks.map((block, bi) => (
                    <div key={`${key}-${bi}`} className="rounded-md border border-border p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          <Input
                            value={block.label}
                            placeholder={block.type === 'guidance' ? 'The note the client reads' : 'The question'}
                            onChange={e => patchBlock(si, bi, { label: e.target.value })}
                            className="text-sm"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Select
                              value={block.type}
                              onValueChange={v => patchBlock(si, bi, { type: v as BlockType })}
                            >
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
                            onClick={() => patchSection(si, { blocks: moveItem(section.blocks, bi, bi - 1) })}>
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            disabled={bi === section.blocks.length - 1}
                            onClick={() => patchSection(si, { blocks: moveItem(section.blocks, bi, bi + 1) })}>
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                            onClick={() => patchSection(si, { blocks: section.blocks.filter((_, i) => i !== bi) })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}

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
    </div>
  )
}
