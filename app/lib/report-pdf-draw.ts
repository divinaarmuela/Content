import 'server-only'
import { existsSync } from 'node:fs'
import { mayFetch, pdfPageUrl } from './report-pdf-core'

/**
 * THE BROWSER THAT DRAWS THE REPORT'S PDF (see report-pdf-core.ts). One page, scripts off, only a report's own
 * pictures, styles and fonts let in, printed on A4 with the sheet's colours.
 */

/** a Chrome on this machine, for running the app outside Vercel (Vercel's own comes from @sparticuz/chromium) */
function localChrome(): string | null {
  const set = process.env.CHROME_PATH
  if (set) return set
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].find(p => existsSync(p)) ?? null
}

async function launch() {
  const { default: puppeteer } = await import('puppeteer-core')
  if (process.env.VERCEL) {
    const { default: chromium } = await import('@sparticuz/chromium')
    chromium.setGraphicsMode = false
    return puppeteer.launch({
      args: puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    })
  }
  const path = localChrome()
  if (!path) throw new Error('No Chrome found on this machine (set CHROME_PATH)')
  return puppeteer.launch({ executablePath: path, headless: true })
}

/** draws the page and returns the PDF's bytes, and what was read of the typeface (so a fallback face is seen, not guessed) */
export async function drawPdf(html: string, origin: string): Promise<{ pdf: Uint8Array; fonts: string }> {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    const sheetUrl = pdfPageUrl(origin)
    page.on('request', r => {
      const go = r.url() === sheetUrl && r.resourceType() === 'document'
        ? r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
        : mayFetch(r.url(), r.resourceType(), r.method(), origin) ? r.continue() : r.abort()
      void go.catch(() => {})
    })
    // a picture that never arrives (an expired Instagram address) must not hold the whole file back
    await page.goto(sheetUrl, { waitUntil: 'load', timeout: 25_000 }).catch(e => console.warn('[report-pdf] drew without waiting for everything:', e instanceof Error ? e.message : e))
    // THE TYPEFACE IS ASKED FOR, NOT WAITED ON (20 Nov 2026). A web font is fetched only when the words using it are laid
    // out, and the page may be printed before that: on the server the first PDF came out in the fallback face. So every
    // weight the sheet uses is loaded here, for the sheet's own letters, before the page is printed.
    const fonts = await Promise.race([
      page.evaluate(async () => {
        const sheet = document.querySelector('.report-sheet')
        if (!sheet) return 'no sheet'
        const family = getComputedStyle(sheet).fontFamily.split(',')[0].trim()
        const text = (sheet.textContent ?? '').slice(0, 20000)
        const got = await Promise.all([400, 500, 600, 700, 800].map(w => document.fonts.load(`${w} 14px ${family}`, text).then(f => f.length, () => -1)))
        await document.fonts.ready
        return `${family} ${got.join('/')}`
      }),
      new Promise<string>(res => setTimeout(() => res('timed out'), 10_000)),
    ]).catch(e => `not read: ${e instanceof Error ? e.message : String(e)}`)
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' } })
    return { pdf, fonts }
  } finally {
    await browser.close().catch(() => {})
  }
}
