import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 29 Oct 2026: "where else does this thing appear on portal? also when we input it in the shoots will it come out as
// hyperlink? like the input fields"
describe('links in a shoot plan open', () => {
  it('on the client’s portal "See the plan": the notes, what is being made, the shot list and the scripts', () => {
    const s = readFileSync('app/components/portal/PortalBoard.tsx', 'utf8')
    expect(s).toContain('<LinkedText text={card.shoot.concept} />')
    expect(s).toContain('<Chip key={d.id} tone="surface"><LinkedText text={d.title} /></Chip>')
    expect(s).toContain('<LinkedText text={r.text} />')
    expect(s).toContain(String.raw`<LinkedText text={w.lines.join('\n')} />`)
  })
  it('under every field of the shoot page that holds one', () => {
    const s = readFileSync('app/dashboard/production/shoots/[id]/ShootSop.tsx', 'utf8')
    expect(s).toContain('<LinksIn text={String(batch[field] ?? \'\')} className="mt-1.5" />')
    expect(s).toContain('<LinksIn text={l.title} className="pl-7" />')
    expect(s).toContain('<LinksIn text={shot.text} className="pl-9" />')
  })
  it('a link opens in a new tab and nothing typed is run as HTML', () => {
    const s = readFileSync('app/components/LinkedText.tsx', 'utf8')
    expect(s).toContain('target="_blank" rel="noopener noreferrer"')
    expect(s).not.toContain('dangerouslySetInnerHTML')
  })
})
