'use client'

import React from 'react'
import { Check, ExternalLink, FileText, LayoutGrid, Paperclip } from 'lucide-react'
import { type CanvasCard as Card, fontOf } from '../../../../lib/batch-brief-core'
import { FONT_CLASS, fontVars } from './canvasFont'
import { isGlyphIcon } from '../../../../lib/board-icons-core'
import { isBoardIcon } from '../../../../lib/board-canvas-core'
import { ICON } from '../../../boards/canvasTone'
import { htmlText, sanitiseCanvasHtml, wordCount } from '../../../../lib/canvas-rich-core'

/**
 * MILANOTE'S CARDS, DRAWN AS MILANOTE DRAWS THEM (the owner, 20 Oct 2026, for Renée: "exactly the same" —
 * docs/MILANOTE_MERGE.md, from screenshots of the MGMT shoot brief, the Duru board, Cutter & Co's swatches,
 * Cecconi's task lists and Jason Swift's Content Guide).
 *
 * White cards with a soft shadow; serif titles on columns and documents; a column a white panel with a centred
 * serif title and a grey count, its cards stacked inside; rich text with orange links; a swatch a colour block with
 * its hex in the corner and its name under it; a table with a grey header row; a document a tile with its word
 * count. Presentation only: the canvas positions every card and owns the pointer.
 */

/** Milanote's serif — its titles read as a book's, not an app's */
export const MN_SERIF = 'Georgia, "Times New Roman", serif'

/** the kinds drawn here, and the notes and task lists that came from Milanote with rich text or a title */
export function drawnAsMilanote(card: Card): boolean {
  return ['column', 'document', 'table', 'swatch', 'file', 'boardlink'].includes(card.kind)
    || (card.kind === 'note' && !!card.html)
    || (card.kind === 'todo' && !!card.mn)
    || (card.kind === 'board' && !!card.mn)
}

const CARD = 'rounded-[3px] bg-white text-[#2b2b2b] shadow-[0_1px_3px_rgba(0,0,0,0.14)] dark:bg-[#2a2a2a] dark:text-[#ececec]'
/** rich text, Milanote's way: paragraphs spaced, lists indented, links orange */
const RICH = [
  'text-[14px] leading-[1.5] break-words',
  '[&_p]:mb-[0.5em] [&_p:last-child]:mb-0',
  '[&_h1]:mb-2 [&_h1]:text-[22px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:text-[15px] [&_h3]:font-semibold',
  '[&_ul]:mb-[0.5em] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-[0.5em] [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5 [&_li_p]:mb-0',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-[#d0d0d0] [&_blockquote]:pl-3 [&_blockquote]:italic',
  '[&_a]:text-[#f0632b] [&_a]:underline [&_mark]:rounded-sm [&_mark]:px-0.5',
].join(' ')

const box = (card: Card): React.CSSProperties => ({ width: card.w, ...(card.h ? { height: card.h } : {}) })

/** readable words on a colour: dark on light, white on dark */
function inkOn(hex: string): string {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#2b2b2b' : '#ffffff'
}

/** A rich text editor in place: Ctrl/Cmd+B, I and U as anywhere; what is kept is canvas-rich-core's allowlist. */
function RichEditable({ html, onSave, className, style }: {
  html: string; onSave: (html: string) => void; className?: string; style?: React.CSSProperties
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html
    el.focus({ preventScroll: true })
    // caret to the end, where a person carries on writing
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [html])
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline
      className={`outline-none ${className ?? ''}`}
      style={style}
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); (e.currentTarget as HTMLDivElement).blur() } }}
      onBlur={e => onSave(sanitiseCanvasHtml(e.currentTarget.innerHTML))}
    />
  )
}

/** "2 cards, 1 document" — Milanote's count under a column's title */
export function columnCountWords(children: readonly Card[]): string {
  const docs = children.filter(c => c.kind === 'document').length
  const boards = children.filter(c => c.kind === 'board' || c.kind === 'boardlink').length
  const cards = children.length - docs - boards
  const parts = [
    boards ? `${boards} board${boards === 1 ? '' : 's'}` : '',
    cards ? `${cards} card${cards === 1 ? '' : 's'}` : '',
    docs ? `${docs} document${docs === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.join(', ') || 'Empty'
}

export function MilanoteCard({ card, editing, onUpdate, onOpen, insideLabel, columnCards, renderChild }: {
  card: Card
  editing: boolean
  onUpdate?: (next: Card) => void
  onOpen?: () => void
  insideLabel?: string
  /** a column: the cards inside it, in their order */
  columnCards?: Card[]
  /** a column: how to draw one of its cards */
  renderChild?: (child: Card) => React.ReactNode
}) {
  const save = (patch: Partial<Card>) => onUpdate?.({ ...card, ...patch })

  /* ── a note with Milanote's rich text ── */
  if (card.kind === 'note') {
    const bg = card.hex ? { backgroundColor: card.hex, color: inkOn(card.hex) } : {}
    return (
      <div data-mn="note" className={`${CARD} flex flex-col overflow-hidden px-[18px] py-[14px]`} style={{ ...box(card), ...bg }}>
        {editing && onUpdate
          ? <RichEditable html={card.html ?? ''} className={`${RICH} min-h-[1.5em] flex-1 overflow-y-auto`} onSave={html => save({ html, text: htmlText(html) })} />
          : <div data-scroll className={`${RICH} min-h-0 flex-1 overflow-y-auto`} dangerouslySetInnerHTML={{ __html: card.html ?? '' }} />}
      </div>
    )
  }

  /* ── a column: a white panel, a serif title, a count, its cards stacked inside ── */
  if (card.kind === 'column') {
    const kids = columnCards ?? []
    const bg = card.hex ? { backgroundColor: card.hex } : {}
    return (
      <div data-mn="column" className={`${CARD} flex flex-col`} style={{ ...box(card), ...bg }}>
        {/* a coloured column (Milanote, the owner's clip of Luxe Laser, 20 Oct 2026): the whole panel takes the colour,
            its cards stay white, and the title and count turn readable on it */}
        {/* select-none: dragging a card out across the title highlighted the count (20 Oct 2026) */}
        <div className="select-none px-4 pb-3 pt-5 text-center" style={card.hex ? { color: inkOn(card.hex) } : undefined}>
          <p className="text-[17px] font-semibold leading-tight" style={{ fontFamily: MN_SERIF }}>{card.name || 'Untitled'}</p>
          <p className={`mt-1 text-[12px] ${card.hex ? 'opacity-70' : 'text-[#8a8a8a]'}`}>{columnCountWords(kids)}</p>
        </div>
        {!card.collapsed && kids.length > 0 && (
          <div className="flex flex-col gap-2 px-2 pb-2">
            {kids.map(k => <div key={k.id} data-col-child={k.id} className={`relative ${fontOf(k) ? FONT_CLASS : ''}`} style={fontVars(k)}>{renderChild?.({ ...k, w: card.w - 16 })}</div>)}
          </div>
        )}
        {/* an empty column, as Milanote draws a new one: a pale well to drop cards into */}
        {!card.collapsed && kids.length === 0 && (
          <div className="mx-2 mb-2 flex h-20 select-none items-center justify-center rounded-[3px] bg-black/[0.04] text-[12px] text-[#9a9a9a] dark:bg-white/[0.06]">
            Drag cards here
          </div>
        )}
      </div>
    )
  }

  /* ── a document: a tile with an icon, its title and its length; opened, the whole text ── */
  if (card.kind === 'document') {
    if (editing) {
      return (
        <div data-mn="document-open" className={`${CARD} flex flex-col overflow-hidden`} style={{ width: Math.max(card.w, 640), maxHeight: 720 }}>
          <p className="border-b border-black/10 px-6 py-4 text-[22px] font-semibold" style={{ fontFamily: MN_SERIF }}>{card.name || 'Untitled document'}</p>
          {onUpdate
            ? <RichEditable html={card.html ?? ''} className={`${RICH} flex-1 overflow-y-auto px-6 py-4`} onSave={html => save({ html, text: htmlText(html) })} />
            : <div className={`${RICH} flex-1 overflow-y-auto px-6 py-4`} dangerouslySetInnerHTML={{ __html: card.html ?? '' }} />}
        </div>
      )
    }
    return (
      <div data-mn="document" className={`${CARD} flex items-center gap-3 px-4 py-4`} style={box(card)} title="Double-click to open">
        <FileText className="h-7 w-7 shrink-0 text-[#6b6b6b]" strokeWidth={1.4} aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium">{card.name || 'Untitled document'}</p>
          <p className="text-[12px] text-[#8a8a8a]">{wordCount(card.html ?? '')} words</p>
        </div>
      </div>
    )
  }

  /* ── a table: a grey header row, ruled cells ── */
  if (card.kind === 'table') {
    const rows = card.rows ?? []
    return (
      <div data-mn="table" className={`${CARD} overflow-auto`} style={box(card)}>
        {card.name && <p className="px-3 pb-1 pt-3 text-[14px] font-semibold">{card.name}</p>}
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i === 0 && card.header !== false ? 'bg-[#f2f2f2] font-semibold dark:bg-white/10' : ''}>
                {row.map((cell, j) => (
                  <td key={j} className={`border border-[#e3e3e3] px-2.5 py-1.5 align-top dark:border-white/15 ${RICH} text-[13px]`} dangerouslySetInnerHTML={{ __html: cell }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  /* ── a colour swatch: the block, its hex in the corner, its name under it ── */
  if (card.kind === 'swatch') {
    const hex = card.hex ?? '#cccccc'
    return (
      <div data-mn="swatch" className={`${CARD} flex flex-col overflow-hidden`} style={{ ...box(card), minHeight: 150 }}>
        <div className="relative flex-1" style={{ backgroundColor: hex, minHeight: 100 }}>
          <span className="absolute left-5 top-4 text-[13px] font-medium uppercase" style={{ color: inkOn(hex) }}>{hex}</span>
        </div>
        <p className="px-5 py-4 text-[13px]">{card.name || hex.toUpperCase()}</p>
      </div>
    )
  }

  /* ── a file: an icon, its name and size; opens the file ── */
  if (card.kind === 'file') {
    const f = card.file
    const size = f?.size ? (f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`) : ''
    return (
      <a data-mn="file" href={f?.url} target="_blank" rel="noreferrer noopener" onPointerDown={e => e.stopPropagation()}
        className={`${CARD} flex items-center gap-3 px-4 py-4 no-underline`} style={box(card)}>
        <Paperclip className="h-6 w-6 shrink-0 text-[#6b6b6b]" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium">{f?.name || card.name || 'File'}</span>
          <span className="block text-[12px] text-[#8a8a8a]">{size || 'Open'}</span>
        </span>
        <ExternalLink className="ml-auto h-4 w-4 shrink-0 text-[#8a8a8a]" aria-hidden />
      </a>
    )
  }

  /* ── a task list from Milanote: its title, its ticks, done ones greyed ── */
  if (card.kind === 'todo') {
    const items = card.items ?? []
    return (
      <div data-mn="todo" className={`${CARD} px-4 py-3`} style={box(card)}>
        {card.name && <p className="mb-2 text-[14px] font-semibold">{card.name}</p>}
        <ul className="flex flex-col gap-1.5">
          {items.map(t => (
            <li key={t.id} className="flex items-start gap-2.5 text-[14px] leading-snug">
              <button type="button" aria-pressed={t.done} aria-label={`${t.done ? 'Untick' : 'Tick'} ${t.text}`} disabled={!onUpdate}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); save({ items: items.map(x => x.id === t.id ? { ...x, done: !x.done } : x) }) }}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${t.done ? 'border-[#b5b5b5] bg-[#b5b5b5] text-white' : 'border-[#9a9a9a] bg-white dark:bg-transparent'}`}>
                {t.done && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
              </button>
              <span className={t.done ? 'text-[#a3a3a3]' : ''}>{t.text}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  /* ── a board, or a link to one: Milanote's row — a coloured square icon, the name, what it holds ── */
  if (card.kind === 'board' || card.kind === 'boardlink') {
    const hex = card.hex ?? '#b9b9b9'
    // ON THE CANVAS, Milanote's tile (measured, 20 Oct 2026): a 64 px rounded square in the board's colour with its
    // icon, the name centred under it, what it holds under that; double-click (or Open) goes in
    if (!card.col) {
      return (
        <div data-mn={`${card.kind}-tile`} className="flex flex-col items-center gap-1.5 pt-1" style={{ width: card.w }}>
          <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[14px] shadow-[0_1px_3px_rgba(0,0,0,0.14)]" style={{ backgroundColor: hex, color: inkOn(hex) }}>
            {card.icon_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={card.icon_url} alt="" className={isGlyphIcon(card.icon_url) ? 'h-8 w-8 object-contain' : 'h-full w-full object-cover'} draggable={false} />
              // one of our own icons, picked in the dialog (folder is the dialog's default, so it keeps the letter)
              : isBoardIcon(card.icon) && card.icon !== 'folder' ? React.createElement(ICON[card.icon], { className: 'h-7 w-7' })
              : <span className="text-[24px] font-semibold" style={{ fontFamily: MN_SERIF }}>{(card.name ?? '').trim()[0]?.toUpperCase() ?? ''}</span>}
          </span>
          <span className="w-full text-center text-[14px] font-semibold leading-tight text-[#2b2b2b] [overflow-wrap:anywhere] dark:text-[#ececec]">{card.name || 'Board'}</span>
          {insideLabel && <span className="text-center text-[11px] text-[#8a8a8a]">{insideLabel}</span>}
        </div>
      )
    }
    return (
      <div data-mn={card.kind} className={`${CARD} flex items-center gap-3 px-3 py-3`} style={box(card)}>
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: hex, color: inkOn(hex) }}>
          {card.name ? <span className="text-[22px] font-semibold" style={{ fontFamily: MN_SERIF }}>{card.name.trim()[0]?.toUpperCase()}</span> : <LayoutGrid className="h-6 w-6" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{card.name || 'Board'}</span>
          <span className="block truncate text-[12px] text-[#8a8a8a]">{insideLabel ?? (card.kind === 'boardlink' ? 'Board' : 'Empty')}</span>
        </span>
        <button type="button" aria-label={`Open ${card.name || 'board'}`} onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onOpen?.() }}
          className="h-9 shrink-0 rounded-full px-3 text-[12px] font-semibold text-[#6b6b6b] hover:bg-black/5">Open</button>
      </div>
    )
  }

  return null
}
