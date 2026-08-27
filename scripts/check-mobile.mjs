#!/usr/bin/env node
/**
 * Mobile responsiveness check for the client portal.
 *
 * Loads every URL in MOBILE_CHECK_URLS (comma-separated; defaults to the
 * ZZ TEST portal share link) at iPhone-14 and tablet widths and fails on the
 * four things that actually break a portal on a phone:
 *
 *   1. horizontal overflow  — documentElement.scrollWidth > window.innerWidth
 *   2. unusable tap targets — a visible button/link/input under 40px tall, or
 *                             one whose box runs outside the viewport
 *   3. unreadable type      — any element with its own text under 12px
 *   4. the fixed "Dark mode" pill sitting on top of a button
 *
 * On the share-link portal it also opens the request-changes form (it never
 * presses Approve or Send — this runs against production data) and re-runs
 * every check with the form open, because that is the state where the pill
 * and the Send button used to collide.
 *
 * Not part of `npm test` — it needs a network and a browser.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run check:mobile
 *   MOBILE_CHECK_URLS="https://…/portal/xxx,https://…/portal/xxx/item/yyy" npm run check:mobile
 *
 * Screenshots + a findings JSON land in .mobile-check/ (git-ignored).
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

/** the ZZ TEST client's portal — a real, safe page that needs no login */
const DEFAULT_URL = 'https://app.mdmmarketing.com.au/portal/3ae353c7-c879-4db7-bf71-dec9657d40e3'

const URLS = (process.env.MOBILE_CHECK_URLS ?? DEFAULT_URL)
  .split(',').map(s => s.trim()).filter(Boolean)

const VIEWPORTS = [
  { name: 'iphone14', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
]

const MIN_TAP_HEIGHT = 40
const MIN_FONT_PX = 12
const OUT = path.resolve(process.cwd(), '.mobile-check')

/**
 * Runs inside the page. Pure DOM measurement — returns findings, never throws,
 * so a broken page reports rather than crashing the run.
 */
const AUDIT = `(() => {
  const findings = []
  const vw = window.innerWidth

  const describe = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 4).join('.')
      : ''
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
    return el.tagName.toLowerCase() + id + cls + (text ? ' — "' + text + '"' : '')
  }

  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  // 1 — horizontal overflow
  const sw = document.documentElement.scrollWidth
  if (sw > vw) {
    findings.push({ rule: 'overflow', detail: 'scrollWidth ' + sw + ' > innerWidth ' + vw, selector: 'html' })
    // name the widest offenders so the fix has somewhere to go
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 || r.left < -1) {
        const p = el.parentElement
        const pr = p ? p.getBoundingClientRect() : null
        // report the outermost element that sticks out, not every descendant
        if (pr && pr.right > vw + 1) continue
        findings.push({ rule: 'overflow-element', detail: 'left ' + Math.round(r.left) + ' right ' + Math.round(r.right) + ' vs ' + vw, selector: describe(el) })
      }
    }
  }

  // 2 — tap targets
  const controls = document.querySelectorAll('button, a[href], input, textarea, select, [role="button"]')
  for (const el of controls) {
    if (!visible(el)) continue
    if (el.closest('[data-mobile-check-ignore]')) continue
    const r = el.getBoundingClientRect()
    if (r.height < ${MIN_TAP_HEIGHT}) {
      findings.push({ rule: 'tap-height', detail: Math.round(r.height) + 'px tall', selector: describe(el) })
    }
    if (r.right > vw + 1 || r.left < -1) {
      findings.push({ rule: 'tap-offscreen', detail: 'left ' + Math.round(r.left) + ' right ' + Math.round(r.right) + ' vs ' + vw, selector: describe(el) })
    }
  }

  // 3 — type under the legibility floor. Only elements holding their own text.
  for (const el of document.querySelectorAll('body *')) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'SVG') continue
    let own = ''
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent
    if (!own.trim()) continue
    if (!visible(el)) continue
    const size = parseFloat(getComputedStyle(el).fontSize)
    if (size < ${MIN_FONT_PX} - 0.01) {
      findings.push({ rule: 'font-size', detail: size + 'px', selector: describe(el) })
    }
  }

  // 4 — the fixed dark/light-mode pill sitting on a control
  const pill = [...document.querySelectorAll('button')].find(b =>
    /light mode|dark mode/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')) &&
    getComputedStyle(b).position === 'fixed')
  if (pill) {
    const p = pill.getBoundingClientRect()
    for (const el of document.querySelectorAll('button, a[href], input, textarea')) {
      if (el === pill || !visible(el)) continue
      const r = el.getBoundingClientRect()
      const hit = r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top
      if (hit) findings.push({ rule: 'pill-overlap', detail: 'the mode pill covers this control', selector: describe(el) })
    }
  }

  return findings
})()`

/** Human-readable one-liner per finding, deduped. */
function format(findings) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    const line = `      [${f.rule}] ${f.selector}  (${f.detail})`
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/**
 * Walk the page top to bottom and back.
 *
 * The portal wraps every section in <Reveal>, which holds its children at
 * opacity 0 until an IntersectionObserver fires. A screenshot-and-measure pass
 * on a freshly loaded page therefore audits the hero and nothing else — the
 * whole page below the fold is invisible, and invisible elements are skipped.
 * Scrolling through the document first is what makes the check honest.
 */
async function revealEverything(page) {
  await page.evaluate(async () => {
    const step = Math.floor(window.innerHeight * 0.75)
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise(r => setTimeout(r, 120))
    }
    window.scrollTo(0, document.body.scrollHeight)
    await new Promise(r => setTimeout(r, 400))
    window.scrollTo(0, 0)
    await new Promise(r => setTimeout(r, 400))
  })
}

async function auditState(page, label, shotPath) {
  const findings = await page.evaluate(AUDIT)
  await page.screenshot({ path: shotPath, fullPage: true })
  return { label, findings, screenshot: shotPath }
}

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  const results = []
  /** states where no "Request changes" button existed to open */
  const skipped = []

  for (const url of URLS) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        isMobile: vp.width < 500,
        hasTouch: vp.width < 500,
        userAgent: vp.width < 500
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : undefined,
      })
      const page = await context.newPage()
      const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 60)

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
      } catch {
        // networkidle can never settle on a page with a looping video
        await page.waitForLoadState('domcontentloaded')
      }
      // webfonts change every text metric, so measuring before they land makes
      // the whole check flaky — wait for them, not just for the HTML
      await page.waitForLoadState('load').catch(() => {})
      await page.evaluate(() => document.fonts.ready).catch(() => {})
      await page.waitForTimeout(1200) // scramble entrances settle
      await revealEverything(page)

      results.push(await auditState(page, `${url} @ ${vp.name}`,
        path.join(OUT, `${slug}--${vp.name}.png`)))

      // the request-changes form open — never Approve, never Send
      const trigger = page.getByRole('button', { name: /^request changes$/i }).first()
      if (await trigger.count() > 0 && await trigger.isVisible().catch(() => false)) {
        await trigger.click()
        await page.waitForTimeout(400)
        results.push(await auditState(page, `${url} @ ${vp.name} [request-changes open]`,
          path.join(OUT, `${slug}--${vp.name}--changes-open.png`)))
      } else {
        // said out loud rather than skipped quietly: the form is only on the
        // page while something is genuinely waiting on the client, so a clean
        // run here is not evidence that the open form is clean
        skipped.push(`${url} @ ${vp.name}`)
      }

      await context.close()
    }
  }

  await browser.close()

  let failed = 0
  console.log('')
  for (const r of results) {
    const lines = format(r.findings)
    if (lines.length === 0) {
      console.log(`  PASS  ${r.label}`)
    } else {
      failed++
      console.log(`  FAIL  ${r.label}  — ${lines.length} issue(s)`)
      for (const l of lines) console.log(l)
    }
    console.log(`        screenshot: ${path.relative(process.cwd(), r.screenshot)}`)
  }

  if (skipped.length > 0) {
    console.log('\n  NOTE  no "Request changes" button on these — nothing is waiting on the client,')
    console.log('        so the open-form state was NOT checked here:')
    for (const s of skipped) console.log(`          ${s}`)
  }

  await writeFile(path.join(OUT, 'findings.json'), JSON.stringify({ results, skippedFormState: skipped }, null, 2))
  console.log(`\n  ${results.length - failed}/${results.length} states clean.  Details: .mobile-check/findings.json\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
