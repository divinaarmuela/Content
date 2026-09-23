'use client'

import DOMPurify from 'dompurify'
import { QUOTE_SELECTORS, SIGNATURE_SELECTORS } from './acq-conversation-core'

/**
 * HTML MAIL, MADE SAFE TO DRAW — the browser half (research, 23 Sep 2026:
 * Close.com's "Rendering untrusted HTML email, safely", AdGuard's renderer).
 * DOMPurify strips scripts, forms, frames and event handlers; remote images
 * are held back until the reader asks for them, because a loaded image is a
 * tracking pixel; the quoted history is cut out and handed back separately
 * so the page can fold it. The result is drawn in a script-less sandboxed
 * iframe (EmailBody.tsx), which is the second wall.
 */
export type PreparedEmail = { own: string; quoted: string | null; blockedImages: number }

const FORBID_TAGS = ['script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'audio', 'video', 'svg', 'math']
const FORBID_ATTR = ['onerror', 'onload', 'onclick', 'onmouseover', 'srcset', 'ping']

let hooked = false
function blockImagesHook(): void {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'src' && /^(https?:)?\/\//i.test(data.attrValue) && node.tagName === 'IMG' && !(DOMPurify as unknown as { __allowImages?: boolean }).__allowImages) {
      node.setAttribute('data-blocked-src', data.attrValue)
      data.attrValue = ''
      data.forceKeepAttr = false
      data.keepAttr = false
    }
    // a background image is an image too
    if (data.attrName === 'style' && /url\s*\(/i.test(data.attrValue) && !(DOMPurify as unknown as { __allowImages?: boolean }).__allowImages) {
      data.attrValue = data.attrValue.replace(/url\s*\([^)]*\)/gi, 'none')
    }
    if (data.attrName === 'style' && /position\s*:\s*(fixed|absolute)/i.test(data.attrValue)) {
      data.attrValue = data.attrValue.replace(/position\s*:\s*(fixed|absolute)/gi, 'position:static')
    }
  })
}

/** cut the quoted history out of the document, by the markers the sending client left */
export function splitQuotedHtml(html: string): { own: string; quoted: string | null } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const quoted: string[] = []
  for (const sel of QUOTE_SELECTORS) {
    for (const el of Array.from(doc.querySelectorAll(sel))) {
      if (!el.isConnected) continue
      // Outlook's divider is followed by the quoted message as siblings, not children
      if (el.id === 'divRplyFwdMsg' || el.id === 'isReplyFwdMsg' || el.id === 'appendonsend') {
        let n: Element | null = el
        const run: Element[] = []
        while (n) { run.push(n); n = n.nextElementSibling }
        quoted.push(run.map(x => x.outerHTML).join(''))
        run.forEach(x => x.remove())
      } else {
        quoted.push(el.outerHTML)
        el.remove()
      }
    }
  }
  // the signature, dimmed: by the client's own marker, else the block that begins with the "--" line
  let sig: Element | null = null
  for (const sel of SIGNATURE_SELECTORS) { sig = doc.querySelector(sel); if (sig) break }
  if (!sig) sig = Array.from(doc.body.querySelectorAll('div, p')).find(el => /^--\s*$/.test((el.firstChild?.textContent ?? '').trim()) && el.textContent && el.textContent.trim().length > 2) ?? null
  if (sig && sig !== doc.body) {
    const wrap = doc.createElement('div'); wrap.className = 'mdm-signature'
    // Gmail's own signature block, or the div that begins with -- and everything after it
    const run: Element[] = [sig]; if (!sig.matches(SIGNATURE_SELECTORS.join(','))) { let n = sig.nextElementSibling; while (n) { run.push(n); n = n.nextElementSibling } }
    sig.parentElement?.insertBefore(wrap, sig); run.forEach(x => wrap.appendChild(x))
  }
  return { own: doc.body.innerHTML, quoted: quoted.length ? quoted.join('') : null }
}

/** an <img> with nothing to show — no src, a cid: nobody resolved, or one held back — is removed, never drawn broken */
export function dropEmptyImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, tag => (/\ssrc\s*=\s*(["'])(?!\s*\1)(?!cid:)[^"']+\1/i.test(tag) ? tag : ''))
}

/** sanitise for the frame; images blocked unless asked */
export function prepareEmailHtml(html: string, opts: { images?: boolean } = {}): PreparedEmail {
  blockImagesHook()
  ;(DOMPurify as unknown as { __allowImages?: boolean }).__allowImages = opts.images === true
  const { own, quoted } = splitQuotedHtml(html)
  const clean = (s: string) => DOMPurify.sanitize(s, { FORBID_TAGS, FORBID_ATTR, ALLOW_UNKNOWN_PROTOCOLS: false, USE_PROFILES: { html: true } }) as string
  const ownSafe = clean(own)
  const quotedSafe = quoted ? clean(quoted) : null
  // counted before the empty ones are dropped, so "Show images" still knows how many were held back
  const blockedImages = opts.images ? 0 : (ownSafe.match(/data-blocked-src=/g)?.length ?? 0) + (quotedSafe?.match(/data-blocked-src=/g)?.length ?? 0)
  const ownClean = dropEmptyImages(ownSafe)
  const quotedClean = quotedSafe ? dropEmptyImages(quotedSafe) : null
  return { own: ownClean, quoted: quotedClean, blockedImages }
}
