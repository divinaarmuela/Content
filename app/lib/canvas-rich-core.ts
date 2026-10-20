/**
 * RICH TEXT ON THE CANVAS, AS MILANOTE HAS IT (20 Oct 2026, the Milanote merge — docs/MILANOTE_MERGE.md).
 *
 * Milanote's notes and documents are bold, italic, underlined and struck words, bullets and numbered lists,
 * headings, quotes, highlights, links and coloured words. A note here was plain words with one bold switch, so a
 * brief brought across would lose its shape. This is the allowlist the canvas renders from: those tags and nothing
 * else, a link only to https, a colour only as a hex — every other attribute dropped, every tag closed, text
 * escaped. Pure; nothing here imports anything.
 *
 * `milanoteToHtml` turns Milanote's stored text (ProseMirror-style JSON: `{ type: 'doc', content: [...] }`) into
 * that HTML, so the import and the canvas speak the same thing.
 */

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'div'])
const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'mark', 'a', 'span', 'code'])
const VOID = new Set(['br'])
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i

function escapeText(s: string): string {
  return s.replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** the one attribute each tag may keep */
function attrsFor(name: string, tag: string): string {
  if (name === 'a') {
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag)
    const url = (href?.[2] ?? href?.[3] ?? '').trim()
    return /^https:\/\//i.test(url) ? ` href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener"` : ''
  }
  if (name === 'span' || name === 'mark') {
    const style = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag)
    const css = style?.[2] ?? style?.[3] ?? ''
    const colour = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6})\s*(?:;|$)/i.exec(css)?.[1]
    const back = /(?:^|;)\s*background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\s*(?:;|$)/i.exec(css)?.[1]
    const parts = [colour && HEX.test(colour) ? `color:${colour}` : '', back && HEX.test(back) ? `background-color:${back}` : ''].filter(Boolean)
    return parts.length ? ` style="${parts.join(';')}"` : ''
  }
  return ''
}

export function sanitiseCanvasHtml(html: string, max = 40_000): string {
  const out: string[] = []
  const open: string[] = []
  const re = /<\/?([a-zA-Z0-9]+)[^>]*>|[^<]+|</g
  let m: RegExpExecArray | null
  const src = String(html ?? '').slice(0, max * 2)
  while ((m = re.exec(src))) {
    const tok = m[0]
    if (tok === '<') { out.push('&lt;'); continue }
    if (tok[0] !== '<') { out.push(escapeText(tok)); continue }
    const name = m[1].toLowerCase()
    if (VOID.has(name)) { out.push('<br>'); continue }
    if (!BLOCK.has(name) && !INLINE.has(name)) continue
    if (tok[1] === '/') {
      const at = open.lastIndexOf(name)
      if (at === -1) continue
      while (open.length > at) out.push(`</${open.pop()}>`)
    } else {
      open.push(name)
      out.push(`<${name}${attrsFor(name, tok)}>`)
    }
  }
  while (open.length) out.push(`</${open.pop()}>`)
  return out.join('').slice(0, max)
}

/** The words without their markup — a count, a search, a document's "235 words". */
export function htmlText(html: string): string {
  return String(html ?? '')
    .replace(/<\/(p|h1|h2|h3|li|div|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function wordCount(html: string): number {
  const t = htmlText(html)
  return t ? t.split(/\s+/).filter(Boolean).length : 0
}

/* ── Milanote's text → our HTML ─────────────────────────────────────────── */

type PmMark = { type?: string; attrs?: Record<string, unknown> }
/** Milanote's named highlighters: blue, green and pink measured on its page; the rest matched to its palette */
const MN_HIGHLIGHT: Record<string, string> = {
  blue: '#8ae0ff', green: '#c9f201', pink: '#ffa4de', yellow: '#fff27a', orange: '#ffc46b', grey: '#dcdcdc', gray: '#dcdcdc', red: '#ff9b9b', purple: '#d7b8ff',
}

type PmNode = { type?: string; text?: string; marks?: PmMark[]; attrs?: Record<string, unknown>; content?: PmNode[] }

function wrapMarks(text: string, marks: PmMark[] | undefined): string {
  let out = escapeText(text)
  for (const mk of marks ?? []) {
    switch (mk.type) {
      case 'bold': case 'strong': out = `<strong>${out}</strong>`; break
      case 'italic': case 'em': out = `<em>${out}</em>`; break
      case 'underline': out = `<u>${out}</u>`; break
      case 'strike': case 'strikethrough': out = `<s>${out}</s>`; break
      case 'code': out = `<code>${out}</code>`; break
      case 'highlight': {
        // Milanote names its highlighters; their shades read off Milanote's own page (20 Oct 2026)
        const raw = String(mk.attrs?.color ?? '')
        const c = HEX.test(raw) ? raw : MN_HIGHLIGHT[raw.toLowerCase()] ?? ''
        out = c ? `<mark style="background-color:${c}">${out}</mark>` : `<mark>${out}</mark>`
        break
      }
      case 'link': {
        const href = String(mk.attrs?.href ?? '')
        if (/^https:\/\//i.test(href)) out = `<a href="${escapeAttr(href)}">${out}</a>`
        break
      }
      case 'textStyle': {
        const c = String(mk.attrs?.color ?? '')
        if (HEX.test(c)) out = `<span style="color:${c}">${out}</span>`
        break
      }
    }
  }
  return out
}

function nodeToHtml(n: PmNode): string {
  const inner = () => (n.content ?? []).map(nodeToHtml).join('')
  switch (n.type) {
    case 'doc': return inner()
    case 'text': return wrapMarks(n.text ?? '', n.marks)
    case 'hardBreak': return '<br>'
    case 'paragraph': return `<p>${inner() || '<br>'}</p>`
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 2)))
      return `<h${level}>${inner()}</h${level}>`
    }
    case 'bulletList': return `<ul>${inner()}</ul>`
    case 'orderedList': return `<ol>${inner()}</ol>`
    case 'listItem': return `<li>${inner()}</li>`
    case 'blockquote': return `<blockquote>${inner()}</blockquote>`
    case 'horizontalRule': return '<p><br></p>'
    default: return inner()
  }
}

/**
 * Milanote's stored text — a ProseMirror-style doc, an older draft-js string (`@@mn-draft-js:{…}`), or plain
 * words — as our sanitised HTML.
 */
export function milanoteToHtml(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'object') return sanitiseCanvasHtml(nodeToHtml(raw as PmNode))
  const s = String(raw)
  if (s.startsWith('@@mn-draft-js:')) {
    try {
      const d = JSON.parse(s.slice('@@mn-draft-js:'.length)) as { blocks?: { text?: string; type?: string; inlineStyleRanges?: { offset: number; length: number; style: string }[] }[] }
      const blocks = (d.blocks ?? []).map(b => {
        const text = String(b.text ?? '')
        const bold = (b.inlineStyleRanges ?? []).some(r => r.style === 'BOLD' && r.offset === 0 && r.length >= text.length)
        const body = bold ? `<strong>${escapeText(text)}</strong>` : escapeText(text)
        return b.type === 'unordered-list-item' ? `<li>${body}</li>` : `<p>${body || '<br>'}</p>`
      })
      return sanitiseCanvasHtml(blocks.join(''))
    } catch { return sanitiseCanvasHtml(`<p>${escapeText(s)}</p>`) }
  }
  return sanitiseCanvasHtml(s.split(/\n/).map(l => `<p>${escapeText(l) || '<br>'}</p>`).join(''))
}
