/**
 * SCRIPTS ON THE SHOOT PLAN — pure, no I/O.
 *
 * The team writes scripts the way they always have in a doc (the owner's
 * "TOF SCRIPTS" brief, 13 Sep 2026): one block per video, each with a
 * title and presenter, a hook, a list of prompts (the interview questions),
 * a visual direction, a purpose (why the video exists) and reference links.
 * Two of the ten were "voiceover concepts".
 *
 * This file is the one shape for all of that: the sanitiser the PATCH route
 * runs, the parser behind "Paste from a doc", and the words every reader
 * (the plan PDF, the editor's card, the plan email, the client portal)
 * prints — so the five can never drift.
 */

export type ScriptBlock = {
  id: string
  title: string
  presenter: string
  /** a voiceover concept: film the work, record the talk, cut the voice over b-roll */
  voiceover: boolean
  hook: string
  prompts: string[]
  visual: string
  purpose: string
  /** https only */
  links: string[]
  /** THE SCRIPT ITSELF, AS PARAGRAPHS (the owner, 15 Sep 2026: "a script
   *  name, the body in it, then add another script") — the plain words, as
   *  they will be said. The older fields (hook, prompts, visual, purpose)
   *  stay for plans pasted from a doc; a script with a body prints its body. */
  body: string
}

export const SCRIPT_LIMITS = {
  blocks: 30, title: 200, presenter: 80, hook: 600, prompt: 400, prompts: 25,
  visual: 1000, purpose: 2000, link: 500, links: 8, body: 8000,
} as const

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n)
export const newScriptId = () => Math.random().toString(36).slice(2, 10)

/** What a stored `scripts` column becomes on the way in and the way out. */
export function sanitiseScripts(raw: unknown): ScriptBlock[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({
      id: clip(r.id, 40) || newScriptId(),
      title: clip(r.title, SCRIPT_LIMITS.title),
      presenter: clip(r.presenter, SCRIPT_LIMITS.presenter),
      voiceover: r.voiceover === true,
      hook: clip(r.hook, SCRIPT_LIMITS.hook),
      prompts: (Array.isArray(r.prompts) ? r.prompts : [])
        .map(p => clip(p, SCRIPT_LIMITS.prompt)).filter(Boolean).slice(0, SCRIPT_LIMITS.prompts),
      visual: clip(r.visual, SCRIPT_LIMITS.visual),
      purpose: clip(r.purpose, SCRIPT_LIMITS.purpose),
      links: (Array.isArray(r.links) ? r.links : [])
        .map(l => clip(l, SCRIPT_LIMITS.link)).filter(l => /^https:\/\/\S+$/.test(l)).slice(0, SCRIPT_LIMITS.links),
      body: String(r.body ?? '').replace(/\r/g, '').trim().slice(0, SCRIPT_LIMITS.body),
    }))
    // an empty block (nothing typed anywhere) is not kept
    .filter(b => b.title || b.body || b.hook || b.prompts.length > 0 || b.visual || b.purpose || b.links.length > 0)
    .slice(0, SCRIPT_LIMITS.blocks)
}

/** A block with something worth calling a script: a hook, or prompts. */
export function scriptHasContent(b: Pick<ScriptBlock, 'hook' | 'prompts'> & { body?: string }): boolean {
  return (b.body ?? '').trim().length > 0 || b.hook.trim().length > 0 || b.prompts.length > 0
}

/** Does the plan's "Script or talking points" count as filled by the blocks? */
export function scriptsFilled(raw: unknown): boolean {
  return sanitiseScripts(raw).some(scriptHasContent)
}

/* ── the words, once ───────────────────────────────────────────────────── */

export type ScriptWords = { n: number; heading: string; lines: string[] }

/** "Video 1 · The Adelaide hotel project · Kareen · voiceover" and the body
 *  as plain lines, in the order the team reads them. */
export function scriptWords(blocks: readonly ScriptBlock[]): ScriptWords[] {
  return blocks.map((b, i) => {
    // a script written here: its name, then its words, paragraph by paragraph
    if (b.body && b.body.trim()) {
      const lines = b.body.replace(/\r/g, '').split('\n').map(l => l.trimEnd())
      // one blank line between paragraphs, never a run of them
      const tidy = lines.filter((l, j) => l !== '' || (j > 0 && lines[j - 1] !== ''))
      return { n: i + 1, heading: `Script ${i + 1} · ${b.title || 'Untitled'}`, lines: tidy }
    }
    const heading = [
      `Video ${i + 1}`,
      b.title || 'Untitled',
      b.presenter ? b.presenter : '',
      b.voiceover ? 'voiceover concept' : '',
    ].filter(Boolean).join(' · ')
    const lines: string[] = []
    if (b.hook) lines.push(`Hook: ${b.hook}`)
    if (b.prompts.length > 0) {
      lines.push('Prompts:')
      b.prompts.forEach((p, j) => lines.push(`${j + 1}. ${p}`))
    }
    if (b.visual) lines.push(`Visual direction: ${b.visual}`)
    if (b.purpose) lines.push(`Purpose: ${b.purpose}`)
    b.links.forEach(l => lines.push(l))
    return { n: i + 1, heading, lines }
  })
}

/** The blocks as one plain text, for a place that prints one string. */
export function scriptsText(blocks: readonly ScriptBlock[]): string {
  return scriptWords(blocks).map(w => [w.heading, ...w.lines].join('\n')).join('\n\n')
}

/* ── "Paste from a doc" ────────────────────────────────────────────────── */

const VIDEO_LINE = /^\s*video\s*(\d+)\s*[:.\-–—]\s*(.+?)\s*$/i
const HOOK_LINE = /^\s*hook\s*[:：]\s*(.*)$/i
const PROMPTS_LINE = /^\s*prompts?\s*[:：]?\s*$/i
const VISUAL_LINE = /^\s*visual\s*direction\s*[:：]\s*(.*)$/i
const URL_IN = /https?:\/\/\S+/i
const VOICEOVER = /voice\s*-?\s*over\s+concept/i
const PROMPT_BULLET = /^\s*(?:\d+[.)]|[-•*])\s*/

/**
 * A doc like the team's, pasted whole, into blocks. Tolerant, never
 * throwing: anything it cannot place goes into the block's purpose, so no
 * words are lost and the person sees what to move. Lines before the first
 * "Video N:" (a doc title, "SCRIPT", "INSPIRATION") are dropped.
 */
export function parseScriptDoc(text: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = []
  let cur: ScriptBlock | null = null
  let mode: 'body' | 'prompts' = 'body'
  const purpose: string[] = []
  const flush = () => {
    if (!cur) return
    cur.purpose = purpose.join('\n').trim()
    if (!cur.voiceover && VOICEOVER.test(`${cur.title} ${cur.purpose}`)) cur.voiceover = true
    blocks.push(cur)
    purpose.length = 0
  }
  for (const rawLine of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim()
    const video = line.match(VIDEO_LINE)
    if (video) {
      flush()
      mode = 'body'
      // "The hotel project - VOICEOVER CONCEPT - Kareen": dash-separated
      // segments; a short last segment is the presenter, a segment that is
      // only the voiceover marker is the flag, the rest is the title
      let title = video[2].trim()
      let presenter = ''
      const tail = title.match(/^(.*\S)\s+[-–—]\s+([^-–—]{1,40})$/)
      if (tail && !/[.?!]$/.test(tail[2].trim())) { title = tail[1].trim(); presenter = tail[2].trim() }
      let voiceover = false
      // the marker as its own dash segment is removed; inside a bracket it stays in the title
      const marked = title.replace(/(?:^|\s+[-–—]\s+)voice\s*-?\s*over\s+concept(?=\s+[-–—]\s+|$)/i, '')
      if (marked !== title) { voiceover = true; title = marked.trim() }
      if (VOICEOVER.test(title)) voiceover = true
      cur = { id: newScriptId(), title, presenter, voiceover, hook: '', prompts: [], visual: '', purpose: '', links: [], body: '' }
      continue
    }
    if (!cur) continue
    if (!line) continue
    const hook = line.match(HOOK_LINE)
    if (hook) { cur.hook = hook[1].trim(); mode = hook[1].trim() ? 'body' : 'hook' as never; continue }
    if ((mode as string) === 'hook') { cur.hook = line; mode = 'body'; continue }
    if (PROMPTS_LINE.test(line)) { mode = 'prompts'; continue }
    const visual = line.match(VISUAL_LINE)
    if (visual) { cur.visual = visual[1].trim(); mode = 'body'; continue }
    const url = line.match(URL_IN)
    if (url) {
      const u = url[0].replace(/[),.]+$/, '')
      if (/^https:\/\//i.test(u)) cur.links.push(u)
      const note = line.replace(url[0], '').replace(/^\s*[-–—:]\s*/, '').trim()
      if (note) purpose.push(note)
      mode = 'body'
      continue
    }
    if (mode === 'prompts') {
      // a prompt is a question or a numbered line; a sentence that is
      // neither is the purpose paragraph that follows the list
      if (PROMPT_BULLET.test(line) || /\?$/.test(line)) { cur.prompts.push(line.replace(PROMPT_BULLET, '').trim()); continue }
      mode = 'body'
    }
    purpose.push(line)
  }
  flush()
  return sanitiseScripts(blocks)
}
