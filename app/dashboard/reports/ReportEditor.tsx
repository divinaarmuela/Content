'use client'

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { Bold, ChevronDown, Italic, Link2, List, ListOrdered, Redo2, Table2, Undo2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { reportHtml } from '../../lib/client-report-core'
import { docToMarkdown, type DocNode } from '../../lib/report-markdown'
import { reportEditorExtensions } from '../../lib/report-editor-schema'

/**
 * THE REPORT, EDITED AS A PAGE (the owner, 19 Nov 2026: "use tiptap … editing, creating tables, a toolbar like Google
 * Docs … very quick response to keystrokes and no lagging"). What you see is the report as the client reads it; the
 * toolbar gives headings, bold, italics, lists, links and tables.
 *
 * WHY IT DOES NOT LAG. Typing never touches React: the editor keeps its own document, the page is not re-drawn on a
 * keystroke (`shouldRerenderOnTransaction: false`), and the toolbar re-draws only when one of its own lights changes
 * (`useEditorState`). The report is turned back into its saved text once, when Save is pressed — never while typing.
 */
export type ReportEditorHandle = { markdown: () => string }

type Lights = {
  bold: boolean; italic: boolean; bullet: boolean; ordered: boolean; link: boolean; table: boolean
  style: 'p' | 2 | 3 | 4; undo: boolean; redo: boolean
}
const STYLES: { key: Lights['style']; label: string }[] = [
  { key: 'p', label: 'Normal text' }, { key: 2, label: 'Heading' }, { key: 3, label: 'Sub-heading' }, { key: 4, label: 'Small heading' },
]

export default function ReportEditor({ initial, handle, onDirty }: {
  /** the saved report text */
  initial: string
  /** how Save reads the page back as text */
  handle: MutableRefObject<ReportEditorHandle | null>
  onDirty: (dirty: boolean) => void
}) {
  const extensions = useMemo(() => reportEditorExtensions(), [])
  const start = useMemo(() => reportHtml(initial), []) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = useRef(false)
  const tellDirty = useRef(onDirty)
  tellDirty.current = onDirty
  const editor = useEditor({
    extensions,
    content: start,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'report-prose report-editor-area', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'The report' } },
    onUpdate: () => { if (!dirty.current) { dirty.current = true; tellDirty.current(true) } },
  })
  useEffect(() => {
    handle.current = editor ? { markdown: () => docToMarkdown(editor.getJSON() as DocNode) } : null
    return () => { handle.current = null }
  }, [editor, handle])

  return (
    <div className="rounded-inner border border-border bg-background">
      <style>{EDITOR_CSS}</style>
      {editor ? <Toolbar editor={editor} /> : <div className="h-[53px] border-b border-border" />}
      {editor ? <EditorContent editor={editor} /> : <div className="report-prose report-editor-area" dangerouslySetInnerHTML={{ __html: start }} />}
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }): Lights => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'),
      link: e.isActive('link'), table: e.isActive('table'),
      style: e.isActive('heading', { level: 2 }) ? 2 : e.isActive('heading', { level: 3 }) ? 3 : e.isActive('heading', { level: 4 }) ? 4 : 'p',
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  })
  const [linking, setLinking] = useState(false)
  const [href, setHref] = useState('')
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
        <Tool label="Link" lit={on.link || linking} onClick={() => (linking ? setLinking(false) : openLink())}><Link2 className="h-4 w-4" aria-hidden /></Tool>
        <Sep />
        <Tool label="Bullet list" lit={on.bullet} onClick={() => run().toggleBulletList().run()}><List className="h-4 w-4" aria-hidden /></Tool>
        <Tool label="Numbered list" lit={on.ordered} onClick={() => run().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" aria-hidden /></Tool>
        <Sep />
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
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().deleteRow().run()}>Delete this row</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().deleteColumn().run()}>Delete this column</DropdownMenuItem>
            <DropdownMenuItem disabled={!on.table} onSelect={() => run().deleteTable().run()} className="text-destructive">Delete the table</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
.report-editor-area th,.report-editor-area td{position:relative;min-width:72px;vertical-align:top}
.report-editor-area th{background:hsl(var(--muted));font-weight:600}
.report-editor-area td p,.report-editor-area th p,.report-editor-area li p{margin:0}
.report-editor-area .selectedCell::after{content:"";position:absolute;inset:0;background:rgba(47,111,237,.14);pointer-events:none}
@media (max-width:640px){.report-editor-area{padding:14px}}
`
