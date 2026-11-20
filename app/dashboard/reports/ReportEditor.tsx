'use client'

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Content, type Editor } from '@tiptap/react'
import { BarChart3, Bold, Check, ChevronDown, ChevronsDownUp, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, Palette, Redo2, Table2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { reportHtml, type ReportData } from '../../lib/client-report-core'
import { docToMarkdown, type DocNode } from '../../lib/report-markdown'
import { readDoc } from '../../lib/report-doc'
import { reportEditorExtensions } from '../../lib/report-editor-schema'
import { REPORT_BLUE } from '../../lib/report-look'
import { allFigures, carriesFigures, figureHtml, figureKey, figureName, figureNode, figuresIn, hoistFigures, type Figure } from '../../lib/report-figures'
import { EditorFigure, type FigureContext } from './ReportFigureBlock'
import type { FigureReport } from './SheetFigure'

/**
 * THE REPORT, EDITED AS A PAGE (the owner, 19 Nov 2026: "use tiptap … editing, creating tables, a toolbar like Google
 * Docs … very quick response to keystrokes and no lagging"; then "why can't I minimise things, add images, resize
 * tables, colours"). What you see is the report as the client reads it. The toolbar gives headings, bold, italics,
 * colour, a highlight, links, lists, pictures, tables and sections that fold; a table's columns and a picture are
 * dragged to size.
 *
 * WHY IT DOES NOT LAG. Typing never touches React: the editor keeps its own document, the page is not re-drawn on a
 * keystroke (`shouldRerenderOnTransaction: false`), and the toolbar re-draws only when one of its own lights changes
 * (`useEditorState`). The report is handed back once, when Save is pressed — never while typing.
 */
export type ReportEditorHandle = {
  /** the report as its Markdown (what the writer reads next month, and the fallback) */
  markdown: () => string
  /** the report as the editor's own document, JSON as text (what the page draws) */
  doc: () => string
}

type Lights = {
  bold: boolean; italic: boolean; bullet: boolean; ordered: boolean; link: boolean; table: boolean; highlight: boolean; fold: boolean
  colour: string | null; style: 'p' | 2 | 3 | 4; undo: boolean; redo: boolean; canMerge: boolean; canSplit: boolean
}
const STYLES: { key: Lights['style']; label: string }[] = [
  { key: 'p', label: 'Normal text' }, { key: 2, label: 'Heading' }, { key: 3, label: 'Sub-heading' }, { key: 4, label: 'Small heading' },
]
const COLOURS: { name: string; value: string | null }[] = [
  { name: 'Black (normal)', value: null }, { name: 'Blue', value: REPORT_BLUE }, { name: 'Green', value: '#1B8A5A' },
  { name: 'Red', value: '#D92D20' }, { name: 'Orange', value: '#E8590C' }, { name: 'Grey', value: '#6B7280' },
]
const HIGHLIGHT = '#FFF1A8'

/** a picture no wider than a report needs, and small enough to send: a phone photo is many times both */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const png = file.type === 'image/png'
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.86))
  if (!blob) return file
  // a PNG that is still heavy (a screenshot of a photo) goes as a JPEG
  if (blob.size > 3_500_000) {
    const jpeg = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8))
    if (jpeg) return new File([jpeg], 'picture.jpg', { type: 'image/jpeg' })
  }
  return new File([blob], png ? 'picture.png' : 'picture.jpg', { type: blob.type })
}

export default function ReportEditor({ initial, initialDoc = null, handle, onDirty, uploadImage, data = null, report = null }: {
  /** the month's figures: what the report's figure blocks are drawn from */
  data?: ReportData | null
  /** the saved report's objective and post breakdowns, for the figures that show them */
  report?: FigureReport
  /** the saved report text */
  initial: string
  /** the saved report as the editor's document, when it has been edited as one */
  initialDoc?: string | null
  /** how Save reads the page back */
  handle: MutableRefObject<ReportEditorHandle | null>
  onDirty: (dirty: boolean) => void
  /** keeps a picture and answers with its address */
  uploadImage: (file: File) => Promise<string>
}) {
  // the figure blocks read the figures as they are now, each time they draw
  const context = useRef<FigureContext>({ data, report })
  context.current = { data, report }
  const extensions = useMemo(() => reportEditorExtensions(EditorFigure.configure({ context: () => context.current })), [])
  /** every figure this report can show, in the usual order */
  const figures = useMemo(() => (data ? allFigures(data, report) : []), [data, report])
  // THE REPORT OPENS WITH ITS FIGURES IN IT (20 Nov 2026). A report that already carries them opens as it was saved; any
  // other (still Markdown, or edited before figures were blocks) opens with every figure on top in the usual order —
  // exactly what its PDF shows today — ready to be moved or removed.
  const start = useMemo<Content>(() => {
    const saved = readDoc(initialDoc)
    if (saved && carriesFigures(saved)) return saved as Content
    if (saved) return { ...saved, content: [...figures.map(figureNode), ...(saved.content ?? [])] } as Content
    return figures.map(figureHtml).join('') + reportHtml(initial)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // a report opened with no figures read is saved as it came: its figures are not decided here
  const carries = !!data || carriesFigures(readDoc(initialDoc))
  const dirty = useRef(false)
  const tellDirty = useRef(onDirty)
  tellDirty.current = onDirty
  const upload = useRef(uploadImage)
  upload.current = uploadImage
  const live = useRef<Editor | null>(null)

  /** PICTURES IN: from the button, a paste or a drop — shrunk, kept, then put where the cursor is */
  const addPictures = async (files: File[]) => {
    const pictures = files.filter(f => /^image\/(png|jpeg|webp)$/.test(f.type))
    if (!pictures.length) { toast.error('Use a PNG, JPEG or WebP picture'); return }
    for (const file of pictures) {
      const wait = toast.loading('Adding the picture…')
      try {
        const small = await shrink(file)
        const src = await upload.current(small)
        const { width } = await createImageBitmap(small)
        live.current?.chain().focus().setImage({ src, alt: '', width: Math.min(width, 520) }).run()
        toast.success('Picture added. Drag a corner to resize it.', { id: wait })
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add the picture', { id: wait }) }
    }
  }
  const pictures = useRef(addPictures)
  pictures.current = addPictures

  const editor = useEditor({
    extensions,
    content: start,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'report-prose report-editor-area', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'The report' },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault(); void pictures.current(files); return true
      },
      handleDrop: (_view, event) => {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault(); void pictures.current(files); return true
      },
    },
    onUpdate: () => { if (!dirty.current) { dirty.current = true; tellDirty.current(true) } },
  })
  live.current = editor
  useEffect(() => {
    handle.current = editor ? { markdown: () => docToMarkdown(editor.getJSON() as DocNode), doc: () => JSON.stringify({ ...hoistFigures(editor.getJSON() as DocNode), ...(carries ? { figures: true } : {}) }) } : null
    return () => { handle.current = null }
  }, [editor, handle, carries])

  return (
    <div className="rounded-inner border border-border bg-background">
      <style>{EDITOR_CSS}</style>
      {editor ? <Toolbar editor={editor} onPictures={f => void addPictures(f)} figures={figures} /> : <div className="h-[53px] border-b border-border" />}
      {editor ? <EditorContent editor={editor} /> : <div className="report-prose report-editor-area" dangerouslySetInnerHTML={{ __html: typeof start === 'string' ? start : '' }} />}
    </div>
  )
}

function Toolbar({ editor, onPictures, figures }: { editor: Editor; onPictures: (files: File[]) => void; figures: Figure[] }) {
  // which figures are in the report now, read when the menu opens (never on a keystroke)
  const [inReport, setInReport] = useState<Set<string>>(new Set())
  /** a figure goes in straight after the block the cursor is in, as a piece of its own */
  const addFigures = (list: Figure[]) => {
    if (!list.length) return
    const { $from, to } = editor.state.selection
    const at = $from.depth >= 1 ? $from.after(1) : to
    editor.chain().focus().insertContentAt(at, list.map(figureNode)).run()
  }
  const on = useEditorState({
    editor,
    selector: ({ editor: e }): Lights => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'),
      link: e.isActive('link'), table: e.isActive('table'), highlight: e.isActive('highlight'), fold: e.isActive('details'),
      colour: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      style: e.isActive('heading', { level: 2 }) ? 2 : e.isActive('heading', { level: 3 }) ? 3 : e.isActive('heading', { level: 4 }) ? 4 : 'p',
      undo: e.can().undo(), redo: e.can().redo(), canMerge: e.can().mergeCells(), canSplit: e.can().splitCell(),
    }),
  })
  const [linking, setLinking] = useState(false)
  const [href, setHref] = useState('')
  const file = useRef<HTMLInputElement | null>(null)
  const run = () => editor.chain().focus()
  // THE CURSOR NEVER LEAVES THE PAGE FOR LONG: a menu's choice puts it straight back (the menus are not modal, so
  // nothing holds it), and a menu closed without a choice hands it back too — the very next key lands in the report
  const backToPage = (e: Event) => { e.preventDefault(); editor.commands.focus() }

  const openLink = () => {
    setHref(String(editor.getAttributes('link').href ?? ''))
    setLinking(true)
  }
  const applyLink = () => {
    const raw = href.trim()
    const url = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw
    if (!url) run().extendMarkRange('link').unsetLink().run()
    else if (editor.state.selection.empty && !editor.isActive('link')) run().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    else run().extendMarkRange('link').setLink({ href: url }).run()
    setLinking(false)
  }

  return (
    <div className="sticky top-[72px] z-10 rounded-t-inner border-b border-border bg-surface">
      <div className="flex flex-wrap items-center gap-1 p-2" role="toolbar" aria-label="Format the report">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="inline-flex h-9 min-w-[150px] items-center justify-between gap-2 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-muted" aria-label="Text style">
              {STYLES.find(s => s.key === on.style)?.label} <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-popover" onCloseAutoFocus={backToPage}>
            {STYLES.map(s => (
              <DropdownMenuItem key={s.label} onSelect={() => { if (s.key === 'p') run().setParagraph().run(); else run().setHeading({ level: s.key }).run() }}
                className={s.key === 'p' ? '' : s.key === 2 ? 'text-[17px] font-semibold' : s.key === 3 ? 'text-[15px] font-semibold' : 'font-semibold'}>
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Sep />
        <Tool label="Bold (Ctrl+B)" lit={on.bold} onClick={() => run().toggleBold().run()}><Bold className="h-4 w-4" aria-hidden /></Tool>
        <Tool label="Italic (Ctrl+I)" lit={on.italic} onClick={() => run().toggleItalic().run()}><Italic className="h-4 w-4" aria-hidden /></Tool>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" title="Text colour" aria-label="Text colour" className="inline-flex h-9 items-center gap-1 rounded-full px-2 hover:bg-muted">
              <Palette className="h-4 w-4" aria-hidden />
              <span className="h-1 w-4 rounded-full" style={{ background: on.colour ?? 'currentColor' }} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-popover" onCloseAutoFocus={backToPage}>
            {COLOURS.map(c => (
              <DropdownMenuItem key={c.name} onSelect={() => { if (c.value) run().setColor(c.value).run(); else run().unsetColor().run() }}>
                <span className="mr-2 inline-block h-4 w-4 rounded-full border border-border" style={{ background: c.value ?? 'currentColor' }} aria-hidden /> {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tool label="Highlight" lit={on.highlight} onClick={() => run().toggleHighlight({ color: HIGHLIGHT }).run()}><Highlighter className="h-4 w-4" aria-hidden /></Tool>
        <Tool label="Link" lit={on.link || linking} onClick={() => (linking ? setLinking(false) : openLink())}><Link2 className="h-4 w-4" aria-hidden /></Tool>
        <Sep />
        <Tool label="Bullet list" lit={on.bullet} onClick={() => run().toggleBulletList().run()}><List className="h-4 w-4" aria-hidden /></Tool>
        <Tool label="Numbered list" lit={on.ordered} onClick={() => run().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" aria-hidden /></Tool>
        <Sep />
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => file.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-muted">
          <ImagePlus className="h-4 w-4" aria-hidden /> Picture
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
          onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onPictures(f) }} />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-muted ${on.table ? 'bg-muted' : ''}`}>
              <Table2 className="h-4 w-4" aria-hidden /> Table <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-popover" onCloseAutoFocus={backToPage}>
            <DropdownMenuItem disabled={on.table} onSelect={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Add a table</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().addRowBefore().run()}>Add a row above</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().addRowAfter().run()}>Add a row below</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().addColumnBefore().run()}>Add a column to the left</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().addColumnAfter().run()}>Add a column to the right</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!on.canMerge} onSelect={() => run().mergeCells().run()}>Merge the selected cells</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.canSplit} onSelect={() => run().splitCell().run()}>Split this cell</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().deleteRow().run()}>Delete this row</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().deleteColumn().run()}>Delete this column</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().deleteTable().run()} className="text-destructive">Delete the table</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* THE REPORT'S OWN FIGURES (20 Nov 2026): put one back, or see which are in — a tick marks those already there */}
        {figures.length > 0 && (
          <DropdownMenu modal={false} onOpenChange={open => { if (open) setInReport(new Set(figuresIn(editor.getJSON() as DocNode).map(figureKey))) }}>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-muted">
                <BarChart3 className="h-4 w-4" aria-hidden /> Add figures <ChevronDown className="h-4 w-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto bg-popover" onCloseAutoFocus={backToPage}>
              {figures.map(f => {
                const there = inReport.has(figureKey(f))
                return (
                  <DropdownMenuItem key={figureKey(f)} disabled={there} onSelect={() => addFigures([f])}>
                    <span className="mr-2 inline-flex h-4 w-4 items-center justify-center">{there && <Check className="h-4 w-4" aria-hidden />}</span>
                    {figureName(f)}{there ? ' (in the report)' : ''}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={figures.every(f => inReport.has(figureKey(f)))} onSelect={() => addFigures(figures.filter(f => !inReport.has(figureKey(f))))}>
                Add every figure that is missing
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button type="button" onMouseDown={e => e.preventDefault()} aria-pressed={on.fold}
          onClick={() => (on.fold ? run().unsetDetails().run() : foldSection(editor))}
          title={on.fold ? 'Stop this section folding' : 'Fold this section: its heading stays, the rest tucks under it'}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-muted ${on.fold ? 'bg-muted' : ''}`}>
          <ChevronsDownUp className="h-4 w-4" aria-hidden /> Fold
        </button>
        <Sep />
        <Tool label="Undo (Ctrl+Z)" disabled={!on.undo} onClick={() => run().undo().run()}><Undo2 className="h-4 w-4" aria-hidden /></Tool>
        <Tool label="Redo (Ctrl+Y)" disabled={!on.redo} onClick={() => run().redo().run()}><Redo2 className="h-4 w-4" aria-hidden /></Tool>
      </div>
      {linking && (
        <form className="flex flex-wrap items-center gap-2 border-t border-border p-2" onSubmit={e => { e.preventDefault(); applyLink() }}>
          <input autoFocus value={href} onChange={e => setHref(e.target.value)} placeholder="Paste the web address, e.g. https://instagram.com/p/…"
            onKeyDown={e => { if (e.key === 'Escape') { setLinking(false); editor.commands.focus() } }}
            className="h-9 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-[13px] outline-none focus:border-foreground" aria-label="Web address" />
          <button type="submit" className="h-9 rounded-full bg-foreground px-4 text-[13px] font-medium text-background">{href.trim() ? 'Add link' : 'Remove link'}</button>
          <button type="button" onClick={() => { setLinking(false); editor.commands.focus() }} className="h-9 rounded-full px-3 text-[13px] hover:bg-muted">Cancel</button>
        </form>
      )}
    </div>
  )
}

/**
 * FOLD THIS SECTION (the owner, 19 Nov 2026: "why can't I minimise things"). With the cursor anywhere in a section, the
 * section's heading becomes the fold's title and everything under it, up to the next heading of the same size, goes
 * inside. Words that are selected, or a place with no heading above it, fold just what is there. A new fold starts
 * open, so nothing seems to vanish.
 */
function foldSection(editor: Editor) {
  const plain = () => editor.chain().focus().setDetails().updateAttributes('details', { open: true }).run()
  const { state } = editor
  const { $from, empty } = state.selection
  const { doc, schema } = state
  if (!empty || $from.depth < 1) return plain()
  let h = -1
  for (let i = $from.index(0); i >= 0; i--) if (doc.child(i).type.name === 'heading') { h = i; break }
  if (h < 0) return plain()
  const level = Number(doc.child(h).attrs.level)
  let end = h + 1
  while (end < doc.childCount && !(doc.child(end).type.name === 'heading' && Number(doc.child(end).attrs.level) <= level)) end++
  if (end === h + 1) return plain()
  let from = 0
  for (let i = 0; i < h; i++) from += doc.child(i).nodeSize
  let to = from
  const inside = []
  for (let i = h; i < end; i++) { to += doc.child(i).nodeSize; if (i > h) inside.push(doc.child(i)) }
  try {
    const fold = schema.nodes.details.create({ open: true }, [
      schema.nodes.detailsSummary.create(null, doc.child(h).content),
      schema.nodes.detailsContent.create(null, inside),
    ])
    editor.view.dispatch(state.tr.replaceWith(from, to, fold).scrollIntoView())
    editor.commands.focus(from + 2)
    return true
  } catch { return plain() }
}

const Sep = () => <span className="mx-1 h-5 w-px bg-border" aria-hidden />

/** a toolbar button: pressing it never takes the cursor out of the page */
function Tool({ label, lit, disabled, onClick, children }: { label: string; lit?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={lit} disabled={disabled}
      onMouseDown={e => e.preventDefault()} onClick={onClick}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition disabled:opacity-35 ${lit ? 'bg-foreground text-background' : 'hover:bg-muted'}`}>
      {children}
    </button>
  )
}

const EDITOR_CSS = `
.report-editor-area{outline:none;min-height:420px;padding:24px}
.report-editor-area .tableWrapper{overflow-x:auto;margin:8px 0 14px}
.report-editor-area table{margin:0;table-layout:fixed}
.report-editor-area th,.report-editor-area td{position:relative;min-width:60px;vertical-align:top}
.report-editor-area li p{margin:0}
.report-editor-area .selectedCell::after{content:"";position:absolute;inset:0;background:rgba(30,129,253,.16);pointer-events:none}
/* a column's edge, while it is being dragged */
.report-editor-area .column-resize-handle{position:absolute;right:-2px;top:0;bottom:-1px;width:4px;background:${REPORT_BLUE};pointer-events:none;z-index:2}
.report-editor-area.resize-cursor{cursor:col-resize}
/* a picture: a blue edge when picked, a square on each corner to drag */
.report-editor-area [data-resize-container]{margin:10px 0}
.report-editor-area [data-resize-wrapper] img{display:block;max-width:100%;height:auto;margin:0}
.report-editor-area [data-resize-handle]{width:12px;height:12px;background:#fff;border:2px solid ${REPORT_BLUE};border-radius:3px;opacity:0;z-index:2}
.report-editor-area [data-resize-container]:hover [data-resize-handle],.report-editor-area .ProseMirror-selectednode [data-resize-handle],.report-editor-area [data-resize-state="true"] [data-resize-handle]{opacity:1}
.report-editor-area [data-resize-handle="top-left"],.report-editor-area [data-resize-handle="bottom-right"]{cursor:nwse-resize}
.report-editor-area [data-resize-handle="top-right"],.report-editor-area [data-resize-handle="bottom-left"]{cursor:nesw-resize}
.report-editor-area .ProseMirror-selectednode img{outline:2px solid ${REPORT_BLUE};outline-offset:2px}
/* a section that folds: the arrow opens and shuts it */
.report-editor-area .report-fold{display:flex;gap:6px;margin:10px 0;padding:8px 10px;border:1px solid hsl(var(--border));border-radius:10px}
.report-editor-area .report-fold > button{flex:none;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px}
.report-editor-area .report-fold > button:hover{background:hsl(var(--muted))}
.report-editor-area .report-fold > button::before{content:"\\25B6"}
.report-editor-area .report-fold.is-open > button::before{content:"\\25BC"}
.report-editor-area .report-fold > div{flex:1;min-width:0}
.report-editor-area .report-fold summary{font-size:17px;font-weight:700;list-style:none;cursor:text}
.report-editor-area .report-fold summary::-webkit-details-marker{display:none}
.report-editor-area .report-fold [data-type="detailsContent"]{margin-top:6px}
.report-editor-area .report-fold [data-type="detailsContent"] > :last-child{margin-bottom:0}
/* A FIGURE BLOCK: the figure as it prints, on white, under a bar that says what it is and holds its three buttons */
.report-editor-area .report-figure-block{margin:12px 0;border:1px solid hsl(var(--border));border-radius:12px;overflow:hidden;background:#fff}
.report-editor-area .report-figure-block.is-picked,.report-editor-area .report-figure-block.ProseMirror-selectednode{border-color:${REPORT_BLUE};box-shadow:0 0 0 2px rgba(30,129,253,.25)}
.report-editor-area .report-figure-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;background:hsl(var(--muted));border-bottom:1px solid hsl(var(--border));font-size:12px;user-select:none}
.report-editor-area .report-figure-grip{display:inline-flex;align-items:center;justify-content:center;width:28px;height:32px;border-radius:8px;cursor:grab;color:hsl(var(--muted-foreground))}
.report-editor-area .report-figure-grip:hover{background:hsl(var(--background))}
.report-editor-area .report-figure-name{flex:1;min-width:120px;font-weight:600;font-size:13px}
.report-editor-area .report-figure-bar button{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 11px;border-radius:999px;border:1px solid hsl(var(--border));background:hsl(var(--background));font-size:12px;font-weight:500}
.report-editor-area .report-figure-bar button:hover{border-color:hsl(var(--foreground))}
.report-editor-area .report-figure-bar button.is-remove:hover{border-color:#D92D20;color:#D92D20}
.report-editor-area .report-figure-body{padding:14px 16px 8px}
.report-editor-area .report-figure-body .pr-block.pr-fig{margin:0}
.report-editor-area .report-figure-body h2,.report-editor-area .report-figure-body h3{margin-top:0}
.report-editor-area .report-figure-body .pr-chart{max-width:680px}
.report-editor-area .report-figure-empty{font-size:13px;color:#666;margin:0 0 6px}
/* a tile's own x: leave just that number out */
.report-editor-area .pr-tile{position:relative}
.report-editor-area .pr-tile-x{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #c9d1de;color:#555;opacity:.55}
.report-editor-area .pr-tile:hover .pr-tile-x,.report-editor-area .pr-tile-x:focus-visible{opacity:1}
.report-editor-area .pr-tile-x:hover{border-color:#D92D20;color:#D92D20}
@media (max-width:640px){.report-editor-area{padding:14px}.report-editor-area .report-figure-name{flex-basis:100%}.report-editor-area .report-figure-grip{display:none}}
`
