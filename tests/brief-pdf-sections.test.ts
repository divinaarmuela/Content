import { describe, expect, it } from 'vitest'
import { briefPdfSections, type BriefPdfData } from '../app/lib/brief-pdf'

/**
 * The plan PDF prints the WHOLE plan (the owner, 13 Sep 2026: "what fields do
 * I need to enter in order to fill it up?" - it printed five of nine), in the
 * shoot page's order; and the client's copy never carries the editor's
 * brief, the crew or the team's notes.
 */

const full: BriefPdfData = {
  title: 'Golf Day', clientName: 'Royal', statusLabel: 'Draft', shootDate: '2026-09-21', location: 'Royal Melbourne',
  concept: 'Bring the drone', deliverables: [{ id: 'l1', title: 'Hero reel' }], shotList: [],
  callTime: '7:30 am', objective: 'Spring drive', script: 'Three points', talent: 'Sam', propsWardrobe: 'Polos',
  clientAvailability: 'GM 8-10', editorPriorities: 'Hero reel first', editDeadline: '2026-09-25',
  editorName: 'Ed Itor', crewNames: ['Vik Camera', 'Sam Presenter'],
}

describe('the plan PDF sections', () => {
  it('the team copy has every part of the plan, the editor brief, the crew and the notes, in the page order', () => {
    expect(briefPdfSections({ ...full, audience: 'team' }).map(s => s.title)).toEqual([
      'OBJECTIVE', 'SCRIPT OR TALKING POINTS', 'TALENT OR PRESENTER', 'PROPS, WARDROBE AND SETUP', 'CLIENT AVAILABILITY',
      'EDITOR PRIORITIES AND DEADLINE', 'WHO IS ON THIS SHOOT', 'NOTES FOR THE TEAM',
    ])
    const ed = briefPdfSections(full).find(s => s.title === 'EDITOR PRIORITIES AND DEADLINE')!
    expect(ed.text).toBe('Editor: Ed Itor\nDeadline: 2026-09-25\nHero reel first')
  })
  it('the client copy stops at client availability', () => {
    expect(briefPdfSections({ ...full, audience: 'client' }).map(s => s.title)).toEqual([
      'OBJECTIVE', 'SCRIPT OR TALKING POINTS', 'TALENT OR PRESENTER', 'PROPS, WARDROBE AND SETUP', 'CLIENT AVAILABILITY',
    ])
  })
  it('an empty part is simply not printed', () => {
    expect(briefPdfSections({ ...full, script: '  ', talent: null })).not.toContainEqual(expect.objectContaining({ title: 'SCRIPT OR TALKING POINTS' }))
  })
})

describe('the scripts on the PDF (13 Sep 2026)', () => {
  const scripts = [{ id: 's1', title: 'The Adelaide hotel project', presenter: 'Kareen', voiceover: false, hook: 'We design every sign', prompts: ['Where did you start?'], visual: 'B-roll', purpose: 'Behind the scenes', links: ['https://www.instagram.com/reels/x/'] }]
  it('each video is its own section after the script, on both copies', () => {
    const team = briefPdfSections({ ...full, scripts, audience: 'team' }).map(s => s.title)
    const client = briefPdfSections({ ...full, scripts, audience: 'client' }).map(s => s.title)
    expect(team.indexOf('VIDEO 1 · THE ADELAIDE HOTEL PROJECT · KAREEN')).toBe(team.indexOf('SCRIPT OR TALKING POINTS') + 1)
    expect(client).toContain('VIDEO 1 · THE ADELAIDE HOTEL PROJECT · KAREEN')
    const body = briefPdfSections({ ...full, scripts }).find(s => s.title.startsWith('VIDEO 1'))!.text
    expect(body).toBe('Hook: We design every sign\nPrompts:\n1. Where did you start?\nVisual direction: B-roll\nPurpose: Behind the scenes\nhttps://www.instagram.com/reels/x/')
  })
})
