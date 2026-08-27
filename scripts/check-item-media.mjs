#!/usr/bin/env node
/**
 * What does it cost to open an item with big videos on it?
 *
 * "May Shoot 05" — a 184 MB .mov cut with its index at the end and three
 * 100–400 MB source files on R2 — froze a Chrome tab for half a minute. This
 * loads the harness at /dev/item-media (the item page's own media components
 * against those real files) in a clean Chromium and fails when the page
 * costs more than a page may cost:
 *
 *   - more than 5 MB on the wire     — a page must not download a video
 *                                     nobody pressed play on
 *   - a main-thread task over 2 s   — the tab must never stop answering
 *
 * It prints every request over 256 KB so a regression names the file.
 *
 * Not part of `npm test` — it needs a network, a browser and a server:
 *
 *   npm run build && DEV_HARNESS=1 npx next start -p 3131
 *   npm run check:item-media                     # against localhost:3131
 *   ITEM_MEDIA_URL=http://localhost:3000/dev/item-media npm run check:item-media
 *
 * ITEM_MEDIA_CORS=1 rewrites the R2 responses' CORS header to this origin, so
 * the probe succeeds the way it does on app.mdmmarketing.com.au (R2 only
 * allows that origin). Without it, this run measures the "probe refused"
 * path — which is what any other host, or a CORS hiccup, gets.
 *
 *   ITEM_MEDIA_WAIT_MS   how long to watch after load (default 12000)
 */

import { chromium } from 'playwright'

const URL_ = process.env.ITEM_MEDIA_URL ?? 'http://localhost:3131/dev/item-media'
const WAIT_MS = Number(process.env.ITEM_MEDIA_WAIT_MS ?? 12_000)
const FIX_CORS = process.env.ITEM_MEDIA_CORS === '1'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_TASK_MS = 2000
const REPORT_OVER = 256 * 1024

const mb = n => `${(n / (1024 * 1024)).toFixed(2)} MB`

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  // long tasks, recorded from before the first script runs
  await page.addInitScript(() => {
    window.__longTasks = []
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) window.__longTasks.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) })
      }).observe({ type: 'longtask', buffered: true })
    } catch { /* no observer, no numbers — reported below */ }
  })

  if (FIX_CORS) {
    // only the probe's small ranged GET is rewritten — proxying a video
    // download through Node would hide its bytes from the count below
    await page.route(/r2\.dev\//, async route => {
      const range = route.request().headers().range ?? ''
      const m = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (!m || Number(m[2]) - Number(m[1]) > 1024 * 1024) return route.continue()
      try {
        const res = await route.fetch()
        await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-length, accept-ranges' } })
      } catch { /* the page went away mid-probe */ }
    })
  }

  // bytes, from the network layer rather than the DOM: a <video> that quietly
  // pulls 184 MB never shows up in performance entries
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  const requests = new Map()
  let total = 0
  cdp.on('Network.requestWillBeSent', e => requests.set(e.requestId, { url: e.request.url, bytes: 0, status: null }))
  cdp.on('Network.responseReceived', e => { const r = requests.get(e.requestId); if (r) r.status = e.response.status })
  cdp.on('Network.dataReceived', e => {
    const r = requests.get(e.requestId)
    if (!r) return
    r.bytes += e.encodedDataLength || e.dataLength
    total += e.encodedDataLength || e.dataLength
  })

  const t0 = Date.now()
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const title = await page.title()
  const harness = await page.locator('[data-harness="item-media"]').count()
  if (harness === 0) {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
    console.error(`  FAIL  ${URL_} did not render the harness (title "${title}"). Start the server with DEV_HARNESS=1.`)
    await browser.close()
    process.exit(2)
  }
  await page.waitForTimeout(WAIT_MS)

  // is the main thread still answering? A frozen renderer never returns this.
  const alive = await Promise.race([
    page.evaluate(() => 1 + 1).then(() => true),
    new Promise(r => setTimeout(() => r(false), 5000)),
  ])
  const longTasks = alive ? await page.evaluate(() => window.__longTasks) : []
  const videos = alive ? await page.evaluate(() => [...document.querySelectorAll('video')].map(v => ({ preload: v.preload, src: v.currentSrc.split('/').pop(), readyState: v.readyState }))) : []
  const iframes = alive ? await page.locator('iframe').count() : -1

  const rows = [...requests.values()].filter(r => r.bytes >= REPORT_OVER).sort((a, b) => b.bytes - a.bytes)
  const worst = longTasks.reduce((m, t) => Math.max(m, t.ms), 0)

  console.log('')
  console.log(`  ${URL_}  (${FIX_CORS ? 'probe allowed' : 'probe CORS-refused'}, watched ${WAIT_MS} ms, ${Date.now() - t0} ms total)`)
  console.log(`  requests: ${requests.size}   bytes: ${mb(total)}   <video> mounted: ${videos.length}   <iframe>: ${iframes}   main thread: ${alive ? 'responsive' : 'FROZEN'}`)
  console.log(`  long tasks: ${longTasks.length}   worst: ${worst} ms`)
  for (const v of videos) console.log(`      <video preload="${v.preload}" readyState=${v.readyState}> ${v.src}`)
  for (const r of rows) console.log(`      ${mb(r.bytes).padStart(10)}  ${r.status ?? '-'}  ${r.url}`)

  const failures = []
  if (!alive) failures.push('the main thread stopped answering')
  if (total > MAX_BYTES) failures.push(`${mb(total)} on the wire is over ${mb(MAX_BYTES)}`)
  if (worst > MAX_TASK_MS) failures.push(`a ${worst} ms task is over ${MAX_TASK_MS} ms`)

  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
  await browser.close()
  if (failures.length) {
    console.log(`\n  FAIL  ${failures.join('; ')}\n`)
    process.exit(1)
  }
  console.log('\n  PASS\n')
}

main().catch(e => { console.error(e); process.exit(1) })
