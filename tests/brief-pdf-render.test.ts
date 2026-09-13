import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { renderBriefPdf, type BriefPdfData } from '../app/lib/brief-pdf'

/**
 * The PDF as bytes: every section's heading and words are in the file the
 * team downloads, and the client's file carries none of the team's parts.
 * pdfkit deflates each content stream; inflate them and read the text.
 */

function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1')
  let out = ''
  let i = 0
  for (;;) {
    const s = raw.indexOf('stream', i)
    if (s < 0) break
    let start = s + 'stream'.length
    if (raw[start] === '\r') start++
    if (raw[start] === '\n') start++
    const e = raw.indexOf('endstream', start)
    if (e < 0) break
    try { out += inflateSync(buf.subarray(start, e)).toString('latin1') } catch { /* not a deflated stream (fonts, xref) */ }
    i = e + 'endstream'.length
  }
  // pdfkit writes a line of text as a TJ array of hex runs with kerning
  // numbers between them: [<476f6c> -10 <6620446179>] TJ — join the runs
  const hex = (h: string) => h.match(/.{2}/g)!.map(x => String.fromCharCode(parseInt(x, 16))).join('')
  return out.replace(/\[((?:<[0-9a-fA-F]+>|-?[\d.]+|\s)+)\]\s*TJ/g, (_m, arr: string) =>
    (arr.match(/<([0-9a-fA-F]+)>/g) ?? []).map(r => hex(r.slice(1, -1))).join('') + '\n')
}

const data: BriefPdfData = {
  title: 'Golf Day', clientName: 'Royal', statusLabel: 'Draft', shootDate: '2026-09-21', location: 'Royal Melbourne',
  concept: 'Bring the drone', deliverables: [{ id: 'l1', title: 'Hero reel' }], shotList: [{ id: 's1', text: 'Drone over the first tee', done: false }],
  callTime: '7:30 am', objective: 'Spring membership drive', script: 'Three talking points', talent: 'Sam presents',
  propsWardrobe: 'Club polos', clientAvailability: 'GM on site 8 to 10', editorPriorities: 'Hero reel first', editDeadline: '2026-09-25',
  editorName: 'Ed Itor', crewNames: ['Vik Camera'],
  scripts: [{ id: 's1', title: 'Hotel project', presenter: 'Kareen', voiceover: true, hook: 'Every sign in Adelaide', prompts: ['Where did you start?'], visual: 'Process b-roll', purpose: 'Design thinking', links: ['https://www.instagram.com/reels/x/'] }],
}

describe('the plan PDF, as bytes', () => {
  it('the team’s copy prints all eleven parts', async () => {
    const text = pdfText(await renderBriefPdf({ ...data, audience: 'team' }))
    for (const w of [
      'Golf Day', 'CALL TIME', '7:30 am', 'Royal Melbourne',
      'OBJECTIVE', 'Spring membership drive',
      'WHAT IS BEING MADE', 'Hero reel',
      'SHOT LIST', 'Drone over the first tee',
      'SCRIPT OR TALKING POINTS', 'Three talking points',
      'VIDEO 1 · HOTEL PROJECT · KAREEN · VOICEOVER CONCEPT', 'Every sign in Adelaide', 'Where did you start?', 'Process b-roll', 'Design thinking',
      'TALENT OR PRESENTER', 'Sam presents',
      'PROPS, WARDROBE AND SETUP', 'Club polos',
      'CLIENT AVAILABILITY', 'GM on site 8 to 10',
      'EDITOR PRIORITIES AND DEADLINE', 'Ed Itor', '2026-09-25', 'Hero reel first',
      'WHO IS ON THIS SHOOT', 'Vik Camera',
      'NOTES FOR THE TEAM', 'Bring the drone',
    ]) expect(text, w).toContain(w)
  })
  it('the client’s copy has the plan and none of the team’s parts', async () => {
    const text = pdfText(await renderBriefPdf({ ...data, concept: null, audience: 'client' }))
    for (const w of ['OBJECTIVE', 'SCRIPT OR TALKING POINTS', 'VIDEO 1 · HOTEL PROJECT', 'Every sign in Adelaide', 'CLIENT AVAILABILITY', 'SHOT LIST']) expect(text, w).toContain(w)
    for (const w of ['EDITOR PRIORITIES', 'Hero reel first', 'WHO IS ON THIS SHOOT', 'Vik Camera', 'NOTES FOR THE TEAM', 'Bring the drone']) {
      expect(text, w).not.toContain(w)
    }
  })
})
