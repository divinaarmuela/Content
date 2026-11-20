import { monthLabel, type MonthKey } from './client-report-core'

/**
 * THE REPORT AS A REAL PDF FILE (the owner, 20 Nov 2026: "why is download pdf still a print"). Download PDF used to
 * open the browser's print window and leave the person to find "Save as PDF". Now the page sends its own print sheet
 * to the server, a browser there draws it on A4, and the file comes straight back.
 *
 * This is the pure half: the page that is drawn, the file's name, and which addresses that browser may fetch.
 * The sheet arrives from a signed-in member of the team, but it is still drawn with scripts off and with only
 * pictures, styles and fonts allowed in — the server's browser never opens a page for anybody.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** the largest sheet taken: a report's sheet is words, figures and picture addresses, far under this */
export const MAX_SHEET_CHARS = 2_000_000

/**
 * the stylesheets the sheet is drawn under: our own built ones (the dashboard's base look), and Google Fonts' (the
 * dashboard's typeface, Inter Tight, is served from there — without it the PDF falls back to a serif)
 */
export function ownStyles(hrefs: unknown, origin: string): string[] {
  if (!Array.isArray(hrefs)) return []
  const out: string[] = []
  for (const h of hrefs) {
    if (typeof h !== 'string') continue
    let u: URL
    try { u = new URL(h, origin) } catch { continue }
    if (u.origin === origin && u.pathname.startsWith('/_next/static/') && u.pathname.endsWith('.css')) out.push(u.origin + u.pathname + u.search)
    else if (u.origin === 'https://fonts.googleapis.com' && u.pathname.startsWith('/css')) out.push(u.href)
  }
  return out.slice(0, 20)
}

/** the classes on <html> that carry the font, never the dark theme: paper is white */
export function paperClasses(raw: unknown): string {
  return typeof raw === 'string' ? raw.split(/\s+/).filter(c => c && c !== 'dark' && c.length < 80).slice(0, 30).join(' ') : ''
}

/** the page the server's browser draws: the sheet, where the Reports page keeps it, under the same styles */
export function pdfPageHtml(x: { sheet: string; css: string; styles: string[]; htmlClass: string; origin: string; title: string }): string {
  return `<!doctype html><html lang="en" class="${esc(x.htmlClass)}"><head><meta charset="utf-8"><title>${esc(x.title)}</title>`
    + x.styles.map(h => `<link rel="stylesheet" href="${esc(h)}">`).join('')
    + `<style>${x.css.replace(/<\/style/gi, '<\\/style')}</style>`
    + `</head><body style="margin:0;background:#fff"><div id="report-print" class="dbx">${x.sheet}</div></body></html>`
}

/** "Intersign - October 2026 report.pdf": a name a person can find again, with nothing a file system refuses */
export function pdfFileName(clientName: string, month: MonthKey): string {
  const name = clientName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Client'
  return `${name} - ${monthLabel(month)} report.pdf`
}

/** the header that names the download, with the plain-letters name older browsers read */
export function pdfDisposition(fileName: string): string {
  const plain = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\[.*\]|\d+\.\d+\.\d+\.\d+)$/i

/** the one address the server's browser opens: it is never fetched — the drawn page is handed to it there, so the
 *  sheet sits on our own site's address (its styles and pictures load as they do on the Reports page) */
export const pdfPageUrl = (origin: string) => `${origin}/__report-pdf-sheet`

/**
 * MAY THE SERVER'S BROWSER FETCH THIS? Only what a report is made of: our own built styles and fonts, and pictures,
 * styles and fonts over https from a named host. Never a page, a frame, a script or a call; never an address on the
 * server's own network (a bare IP, localhost) other than this site itself.
 */
export function mayFetch(url: string, kind: string, method: string, origin: string): boolean {
  if (url.startsWith('data:')) return kind === 'image' || kind === 'font'
  if (method !== 'GET') return false
  if (!['image', 'stylesheet', 'font'].includes(kind)) return false
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.origin === origin) return u.pathname.startsWith('/_next/') || kind === 'image'
  if (u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  return !PRIVATE_HOST.test(u.hostname)
}
