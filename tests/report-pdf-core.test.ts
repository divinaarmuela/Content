import { describe, expect, it } from 'vitest'
import { mayFetch, ownStyles, paperClasses, pdfDisposition, pdfFileName, pdfPageHtml, pdfPageUrl } from '../app/lib/report-pdf-core'

const O = 'https://app.example.com'

describe('the report as a PDF file', () => {
  it('names the file so a person can find it again', () => {
    expect(pdfFileName('Intersign', '2026-10')).toBe('Intersign - October 2026 report.pdf')
    expect(pdfFileName('A/B: "C" <D>', '2026-10')).toBe('A B C D - October 2026 report.pdf')
    expect(pdfFileName('', '2026-10')).toBe('Client - October 2026 report.pdf')
  })
  it('sends the name in a header every browser reads', () => {
    const h = pdfDisposition('Café - October 2026 report.pdf')
    expect(h).toContain('attachment; filename="Caf_ - October 2026 report.pdf"')
    expect(h).toContain("filename*=UTF-8''Caf%C3%A9%20-%20October%202026%20report.pdf")
  })
  it('keeps only our own built stylesheets and the typeface', () => {
    expect(ownStyles([
      `${O}/_next/static/chunks/a.css`, 'https://fonts.googleapis.com/css2?family=Inter+Tight&display=swap',
      'https://evil.example/x.css', `${O}/api/leads`, `${O}/_next/static/chunks/a.js`, 7, null,
    ], O)).toEqual([`${O}/_next/static/chunks/a.css`, 'https://fonts.googleapis.com/css2?family=Inter+Tight&display=swap'])
    expect(ownStyles('nope', O)).toEqual([])
  })
  it('draws on white paper whatever the theme', () => {
    expect(paperClasses('font-sans dark geist__variable')).toBe('font-sans geist__variable')
    expect(paperClasses(undefined)).toBe('')
  })
  it('builds the page with the sheet where the Reports page keeps it', () => {
    const html = pdfPageHtml({ sheet: '<div class="report-sheet">Hi</div>', css: 'a{}</style><script>x</script>', styles: [`${O}/_next/static/a.css?v="1"`], htmlClass: 'a"><script>', origin: O, title: 'T<' })
    expect(html).toContain('<div id="report-print" class="dbx"><div class="report-sheet">Hi</div></div>')
    expect(html).toContain('class="a&quot;&gt;&lt;script&gt;"')
    expect(html).toContain('href="https://app.example.com/_next/static/a.css?v=&quot;1&quot;"')
    expect(html).not.toContain('a{}</style>')
    expect(html).toContain('<title>T&lt;</title>')
  })
  it('lets the server browser fetch only what a report is made of', () => {
    expect(mayFetch(`${O}/_next/static/a.css`, 'stylesheet', 'GET', O)).toBe(true)
    expect(mayFetch('https://cdn.example.com/p.jpg', 'image', 'GET', O)).toBe(true)
    expect(mayFetch('https://fonts.gstatic.com/s/x.woff2', 'font', 'GET', O)).toBe(true)
    expect(mayFetch('data:image/png;base64,AAAA', 'image', 'GET', O)).toBe(true)
    // never a page, a frame, a script or a call
    for (const kind of ['document', 'script', 'xhr', 'fetch', 'websocket', 'other']) expect(mayFetch('https://cdn.example.com/x', kind, 'GET', O)).toBe(false)
    expect(mayFetch(pdfPageUrl(O), 'document', 'GET', O)).toBe(false)
    expect(mayFetch(`${O}/api/leads`, 'stylesheet', 'GET', O)).toBe(false)
    expect(mayFetch('https://cdn.example.com/p.jpg', 'image', 'POST', O)).toBe(false)
    // never the server's own network
    for (const u of ['http://cdn.example.com/p.jpg', 'https://127.0.0.1/p.jpg', 'https://169.254.169.254/latest', 'https://localhost/p.jpg', 'https://[::1]/p.jpg', 'https://box.internal/p.jpg', 'https://u:p@cdn.example.com/p.jpg', 'file:///etc/passwd'])
      expect(mayFetch(u, 'image', 'GET', O)).toBe(false)
  })
})
