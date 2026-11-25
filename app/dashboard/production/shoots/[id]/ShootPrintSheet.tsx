import React from 'react'
import { boldRuns, type CanvasCard } from '../../../../lib/batch-brief-core'
import { markRuns } from '../../../../lib/note-format-core'
import { sanitiseCanvasHtml } from '../../../../lib/canvas-rich-core'
import { planAsText, type SopShoot } from '../../../../lib/shoot-sop-core'
import { printSections, type PrintBlock, type PrintSection } from '../../../../lib/shoot-print-core'

/**
 * THE SHOOT BRIEF AS A SHEET OF PAPER (Renee, 25 Nov 2026: "the shoot brief needs to be printable"). The plan's nine
 * parts, the notes for the team, who is on the shoot, then the whole board read into a document by
 * `shoot-print-core` — each column a section, its reference pictures in a grid under its words.
 *
 * No hooks and no Tailwind: the sheet is drawn straight under <body> for the print window (PrintBrief), where the
 * dashboard's scoped styles do not reach, so its look is `shootPrintCss` and nothing else.
 */

export type PrintShoot = SopShoot & {
  title: string
  concept?: string | null
  clients?: { name?: string | null } | null
}

const NOT_FILLED = 'Not filled in yet'

function Words({ text }: { text: string }) {
  const bold = (t: string, k: string) => boldRuns(t).map((r, i) => (r.bold ? <strong key={`${k}${i}`}>{r.text}</strong> : <span key={`${k}${i}`}>{r.text}</span>))
  return <>{markRuns(text).map((m, i) => (m.mark ? <mark key={i}>{bold(m.text, `m${i}-`)}</mark> : <React.Fragment key={i}>{bold(m.text, `p${i}-`)}</React.Fragment>))}</>
}

function shortLink(url: string): string {
  try { const u = new URL(url); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}` } catch { return url }
}

/** a picture that will not load leaves no broken frame on the paper */
const hide = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }

function Block({ b }: { b: PrintBlock }) {
  switch (b.kind) {
    case 'words':
      return b.html
        ? <div className={`sp-words sp-rich${b.label ? ' sp-label' : ''}`} dangerouslySetInnerHTML={{ __html: sanitiseCanvasHtml(b.html) }} />
        : <p className={`sp-words${b.label ? ' sp-label' : ''}`}><Words text={b.text} /></p>
    case 'table':
      return (
        <table className="sp-table">
          {b.header && b.rows.length > 1 && (
            <thead>
              <tr>{b.rows[0].map((cell, c) => <th key={c} dangerouslySetInnerHTML={{ __html: sanitiseCanvasHtml(cell) }} />)}</tr>
            </thead>
          )}
          <tbody>
            {(b.header && b.rows.length > 1 ? b.rows.slice(1) : b.rows).map((row, r) => (
              <tr key={r}>{row.map((cell, c) => <td key={c} dangerouslySetInnerHTML={{ __html: sanitiseCanvasHtml(cell) }} />)}</tr>
            ))}
          </tbody>
        </table>
      )
    case 'todo':
      return (
        <div className="sp-todo">
          {b.name && <p className="sp-todo-name">{b.name}</p>}
          <ul>{b.items.map((i, n) => <li key={n}><span aria-hidden>{i.done ? '☑' : '☐'}</span> {i.text}</li>)}</ul>
        </div>
      )
    case 'link':
      return <p className="sp-link">{b.title ? <>{b.title} — </> : null}<span>{shortLink(b.url)}</span></p>
    case 'file':
      return <p className="sp-link">File: {b.name}</p>
    case 'picture':
      return (
        <figure className="sp-pic">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.url} alt="" onError={hide} />
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      )
    case 'post':
      return (
        <figure className="sp-pic sp-post">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {b.thumb && <img src={b.thumb} alt="" onError={hide} referrerPolicy="no-referrer" />}
          <figcaption>
            {b.author && <strong>{b.author} </strong>}
            {b.words && <span className="sp-post-words">{b.words}</span>}
            {b.link && <span className="sp-post-link">{shortLink(b.link)}</span>}
          </figcaption>
        </figure>
      )
  }
}

/** a section with this many pictures or fewer gives its words most of the sheet, the pictures a strip on the right */
const FEW_PICTURES = 3
/** words shorter than this are a caption over the pictures, not a script to read beside them */
const SHORT_WORDS = 200

/**
 * HOW A SECTION SITS ON THE WIDE SHEET. `both`: a script down the left, its wall of pictures beside it. `few`: the
 * script across most of the sheet, a picture or two in a strip on the right. `stack`: one thing under the other —
 * words alone, pictures alone, or a line or two of words over a wall of pictures (Renee's print, 25 Nov 2026: the
 * one line under PHOTOS took a whole column, and four of its pictures went over to the next page).
 */
export function sectionShape(s: Pick<PrintSection, 'blocks' | 'pictures'>): 'both' | 'few' | 'stack' {
  if (s.blocks.length === 0 || s.pictures.length === 0) return 'stack'
  if (s.pictures.length <= FEW_PICTURES) return 'few'
  const words = s.blocks.reduce((n, b) => n + (b.kind === 'words' ? b.text.length : SHORT_WORDS), 0)
  return words < SHORT_WORDS ? 'stack' : 'both'
}
const SHAPE_CLASS = { both: ' sp-both', few: ' sp-both sp-few', stack: '' } as const

export default function ShootPrintSheet({ shoot, cards, crew = [] }: {
  shoot: PrintShoot
  cards: readonly CanvasCard[]
  /** who is on the shoot, by name, already in order */
  crew?: readonly string[]
}) {
  const facts = planAsText(shoot).filter(p => p.value && p.value !== NOT_FILLED)
  const sections = printSections(cards, 'The board')
  const client = shoot.clients?.name?.trim()
  return (
    <div className="sp">
      <header className="sp-head">
        <p className="sp-kicker">Shoot plan{client ? ` · ${client}` : ''}</p>
        <h1>{shoot.title}</h1>
      </header>

      {facts.length > 0 && (
        <dl className="sp-facts">
          {facts.map(p => (
            <div key={p.label}>
              <dt>{p.label}</dt>
              <dd>{p.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {shoot.concept?.trim() && (
        <div className="sp-notes">
          <p className="sp-notes-h">Notes for the team</p>
          <p>{shoot.concept.trim()}</p>
        </div>
      )}
      {crew.length > 0 && (
        <div className="sp-notes">
          <p className="sp-notes-h">Who is on this shoot</p>
          <p>{crew.join(' · ')}</p>
        </div>
      )}

      <div className="sp-body">
      {sections.map(s => (
        <section key={s.id} className={`sp-sec${s.depth > 0 ? ' sp-sub' : ''}${SHAPE_CLASS[sectionShape(s)]}`}>
          <h2>{s.title}</h2>
          {s.blocks.length > 0 && <div className="sp-text">{s.blocks.map(b => <Block key={b.id} b={b} />)}</div>}
          {s.pictures.length > 0 && (
            <div className="sp-pics">{s.pictures.map(b => <Block key={b.id} b={b} />)}</div>
          )}
        </section>
      ))}
      </div>
    </div>
  )
}

export type PrintPaper = 'A3' | 'A4'
export const PRINT_PAPERS: readonly PrintPaper[] = ['A3', 'A4']

/**
 * The sheet's whole look, for one paper size. `#shoot-print` is the node PrintBrief puts straight under <body>.
 * A3 (the owner, 25 Nov 2026: "print can u make it a3") is the same sheet on the bigger page, in two columns.
 *
 * NO WASTED PAGES (the owner, 25 Nov 2026, Renee's 18-page PDF: "each page is kinda wasted with a single photo
 * suddenly on one page"): words may run on to the next page instead of jumping to it whole, and pictures are one
 * height in packed rows — as many as fit across — instead of a grid of tall boxes with one left over.
 */
export function shootPrintCss(paper: PrintPaper): string {
  return paper === 'A3' ? SHEET_CSS.replace('size:A4', 'size:A3 landscape') + A3_CSS : SHEET_CSS
}

/**
 * A3 is twice the page, and ON ITS SIDE (Renee, 25 Nov 2026, after printing it: "just tested the A3, we need it to be
 * landscape").
 *
 * A SECTION STAYS TOGETHER, LAID OUT AS ON THE BOARD (Renee, on that first landscape print: "organised abit weird …
 * would be great if it's shown photos all together, vid 1 all together" — three columns down the sheet ran VID 1
 * from one column into the next and split a section's pictures over two pages). So each section is one block across
 * the wide sheet: its words down the left, its pictures beside them. A section of words alone reads in three columns
 * of its own. A section may run on to the next page — holding each one whole left most of a sheet blank (Renee, on
 * the next print: "the part where it waste 1 sheet of paper") — but its heading never sits alone at the foot of one.
 */
const A3_CSS = `
.sp-both{display:grid;grid-template-columns:120mm 1fr;column-gap:10mm;align-items:start}
.sp-both > h2{grid-column:1 / -1}
.sp-both > .sp-text{grid-column:1}
.sp-both > .sp-pics{grid-column:2;margin-top:0}
.sp-few{grid-template-columns:1fr 100mm}
.sp-few > .sp-text{column-count:2;column-gap:10mm}
.sp-sec:not(.sp-both) > .sp-text{column-count:3;column-gap:10mm}
.sp-sec:not(.sp-both) > .sp-text .sp-table{column-span:all}
.sp-pic img{height:46mm}
`

const SHEET_CSS = `
.sp{color:#111;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45}
.sp *{box-sizing:border-box}
.sp-head{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
.sp-kicker{margin:0;font-size:9pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#555}
.sp h1{margin:4px 0 0;font-size:22pt;line-height:1.15;font-weight:800}
.sp-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin:0 0 12px}
.sp-facts > div{break-inside:avoid}
.sp-facts dt{font-size:8.5pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#555}
.sp-facts dd{margin:1px 0 0;white-space:pre-wrap}
.sp-notes{margin:0 0 10px;break-inside:avoid}
.sp-notes p{margin:0;white-space:pre-wrap}
.sp-notes .sp-notes-h{font-size:8.5pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#555;margin-bottom:1px}
.sp-sec{margin-top:12px;padding-top:6px;border-top:1px solid #bbb}
.sp-sec h2{margin:0 0 6px;font-size:14pt;font-weight:800;break-after:avoid}
.sp-sub{margin-left:14px}
.sp-sub h2{font-size:12pt}
.sp-words{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}
.sp-rich{white-space:normal}
.sp-rich p{margin:0 0 4px}
.sp-rich ul,.sp-rich ol{margin:0 0 4px;padding-left:18px}
.sp-label{font-weight:700;font-size:12pt}
.sp mark{background:#fff066;color:#111;padding:0 2px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sp-table{width:100%;border-collapse:collapse;margin:0 0 10px;font-size:9.5pt}
.sp-table th,.sp-table td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
.sp-table th{background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sp-table tr{break-inside:avoid}
.sp-table p{margin:0}
.sp-todo{margin:0 0 8px;break-inside:avoid}
.sp-todo-name{margin:0 0 2px;font-weight:700}
.sp-todo ul{list-style:none;margin:0;padding:0}
.sp-link{margin:0 0 6px;font-size:9.5pt;overflow-wrap:anywhere}
.sp-link span{color:#444}
.sp-pics{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:flex-start}
.sp-pic{margin:0;break-inside:avoid;display:flex;flex-direction:column;max-width:100%}
.sp-pic img{display:block;height:44mm;width:auto;max-width:100%;object-fit:contain;object-position:left top;border:1px solid #ddd}
.sp-pic figcaption{margin-top:2px;font-size:7.5pt;line-height:1.25;color:#333;overflow-wrap:anywhere;width:0;min-width:100%}
.sp-post figcaption{min-width:max(100%,30mm)}
.sp-post-words{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.sp-post-link{display:block;color:#666}
#shoot-print{display:none}
@media print{
  @page{size:A4;margin:14mm}
  html,body{background:#fff !important;height:auto !important}
  body > *:not(#shoot-print){display:none !important}
  #shoot-print{display:block !important}
}
`

/** the printable part of an A3 sheet on its side with 10mm margins, in CSS pixels (96 to the inch) */
export const BOARD_PAGE = { w: Math.floor((420 - 20) * 96 / 25.4), h: Math.floor((297 - 20) * 96 / 25.4) - 4 }

/**
 * THE BOARD AS IT LOOKS ON THE SCREEN (Renee, 25 Nov 2026: "similar to the one on screen too"): a copy of the board
 * itself, shrunk on to one A3 sheet on its side. PrintBrief makes the copy; this is only the paper it sits on.
 */
export function boardPrintCss(): string {
  return `
#shoot-print{display:none}
#shoot-print .sp-board{position:relative;overflow:hidden;width:${BOARD_PAGE.w}px;height:${BOARD_PAGE.h}px;background:#fff}
#shoot-print .sp-board *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{
  @page{size:A3 landscape;margin:10mm}
  html,body{background:#fff !important;height:auto !important}
  body > *:not(#shoot-print){display:none !important}
  #shoot-print{display:block !important}
}
`
}
