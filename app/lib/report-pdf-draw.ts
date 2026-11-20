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

/** draws the page and returns the PDF's bytes */
export async function drawPdf(html: string, origin: string): Promise<Uint8Array> {
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
    // the typeface is fetched only once the words that use it are laid out: wait for it, or the PDF is set in a fallback
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => true)),
      new Promise(res => setTimeout(res, 8_000)),
    ]).catch(() => {})
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' } })
  } finally {
    await browser.close().catch(() => {})
  }
}
