import { describe, expect, it } from 'vitest'
import { parseScriptDoc, sanitiseScripts, scriptWords, scriptsFilled, scriptsText, type ScriptBlock } from '../app/lib/script-core'

/**
 * SCRIPTS ON THE SHOOT PLAN (13 Sep 2026). The fixture below is the owner's
 * real "TOF SCRIPTS" brief for Intersign, pasted verbatim: ten videos, two of
 * them voiceover concepts. "Paste from a doc" has to read it as the team
 * wrote it, not as a parser would like it written.
 */

const DOC = `TOF SCRIPTS


SCRIPT
Purpose
INSPIRATION
Video 1: The Adelaide hotel project - Kareen
Hook: We're designing every sign for a new hotel in Adelaide, and this is where it's at right now.
Prompts:
When the team first sat down with this project, where did you guys start?
What's the aesthetic or feeling you're all designing towards?
How do you take a hotel's identity and turn it into signage?
What references or directions were you pulling from early on?
How do you balance making it look beautiful with actually guiding people through the space?
What's been the trickiest design decision so far?
What materials or finishes are you leaning towards, and why?
What is the thought process behind this project so far?
Where's the design up to right now, and what's the next stage?

Visual direction: B-rolls of the process, designing, before and after.



A behind-the-scenes look at a live, high-end project, shows Intersign's design thinking, not just the finished product. Introducing more women to the camera.


https://www.instagram.com/reels/DXGnSoIkZfG/
Video 2:  Aboriginal signage: before & after - VOICEOVER CONCEPT - Borche

This is a voiceover concept. We film the work and process on the day, capture Borche talking through it, then cut a voiceover over b-roll and before/after footage.
Hook:  Once in a while, a project comes along that's bigger than signage.
Prompts:
What is the aboriginal post signage project and who is it for?
What's the story or the history behind it?
What does it mean for Intersign to be trusted with something like this?
What materials did you use, and why those ones?
Walk me through how these posts were actually made and the process?
How did the team paint them and what did that involve?
What was the hardest part to get right technically?
How long did the whole thing take, start to finish?
What do you want people to feel when they walk past it now?
Visual direction: B-rolls of the process, designing, before and afters.
A before/after transformation piece with a considered voiceover, shows Intersign's craft and the meaning behind culturally significant work.


https://www.instagram.com/reel/DZHZ8hJR6uF/
Video 3: Public housing, Port Melbourne - Zoe
Hook: Designing signage for public housing isn't like anything else. Here's why.
Prompts:
What was the goal for this project and what role did you play?
What do you have to think about with public housing signage that's different from other jobs?
Where do you even start with a project like this?
Walk us through the design process from start to finish?
What look or feeling were you going for with the signage?
What constraints did you have to design around?
What materials made sense here, and why?
What are you most proud of with how it's coming together?
Visual direction: B-rolls of the process, designing, before and afters.
Introducing more women in the industry and Zoe's take on the creative thinking and design behind the project.

https://www.instagram.com/reels/DaNjXQMu1gj/
https://www.instagram.com/reels/DUYPnT4DE8M/
Video 4: Public housing, Port Melbourne - Francessa
Hook:  Almost nobody sees how much thought and time goes into public housing signage.
Prompts:
What was the concept or the idea behind the design for the Port Melbourne project?
How do you make signage in a space like this feel welcoming instead of institutional?
What's a design choice you made that most people would never notice, but really matters?
How much does helping people actually find their way around shape the look of signage?
What's the detail that makes the biggest difference, a colour, a typeface, a finish?
What was the hardest creative call on this project?
Visual direction: B-rolls of the process, designing, before and afters.
Francessa's take on this project. Introducing more women in the industry. Same project as Video 3, but form a different perspective.
https://au.pinterest.com/pin/974325700657567193
https://www.instagram.com/reels/DW3K8aiDGG7/
Video 5: 3D printing technology (b-roll + voiceover concept) - Borche
This is a voiceover concept. We film all the things they have been playing around with for 3D printing, fun concepts they have created and they talk about it.
Hook: This is a 3D printer. And it's changing how we make signage.
Prompts:
What are you testing with 3D printing right now?
What made Intersign start experimenting with this in the first place?
What can 3D printing do for signage that the usual methods can't?
What's been the trickiest part to figure out so far?
Why does a signage company need to be across tech like this?
How do you think 3D printing changes the industry?
What's the coolest or most surprising thing you've printed?
Where do you see 3D signage going next?
Visual direction: B-rolls of the the 3D signs they have been playing around with.
Positions Intersign as innovative and forward-thinking. A company that invests in new tech to make better signage.
https://www.instagram.com/reels/DbXyAFSstkU/
Video 6: Choosing the right material for the right project - Anyone
Hook: Choosing the right material can make or break a project, and most clients don't know where to start. That's exactly where we come in.
Prompts:
What are the most common material requests you get, and which ones do you end up redirecting?
How do you explain material options and advise clients who don't know much?
Walk me through a project where the material choice made or broke the result?
What questions do you ask before recommending a material?
Is there a material that's underrated, that more clients should be asking for when it comes to signage?
What's the difference between what looks great vs what actually works in reality?
Has a client ever pushed back on your recommendation? How did you handle it?



Intersign aren't just makers, they're experts who guide clients through material decisions, building confidence that they're in the right hands before a project even begins.
https://www.instagram.com/reels/DW3K8aiDGG7/
https://www.instagram.com/reels/DTagqfSiu4i/ - not exactly the same, but the knowledge on different materials shows expertise
Video 7: What actually happens from the moment you contact us - Borche

Hook: Most people have no idea what actually happens between the first enquiry and the finished sign. Here's what it really looks like.

Prompts:

What's the first question you always ask a new client, and why?
At what point do clients really start to trust the process?
What's the part of the process that surprises people the most?
How do you handle it when a client changes their mind halfway through?
What happens when something goes wrong in production, and how do you manage it?
Walk me through a recent job from first message to install, the key moments?



Pulls back the curtain on the full client journey and builds trust.
https://www.instagram.com/reels/Daf8X3jMD_-/
Video 8: The metal misconception (material series) - Anyone

Hook: Everyone assumes metal is the expensive option in signage. The reality's a lot more interesting.

Prompts:

What's the biggest misconception people have about metal signage?
What does metal do better than any other material?
When should you never use it?
What finishes can you get that most people don't know about?
How can you tell quality metalwork from a cheap job?
What's a project where metal was exactly the right call?



Introducing a series to break up content. Intersign speaks about their knowledge on materials and when to use it and when not to. This positions Intersign as trust-worthy.
https://www.instagram.com/reels/DVwiDI5DIiR/ - how he talks about materials, and how to use them etc.
Video 9: If I could design any sign — this is what it would be - Anyone
Hook: If I could design any sign, this is what it would be…
Prompt
1. Describe the one piece of signage you'd most want to make and what would it be?
2. Where would it live, what kind of space, what kind of light?
3. What materials would you use, and why those specifically?
4. What feeling would you want someone to have when they walked past it?
5. Is there a word or a mood, that sums up the aesthetic?
7. Has there ever been a project that got close to this? What was it?
8. If it could be anywhere in the world, where would it go?





A fun, personality-driven video that breaks the feed up, adds personality to Intersign, showcases knowledge on signage.
https://www.instagram.com/reels/DT1GNYxicXy/ - similar concept, making it personal and personal preferences
Video 10:  The signage mistakes we see everywhere - Anyone
Hook: Once you know signage, you can't unsee the mistakes. They're everywhere.
Prompt
What's the most common signage mistake you see out in the world?
What makes a sign genuinely bad, not just ugly, but wrong?
What's a simple fix most people miss?
Is there a sign around Melbourne you drive past and wish you could redo?
What separates a forgettable sign from one people actually remember?
What's the one rule you'd give anyone designing a sign?


Fun, opinionated expertise piece that breaks up the feed and shows Intersign's eye.


https://www.instagram.com/reels/DaAMfjYxn-y/
`

describe('paste from a doc: the owner’s ten videos', () => {
  const blocks = parseScriptDoc(DOC)
  it('finds all ten, in order, and drops the doc’s own title lines', () => {
    expect(blocks).toHaveLength(10)
    expect(blocks.map(b => b.title)).toEqual([
      'The Adelaide hotel project',
      'Aboriginal signage: before & after',
      'Public housing, Port Melbourne',
      'Public housing, Port Melbourne',
      '3D printing technology (b-roll + voiceover concept)',
      'Choosing the right material for the right project',
      'What actually happens from the moment you contact us',
      'The metal misconception (material series)',
      'If I could design any sign — this is what it would be',
      'The signage mistakes we see everywhere',
    ])
  })
  it('reads the presenter off the end of the title', () => {
    expect(blocks.map(b => b.presenter)).toEqual(['Kareen', 'Borche', 'Zoe', 'Francessa', 'Borche', 'Anyone', 'Borche', 'Anyone', 'Anyone', 'Anyone'])
  })
  it('knows the two voiceover concepts', () => {
    expect(blocks.map(b => b.voiceover)).toEqual([false, true, false, false, true, false, false, false, false, false])
  })
  it('keeps every hook whole, without the label', () => {
    expect(blocks[0].hook).toBe("We're designing every sign for a new hotel in Adelaide, and this is where it's at right now.")
    expect(blocks[1].hook).toBe("Once in a while, a project comes along that's bigger than signage.")
    expect(blocks[8].hook).toBe('If I could design any sign, this is what it would be…')
  })
  it('counts the prompts, numbered or not, and strips the numbers', () => {
    expect(blocks.map(b => b.prompts.length)).toEqual([9, 9, 8, 6, 8, 7, 6, 6, 7, 6])
    expect(blocks[8].prompts[0]).toBe("Describe the one piece of signage you'd most want to make and what would it be?")
    expect(blocks[0].prompts[8]).toBe("Where's the design up to right now, and what's the next stage?")
  })
  it('reads the visual direction and leaves the purpose paragraph as the purpose', () => {
    expect(blocks[0].visual).toBe('B-rolls of the process, designing, before and after.')
    expect(blocks[0].purpose).toMatch(/^A behind-the-scenes look/)
    expect(blocks[0].purpose).toMatch(/Introducing more women to the camera\.$/)
    // a purpose paragraph with no "Visual direction" line before it is still the purpose, not a prompt
    expect(blocks[5].visual).toBe('')
    expect(blocks[5].purpose).toMatch(/^Intersign aren't just makers/)
    // the voiceover explainer above the hook is purpose too
    expect(blocks[1].purpose).toMatch(/^This is a voiceover concept\./)
  })
  it('collects the reference links, https only, and keeps a note beside a link as purpose', () => {
    expect(blocks[0].links).toEqual(['https://www.instagram.com/reels/DXGnSoIkZfG/'])
    expect(blocks[3].links).toEqual(['https://au.pinterest.com/pin/974325700657567193', 'https://www.instagram.com/reels/DW3K8aiDGG7/'])
    expect(blocks[5].links).toEqual(['https://www.instagram.com/reels/DW3K8aiDGG7/', 'https://www.instagram.com/reels/DTagqfSiu4i/'])
    expect(blocks[5].purpose).toMatch(/not exactly the same, but the knowledge on different materials shows expertise$/)
  })
  it('an empty paste is nothing, and one without "Video N:" lines is nothing', () => {
    expect(parseScriptDoc('')).toEqual([])
    expect(parseScriptDoc('Just some notes\nHook: no video line')).toEqual([])
  })
})

describe('the sanitiser', () => {
  it('keeps the shape, clips, drops non-https links and empty blocks', () => {
    const out = sanitiseScripts([
      { id: 'a', title: ' T ', presenter: 'P', voiceover: 'yes', hook: 'H', prompts: ['q1', '', 7, 'q2'], visual: 'V', purpose: 'W', links: ['https://x.test/a', 'http://x.test/b', 'nope'] },
      { id: 'empty' },
      'junk',
    ])
    expect(out).toEqual([{ id: 'a', title: 'T', presenter: 'P', voiceover: false, hook: 'H', prompts: ['q1', '7', 'q2'], visual: 'V', purpose: 'W', links: ['https://x.test/a'], body: '' }])
    expect(sanitiseScripts(null)).toEqual([])
    expect(sanitiseScripts(Array.from({ length: 40 }, (_, i) => ({ hook: `h${i}` })))).toHaveLength(30)
  })
  it('fills the "Script or talking points" part only with a hook or prompts', () => {
    expect(scriptsFilled([{ title: 'Only a title' }])).toBe(false)
    expect(scriptsFilled([{ hook: 'Once…' }])).toBe(true)
    expect(scriptsFilled([{ prompts: ['why?'] }])).toBe(true)
  })
})

describe('the words every reader prints', () => {
  const b: ScriptBlock = { id: 'x', title: 'Hotel', presenter: 'Kareen', voiceover: true, hook: 'Hi', prompts: ['A?', 'B?'], visual: 'B-roll', purpose: 'Why', links: ['https://x.test/1'], body: '' }
  it('one heading and the body lines, in reading order', () => {
    expect(scriptWords([b])).toEqual([{ n: 1, heading: 'Video 1 · Hotel · Kareen · voiceover concept', lines: ['Hook: Hi', 'Prompts:', '1. A?', '2. B?', 'Visual direction: B-roll', 'Purpose: Why', 'https://x.test/1'] }])
    expect(scriptsText([b])).toBe('Video 1 · Hotel · Kareen · voiceover concept\nHook: Hi\nPrompts:\n1. A?\n2. B?\nVisual direction: B-roll\nPurpose: Why\nhttps://x.test/1')
  })
})

describe('a script written on the shoot page: a name and its words (the owner, 15 Sep 2026)', () => {
  it('keeps the body, counts it as content, and prints it as its own section, paragraph by paragraph', () => {
    const [s] = sanitiseScripts([{ id: 's1', title: 'The hotel project', body: '  Hi, I am Kareen.\r\nWe design every sign.\n\n\nSecond paragraph.  \n' }])
    expect(s.body).toBe('Hi, I am Kareen.\nWe design every sign.\n\n\nSecond paragraph.')
    expect(scriptsFilled([{ title: 'Named only' }])).toBe(false)
    expect(scriptsFilled([{ body: 'Words' }])).toBe(true)
    expect(scriptWords([s])).toEqual([{ n: 1, heading: 'Script 1 · The hotel project', lines: ['Hi, I am Kareen.', 'We design every sign.', '', 'Second paragraph.'] }])
    expect(scriptsText([s])).toBe('Script 1 · The hotel project\nHi, I am Kareen.\nWe design every sign.\n\nSecond paragraph.')
  })
  it('an empty script is not kept; an unnamed one prints as Untitled; a body is clipped at 8000', () => {
    expect(sanitiseScripts([{ id: 'e', title: '', body: '   ' }])).toEqual([])
    expect(scriptWords(sanitiseScripts([{ body: 'Go.' }]))[0].heading).toBe('Script 1 · Untitled')
    expect(sanitiseScripts([{ body: 'x'.repeat(9000) }])[0].body).toHaveLength(8000)
  })
  it('the shoot page has the editor, with Add another script (source pins)', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('app/dashboard/production/shoots/[id]/ShootSop.tsx', 'utf8')).toContain("<ScriptsEditor scripts={batch.scripts} onSave={v => void onPatch('scripts', v)} disabled={busy} />")
    const ed = readFileSync('app/dashboard/production/shoots/[id]/ScriptsEditor.tsx', 'utf8')
    expect(ed).toContain("{blocks.length === 0 ? 'Add a script' : 'Add another script'}")
    expect(ed).toContain('placeholder="Script name — e.g. The hotel project"')
  })
})
