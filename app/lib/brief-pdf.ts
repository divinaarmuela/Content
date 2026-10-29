import 'server-only'
import PDFDocument from 'pdfkit'
import { scriptWords, type ScriptBlock } from './script-core'
import { bulletText } from './bullet-core'
import { linkParts } from './todo-core'
import type { PlannedDeliverable, ShotRow } from './batch-brief-core'

/**
 * The shoot plan as a PDF — the brief as a hand-out: the nine parts of the
 * plan in the shoot page's order, the shot list with capture ticks, and for
 * the team's copy the editor's brief, the crew and the notes. Same visual
 * system as the leads report (pdfkit, built-in Helvetica, serverless-safe).
 */

const INK = '#18181b'
const DIM = '#71717a'
const FAINT = '#a1a1aa'
const LINE = '#e4e4e7'
const BLUE = '#2563eb'
const PAGE = { width: 595.28, height: 841.89, margin: 48 } // A4

export type BriefPdfData = {
  title: string
  clientName: string
  statusLabel: string
  shootDate: string | null
  location: string | null
  /** "Notes for the team" on the shoot page — team only, never the client's copy */
  concept: string | null
  deliverables: PlannedDeliverable[]
  shotList: ShotRow[]
  /** the rest of the nine-part plan (13 Sep 2026: "what fields do I need to
   *  enter in order to fill it up?" — the PDF printed five of them) */
  callTime?: string | null
  objective?: string | null
  script?: string | null
  talent?: string | null
  propsWardrobe?: string | null
  clientAvailability?: string | null
  editorPriorities?: string | null
  editDeadline?: string | null
  /** the script blocks, one section each, both copies */
  scripts?: ScriptBlock[]
  /** names: the editor and the crew */
  editorName?: string | null
  crewNames?: string[]
  /** who this copy is for. The client's copy drops the editor's priorities
   *  and deadline, the team notes and the crew list. Default: team. */
  audience?: 'team' | 'client'
}

/** The plan's sections in the order the shoot page shows them, already
 *  filtered for the audience. Pure, so a test can read what will print. */
export function briefPdfSections(d: BriefPdfData): { title: string; text: string }[] {
  const client = d.audience === 'client'
  const t = (v: string | null | undefined) => String(v ?? '').trim()
  const out: { title: string; text: string }[] = []
  const push = (title: string, text: string) => { if (text) out.push({ title, text }) }
  push('OBJECTIVE', t(d.objective))
  push('SCRIPT OR TALKING POINTS', bulletText(d.script) ?? '')
  for (const w of scriptWords(d.scripts ?? [])) push(w.heading.toUpperCase(), w.lines.join('\n'))
  push('TALENT OR PRESENTER', t(d.talent))
  push('PROPS, WARDROBE AND SETUP', t(d.propsWardrobe))
  if (!client) {
    const deadline = t(d.editDeadline)
    const pri = t(d.editorPriorities)
    const who = t(d.editorName)
    const lines = [who ? `Editor: ${who}` : '', deadline ? `Deadline: ${deadline}` : '', pri].filter(Boolean)
    push('EDITOR PRIORITIES AND DEADLINE', lines.join('\n'))
    const crew = (d.crewNames ?? []).map(t).filter(Boolean)
    push('WHO IS ON THIS SHOOT', crew.join('\n'))
    push('NOTES FOR THE TEAM', t(d.concept))
  }
  return out
}

/**
 * A LINE CUT INTO WORDS AND LINKS (29 Oct 2026: "shoot brief pdfs when generated links are not working in there"). The
 * plan was printed as plain text, so an address in it could not be pressed and a long one broke over two lines. Each
 * address is now its own run, with a link the PDF reader opens. Pure, so a test reads what will print.
 */
export function pdfRuns(text: string): { text: string; href?: string }[][] {
  return String(text ?? '').split(/\r?\n/).map(line => {
    const parts = linkParts(line).filter(p => p.text)
    return parts.length ? parts : [{ text: ' ' }]
  })
}

export function renderBriefPdf(data: BriefPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const contentW = PAGE.width - PAGE.margin * 2
    const ensureRoom = (needed: number) => {
      if (doc.y + needed > PAGE.height - PAGE.margin) doc.addPage()
    }

    // ─── Header band ───
    doc.rect(0, 0, PAGE.width, 110).fill(INK)
    doc.rect(0, 110, PAGE.width, 3).fill(BLUE)
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
      .text('Shoot plan', PAGE.margin, 34)
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text('Prepared by MD Media', PAGE.margin, 62)
    doc.fillColor('#ffffff').font('Helvetica').fontSize(11)
      .text(`${data.clientName} — ${data.title}`, PAGE.margin, 78, { width: contentW })
    doc.fillColor(FAINT).font('Courier').fontSize(8)
      .text(data.statusLabel.toUpperCase(), PAGE.margin, 40, { width: contentW, align: 'right' })

    doc.y = 140
    doc.x = PAGE.margin

    // ─── Facts row ───
    const dateLabel = data.shootDate
      // the plain date is already local wall-clock; naming the zone keeps it
      // from drifting a day when this renders on a UTC server
      ? new Date(`${data.shootDate}T00:00:00`).toLocaleDateString('en-AU', {
          timeZone: 'Australia/Melbourne',
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      : 'To be confirmed'
    const facts: [string, string][] = [
      ['SHOOT DATE', dateLabel],
      ['CALL TIME', String(data.callTime ?? '').trim() || 'To be confirmed'],
      ['LOCATION', data.location || 'To be confirmed'],
    ]
    const factW = contentW / facts.length
    const factsY = doc.y
    facts.forEach(([label, value], i) => {
      const x = PAGE.margin + i * factW
      doc.fillColor(FAINT).font('Courier').fontSize(7.5).text(label, x, factsY)
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(value, x, factsY + 12, { width: factW - 12 })
    })
    doc.y = factsY + 44

    const section = (title: string) => {
      ensureRoom(60)
      doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.width - PAGE.margin, doc.y).lineWidth(0.5).stroke(LINE)
      doc.y += 10
      doc.fillColor(FAINT).font('Courier').fontSize(8).text(title, PAGE.margin, doc.y)
      doc.y += 16
    }

    /** words with their links pressable: each address blue and underlined, the rest as before */
    const linked = (text: string, x: number, width: number, colour: string) => {
      const lines = pdfRuns(text)
      lines.forEach((runs, li) => {
        runs.forEach((r, ri) => {
          const last = ri === runs.length - 1
          const opts = { width, lineGap: 3, continued: !last, ...(r.href ? { link: r.href, underline: true } : { link: null, underline: false }) }
          doc.fillColor(r.href ? BLUE : colour).font('Helvetica').fontSize(10)
          if (li === 0 && ri === 0) doc.text(r.text, x, doc.y, opts as never)
          else if (ri === 0) doc.text(r.text, x, doc.y, opts as never)
          else doc.text(r.text, opts as never)
        })
      })
    }
    const prose = (title: string, text: string) => {
      section(title)
      linked(text, PAGE.margin, contentW, INK)
      doc.y += 18
    }
    const sections = briefPdfSections(data)
    const objective = sections.find(x => x.title === 'OBJECTIVE')
    if (objective) prose(objective.title, objective.text)

    // ─── What is being made — one line, one thing ───
    if (data.deliverables.length > 0) {
      section('WHAT IS BEING MADE')
      data.deliverables.forEach((d, i) => {
        ensureRoom(18)
        doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10)
          .text(String(i + 1), PAGE.margin, doc.y, { continued: true, width: contentW })
        doc.fillColor(INK).font('Helvetica').fontSize(10).text('  ', { continued: true })
        pdfRuns(d.title)[0].forEach((r, ri, all) => {
          doc.fillColor(r.href ? BLUE : INK).text(r.text, { continued: ri < all.length - 1, ...(r.href ? { link: r.href, underline: true } : { link: null, underline: false }) } as never)
        })
        doc.y += 4
      })
      doc.y += 12
    }

    // ─── Shot list ───
    if (data.shotList.length > 0) {
      const done = data.shotList.filter(r => r.done).length
      section(done > 0 ? `SHOT LIST · ${done}/${data.shotList.length} CAPTURED` : 'SHOT LIST')
      for (const r of data.shotList) {
        ensureRoom(20)
        const y = doc.y
        doc.rect(PAGE.margin, y + 1, 9, 9).lineWidth(0.8).stroke(r.done ? BLUE : FAINT)
        if (r.done) {
          doc.moveTo(PAGE.margin + 2, y + 5.5).lineTo(PAGE.margin + 4, y + 8)
            .lineTo(PAGE.margin + 7.5, y + 3).lineWidth(1.1).stroke(BLUE)
        }
        doc.y = y
        linked(`${r.text}${r.qty ? `  ×${r.qty}` : ''}${r.type ? `  (${r.type})` : ''}`, PAGE.margin + 18, contentW - 18, r.done ? DIM : INK)
        doc.y = Math.max(doc.y, y + 14)
      }
      doc.y += 12
    }

    // ─── The rest of the plan, in the page's order ───
    for (const x of sections) if (x.title !== 'OBJECTIVE') prose(x.title, x.text)

    // ─── Footer on every page ───
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      // the footer sits INSIDE the bottom margin — pdfkit treats any text
      // past the margin as overflow and silently appends a blank page per
      // footer line. Zero the margin while stamping, and never line-break.
      const savedBottom = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc.fillColor(FAINT).font('Courier').fontSize(7)
        .text(
          `MD MEDIA · SHOOT PLAN · ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne' })}`,
          PAGE.margin, PAGE.height - 34, { width: contentW, lineBreak: false },
        )
      doc.text(`${i - range.start + 1} / ${range.count}`, PAGE.margin, PAGE.height - 34, {
        width: contentW, align: 'right', lineBreak: false,
      })
      doc.page.margins.bottom = savedBottom
    }
    doc.end()
  })
}
