'use client'

import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react'
import type { ReportData } from '../../lib/client-report-core'
import { ReportFigureNode } from '../../lib/report-editor-schema'
import { FIGURE_NODE, figureHasData, figureName, readFigure } from '../../lib/report-figures'
import SheetFigure, { type FigureReport } from './SheetFigure'

/**
 * A FIGURE, IN THE EDITOR (the owner, 20 Nov 2026: "this should be editable … please make it easy to use"). The block
 * is drawn exactly as it prints, under a small bar that says what it is and holds the only three things to do with it:
 * Move up, Move down, Remove. It can also be dragged by its handle. A tile has its own × to leave just that number out.
 * Nothing is typed into a figure: its numbers are the account's own.
 */

/** what the blocks draw from: the month's figures and the saved report (read at draw time, so they are never stale) */
export type FigureContext = { data: ReportData | null; report: FigureReport }

export const EditorFigure = ReportFigureNode.extend<{ context: () => FigureContext }>({
  addOptions() { return { context: () => ({ data: null, report: null }) } },
  addNodeView() { return ReactNodeViewRenderer(FigureBlock) },
  // TYPING NEVER EATS A FIGURE. A picked block is replaced by whatever is typed next (that is how an editor treats
  // anything picked) — one stray key and a chart is gone. With a figure picked, typing or Enter starts a new paragraph
  // under it instead. Only Remove, Backspace or Delete takes a figure out.
  addProseMirrorPlugins() {
    const onFigure = (sel: unknown): sel is NodeSelection => sel instanceof NodeSelection && sel.node.type.name === FIGURE_NODE
    const under = (view: Parameters<NonNullable<Plugin['props']['handleTextInput']>>[0], text: string) => {
      const sel = view.state.selection
      if (!onFigure(sel)) return false
      const para = view.state.schema.nodes.paragraph.create(null, text ? view.state.schema.text(text) : null)
      const tr = view.state.tr.insert(sel.to, para)
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.to + 1 + text.length)).scrollIntoView())
      return true
    }
    return [new Plugin({
      props: {
        handleTextInput: (view, _from, _to, text) => under(view, text),
        handleKeyDown: (view, event) => (event.key === 'Enter' ? under(view, '') : false),
      },
    })]
  },
})

function FigureBlock({ node, editor, getPos, updateAttributes, deleteNode, extension, selected }: NodeViewProps) {
  const figure = readFigure(node.attrs)
  const { data, report } = (extension.options as { context: () => FigureContext }).context()
  if (!figure) return <NodeViewWrapper />

  /** one place up or down among the report's pieces; the block stays picked and in view */
  const move = (by: -1 | 1) => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const { state, view } = editor
    const $pos = state.doc.resolve(pos)
    const i = $pos.index()
    const parent = $pos.parent
    if (by < 0 ? i === 0 : i >= parent.childCount - 1) return
    const to = by < 0 ? pos - parent.child(i - 1).nodeSize : pos + parent.child(i + 1).nodeSize
    const tr = state.tr.delete(pos, pos + node.nodeSize).insert(to, node)
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, to)).scrollIntoView())
    view.focus()
  }
  const hidden = figure.hide.length
  const drawable = !!data && figureHasData(figure, data, report)

  return (
    <NodeViewWrapper className={`report-figure-block${selected ? ' is-picked' : ''}`} data-figure={`${figure.kind}:${figure.platform}`}>
      <div className="report-figure-bar" contentEditable={false}>
        <span className="report-figure-grip" data-drag-handle title="Drag to move" aria-hidden><GripVertical className="h-4 w-4" /></span>
        <span className="report-figure-name">{figureName(figure)}</span>
        {hidden > 0 && (
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => updateAttributes({ hide: [] })}>
            Show {hidden} hidden {hidden === 1 ? 'tile' : 'tiles'}
          </button>
        )}
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => move(-1)} aria-label={`Move ${figureName(figure)} up`}><ArrowUp className="h-3.5 w-3.5" aria-hidden /> Move up</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => move(1)} aria-label={`Move ${figureName(figure)} down`}><ArrowDown className="h-3.5 w-3.5" aria-hidden /> Move down</button>
        <button type="button" className="is-remove" onMouseDown={e => e.preventDefault()} onClick={() => deleteNode()} aria-label={`Remove ${figureName(figure)} from the report`}><Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove</button>
      </div>
      <div className="report-sheet report-figure-body" contentEditable={false}>
        {drawable
          ? <div className={`pr-block pr-fig pr-fig-${figure.kind}`}><SheetFigure figure={figure} data={data!} report={report} onHideTile={figure.kind === 'tiles' ? label => updateAttributes({ hide: [...figure.hide, label] }) : undefined} /></div>
          : <p className="report-figure-empty">There are no numbers for this figure this month, so it is left out of the report.</p>}
      </div>
    </NodeViewWrapper>
  )
}
